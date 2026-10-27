// lib/autonomous-learning.js — Riset mandiri harian
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";
import { saveExperience } from "./memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, "..", "learning-log.jsonl");
const STATE_FILE = path.join(__dirname, "..", ".learning-state.json");

const TOPICS = [
  "AI coding agent techniques 2026",
  "LLM agent architecture patterns",
  "prompt engineering best practices latest",
  "self-improving AI agents research",
  "tool use in language models",
  "chain of thought reasoning improvements",
  "RAG retrieval augmented generation tips",
  "multi-agent orchestration patterns",
  "agent safety and guardrails",
  "code generation evaluation benchmarks",
  "context window management strategies",
  "memory systems for AI agents",
];

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { lastRun: 0, seenTopics: [], todayCount: 0, todayDate: "" }; }
}

function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function pickTopics(seen, n) {
  const unseen = TOPICS.filter(t => !seen.includes(t));
  const pool = unseen.length >= n ? unseen : TOPICS;
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

function findSearchTool() {
  const t = TOOL_DEFINITIONS.find(x => x.function.name === "web_search")
         || TOOL_DEFINITIONS.find(x => /search|web_fetch|fetch/i.test(x.function.name));
  return t?.function.name;
}

export async function runDailyLearning(llm, onLog = () => {}, { force = false } = {}) {
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);
  if (state.todayDate !== today) { state.todayDate = today; state.todayCount = 0; }
  const now = Date.now();
  const DAY = 6 * 60 * 60 * 1000;  // 6 jam

  if (!force && now - state.lastRun < DAY * 0.95) {
    onLog(`🎓 Skip learning (terakhir: ${Math.round((now - state.lastRun)/3600000)}h lalu)`);
    return { skipped: true };
  }

  const searchTool = findSearchTool();
  if (!searchTool) {
    onLog("🎓 ❌ Tidak ada tool search yang terdaftar. Cek tools.js");
    return { error: "no_search_tool" };
  }

  onLog(`🎓 Autonomous learning dimulai (tool: ${searchTool})`);

  if (!force && state.todayCount >= 4) {
    onLog("🎓 Skip: sudah 4x riset hari ini (limit)");
    return { skipped: true };
  }
  const picked = pickTopics(state.seenTopics || [], 2);
  state.todayCount = (state.todayCount || 0) + 1;
  const results = [];

  for (const topic of picked) {
    onLog(`🎓 📖 Riset: ${topic}`);

    // 1. LLM bikin query pencarian yang tajam
    let query = topic;
    try {
      const qr = await llm.chat({
        messages: [{ role: "user", content: `Ubah topik ini jadi query pencarian Google yang singkat & tajam (maks 8 kata). Output HANYA query, tanpa tanda kutip atau penjelasan.\n\nTopik: ${topic}` }]
      });
      query = (qr.message.content || topic).trim().split("\n")[0].replace(/^["'`]+|["'`]+$/g, "").slice(0, 100);
    } catch {}
    onLog(`🎓 🔍 Query: "${query}"`);

    // 2. Cari di web
    let searchText;
    try {
      const r = await executeTool(searchTool, { query }, {
        approvalCallback: async () => true,
        approvalMode: "none",
      });
      searchText = String(r || "");
      if (/^error|failed|❌/i.test(searchText.trim())) {
        onLog(`🎓 ⚠️  Search gagal: ${searchText.slice(0, 100)}`);
        continue;
      }
    } catch (e) {
      onLog(`🎓 ⚠️  Search error: ${e.message}`);
      continue;
    }

    // 3. LLM PAHAMI hasil → ekstrak insight
    let insight = "";
    try {
      const ir = await llm.chat({
        messages: [
          { role: "system", content: "Kamu adalah peneliti AI yang tajam. Tugas: baca hasil pencarian, ekstrak SATU pelajaran konkret yang berguna untuk agent AI coding. Jangan ringkas, jangan basa-basi." },
          { role: "user", content: `Topik: ${topic}\n\nHasil pencarian:\n${searchText.slice(0, 3500)}\n\nFormat output WAJIB (1 kalimat, max 20 kata):\n"Pelajari bahwa <insight konkret>."\n\nKalau hasil pencarian tidak informatif, tulis: "TIDAK INFORMATIF"` }
        ]
      });
      insight = (ir.message.content || "").trim().split("\n")[0];
    } catch (e) {
      onLog(`🎓 ⚠️  Insight error: ${e.message}`);
      continue;
    }

    if (!insight || /TIDAK INFORMATIF/i.test(insight) || insight.length < 15) {
      onLog(`🎓 ⚠️  Insight tidak berguna, skip`);
      continue;
    }

    // 4. Simpan ke memory (otomatis dipakai retrieveExperiences nanti)
    saveExperience(`[RISET] ${topic}`, insight, true);
    onLog(`🎓 💡 ${insight}`);

    // 5. Log ke file audit terpisah
    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify({
        ts: new Date().toISOString(), topic, query, insight
      }) + "\n");
    } catch {}

    results.push({ topic, insight });
  }

  state.lastRun = now;
  state.seenTopics = [...(state.seenTopics || []), ...picked].slice(-50);
  writeState(state);

  onLog(`🎓 ✅ Learning selesai: ${results.length}/${picked.length} insight baru`);
  return { results };
}

export function readRecentLearning(limit = 5) {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean).slice(-limit).reverse().map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
