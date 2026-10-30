import fs from "node:fs";
import path from "node:path";
import { SkillStore } from "./skills.js";

const LOG_FILE = "/root/codeclaw/methods-research-log.jsonl";
const STATE_FILE = "/root/codeclaw/.methods-research-state.json";

// ==========================================
// TOPIC POOL — dikategorikan
// ==========================================
export const TOPIC_POOL = {
  agent: [
    "ReAct reasoning loop pattern for AI agents",
    "Reflexion self-critique method for LLM agents",
    "Tree of Thoughts parallel reasoning",
    "Multi-agent orchestration patterns 2026",
    "Context engineering for long-running agents",
    "RAG techniques for code agents",
    "Tool use patterns function calling best practices",
    "Agent memory systems episodic semantic",
    "Planning algorithms for autonomous agents",
    "Agentic workflow evaluation benchmarks",
    "Chain of Agents collaborative reasoning",
    "Self-consistency and majority voting in LLMs",
  ],
  trading: [
    "Smart Money Concept SMC trading strategy",
    "ICT Inner Circle Trader concepts XAU/USD",
    "Wyckoff method accumulation distribution phases",
    "Order block and fair value gap trading",
    "Liquidity sweep and stop hunt patterns",
    "Market structure break BOS CHoCH",
    "Supply demand zones trading strategy",
    "Price action candlestick patterns gold",
    "Fibonacci confluence trading XAU/USD",
    "Risk management position sizing gold trading",
    "Correlation DXY yields XAU/USD analysis",
    "Sentiment analysis gold market positioning",
  ],
  tools: [
    "Model Context Protocol MCP tools 2026",
    "Claude function calling advanced patterns",
    "OpenAI structured output JSON schema",
    "Browser automation for AI agents",
    "Code execution sandbox for agents",
    "Web scraping techniques for LLMs",
    "Vector database optimization techniques",
    "Prompt caching and cost optimization",
    "Streaming responses architecture",
    "Multi-modal LLM integration patterns",
  ],
};

// Kategori → tag
const CATEGORY_TAG = {
  agent: "method:agent",
  trading: "method:trading",
  tools: "method:tools",
};

const CATEGORY_LABEL = {
  agent: "🤖 AI Agent",
  trading: "📈 Trading",
  tools: "🔧 Tools",
};

// ==========================================
// STATE management
// ==========================================
export function readMethodsState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { autoEnabled: false, lastAutoRun: null, seenTopics: [], todayDate: null, todayCount: 0 };
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { autoEnabled: false, lastAutoRun: null, seenTopics: [], todayDate: null, todayCount: 0 };
  }
}

export function writeMethodsState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ==========================================
// Pick topics — round robin per kategori
// ==========================================
function pickTopics(seen, perCategory = 1) {
  const picked = [];
  for (const cat of ["agent", "trading", "tools"]) {
    const pool = TOPIC_POOL[cat];
    const unseen = pool.filter(t => !seen.includes(t));
    const usePool = unseen.length >= perCategory ? unseen : pool;
    const shuffled = [...usePool].sort(() => Math.random() - 0.5);
    const catPicked = shuffled.slice(0, perCategory).map(topic => ({ topic, category: cat }));
    picked.push(...catPicked);
  }
  return picked;
}

// ==========================================
// Cari tool web_search dari TOOL_DEFINITIONS
// ==========================================
async function findSearchTool() {
  try {
    const mod = await import("./tools.js");
    const defs = mod.TOOL_DEFINITIONS || [];
    const t = defs.find(x => x.function?.name === "web_search")
           || defs.find(x => /search|web_fetch|fetch/i.test(x.function?.name || ""));
    return t?.function?.name || null;
  } catch {
    return null;
  }
}

async function executeSearch(searchToolName, query) {
  try {
    const mod = await import("./tools.js");
    const r = await mod.executeTool(searchToolName, { query }, {
      approvalCallback: async () => true,
      approvalMode: "none",
    });
    return String(r || "");
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

// ==========================================
// Main research function
// ==========================================
export async function runMethodsResearch(llm, onLog = () => {}, { force = false, categories = null } = {}) {
  const state = readMethodsState();
  const today = new Date().toISOString().slice(0, 10);

  // Reset counter harian
  if (state.todayDate !== today) {
    state.todayDate = today;
    state.todayCount = 0;
  }

  // Limit kalau bukan force
  if (!force && state.todayCount >= 2) {
    return { skipped: true, reason: "daily_limit", todayCount: state.todayCount };
  }

  const searchTool = await findSearchTool();
  if (!searchTool) {
    return { error: "no_search_tool", message: "Tool web_search tidak tersedia" };
  }

  onLog(`🔬 Riset metode dimulai (tool: ${searchTool})`);

  const cats = categories || ["agent", "trading", "tools"];
  const picked = pickTopics(state.seenTopics || [], 1).filter(p => cats.includes(p.category));

  if (!picked.length) return { skipped: true, reason: "no_topics" };

  const results = [];
  const store = new SkillStore();
  let savedCount = 0, skippedCount = 0, failedCount = 0;
  const savedByCategory = { agent: [], trading: [], tools: [] };

  for (const { topic, category } of picked) {
    onLog(`🔬 [${category}] Riset: ${topic}`);

    // 1. LLM bikin query pencarian tajam
    let query = topic;
    try {
      const qr = await llm.chat({
        messages: [{
          role: "user",
          content: `Ubah topik ini jadi query pencarian Google yang singkat & tajam (maks 8 kata). Output HANYA query, tanpa tanda kutip atau penjelasan.\n\nTopik: ${topic}`,
        }],
      });
      query = (qr.message?.content || topic).trim().split("\n")[0].replace(/^["'`]+|["'`]+$/g, "").slice(0, 100);
    } catch {}
    onLog(`🔬 🔍 Query: "${query}"`);

    // 2. Web search
    let searchText = "";
    try {
      searchText = await executeSearch(searchTool, query);
      if (/^ERROR|^failed|^❌/i.test(searchText.trim())) {
        onLog(`🔬 ⚠️ Search gagal, skip`);
        failedCount++;
        continue;
      }
    } catch (e) {
      onLog(`🔬 ⚠️ Search error: ${e.message}`);
      failedCount++;
      continue;
    }

    // 3. LLM ekstrak insight terstruktur
    let insight = "";
    try {
      const ir = await llm.chat({
        messages: [
          {
            role: "system",
            content: `Kamu peneliti senior. Baca hasil pencarian, ekstrak SATU insight konkret yang bisa langsung diterapkan.

Kategori topik: ${CATEGORY_LABEL[category]}

Format output (WAJIB, satu blok):

INSIGHT: <1-2 kalimat insight konkret>
METHOD: <nama metode/teknik spesifik, 2-6 kata>
STEPS:
- <langkah 1>
- <langkah 2>
- <langkah 3>
WHEN: <kapan dipakai, 1 kalimat>
SOURCE: <domain utama dari hasil pencarian>

Kalau hasil pencarian tidak informatif, tulis hanya: TIDAK INFORMATIF`,
          },
          {
            role: "user",
            content: `Topik: ${topic}\nKategori: ${category}\n\nHasil pencarian:\n${searchText.slice(0, 3500)}`,
          },
        ],
      });
      insight = (ir.message?.content || "").trim();
    } catch (e) {
      onLog(`🔬 ⚠️ Insight error: ${e.message}`);
      failedCount++;
      continue;
    }

    if (!insight || /TIDAK INFORMATIF/i.test(insight) || insight.length < 30) {
      onLog(`🔬 ⚠️ Insight tidak berguna, skip`);
      skippedCount++;
      continue;
    }

    // 4. Parse insight terstruktur
    const getField = (key) => {
      const m = insight.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
      return m ? m[1].trim() : "";
    };
    const getSteps = () => {
      const m = insight.match(/STEPS:\s*\n((?:- .+\n?)+)/im);
      return m ? m[1].split("\n").filter(l => l.trim().startsWith("- ")).map(l => l.slice(2).trim()) : [];
    };

    const parsed = {
      insight: getField("INSIGHT"),
      method: getField("METHOD") || topic.slice(0, 40),
      steps: getSteps(),
      when: getField("WHEN"),
      source: getField("SOURCE"),
      topic,
      category,
    };

    // 5. Skip kalau duplikat
    const existing = store.find(parsed.method, 3);
    const isDup = existing.some(s => {
      const hay = ((s.name || "") + " " + (s.trigger || "")).toLowerCase();
      const key = parsed.method.toLowerCase().slice(0, 25);
      return key.length > 5 && hay.includes(key);
    });
    if (isDup) {
      onLog(`🔬 ⏭ Skip (duplikat): ${parsed.method}`);
      skippedCount++;
      continue;
    }

    // 6. Save sebagai skill
    try {
      const tags = [
        CATEGORY_TAG[category],
        category,
        ...parsed.method.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5),
      ];

      store.save({
        name: `[${category}] ${parsed.method}`,
        trigger: `${parsed.method} | ${parsed.topic} | ${parsed.when}`,
        procedure: [
          `## Insight`,
          parsed.insight,
          ``,
          `## Langkah`,
          ...parsed.steps.map((s, i) => `${i + 1}. ${s}`),
          ``,
          `## Kapan Dipakai`,
          parsed.when,
          ``,
          `## Sumber`,
          parsed.source || "(tidak dispesifikasi)",
        ].join("\n"),
        tags,
        examples: [],
      });
      savedCount++;
      savedByCategory[category].push(parsed.method);
      onLog(`🔬 ✅ Saved: [${category}] ${parsed.method}`);
    } catch (e) {
      failedCount++;
      onLog(`🔬 ❌ Skill save error: ${e.message}`);
    }

    results.push({ ...parsed, saved: true });

    // Delay biar tidak rate-limited
    await new Promise(r => setTimeout(r, 1000));
  }

  // Update state
  state.todayCount = (state.todayCount || 0) + 1;
  state.seenTopics = [...(state.seenTopics || []), ...picked.map(p => p.topic)].slice(-100);
  state.lastAutoRun = new Date().toISOString();
  writeMethodsState(state);

  // Log audit
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      topics: picked.map(p => p.topic),
      saved: savedCount,
      skipped: skippedCount,
      failed: failedCount,
      byCategory: savedByCategory,
      results: results.map(r => ({ category: r.category, method: r.method })),
    }) + "\n");
  } catch {}

  onLog(`🔬 ✅ Selesai: ${savedCount} saved, ${skippedCount} skip, ${failedCount} fail`);

  return {
    results,
    savedCount,
    skippedCount,
    failedCount,
    byCategory: savedByCategory,
    totalTopics: picked.length,
  };
}

// ==========================================
// Helper untuk Telegram: riwayat + stats
// ==========================================
export function readRecentResearch(limit = 5) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean).slice(-limit).reverse().map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function computeMethodsStats() {
  const all = readRecentResearch(1000);
  let total = { saved: 0, skipped: 0, failed: 0 };
  let byCategory = { agent: 0, trading: 0, tools: 0 };
  for (const r of all) {
    total.saved += r.saved || 0;
    total.skipped += r.skipped || 0;
    total.failed += r.failed || 0;
    if (r.byCategory) {
      byCategory.agent += (r.byCategory.agent || []).length;
      byCategory.trading += (r.byCategory.trading || []).length;
      byCategory.tools += (r.byCategory.tools || []).length;
    }
  }
  return { totalRuns: all.length, total, byCategory, recentRuns: all.slice(0, 5) };
}
