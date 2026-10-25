import test from "node:test";
import assert from "node:assert/strict";

import { diffLines, formatDiff } from "../lib/diff.js";
import { parseError, formatParsed } from "../lib/error-parser.js";
import { isDangerous, isSafeReadOnly, needsApproval, isBlocked } from "../lib/safety.js";
import { BRAIN_LEVELS, getBrainPrompt, isValidLevel } from "../lib/brain.js";

// ---------- diff ----------

test("diffLines: teks identik menghasilkan hanya ctx", () => {
  const out = diffLines("a\nb\nc", "a\nb\nc");
  assert.ok(out.every((op) => op.type === "ctx"));
});

test("diffLines: mendeteksi penambahan baris", () => {
  const out = diffLines("a\nb", "a\nb\nc");
  assert.ok(out.some((op) => op.type === "add" && op.text === "c"));
});

test("diffLines: mendeteksi penghapusan baris", () => {
  const out = diffLines("a\nb\nc", "a\nc");
  assert.ok(out.some((op) => op.type === "del" && op.text === "b"));
});

test("diffLines: perubahan di tengah menghasilkan add + del", () => {
  const out = diffLines("a\nlama\nc", "a\nbaru\nc");
  assert.ok(out.some((op) => op.type === "del" && op.text === "lama"));
  assert.ok(out.some((op) => op.type === "add" && op.text === "baru"));
});

test("diffLines: guard ukuran besar memakai jalur info, tanpa DP", () => {
  const big = Array.from({ length: 400 }, (_, i) => `line${i}`).join("\n");
  const out = diffLines(big, big + "\nextra");
  assert.equal(out[0].type, "info");
  assert.match(out[0].text, /diff too large/);
});

test("diffLines: menyisipkan pemisah '...' untuk blok yang berjauhan", () => {
  const oldText = Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n");
  const newText = oldText.replace("l5", "X").replace("l50", "Y");
  const out = diffLines(oldText, newText);
  assert.ok(out.some((op) => op.type === "info" && op.text === "..."));
});

test("formatDiff: header memuat path dan statistik +/-", () => {
  const text = formatDiff("lib/a.js", [{ type: "add", text: "x" }, { type: "del", text: "y" }]);
  assert.match(text, /^--- lib\/a\.js \(\+1 -1\) ---$/m);
  assert.match(text, /^\+x$/m);
  assert.match(text, /^-y$/m);
});

test("formatDiff: baris ctx diawali spasi tunggal", () => {
  const text = formatDiff("f", [{ type: "ctx", text: "same" }]);
  assert.ok(text.split("\n").includes(" same"));
});

// ---------- error-parser ----------

test("parseError: Node stack trace → file, line, col", () => {
  const { locations, errorType } = parseError(
    "TypeError: boom\n    at run (/app/lib/tools.js:42:13)"
  );
  const loc = locations.find((l) => l.file === "/app/lib/tools.js");
  assert.ok(loc, "lokasi /app/lib/tools.js harus terdeteksi");
  assert.equal(loc.line, 42);
  assert.equal(loc.col, 13);
  assert.equal(loc.lang, "node");
  assert.equal(errorType, "TypeError");
});

test("parseError: Python traceback → line tanpa col", () => {
  const { locations } = parseError('Traceback (most recent call last):\n  File "/srv/app/main.py", line 88');
  const loc = locations.find((l) => l.file === "/srv/app/main.py");
  assert.ok(loc);
  assert.equal(loc.line, 88);
  assert.equal(loc.col, null);
  assert.equal(loc.lang, "python");
});

test("parseError: format generik 'file.go:12'", () => {
  const { locations } = parseError("main.go:12 something");
  const loc = locations.find((l) => l.file === "main.go");
  assert.ok(loc);
  assert.equal(loc.line, 12);
});

test("parseError: dedup lokasi yang sama", () => {
  const { locations } = parseError("/a/b.js:7\n/a/b.js:7:9\n/a/b.js:7");
  assert.equal(locations.filter((l) => l.file === "/a/b.js" && l.line === 7).length, 1);
});

test("parseError: dibatasi maksimal 10 lokasi", () => {
  const output = Array.from({ length: 30 }, (_, i) => `/x/f${i}.js:${i + 1}`).join("\n");
  assert.equal(parseError(output).locations.length, 10);
});

test("parseError: input tanpa lokasi mengembalikan array kosong", () => {
  const parsed = parseError("semua aman");
  assert.deepEqual(parsed.locations, []);
  assert.equal(parsed.errorType, null);
  assert.equal(parsed.raw, "semua aman");
});

test("formatParsed: output human-readable", () => {
  const text = formatParsed(parseError("Error: x\n    at f (/p/q.js:3:4)"));
  assert.match(text, /Error type: Error/);
  assert.match(text, /Locations:/);
  assert.match(text, /\/p\/q\.js:3:4 \(node\)/);
});

test("formatParsed: pesan fallback bila kosong", () => {
  assert.equal(formatParsed({ locations: [], errorType: null }), "No locations or error type found.");
});

// ---------- safety ----------

test("safety: rm -rf pada root dianggap berbahaya", () => {
  assert.equal(isDangerous("rm -rf /"), true);
});

test("safety: sudo diblokir", () => {
  assert.equal(isDangerous("sudo apt install x"), true);
});

test("safety: git push --force diblokir", () => {
  assert.equal(isDangerous("git push origin main --force"), true);
});

test("safety: git reset --hard diblokir", () => {
  assert.equal(isDangerous("git reset --hard HEAD~1"), true);
});

test("safety: command biasa dianggap aman", () => {
  assert.equal(isDangerous("npm test"), false);
  assert.equal(isDangerous("ls -la"), false);
});

test("safety: isSafeReadOnly mengenali command baca", () => {
  assert.equal(isSafeReadOnly("cat file.txt"), true);
  assert.equal(isSafeReadOnly("grep -r foo ."), true);
  assert.equal(isSafeReadOnly("git status"), true);
  assert.equal(isSafeReadOnly("node --check index.js"), true);
  assert.equal(isSafeReadOnly("rm -rf /tmp/x"), false);
});

test("safety: needsApproval mengikuti mode", () => {
  assert.equal(needsApproval("npm test", "all"), true);
  assert.equal(needsApproval("rm -rf /", "none"), false);
  assert.equal(needsApproval("rm -rf /", "dangerous-only"), true);
  assert.equal(needsApproval("npm test", "dangerous-only"), false);
});

test("safety: isBlocked menolak edit file inti CodeClaw", () => {
  assert.equal(isBlocked("echo x > codeclaw/lib/safety.js"), true);
  assert.equal(isBlocked("sed -i s/a/b/ codeclaw/index.js"), true);
});

test("safety: isBlocked mengizinkan baca file inti CodeClaw", () => {
  assert.equal(isBlocked("cat codeclaw/lib/safety.js"), false);
  assert.equal(isBlocked("grep -n test codeclaw/index.js"), false);
});

test("safety: isBlocked menolak tulis ke /etc/hosts", () => {
  assert.equal(isBlocked("echo 1.2.3.4 >> /etc/hosts"), true);
  assert.equal(isBlocked("cat /etc/hosts"), false);
});

test("safety: isBlocked menolak edit .bashrc tapi izinkan baca", () => {
  assert.equal(isBlocked("echo alias >> ~/.bashrc"), true);
  assert.equal(isBlocked("cat ~/.bashrc"), false);
});

// ---------- brain ----------

test("brain: level yang tersedia", () => {
  assert.deepEqual(BRAIN_LEVELS, ["off", "normal", "high", "genius"]);
});

test("brain: isValidLevel memvalidasi input", () => {
  assert.equal(isValidLevel("high"), true);
  assert.equal(isValidLevel("genius"), true);
  assert.equal(isValidLevel("turbo"), false);
  assert.equal(isValidLevel(undefined), false);
});

test("brain: getBrainPrompt mengembalikan prompt sesuai level", () => {
  assert.match(getBrainPrompt("high"), /BRAIN MODE: HIGH/);
  assert.match(getBrainPrompt("normal"), /BRAIN MODE: NORMAL/);
});

test("brain: level 'off' menghasilkan prompt kosong", () => {
  assert.equal(getBrainPrompt("off"), "");
});

test("brain: level tidak dikenal tidak melempar error", () => {
  assert.doesNotThrow(() => getBrainPrompt("turbo"));
});
