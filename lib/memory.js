import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, "..", "memory.jsonl");

export function memorySection(session, chatId) {
  const mems = session.memList(chatId);
  if (!mems.length) return "";
  return `\n\n## USER PREFERENCES\n${mems.map(m => `- ${m.key}: ${m.value}`).join("\n")}`;
}

// ==========================================
// HERMES-STYLE EXPERIENTIAL MEMORY
// ==========================================

export function retrieveExperiences(task, limit = 3) {
  if (!fs.existsSync(MEMORY_FILE)) return "";
  
  const lines = fs.readFileSync(MEMORY_FILE, "utf8").split("\n").filter(Boolean);
  const keywords = task.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  
  const matched = [];
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lowerLine.includes(kw)) score++;
    }
    if (score > 0) matched.push({ score, line });
  }

  if (matched.length === 0) return "";

  matched.sort((a, b) => b.score - a.score);
  const top = matched.slice(0, limit).map(m => {
    try {
      const data = JSON.parse(m.line);
      return `- Task: "${data.task}"\n  Insight: ${data.insight}`;
    } catch { return ""; }
  }).filter(Boolean);

  if (top.length === 0) return "";
  return `\n\n## PENGALAMAN MASA LALU (Gunakan ini agar tidak mengulangi kesalahan)\n${top.join("\n")}`;
}

export function saveExperience(task, insight, success) {
  const entry = {
    ts: new Date().toISOString(),
    task: task.slice(0, 100),
    insight,
    success
  };
  fs.appendFileSync(MEMORY_FILE, JSON.stringify(entry) + "\n");
  compressMemory();
}

export function compressMemory() {
  if (!fs.existsSync(MEMORY_FILE)) return;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  const stat = fs.statSync(MEMORY_FILE);
  if (stat.size <= MAX_BYTES) return;

  const lines = fs.readFileSync(MEMORY_FILE, "utf8").split("\n").filter(Boolean);
  const recent = lines.slice(-10); // simpan 10 entri terbaru
  const older = lines.slice(0, -10);

  let summary = "";
  if (older.length > 0) {
    const successCount = older.filter(l => {
      try { return JSON.parse(l).success; } catch { return false; }
    }).length;
    summary = JSON.stringify({
      ts: new Date().toISOString(),
      task: `Ringkasan ${older.length} pengalaman sebelumnya`,
      insight: `${successCount}/${older.length} sukses. Dikompresi untuk mencegah pembengkakan file.`,
      success: true
    }) + "\n";
  }

  fs.writeFileSync(MEMORY_FILE, summary + recent.join("\n") + "\n");
}

export async function reflectExperience(llm, task, messages) {
  // Cari pesan user terakhir untuk membatasi konteks HANYA pada task saat ini
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      startIndex = i;
      break;
    }
  }
  const currentRun = messages.slice(startIndex);

  const historyStr = currentRun
    .filter(m => m.role === "user" || (m.role === "assistant" && m.content) || m.role === "tool")
    .map(m => {
      if (m.role === "tool") return `[tool:${m.name}]: ${String(m.content).slice(0, 200)}`;
      return `[${m.role}]: ${m.content}`;
    })
    .join("\n");

  const prompt = `Tugas sebelumnya: "${task}"
Riwayat eksekusi:
${historyStr}

Tugasmu: Evaluasi eksekusi di atas. Berikan 1 kalimat singkat (maksimal 15 kata) tentang "Insight" atau pelajaran yang didapat. 
Contoh: "Pencarian 'harga BTC' di web search lokal mengembalikan harga Emas, harus pakai kata 'Bitcoin USD'."
Jangan basa-basi, langsung berikan kalimat insight-nya saja.`;

  try {
    const res = await llm.chat({ messages: [{ role: "user", content: prompt }] });
    return res.message.content?.trim() || "Task selesai.";
  } catch (e) {
    return "Task selesai (reflection gagal).";
  }
}
