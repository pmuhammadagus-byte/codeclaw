/**
 * isolated-exec.mjs — di-preload lewat NODE_OPTIONS="--import ..."
 *
 * Masalah yang diperbaiki (child_process.exec bawaan):
 *   - stdio berupa PIPE, dan anak berada di process group yang sama dengan bot.
 *     Akibat: command yang mematikan bot membunuh dirinya sendiri di tengah
 *     jalan (promise tak pernah resolve), dan saat bot mati semua anak kena
 *     EPIPE/SIGHUP walau command-nya tidak bersalah.
 *
 * Solusi: exec diganti implementasi berbasis spawn dengan
 *   - detached  -> process group sendiri, aman dari signal group bot
 *   - stdio file -> tidak ada pipe, jadi tidak ada EPIPE
 *   - sumber exit code: event 'exit' (utama) + file rc (cadangan, untuk kasus
 *     shell berhenti sebelum sempat menulis, mis. `kill -9 $$`)
 *   - timeout membunuh seluruh process group, bukan hanya anak langsung
 */
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { syncBuiltinESMExports } from "node:module";

const STATE_DIR = path.join(os.tmpdir(), "codeclaw-exec");

function isValidShell(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Hormati options.shell seperti exec bawaan:
//   string  -> pakai itu
//   false/undefined -> fallback ke $SHELL / /bin/bash
function resolveShell(opt) {
  const s = opt?.shell;
  if (typeof s === "string" && s && isValidShell(s)) return s;
  const env = process.env.CODECLAW_SHELL || process.env.SHELL;
  if (env && isValidShell(env)) return env;
  return "/bin/bash";
}

let seq = 0;
function workDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const d = path.join(STATE_DIR, `${process.pid}-${Date.now()}-${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readSafe(p, max) {
  try {
    const s = fs.readFileSync(p, "utf8");
    return s.length > max ? s.slice(0, max) : s;
  } catch {
    return "";
  }
}

function isolatedExec(command, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  options = options || {};
  const cb = typeof callback === "function" ? callback : () => {};

  const maxBuffer = options.maxBuffer || 1024 * 1024;
  const timeout = options.timeout || 0;
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };
  const dir = workDir();
  const outFile = path.join(dir, "out");
  const errFile = path.join(dir, "err");
  const rcFile = path.join(dir, "rc");

  // `command` dibungkus sedemikian rupa agar exit code tetap tercatat walau
  // parent (bot) sudah mati duluan.
  const wrapped =
    `{ ${command}\n}; __rc=$?; printf '%s' "$__rc" > '${rcFile}'; exit "$__rc"`;

  const outFd = fs.openSync(outFile, "w");
  const errFd = fs.openSync(errFile, "w");

  let child;
  try {
    child = cp.spawn(resolveShell(options), ["-c", wrapped], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }

  let done = false;
  let timer = null;

  const cleanupFiles = () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  };

  const finish = (err, res) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    if (err) {
      err.cmd = command;
      err.stdout = res.stdout;
      err.stderr = res.stderr;
      cb(err);
    } else {
      cb(null, res);
    }
    cleanupFiles();
  };

  const collect = (fallbackCode, signal, killedByTimeout) => {
    const stdout = readSafe(outFile, maxBuffer);
    const stderr = readSafe(errFile, maxBuffer);
    const res = { stdout, stderr };

    if (killedByTimeout) {
      const e = new Error(`Command timed out after ${timeout}ms`);
      e.code = "ETIMEDOUT";
      e.killed = true;
      e.signal = "SIGKILL";
      return finish(e, res);
    }

    // File rc lebih akurat untuk kasus `exit N` / shell yang mati mendadak.
    let code = fallbackCode;
    const rcRaw = readSafe(rcFile, 32).trim();
    if (/^-?\d+$/.test(rcRaw)) code = Number(rcRaw);
    if (code === null || code === undefined) code = signal ? 137 : 0;

    if (code !== 0) {
      const e = new Error(`Command failed: ${command}`);
      e.code = code;
      e.signal = signal || undefined;
      return finish(e, res);
    }
    res.code = 0;
    res.signal = signal || null;
    finish(null, res);
  };

  child.on("exit", (code, signal) => collect(code, signal, false));

  child.on("error", (e) => {
    if (done) return;
    e.code = e.code ?? -1;
    finish(e, { stdout: readSafe(outFile, maxBuffer), stderr: readSafe(errFile, maxBuffer) });
  });

  if (timeout > 0) {
    timer = setTimeout(() => {
      if (done) return;
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
      collect(null, "SIGKILL", true);
    }, timeout);
  }

  return child;
}

// Promisify eksplisit: dipakai luas oleh `promisify(exec)` di modul lain.
isolatedExec[promisify.custom] = (command, options) =>
  new Promise((resolve, reject) => {
    isolatedExec(command, options, (err, res) => (err ? reject(err) : resolve(res)));
  });

const orig = cp.exec;
function patchedExec(...args) {
  try {
    return isolatedExec(...args);
  } catch {
    return orig(...args);
  }
}
patchedExec[promisify.custom] = isolatedExec[promisify.custom];

cp.exec = patchedExec;
syncBuiltinESMExports(); // wajib: agar `import { exec }` melihat versi patch

if (process.env.CODECLAW_EXEC_DEBUG === "1") {
  console.error("[isolated-exec] aktif");
}
