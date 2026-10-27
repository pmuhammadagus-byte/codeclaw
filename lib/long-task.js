// 🛡️ P0-3: Long-task handler — misi teks panjang tanpa hang
import fs from "node:fs";
import path from "node:path";

const MISSION_DIR = "/tmp/codeclaw-missions";
const MAX_CHARS_DIRECT = 4000;

export function shouldChunk(text) {
  return typeof text === "string" && text.length > MAX_CHARS_DIRECT;
}

export function saveMission(chatId, text) {
  fs.mkdirSync(MISSION_DIR, { recursive: true });
  const id = `${chatId}-${Date.now()}`;
  const file = path.join(MISSION_DIR, `${id}.md`);
  fs.writeFileSync(file, text, "utf8");
  return { id, file, size: text.length, lines: text.split("\n").length };
}

export function buildMissionPrompt(file, size, lines) {
  return `[MODE MISI PANJANG]
Teks mission: ${size} karakter, ${lines} baris
Tersimpan di: ${file}

LANGKAH WAJIB (jangan dilanggar):
1. Baca file via read_file BERTAHAP, maks 200 baris per panggilan:
   - start=1 end=200, start=201 end=400, start=401 end=600, dst.
   - JANGAN baca sekaligus (bisa OOM/hang).
2. Setelah selesai baca semua baris, ringkas jadi 5 bullet poin.
3. Kirim ringkasan ke user, lalu TANYA:
   "Apakah saya boleh mulai eksekusi? (ya/tidak)"
4. Jika user bilang "ya", eksekusi BERTAHAP per bagian (per ## heading).
5. Setiap bagian selesai, kirim progress:
   "✅ Bagian X/Y selesai: [nama bagian]"

LARANGAN:
- JANGAN eksekusi sebelum user konfirmasi "ya".
- JANGAN tulis kode sebelum konfirmasi.
- JANGAN proses semua bagian dalam satu shot.`;
}

export function estimateTokens(msg) {
  const str = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return Math.ceil(str.length / 4);
}

export function listMissions() {
  if (!fs.existsSync(MISSION_DIR)) return [];
  return fs.readdirSync(MISSION_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => ({
      id: f.replace(".md", ""),
      file: path.join(MISSION_DIR, f),
      size: fs.statSync(path.join(MISSION_DIR, f)).size,
      mtime: fs.statSync(path.join(MISSION_DIR, f)).mtime.toISOString()
    }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}
