#!/usr/bin/env node
// Entrypoint riset harian untuk crontab.
//
// Dipanggil tiap jam oleh cron. Interval 24 jam TIDAK dijaga di sini —
// lib/cron.js yang menolak kalau belum 24 jam (.cron-state.json).
// Jadi panggilan per jam aman: 23 di antaranya akan jadi no-op cepat.
//
// Exit code selalu 0 kecuali error fatal, supaya cron tidak mengirim
// email kegagalan tiap jam.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCronOnce } from "../lib/cron.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, "..", "cron.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.appendFileSync(LOG, line + "\n");
  } catch {
    // Log gagal bukan alasan menggagalkan riset.
  }
}

// Cegah dua instance jalan bersamaan (mis. cron jam ini belum selesai
// saat jam berikutnya menembak). Lock sederhana berbasis file + pid.
const LOCK = path.join(__dirname, "..", ".cron.lock");
function acquireLock() {
  try {
    const pid = parseInt(fs.readFileSync(LOCK, "utf8"), 10);
    if (pid > 0) {
      try {
        process.kill(pid, 0); // masih hidup?
        return false;
      } catch {
        // pid sudah mati — lock basi, boleh diambil alih.
      }
    }
  } catch {
    // Lock belum ada.
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}

function releaseLock() {
  try {
    const pid = parseInt(fs.readFileSync(LOCK, "utf8"), 10);
    if (pid === process.pid) fs.unlinkSync(LOCK);
  } catch {
    // Sudah hilang, tidak masalah.
  }
}

async function main() {
  if (!acquireLock()) {
    log("skip: instance lain masih jalan");
    return;
  }

  try {
    const r = await runCronOnce();

    if (r.skipped) {
      log(`skip: ${r.reason}`);
      return;
    }

    log(`run: ${r.results.length} topik, budget ${r.todayCount}/${r.budget}`);
    for (const x of r.results) {
      if (x.error) {
        log(`  ✗ ${x.topic}: ${x.error}`);
        continue;
      }
      const parts = Object.entries(x.stats ?? {})
        .map(([src, s]) => `${src} ${s.kept}/${s.total}`)
        .join(", ");
      const kw = (x.keywords ?? []).join("+");
      log(`  ✓ ${x.topic}: +${x.added ?? 0} entri${parts ? ` [${parts}]` : ""}${kw ? ` kw=${kw}` : ""}`);
      for (const e of x.errors ?? []) log(`      ! ${e}`);
    }
  } finally {
    releaseLock();
  }
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(0); // Jangan bikin cron bising; detail sudah di cron.log.
});
