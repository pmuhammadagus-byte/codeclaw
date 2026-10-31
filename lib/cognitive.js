// lib/cognitive.js — Externalized cognition layer
// Membuat LLM model apa pun berpikir seperti frontier model:
// PLANNER → EXECUTOR → CRITIC → FIXER

// 🛡️ P0-3: TIMEOUT wrapper untuk LLM call
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timeout setelah ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const ROLES = {
  planner: `Kamu adalah PLANNER. Tugas HANYA merencanakan, TIDAK mengeksekusi.
Jangan sebut "saya akan", cukup output rencana.
Format WAJIB:
TAHAP 1: <judul singkat>
- Tool: <nama tool yang akan dipakai>
- Aksi: <apa yang dikerjakan>
- Risiko: <kalau ada, kalau tidak tulis "-">

TAHAP 2: <...>
...

Maksimal 5 tahap. Jangan basa-basi.`,

  critic: `Kamu adalah CRITIC yang KERAS. Tugas HANYA cari kesalahan, BUKAN memuji.
Format WAJIB:
STATUS: OK
(atau)
STATUS: PERBAIKI
MASALAH:
1. <poin konkret>
2. <poin konkret>

Aturan:
- "Tidak ada masalah" hanya kalau benar-benar sempurna
- Sebut fakta yang salah/halusinasi kalau ada
- Sebut langkah yang terlewat kalau ada
- Jangan komentar gaya bahasa, fokus substansi`,

  fixer: `Kamu adalah FIXER. Tugas perbaiki hasil sesuai KRITIK yang diberikan.
Aturan:
- Fokus HANYA pada masalah yang disebutkan
- Jangan ubah bagian yang tidak dikritik
- Output jawaban final yang sudah diperbaiki, format sama seperti hasil awal
- Jangan jelaskan apa yang kamu ubah, langsung jawaban final`,

  synthesizer: `Kamu adalah SYNTHESIZER. Gabungkan hasil kerja menjadi jawaban final untuk user.
Jangan sebut "tahap planner", "kritik", "fixer". 
Langsung jawaban yang rapi dan lengkap.`
};

export async function planTask(llm, task, onLog = () => {}) {
  onLog("🧠 [Otak 1/3] Merencanakan...");
  try {
    const res = await withTimeout(llm.chat({
      messages: [
        { role: "system", content: ROLES.planner },
        { role: "user", content: `Tugas user: ${task}\n\nBuat rencana eksekusi.` }
      ]
    }), 90000, "LLM");
    const plan = res.message.content?.trim() || "";
    onLog(`🧠 [Otak 1/3] Rencana:\n${plan.slice(0, 300)}`);
    return plan;
  } catch (e) {
    onLog(`🧠 [Otak 1/3] Planner gagal: ${e.message}`);
    return "";
  }
}

export async function critiqueResult(llm, task, result, onLog = () => {}) {
  onLog("🧠 [Otak 2/3] Mengkritik hasil...");
  try {
    const res = await withTimeout(llm.chat({
      messages: [
        { role: "system", content: ROLES.critic },
        { role: "user", content: `Tugas user: ${task}\n\nHasil yang akan dikritik:\n${result}\n\nCari kesalahan atau hal terlewat.` }
      ]
    }), 90000, "LLM");
    const critique = res.message.content?.trim() || "STATUS: OK";
    onLog(`🧠 [Otak 2/3] Kritik: ${critique.slice(0, 200)}`);
    return critique;
  } catch (e) {
    onLog(`🧠 [Otak 2/3] Critic gagal: ${e.message}`);
    return "STATUS: OK"; // Fail-open: jangan block kalau critic error
  }
}

export async function fixResult(llm, task, result, critique, onLog = () => {}) {
  onLog("🧠 [Otak 3/3] Memperbaiki...");
  try {
    const res = await withTimeout(llm.chat({
      messages: [
        { role: "system", content: ROLES.fixer },
        { role: "user", content: `Tugas: ${task}\n\nKritik:\n${critique}\n\nHasil awal:\n${result}\n\nBerikan hasil yang sudah diperbaiki.` }
      ]
    }), 90000, "LLM");
    const fixed = res.message.content?.trim() || result;
    onLog(`🧠 [Otak 3/3] Hasil diperbaiki (${fixed.length} char)`);
    return fixed;
  } catch (e) {
    onLog(`🧠 [Otak 3/3] Fixer gagal: ${e.message}`);
    return result; // Fail-safe: kembalikan hasil awal
  }
}

export function shouldCritique(critique) {
  const text = String(critique || "");
  const upper = text.toUpperCase();

  // 1) Cek eksplisit PERBAIKI dulu (prioritas tertinggi)
  if (/STATUS\s*:\s*PERBAIKI/.test(upper)) return true;

  // 2) Cek OK di mana pun (toleran markdown/preamble), kecuali ada "PERBAIKI"
  if (/STATUS\s*:\s*OK\b/.test(upper)) {
    // Guard: kalau ternyata ada daftar MASALAH konkret, tetap perbaiki
    if (/MASALAH\s*:\s*\n\s*\d+\./.test(upper)) return true;
    return false;
  }

  // 3) Fallback: TIDAK jelas → JANGAN fix (default false, hindari over-fix)
  // Alasan: over-fix = 2x token terbuang. Kalau critic ngaco, lebih baik respons awal.
  return false;
}
