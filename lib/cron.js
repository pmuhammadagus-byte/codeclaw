import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Knowledge } from "./knowledge.js";
import { research } from "./research.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", ".cron-state.json");

// Guard rails
const MIN_INTERVAL_HOURS = 24;       // minimal 24 jam antar run
const MAX_RESEARCH_PER_RUN = 3;      // max 3 topik per run
const DAILY_RESEARCH_BUDGET = 3;     // max 3 topik/hari

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastRun: 0, todayCount: 0, todayDate: "" };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { lastRun: 0, todayCount: 0, todayDate: "" }; }
}

function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

export async function runCronOnce() {
  const state = loadState();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Reset counter harian
  if (state.todayDate !== today) {
    state.todayDate = today;
    state.todayCount = 0;
  }

  // Guard: fitur dimatikan lewat config. Dicek paling awal supaya alasan
  // skip-nya jujur ("disabled"), bukan menyesatkan seperti "terlalu cepat".
  const cfg = loadConfig(path.join(__dirname, "..", "config.json"));
  const researchCfg = cfg.raw?.research ?? {};
  if (researchCfg.enabled !== true) {
    return { skipped: true, reason: "Riset harian dimatikan (config.research.enabled=false)" };
  }

  // Guard: minimal 24 jam
  const hoursSince = (now - state.lastRun) / (1000 * 60 * 60);
  if (state.lastRun > 0 && hoursSince < MIN_INTERVAL_HOURS) {
    return { skipped: true, reason: `Terlalu cepat (${hoursSince.toFixed(1)}h < ${MIN_INTERVAL_HOURS}h)`, lastRun: state.lastRun };
  }

  // Guard: budget harian
  if (state.todayCount >= DAILY_RESEARCH_BUDGET) {
    return { skipped: true, reason: `Budget harian habis (${state.todayCount}/${DAILY_RESEARCH_BUDGET})` };
  }

  // Topics dari config (user-defined)
  const topics = researchCfg.topics ?? [];

  if (!topics.length) {
    return { skipped: true, reason: "Tidak ada config.research.topics — tambahkan dulu" };
  }


  const kb = new Knowledge(path.join(__dirname, "..", "knowledge.db"));
  const toRun = topics.slice(0, Math.min(MAX_RESEARCH_PER_RUN, DAILY_RESEARCH_BUDGET - state.todayCount));

  const results = [];
  for (const topic of toRun) {
    try {
      const r = await research({ topic, sources: ["arxiv", "hn"], limit: 2 });
      let added = 0;
      const skippedLowRelevance = r.stats ? Object.values(r.stats).reduce((a, s) => a + s.dropped, 0) : 0;
      for (const [src, items] of Object.entries(r.sources)) {
        for (const item of items ?? []) {
          const res = kb.add({ topic, title: item.title, content: item.content, url: item.url || "", source: src });
          if (!res.duplicate) added++;
        }
      }
      results.push({ topic, added, errors: r.errors, stats: r.stats ?? {}, keywords: r.keywords ?? [], droppedLowRelevance: skippedLowRelevance });
      state.todayCount++;
    } catch (e) {
      results.push({ topic, error: e.message });
    }
  }

  state.lastRun = now;
  saveState(state);
  kb.close();

  return { skipped: false, results, todayCount: state.todayCount, budget: DAILY_RESEARCH_BUDGET };
}

export function cronStatus() {
  const state = loadState();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = state.todayDate === today ? state.todayCount : 0;
  return {
    lastRun: state.lastRun,
    lastRunAgo: state.lastRun ? `${((now - state.lastRun) / 3600000).toFixed(1)}h ago` : "never",
    todayCount,
    budget: DAILY_RESEARCH_BUDGET,
    nextEligible: state.lastRun ? new Date(state.lastRun + MIN_INTERVAL_HOURS * 3600000).toISOString() : "now",
  };
}
