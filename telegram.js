import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "./lib/llm.js";
import { mdToTelegramHtml } from "./lib/md-to-html.js";
import { analyzeOhlcForIct, formatOhlcForPrompt } from "./lib/ict-ohlc.mjs";
import { detectPatterns, formatPatternsForPrompt } from "./lib/pattern-detect.mjs";
import { Session } from "./lib/session.js";
import { TOOL_DEFINITIONS, executeTool } from "./lib/tools.js";
import { TelegramAPI } from "./lib/telegram-api.js";
import { todoSection } from "./lib/planner.js";
import { memorySection, retrieveExperiences, reflectExperience, saveExperience } from "./lib/memory.js";
import { distillSkill, improveSkill, autoImproveFailingSkills, isComplexTask } from "./lib/skill-distiller.js";
import { loadConfig, migrateIfNeeded } from "./lib/config.js";
import { CONFIG_FILE, DATA_DIR, MEMORY_FILE, LEARNING_STATE } from "./lib/paths.js";
import { TOOL_USE_RULES } from "./lib/tool-use-rules.js";
import { getBrainPrompt } from "./lib/brain.js";
import { buildSkillSection } from "./lib/skills.js";
import { getSkillStore } from "./lib/tools.js";
import { shouldChunk, saveMission, buildMissionPrompt } from "./lib/long-task.js";
import { runDailyLearning, readRecentLearning } from "./lib/autonomous-learning.js";
import { planTask, critiqueResult, fixResult, shouldCritique } from "./lib/cognitive.js";

// Escape HTML entity untuk Telegram (default parse_mode: HTML di lib/telegram-api.js)
function __escTg(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CONFIG_PATH dari paths.js (handle legacy + user config dir)
const CONFIG_PATH = CONFIG_FILE;
function loadFileIfExists(name) {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
const BASE_SYSTEM = [
  loadFileIfExists("IDENTITY.md"),
  loadFileIfExists("system.md"),
].filter(Boolean).join("\n\n---\n\n");
const DB_PATH = path.join(__dirname, "data.db");
const PID_FILE = path.join(__dirname, "telegram.pid");
const HEALTH_FILE = path.join(__dirname, ".health");
const DL_DIR = path.join(__dirname, "downloads");
fs.mkdirSync(DL_DIR, { recursive: true });

// === Load config dengan backward compat ===
let CFG = loadConfig(CONFIG_PATH);
if (migrateIfNeeded(CFG, CONFIG_PATH)) {
  console.log("⚠️  Config lama terdeteksi, sudah dimigrasi ke format baru");
  CFG = loadConfig(CONFIG_PATH);
}
const CONFIG = { ...CFG.raw, llm: CFG.llm, agent: CFG.agent, telegram: CFG.telegram };

// === Validate ===
if (!CONFIG.telegram.enabled) {
  console.error("❌ Telegram channel disabled");
  console.error("   Aktifkan: node cli.js channel telegram enable");
  process.exit(1);
}
if (!CONFIG.telegram.botToken || CONFIG.telegram.botToken.includes("PASTE")) {
  console.error("❌ telegram.botToken belum diisi");
  console.error("   Set: node cli.js channel telegram set-token <TOKEN>");
  process.exit(1);
}

const llm = new LLM(CONFIG.llm);
const session = new Session(DB_PATH);
const tg = new TelegramAPI(CONFIG.telegram.botToken);
const ALLOWED = new Set(CONFIG.telegram.allowedUserIds.map(Number));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// === Markdown → Telegram HTML ===
function isGarbageOutput(text) {
  if (!text || text.length < 10) return false;
  const htmlTags = (text.match(/<\/?[a-z][^>]*>/gi) || []).length;
  if (htmlTags > 5) return true;
  if ((text.match(/\[\[\[|\]\]\]|>>>|<<<|###|@@@/g) || []).length > 3) return true;
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const chinese = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
  if (cyrillic > 20 || chinese > 20) return true;
  if (/<\/?think>/i.test(text) && text.length > 500) return true;
  if ((text.match(/\\x[0-9a-f]{2}/gi) || []).length > 10) return true;
  return false;
}

function mdToHtml(text) {
  if (!text) return "";
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, c) => `<pre>${c.trim()}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TOOL_ICONS = {
  read_file: "📖", write_file: "✍️", edit_file: "✏️", list_dir: "📁",
  search_code: "🔍", diff_preview: "🔀", refactor_multi: "🧩",
  shell: "💻", install_package: "📦", run_tests: "🧪", parse_error: "🐛",
  web_fetch: "🌐", web_search: "🔎",
  todo_write: "📋", memory_set: "🧠", memory_get: "💭",
  branch_save: "💾", branch_restore: "⏪",
  index_codebase: "📚", search_index: "🗂️",
  skill_save: "💡", skill_find: "🎯", skill_list: "📜", skill_record: "📊",
  research_topic: "🔬", knowledge_search: "📖", knowledge_add: "🗃️",
};

const TOOL_LABELS = {
  read_file: "Baca file", write_file: "Tulis file", edit_file: "Edit file",
  list_dir: "List folder", search_code: "Cari kode", diff_preview: "Diff preview",
  refactor_multi: "Refactor multi", shell: "Shell", install_package: "Install package",
  run_tests: "Jalankan test", parse_error: "Parse error",
  web_fetch: "Fetch web", web_search: "Web search",
  todo_write: "Kelola todo", memory_set: "Simpan memori", memory_get: "Baca memori",
  branch_save: "Snapshot", branch_restore: "Restore snapshot",
  index_codebase: "Index codebase", search_index: "Cari di index",
  skill_save: "Simpan skill", skill_find: "Cari skill", skill_list: "List skill",
  skill_record: "Catat skill", research_topic: "Riset",
  knowledge_search: "Cari knowledge", knowledge_add: "Simpan knowledge",
};

function toolArgPreview(name, args) {
  if (!args || typeof args !== "object") return "";
  const t = (s, n = 50) => String(s ?? "").slice(0, n);
  switch (name) {
    case "shell": return t(args.command, 60);
    case "read_file": case "write_file": case "edit_file": return t(args.path, 60);
    case "list_dir": return t(args.path || ".", 60);
    case "search_code": return t(args.pattern, 40) + (args.glob ? ` in ${args.glob}` : "");
    case "web_fetch": return t(args.url, 60);
    case "web_search": return t(args.query, 50);
    case "install_package": return (args.packages || []).join(", ").slice(0, 60);
    case "refactor_multi": return `${t(args.glob, 30)} <- "${t(args.pattern, 20)}"`;
    case "todo_write": return `${args.action}${args.task ? `: ${t(args.task, 30)}` : ""}`;
    case "memory_set": return `${args.key} = ${t(args.value, 30)}`;
    case "memory_get": return args.key || "(all)";
    case "research_topic": return t(args.topic, 50);
    case "knowledge_search": case "search_index": return t(args.query, 50);
    case "knowledge_add": return t(args.title, 50);
    case "skill_find": return t(args.task, 50);
    case "skill_save": return t(args.name, 50);
    case "skill_record": return `${args.id} -> ${args.success ? "OK" : "FAIL"}`;
    case "branch_save": case "branch_restore": return t(args.name, 40);
    default: return "";
  }
}

function renderToolStatus(tools, iteration, maxIter) {
  const MAX_SHOW = 12;
  let displayTools = tools;
  let trimmed = 0;
  if (tools.length > MAX_SHOW) {
    displayTools = tools.slice(-MAX_SHOW);
    trimmed = tools.length - MAX_SHOW;
  }
  const lines = [];
  lines.push(`<b>⚙️ Aktivitas Agent</b>  <i>langkah ${iteration}/${maxIter}</i>`);
  lines.push("");
  if (trimmed > 0) lines.push(`<i>... +${trimmed} tool sebelumnya</i>`);
  for (const t of displayTools) {
    const icon = TOOL_ICONS[t.name] || "🔧";
    const label = TOOL_LABELS[t.name] || t.name;
    const detail = toolArgPreview(t.name, t.args);
    const detailStr = detail ? `  <code>${escapeHtml(detail)}</code>` : "";
    const badge = t.status === "done" ? " ✅" : t.status === "error" ? " ❌" : " ⏳";
    lines.push(`${icon} <b>${label}</b>${badge}${detailStr}`);
  }
  const done = tools.filter(t => t.status === "done").length;
  const err = tools.filter(t => t.status === "error").length;
  const run = tools.filter(t => t.status === "running").length;
  const parts = [];
  if (done) parts.push(`✅ ${done} selesai`);
  if (err) parts.push(`❌ ${err} gagal`);
  if (run) parts.push(`⏳ ${run} jalan`);
  if (parts.length) {
    lines.push("");
    lines.push(`<i>${parts.join("  ·  ")}</i>`);
  }
  return lines.join("\n").slice(0, 4000);
}

function split(text, max = 4000) {
  if (text.length <= max) return [text];
  const out = []; let rem = text;
  while (rem.length) {
    if (rem.length <= max) { out.push(rem); break; }
    let cut = rem.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    out.push(rem.slice(0, cut));
    rem = rem.slice(cut).replace(/^\n/, "");
  }
  return out;
}

async function sendText(chatId, text) {
  const html = mdToHtml(text);
  for (const p of split(html)) {
    try { await tg.sendMessage(chatId, p); }
    catch {
      await tg.sendMessage(chatId, p.replace(/<[^>]+>/g, "")).catch(() => {});
    }
  }
}

function buildSystem(chatId, userInput = "") {
  const brainLevel = CONFIG.agent.brainLevel || CONFIG.agent.brain || "normal";
  let skillSection = "";
  try {
    if (userInput && String(userInput).trim().length >= 8) {
      skillSection = buildSkillSection(getSkillStore(), String(userInput));
    }
  } catch (e) { console.log("[buildSystem] skillSection fail:", e.message); }
  const trackerHint = "\n\n## Skill tracking\nJika kamu memakai skill dari skill_find/skill_read, WAJIB panggil skill_record({id, success}) setelah selesai — success=true jika berhasil, false jika gagal. Ini supaya skill yang tidak berguna bisa diperbaiki otomatis.";
  return BASE_SYSTEM + getBrainPrompt(brainLevel) + TOOL_USE_RULES + todoSection(session, chatId) + memorySection(session, chatId) + skillSection + trackerHint;
}

async function processMessage(chatId, userInput, from) {
  // 🛡️ P0-3: LONG-TASK HANDLER
  if (shouldChunk(userInput)) {
    const { file, size, lines } = saveMission(chatId, userInput);
    log(`📄 Misi panjang: ${size}b → ${file}`);
    try {
      await tg.sendMessage(chatId,
        `📄 *Misi diterima*\n\nUkuran: ${(size/1024).toFixed(1)} KB (${lines} baris)\nDisimpan: \`${file}\`\n\nBot akan baca bertahap lalu konfirmasi sebelum eksekusi. Tunggu 30-60 detik...`,
        { parse_mode: "Markdown" }
      );
    } catch {}
    userInput = buildMissionPrompt(file, size, lines);
  }

  session.add(chatId, { role: "user", content: userInput });

  const toolActivity = [];
  let statusMsgId = null;
  const usedSkillIds = new Set();
  let lastMessages = [];
  const updateToolStatus = async (iteration) => {
    const html = renderToolStatus(toolActivity, iteration, CONFIG.agent.maxToolIterations);
    try {
      if (statusMsgId) {
        await tg.editMessageText(chatId, statusMsgId, html);
      } else {
        const msg = await tg.sendMessage(chatId, html);
        statusMsgId = msg.message_id;
      }
    } catch { /* silent */ }
  };

  // 🧠 COGNITIVE PRE-PASS: Planner (hanya high/genius)
  const brainLevel = CONFIG.agent.brainLevel || "normal";
  let cognitivePlan = "";
  if (brainLevel === "high" || brainLevel === "genius") {
    cognitivePlan = await planTask(llm, userInput, log);
  }

  for (let iter = 0; iter < CONFIG.agent.maxToolIterations; iter++) {
    const history = session.history(chatId, CONFIG.agent.contextWindow);
    const pastExp = retrieveExperiences(userInput);
    const planBlock = cognitivePlan ? "\n\n## RENCANA YANG SUDAH DIBUAT:\n" + cognitivePlan + "\n\nIkuti rencana ini." : "";
    const messages = [{ role: "system", content: buildSystem(chatId, userInput) + pastExp + planBlock }, ...history];
    lastMessages = messages;

    let responseText = "";
    const typing = setInterval(() => tg.sendChatAction(chatId).catch(() => {}), 4500);
    tg.sendChatAction(chatId).catch(() => {});

    let result;
    try {
      result = await llm.chat({ messages, tools: TOOL_DEFINITIONS, onStream: (c) => { responseText += c; } });
    } catch (e) {
      // llm.js sudah retry 3x. Kalau tetap gagal, jangan sampai user cuma dapat
      // "fetch failed" mentah — kasih konteks + sisa history tetap konsisten.
      log(`llm err: ${e.message}`);
      const detail = String(e.message || "");
      const isNet = /fetch gagal|ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|LLM request gagal/i.test(detail);
      await tg.sendMessage(chatId,
        isNet
          ? `🌐 *Koneksi ke model gagal*\n\n` +
            `Sudah dicoba otomatis beberapa kali, tetap tidak tembus.\n\n` +
            `\`${escapeHtml(detail.slice(0, 300))}\`\n\n` +
            `*Cek:* provider hidup? (\`/status\`), lalu kirim ulang.`
          : `❌ *Model error*\n\n\`${escapeHtml(detail.slice(0, 300))}\``
      ).catch(() => {});
      return;
    } finally { clearInterval(typing); }


    const { message, finishReason } = result;
    session.add(chatId, message);

    if (finishReason === "tool_calls" || message.tool_calls?.length) {
      const currentIter = iter + 1;
      
      // Deteksi loop: kalau tool yang sama dipanggil dengan args sama >3x
      const history = session.history(chatId, 20);
      const recentToolCalls = history
        .filter(m => m.role === "assistant" && m.tool_calls)
        .slice(-3)
        .flatMap(m => m.tool_calls.map(tc => `${tc.function.name}:${tc.function.arguments}`));
      const currentCalls = (message.tool_calls ?? []).map(tc => `${tc.function.name}:${tc.function.arguments}`);
      const loopDetected = currentCalls.some(c => recentToolCalls.filter(r => r === c).length >= 3);
      
      if (loopDetected) {
        log(`Loop detected — breaking`);
        await tg.sendMessage(chatId, 
          `⚠️ *Loop terdeteksi*\n\n` +
          `Agent stuck memanggil tool yang sama berkali-kali tanpa progress.\n\n` +
          `*Kemungkinan penyebab:*\n` +
          `• Tool gagal berulang (cek path/permission)\n` +
          `• Model tidak paham output tool\n` +
          `• Task terlalu abstrak\n\n` +
          `*Saran:* pecah jadi langkah lebih kecil, atau kirim error spesifik.`);
        return;
      }
      
      for (const tc of message.tool_calls ?? []) {
        let args; try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
        const entry = { name: tc.function.name, args, status: "running" };
        toolActivity.push(entry);
        await updateToolStatus(currentIter);

        log(`tool ${tc.function.name} from ${from.id}`);
        const toolResult = await executeTool(tc.function.name, args, {
          session, chatId, config: CONFIG,
          approvalCallback: async () => true,
          approvalMode: "none",
        });
        entry.status = /^(error|failed|❌)/i.test(String(toolResult || "").trim()) ? "error" : "done";
        await updateToolStatus(currentIter);

        session.add(chatId, { role: "tool", tool_call_id: tc.id, name: tc.function.name, content: toolResult });
      }
      continue;
    }

    if (isGarbageOutput(responseText)) {
      log("garbage output detected: " + responseText.length + " chars");
      session.add(chatId, { role: "assistant", content: "[output rusak - diabaikan]" });
      const msg = "Model mengeluarkan output rusak. Coba lagi dengan prompt lebih spesifik, atau ketik /clear untuk reset.";
      await tg.sendMessage(chatId, msg).catch(() => {});
      return;
    }

    // 🧠 COGNITIVE POST-PASS: Critic + Fixer (hanya high/genius)
    if ((brainLevel === "high" || brainLevel === "genius") && responseText.trim()) {
      try {
        const critique = await critiqueResult(llm, userInput, responseText, log);
        if (shouldCritique(critique)) {
          responseText = await fixResult(llm, userInput, responseText, critique, log);
        } else {
          log("🧠 [Otak] Critic: OK, tidak perlu perbaikan");
        }
      } catch (e) {
        log("🧠 [Otak] Post-pass gagal: " + e.message);
      }
    }
    
    if (responseText.trim()) {
      const priceTopic = /\b(?:xau|gold|emas)\b[^\n]{0,80}\$\s*\d{3,}|\$\s*\d{3,}[^\n]{0,80}\b(?:xau|gold|emas)\b|\b(?:harga|price|spot)\s+(?:xau|gold|emas)\s*[:=]?\s*\$?\d{3,}/i.test(responseText);
      const disclaimer = priceTopic
        ? '⚠️ <i>Jawaban dari model tanpa data live. Untuk harga real: /gold. Jangan pakai angka di atas untuk entry.</i>\n\n'
        : '';
      await tg.sendMessage(chatId, disclaimer + mdToTelegramHtml(responseText), { parse_mode: "HTML" });
    }
    else await tg.sendMessage(chatId, "(no response)").catch(() => {});
    reflectExperience(llm, userInput, lastMessages).then(ins => saveExperience(userInput, ins, true)).catch(() => {});
    return;
  }
  await tg.sendMessage(chatId, "⚠️ Max iterations. Persempit task atau pecah jadi beberapa prompt.");
  reflectExperience(llm, userInput, lastMessages).then(ins => saveExperience(userInput, ins, false)).catch(() => {});
}

// ===== ICT/SMC ANALYSIS HELPERS =====
function extractGoldDataFromHtml(html) {
  const strip = String(html || "").replace(/<[^>]+>/g, " ");
  const g = (re) => { const m = strip.match(re); return m ? parseFloat(m[1]) : null; };
  return {
    price: g(/Harga:\s*([\d.]+)/),
    rsi: g(/RSI\(14\):\s*([\d.]+)/),
    sma20: g(/SMA\(20\):\s*([\d.]+)/),
    sma50: g(/SMA\(50\):\s*([\d.]+)/),
    rangeLow: g(/Rentang 50h:\s*([\d.]+)/),
    rangeHigh: g(/Rentang 50h:\s*[\d.]+\s*[-–]\s*([\d.]+)/),
    adx: g(/ADX\(14\):\s*([\d.]+)/),
    pp: g(/PP\s+([\d.]+)/),
    us10y: g(/US10Y:\s*([\d.]+)%/),
    vix: g(/VIX:\s*([\d.]+)/),
    atr: g(/ATR\(14\):\s*([\d.]+)/),
    sl: g(/SL:\s*([\d.]+)/),
    tp1: g(/TP1:\s*([\d.]+)/),
    tp2: g(/TP2:\s*([\d.]+)/),
    recommend: (strip.match(/Rekomendasi:\s*(\w+)/) || [])[1] || "?",
    score: (strip.match(/Skor\s+(\d+)/) || [])[1] || "?",
    newsBlock: (strip.match(/Pembacaan langsung terhadap[\s\S]*?(?=📰 BERITA|$)/) || [""])[0].trim(),
  };
}

function buildIctPrompt(d) {
  const f = (v) => v != null ? "$" + v : "[data tidak tersedia]";
  const mode = d.mode || "analysis";

  const dataBlock = [
    "DATA REAL (WAJIB pakai, JANGAN ganti):",
    "- Harga: " + f(d.price),
    "- RSI(14): " + d.rsi,
    "- SMA20: " + f(d.sma20) + " | SMA50: " + f(d.sma50),
    "- Range 50 jam: " + f(d.rangeLow) + " – " + f(d.rangeHigh),
    "- ADX(14): " + d.adx,
    "- Pivot Point: " + f(d.pp),
    "- ATR(14): " + f(d.atr),
    "- US10Y: " + d.us10y + "%",
    "- VIX: " + d.vix,
    "- Level ref algoritma: SL " + f(d.sl) + " | TP1 " + f(d.tp1) + " | TP2 " + f(d.tp2),
    "- Rekomendasi algoritma: " + d.recommend + " (skor " + d.score + ")",
    ...(d.ohlc ? [formatOhlcForPrompt(d.ohlc, d.price)] : []),
    ...(d.patterns ? [formatPatternsForPrompt(d.patterns)] : []),
    "",
    "NEWS EXA (ringkasan):",
    (d.newsBlock ? d.newsBlock.slice(0, 1000) : "[tidak ada]"),
  ].join("\n");

  const commonRules = [
    "ATURAN ANGKA KETAT:",
    "1. WAJIB pakai angka dari DATA di atas. JANGAN sebut $2.xxx, $2.5xx, $2.4xx (harga lama dari training data).",
    "2. Kalau level tidak tersedia di DATA OHLC, tulis '[perlu chart live]'. JANGAN ngarang.",
    "3. FORMAT: HTML VALID — <b>bold</b>, <i>italic</i>, <code>x</code>. JANGAN markdown (**, ##, *).",
    "4. Bahasa Indonesia, ringkas, actionable.",
  ].join("\n");

  if (mode === "plan") {
    return [
      "Kamu trader institusional ICT/SMC. Buat TRADING PLAN actionable dari data di bawah.",
      "",
      dataBlock,
      "",
      commonRules,
      "",
      "=== HARD RULES TRADING (WAJIB DIPATUHI, JANGAN DILANGGAR) ===",
      "1. SL: minimal 1.5x ATR H1 dari entry, DAN minimal $15 untuk XAU. Jangan pakai SL < $15.",
      "2. R:R: minimal 1:1.5, MAKSIMAL 1:3. Kalau kalkulasi > 1:3, potong TP supaya pas 1:3.",
      "3. Entry zone: HANYA zona yang BELUM tertembus harga sekarang. Kalau harga DI LUAR zona (misal di bawah OB bull), itu berarti OB sudah dimitigasi → jadi resistance/support flip, BUKAN entry zone.",
      "4. TP: TP1 ~1.0-1.5x ATR dari entry, TP2 ~2-2.5x ATR, TP3 (opsional) max 3x ATR. JANGAN skip ke level pivot jauh ($50+).",
      "5. Kalau tidak ada setup valid (entry tertembus / R:R tidak bisa 1.5-3): tulis 'TIDAK ADA SETUP VALID — WAIT' di section 1, dan untuk section 2-4 tulis '—' (strip).",
      "6. DXY/US10Y/VIX hanya konteks bias, bukan pengganti level teknikal.",
      "",
      "STRUKTUR OUTPUT (WAJIB 6 section, bernomor):",
      "Buka dengan: 📊 <b>XAU/USD — TRADING PLAN</b> lalu <i>[tanggal] · Harga: $price</i>",
      "",
      "<b>1. SETUP SAAT INI</b> (2-3 baris max)",
      "- Bias arah + alasan singkat dari RSI/SMA/ADX",
      "- Kalau tidak ada setup: tulis 'TIDAK ADA SETUP VALID — WAIT' di sini",
      "",
      "<b>2. ENTRY ZONE</b>",
      "- Cek: apakah harga sekarang di DALAM atau DI LUAR zona? Kalau di luar → tulis 'OB/FVG $X-$Y sudah tertembus, jadi [resistance/support], bukan entry'",
      "- Zona entry konkret: $X – $Y (dari FVG/OB yang BELUM tertembus, sebut mana)",
      "- Jenis: limit / stop / market",
      "- Trigger: misal 'MSS H1 + close di atas $Z'",
      "",
      "<b>3. STOP LOSS</b>",
      "- SL: $X (dari swing + ATR buffer, sebut mana)",
      "- Jarak SL: $X = Y.Y x ATR (HARUS >= 1.5x ATR, min $15)",
      "",
      "<b>4. TAKE PROFIT</b>",
      "- TP1: $X (1.0-1.5x ATR dari entry), R:R 1:1.5-2",
      "- TP2: $X (2-2.5x ATR), R:R 1:2.5-3",
      "- TP3 (opsional): $X (max 3x ATR)",
      "- Kalau kalkulasi R:R > 3, potong TP.",
      "",
      "<b>5. SKENARIO</b>",
      "- <b>Bull:</b> jika [trigger] → target $Y",
      "- <b>Bear:</b> jika [trigger] → target $Y",
      "- <b>Tidak ada trigger:</b> jika [kondisi] → stay flat",
      "",
      "<b>6. RISK & INVALIDASI</b>",
      "- Lot hint: [X%] risk = [calc dari SL realistis]",
      "- Max risk: 1-2%",
      "- Invalidasi: [kondisi batalin plan]",
      "- Kill zone WIB: London / NY",
      "",
      "Tutup: ⚪ <b>Rekomendasi: " + d.recommend + "</b> (skor " + d.score + ") + 1 baris alasan",
    ].join("\n");
  }

  // Default: analysis mode
  return [
    "Kamu analis trading institusional (ICT/SMC) berpengalaman.",
    "",
    dataBlock,
    "",
    commonRules,
    "",
    "STRUKTUR OUTPUT (WAJIB 6 section, bernomor):",
    "Buka dengan: 📊 <b>XAU/USD — Analisa ICT/SMC + Pattern</b> lalu <i>[tanggal] · Harga: $price</i>",
    "",
    "1. <b>MACRO BIAS (D1/W1)</b>",
    "2. <b>MARKET STRUCTURE (D1→H4)</b>",
    "3. <b>LIQUIDITY</b>",
    "4. <b>KILL ZONE & ENTRY MODEL</b>",
    "5. <b>RISK & INVALIDASI</b>",
    "6. <b>CANDLESTICK & PATTERN</b> (WAJIB pakai data dari SECTION 6 DATA di atas)",
    "   - Kalau pattern detection SKIP (kompresi): tulis 'Pattern detection: SKIP (ATR X < $3, market kompresi). Tunggu ekspansi ATR.'",
    "   - Kalau ada pattern: sebut pattern terdeteksi + S/R + interpretasi bias (bullish/bearish/neutral) dalam 2-3 baris",
    "",
    "Untuk OB/FVG/BSL/SSL yang butuh OHLC — WAJIB pakai level dari DATA OHLC di atas (jangan ngarang).",
    "Tutup: ⚪ <b>Rekomendasi: " + d.recommend + "</b> (skor " + d.score + ")",
  ].join("\n");
}

function normalizeIctHtml(s) {
  let t = String(s || "");
  // Convert <br>, <br/>, <br /> ke newline sebelum proses apapun
  t = t.replace(/<br\s*\/?>/gi, "\n");
  const tags = [];
  t = t.replace(/<\/?(?:b|i|u|s|code|pre|blockquote)(?:\s+[^>]*)?>|<a\s+[^>]*>|<\/a>/gi, (m) => {
    tags.push(m); return `\x00T${tags.length - 1}\x00`;
  });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/__([^_\n]+)__/g, "<b>$1</b>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>");
  t = t.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<i>$2</i>");
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  t = t.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/gi, "&amp;");
  t = t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  t = t.replace(/\x00T(\d+)\x00/g, (_, i) => tags[+i]);
  return t;
}

function validateIctOutput(text) {
  if (!text || text.length < 200) return { ok: false, reason: "terlalu pendek" };
  // R:R sanity check — tolak kalau ada R:R 1:X dengan X > 5
  const rrMatches = [...text.matchAll(/R\s*:\s*R\s*1\s*:\s*([\d.]+)/gi)].map(m => parseFloat(m[1]));
  const badRR = rrMatches.filter(x => x > 5);
  if (badRR.length) return { ok: false, reason: "R:R tidak realistis: 1:" + badRR.slice(0,2).join(", 1:") };

  const prices = [...text.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map(m => parseFloat(m[1].replace(/,/g, "")));
  const bad = prices.filter(p => p >= 2000 && p < 3000);
  if (bad.length >= 1) return { ok: false, reason: "harga ngawur terdeteksi: " + bad.slice(0,3).join(", ") };
  return { ok: true };
}

async function runIctAnalysis(llm, d) {
  try {
    let responseText = "";
    const res = await llm.chat({
      messages: [
        { role: "system", content: "Kamu analis ICT/SMC profesional. Patuhi aturan angka ketat. JANGAN sebut harga di bawah $3000 (halusinasi training data)." },
        { role: "user", content: buildIctPrompt(d) },
      ],
      onStream: (c) => { responseText += c; },
    });
    return responseText || (typeof res === "string" ? res : (res?.content || res?.text || ""));
  } catch (e) {
    log("ict llm err: " + e.message);
    return null;
  }
}

// ===== HOURLY ICT AUTO-ANALYSIS =====
let HOURLY_ICT_LAST_HOUR = "";

async function runHourlyIctForChat(chatId) {
  try {
    await tg.sendMessage(chatId, "🕐 Auto-analisa ICT hourly...").catch(() => {});
    const { spawn } = await import("node:child_process");
    const output = await new Promise((resolve) => {
      const child = spawn("node", ["scripts/gold-analysis.mjs", "--no-telegram"], { cwd: __dirname, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
      let buf = "";
      child.stdout.on("data", d => buf += d.toString());
      child.stderr.on("data", d => buf += d.toString());
      child.on("close", (code) => resolve({ buf, code }));
      setTimeout(() => { child.kill(); resolve({ buf: buf + "\n[timeout]", code: -1 }); }, 90000);
    });
    const m = output.buf.match(/===TG_START===\n([\s\S]*?)\n===TG_END===/);
    const html = m ? m[1].trim() : "";
    if (!html) { log("hourly ict: gold-analysis gagal (exit " + output.code + ")"); return false; }

    const goldData = extractGoldDataFromHtml(html);
    if (!goldData.price) { log("hourly ict: extract gagal"); return false; }

    try {
      const ohlc = await analyzeOhlcForIct(CONFIG?.twelvedata?.apiKey, "XAU/USD", goldData.price);
      goldData.ohlc = ohlc;
    } catch (e) { log("hourly ict: ohlc err " + e.message); }

    const ict = await runIctAnalysis(llm, goldData);
    if (!ict) { log("hourly ict: LLM null"); return false; }
    const check = validateIctOutput(ict);
    if (!check.ok) { log("hourly ict: validation failed: " + check.reason); return false; }

    const normalized = normalizeIctHtml(ict);
    const parts = normalized.length <= 3900 ? [normalized] : (() => {
      const ps = []; const chunks = normalized.split(/\n\n+/); let buf = "";
      for (const c of chunks) {
        if ((buf + "\n\n" + c).length <= 3900) buf = buf ? buf + "\n\n" + c : c;
        else { if (buf) ps.push(buf); buf = c.length <= 3900 ? c : c.slice(0, 3900); }
      }
      if (buf) ps.push(buf); return ps;
    })();
    for (let i = 0; i < parts.length; i++) {
      try {
        await tg.sendMessage(chatId, "🕐 <b>[AUTO HOURLY]</b>\n\n" + parts[i], { parse_mode: "HTML", disable_web_page_preview: true });
      } catch (e) { log("hourly part " + (i+1) + " gagal: " + e.message); }
      if (i < parts.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    log("hourly ict sent to " + chatId + " (" + parts.length + " parts)");
    return true;
  } catch (e) { log("hourly ict err: " + e.message); return false; }
}

async function handleCommand(chatId, text, from) {
  const cmd = text.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case "/start":
      await tg.sendMessage(chatId,
        `👋 <b>CodeClaw Pro</b>

Saya coding agent canggih:
• Buat/edit file
• Git, gh CLI (GitHub)
• Web search + fetch, RAG
• Todo planning
• 📊 Trade signal XAU/USD
• 🔬 Research methods (agent/trading/tools)
• 📚 Skill system (auto-learn, auto-save)

<b>Model aktif:</b> <code>9router/Combo</code>

<b>Coding:</b> /skills /skill /memory /learn /learned /todo /mem /status /whoami /clear /help
<b>Memory:</b> /import_memory
<b>Trading:</b> /trade /gold /goldplan
<b>Research:</b> /research_methods

Langsung ketik permintaan untuk mulai.`);
      return true;
    case "/memory":
      try {
        const mems = fs.readFileSync(path.join(__dirname, "memory.jsonl"), "utf8").split("\n").filter(Boolean).slice(-5).reverse();
        if (mems.length === 0) {
          await tg.sendMessage(chatId, "🧠 Memori masih kosong. Ajak saya mengerjakan tugas!");
        } else {
          let text = "🧠 <b>5 Pelajaran Terakhir yang Saya Ingat:</b>\n\n";
          mems.forEach((m, i) => {
            const d = JSON.parse(m);
            text += `${i + 1}. <i>Task:</i> ${__escTg(String(d.task || "").slice(0, 40))}...\n   💡 <b>Insight:</b> ${__escTg(d.insight || "")}\n\n`;
          });
          await tg.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
        }
      } catch (e) {
        await tg.sendMessage(chatId, "❌ Gagal membaca memori: " + e.message);
      }
      return true;
    case "/learn": {
      await tg.sendMessage(chatId, "🎓 Memulai riset mandiri... (1-2 menit)").catch(() => {});
      try {
        const res = await runDailyLearning(llm, msg => log(msg), { force: true });
        const n = res.results?.length || 0;

        let saved = 0, skipped = 0, failed = 0;
        const savedNames = [];
        if (n > 0) {
          const { SkillStore: SKL } = await import("./lib/skills.js");
          const store = new SKL();
          for (const r of res.results) {
            const topic = String(r.topic || "").trim();
            const insight = String(r.insight || "").trim();
            if (!topic || !insight || insight.length < 15) { skipped++; continue; }

            // Skip kalau topik sudah ada skill serupa
            const existing = store.find(topic, 3);
            const dup = existing.some(s => {
              const hay = ((s.name || "") + " " + (s.trigger || "")).toLowerCase();
              const key = topic.toLowerCase().slice(0, 25);
              return key.length > 5 && hay.includes(key);
            });
            if (dup) { skipped++; continue; }

            try {
              const tagWords = (topic + " " + insight).toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter(w => w.length > 4 && w.length < 20);
              const tags = [...new Set(tagWords)].slice(0, 6);

              store.save({
                name: "riset: " + topic.slice(0, 60),
                trigger: topic + " || " + insight.slice(0, 120),
                procedure: "## Insight\n\n" + insight + "\n\n## Sumber\n\nDari autonomous learning (topic: " + topic + ").",
                tags,
                examples: []
              });
              saved++;
              savedNames.push(topic.slice(0, 40));
            } catch (e) {
              failed++;
              log("Skill save failed: " + e.message);
            }
          }
        }

        let reply = "✅ Riset selesai.\n\n";
        reply += "📚 Insight baru: " + n + "\n";
        reply += "✨ Skill tersimpan: " + saved + "\n";
        if (skipped > 0) reply += "⏭ Dilewati (duplikat/kosong): " + skipped + "\n";
        if (failed > 0) reply += "❌ Gagal simpan: " + failed + "\n";
        if (savedNames.length > 0) {
          reply += "\n*Skill baru:*\n" + savedNames.map(x => "• riset: " + x).join("\n");
        }
        reply += "\n\nCek /skills untuk lihat semua skill";
        await tg.sendMessage(chatId, __escTg(reply), { parse_mode: "HTML", disable_web_page_preview: true });
      } catch (e) {
        await tg.sendMessage(chatId, __escTg("❌ Learning gagal: " + e.message), { parse_mode: "HTML" });
      }
      return true;
    }
    case "/learned": {
      const recents = readRecentLearning(5);
      if (!recents.length) {
        await tg.sendMessage(chatId, "📚 Belum ada riset tersimpan. Coba /learn dulu.");
        return true;
      }
      let text = "📚 <b>5 Riset Terakhir:</b>\n\n";
      recents.forEach((r, i) => {
        text += `${i+1}. <b>${__escTg(r.topic)}</b>\n   ${__escTg(r.insight)}\n\n`;
      });
      await tg.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
      return true;
    }
    case "/trade": {
      try {
        const { runTradeAnalysis, readRecentTrades, computeTradeStats, readTradeState, writeTradeState } = await import("./lib/trade-analyzer.js");
        const args = text.slice(7).trim().split(/\s+/);
        const sub = args[0] || "";
        let twelveDataKey = "";
        try {
          const fsMod = await import("node:fs");
          const rawCfg = JSON.parse(fsMod.default.readFileSync(CONFIG_FILE, "utf8"));
          twelveDataKey = rawCfg.twelvedata?.apiKey || "";
        } catch (e) {
          console.log("[trade] failed read config:", e.message);
        }
        if (!twelveDataKey) {
          try {
            if (CONFIG.raw?.twelvedata?.apiKey) twelveDataKey = CONFIG.raw.twelvedata.apiKey;
            else if (CONFIG.twelvedata?.apiKey) twelveDataKey = CONFIG.twelvedata.apiKey;
          } catch {}
        }

        if (sub === "auto") {
          const toggle = args[1] || "";
          const state = readTradeState();
          if (toggle === "on") {
            state.autoEnabled = true;
            writeTradeState(state);
            await tg.sendMessage(chatId, __escTg("✅ Auto-trade ON. Auto analisa ICT/SMC setiap 4 jam (07, 11, 15, 19, 23, 03 WIB)."), { parse_mode: "HTML" });
          } else if (toggle === "off") {
            state.autoEnabled = false;
            writeTradeState(state);
            await tg.sendMessage(chatId, __escTg("⛔ Auto-trade OFF."), { parse_mode: "HTML" });
          } else {
            const st = state.autoEnabled ? "ON" : "OFF";
            const last = state.lastAutoRun ? new Date(state.lastAutoRun).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "belum pernah";
            await tg.sendMessage(chatId, __escTg("Auto-trade: " + st + "\nLast run: " + last + "\nUsage: /trade auto on|off"), { parse_mode: "HTML" });
          }
          return true;
        }

        if (sub === "list") {
          const trades = readRecentTrades(10);
          if (!trades.length) {
            await tg.sendMessage(chatId, __escTg("📭 Belum ada riwayat trade."), { parse_mode: "HTML" });
            return true;
          }
          let msg = "📜 10 Trade Terakhir:\n\n";
          for (const t of trades) {
            const d = new Date(t.ts).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
            msg += d + " | " + (t.entry || "-") + " @ " + (t.entry_price || "-") + " | Conf: " + (t.confidence || "-") + "\n";
          }
          await tg.sendMessage(chatId, __escTg(msg), { parse_mode: "HTML", disable_web_page_preview: true });
          return true;
        }

        if (sub === "stats") {
          const s = computeTradeStats();
          let msg = "📊 Trade Stats\n\nTotal: " + s.total + "\nBUY: " + s.byEntry.BUY + "\nSELL: " + s.byEntry.SELL + "\nWAIT: " + s.byEntry.WAIT + "\n";
          await tg.sendMessage(chatId, __escTg(msg), { parse_mode: "HTML" });
          return true;
        }

        await tg.sendMessage(chatId, "📊 Analisa XAU/USD... (30-60 detik)").catch(() => {});
        const manualPrice = parseFloat(sub) || null;
        // ===== ICT/SMC PRIMARY =====
        let ictSent = false;
        try {
          await tg.sendMessage(chatId, "📊 Analisa XAU/USD (ICT/SMC)... (30-60 detik)").catch(() => {});
          const { spawn } = await import("node:child_process");
          const output = await new Promise((resolve) => {
            const child = spawn("node", ["scripts/gold-analysis.mjs", "--no-telegram"], { cwd: __dirname, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
            let buf = "";
            child.stdout.on("data", d => buf += d.toString());
            child.stderr.on("data", d => buf += d.toString());
            child.on("close", (code) => resolve({ buf, code }));
            setTimeout(() => { child.kill(); resolve({ buf: buf + "\n[timeout]", code: -1 }); }, 90000);
          });
          const m = output.buf.match(/===TG_START===\n([\s\S]*?)\n===TG_END===/);
          const html = m ? m[1].trim() : "";
          if (html) {
            const goldData = extractGoldDataFromHtml(html);
            if (goldData.price) {
              goldData.mode = "plan";
              if (manualPrice) { goldData.price = manualPrice; log("trade ict: manual price override $" + manualPrice); }
              try {
                const ohlc = await analyzeOhlcForIct(CONFIG?.twelvedata?.apiKey, "XAU/USD", goldData.price);
                goldData.ohlc = ohlc;
                log("trade ict ohlc: H1=" + ohlc.counts.h1 + " M15=" + ohlc.counts.m15 + " fvgB=" + ohlc.counts.fvgBull + " fvgS=" + ohlc.counts.fvgBear + " obB=" + ohlc.counts.obBull + " obS=" + ohlc.counts.obBear);
              } catch (e) { log("trade ict: ohlc err " + e.message); }
              const ict = await runIctAnalysis(llm, goldData);
              if (ict) {
                const check = validateIctOutput(ict);
                if (check.ok) {
                  const normalized = normalizeIctHtml(ict);
                  const parts = normalized.length <= 3900 ? [normalized] : (() => {
                    const ps = []; const chunks = normalized.split(/\n\n+/); let buf = "";
                    for (const c of chunks) {
                      if ((buf + "\n\n" + c).length <= 3900) buf = buf ? buf + "\n\n" + c : c;
                      else { if (buf) ps.push(buf); buf = c.length <= 3900 ? c : c.slice(0, 3900); }
                    }
                    if (buf) ps.push(buf); return ps;
                  })();
                  for (let i = 0; i < parts.length; i++) {
                    try {
                      await tg.sendMessage(chatId, parts[i], { parse_mode: "HTML", disable_web_page_preview: true });
                    } catch (e) {
                      log("trade ict part " + (i+1) + "/" + parts.length + " gagal: " + e.message);
                      try { await tg.sendMessage(chatId, parts[i].replace(/<[^>]+>/g, "")); } catch {}
                    }
                    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 500));
                  }
                  ictSent = true;
                  log("trade ict sent " + parts.length + " parts");
                } else { log("trade ict validation failed: " + check.reason); }
              } else { log("trade ict: LLM null"); }
            } else { log("trade ict: extract gagal"); }
          } else { log("trade ict: gold-analysis gagal (exit " + output.code + ")"); }
        } catch (e) { log("trade ict err: " + e.message); }

        // ===== FALLBACK: template lama =====
        if (!ictSent) {
          log("trade: fallback ke template lama");
          const result = await runTradeAnalysis({ llm, price: manualPrice, twelveDataKey });
          await tg.sendMessage(chatId, __escTg(result.formatted), { parse_mode: "HTML", disable_web_page_preview: true });
          if (result.skillSaved) {
            await tg.sendMessage(chatId, __escTg("💾 Signal disimpan sebagai skill. Cek /skills"), { parse_mode: "HTML" });
          }
        }
      } catch (e) {
        await tg.sendMessage(chatId, __escTg("❌ Trade error: " + e.message), { parse_mode: "HTML" });
      }
      return true;
    }

    case "/gold": {
      await tg.sendMessage(chatId, "🥇 Menganalisis XAU/USD (30-60 detik)...").catch(() => {});
      const { spawn } = await import("node:child_process");
      const output = await new Promise((resolve) => {
        const child = spawn("node", ["scripts/gold-analysis.mjs", "--no-telegram"], {
          cwd: __dirname,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        let buf = "";
        child.stdout.on("data", d => buf += d.toString());
        child.stderr.on("data", d => buf += d.toString());
        child.on("close", (code) => resolve({ buf, code }));
        setTimeout(() => { child.kill(); resolve({ buf: buf + "\n[timeout]", code: -1 }); }, 90000);
      });
      // Extract HTML block dari script
      const m = output.buf.match(/===TG_START===\n([\s\S]*?)\n===TG_END===/);
      const html = m ? m[1].trim() : "";
      if (!html) {
        await tg.sendMessage(chatId, "❌ Gold analysis kosong (exit " + output.code + ")\n" + output.buf.slice(-300)).catch(() => {});
        return true;
      }
      // ===== ICT/SMC UPGRADE =====
      try {
        const goldData = extractGoldDataFromHtml(html);
        if (goldData.price) {
          goldData.mode = "analysis";
          try {
            const ohlc = await analyzeOhlcForIct(CONFIG?.twelvedata?.apiKey, "XAU/USD", goldData.price);
            goldData.ohlc = ohlc;
            log("ohlc: H1=" + ohlc.counts.h1 + " M15=" + ohlc.counts.m15 + " swings=" + ohlc.counts.swings + " fvgB=" + ohlc.counts.fvgBull + " fvgS=" + ohlc.counts.fvgBear + " obB=" + ohlc.counts.obBull + " obS=" + ohlc.counts.obBear);
            try {
              goldData.patterns = detectPatterns(ohlc.rawH1, ohlc.rawM15);
              if (goldData.patterns.ok) {
                log("patterns: H1=" + goldData.patterns.patH1.length + " M15=" + goldData.patterns.patM15.length + " S/R=" + goldData.patterns.nearSupports.length + "/" + goldData.patterns.nearResistances.length + " chart=" + goldData.patterns.chartPatterns.length);
              } else {
                log("patterns: SKIP — " + goldData.patterns.skipReason);
              }
            } catch (pe) { log("patterns err: " + pe.message); }
          } catch (e) {
            log("ohlc err: " + e.message);
          }
          const ict = await runIctAnalysis(llm, goldData);
          const check = ict ? validateIctOutput(ict) : { ok: false, reason: "llm null/empty" };
          if (check.ok) {
            const ictParts = (() => {
              const maxLen = 3900;
              if (ict.length <= maxLen) return [ict];
              const ps = [];
              const chunks = ict.split(/\n\n+/);
              let buf = "";
              for (const c of chunks) {
                if ((buf + "\n\n" + c).length <= maxLen) buf = buf ? buf + "\n\n" + c : c;
                else { if (buf) ps.push(buf); buf = c.length <= maxLen ? c : c.slice(0, maxLen); }
              }
              if (buf) ps.push(buf);
              return ps;
            })();
            let ictSent = 0;
            for (let i = 0; i < ictParts.length; i++) {
              const normalized = normalizeIctHtml(ictParts[i]);
              try {
                await tg.sendMessage(chatId, normalized, { parse_mode: "HTML", disable_web_page_preview: true });
                ictSent++;
                if (i < ictParts.length - 1) await new Promise(r => setTimeout(r, 500));
              } catch (e) {
                log("ict part " + (i+1) + "/" + ictParts.length + " gagal: " + e.message);
                log("ict raw snippet: " + ictParts[i].slice(0, 300).replace(/\n/g, " "));
                try { await tg.sendMessage(chatId, ictParts[i].replace(/<[^>]+>/g, "")); ictSent++; }
                catch (e2) { log("ict fallback " + (i+1) + " gagal: " + e2.message); }
              }
            }
            log("ict sent " + ictSent + "/" + ictParts.length + " parts");
            return true;
          }
          log("ict validation failed: " + check.reason + " — fallback template");
        } else {
          log("gold data extract failed (price null) — fallback template");
        }
      } catch (e) {
        log("ict upgrade err: " + e.message);
      }

      // ===== FALLBACK: template existing =====
      // Smart split by paragraph, HTML-safe (tidak motong tag di tengah)
      function smartSplit(t, maxLen) {
        if (t.length <= maxLen) return [t];
        const parts = [];
        const chunks = t.split(/\n\n+/);
        let buf = "";
        for (const c of chunks) {
          if ((buf + "\n\n" + c).length <= maxLen) {
            buf = buf ? buf + "\n\n" + c : c;
          } else {
            if (buf) parts.push(buf);
            if (c.length <= maxLen) {
              buf = c;
            } else {
              // Paksa split by sentence
              const sents = c.split(/(?<=[.!?])\s+/);
              let sub = "";
              for (const s of sents) {
                if ((sub + " " + s).length <= maxLen) sub = sub ? sub + " " + s : s;
                else { if (sub) parts.push(sub); sub = s; }
              }
              buf = sub;
            }
          }
        }
        if (buf) parts.push(buf);
        return parts;
      }
      const parts = smartSplit(html, 3900);
      let sent = 0;
      for (let i = 0; i < parts.length; i++) {
        try {
          await tg.sendMessage(chatId, parts[i], { parse_mode: "HTML", disable_web_page_preview: true });
          sent++;
          if (i < parts.length - 1) await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          log("gold part " + (i+1) + "/" + parts.length + " gagal: " + e.message);
          try {
            await tg.sendMessage(chatId, parts[i].replace(/<[^>]+>/g, ""));
            sent++;
          } catch (e2) { log("gold fallback " + (i+1) + " gagal: " + e2.message); }
        }
      }
      log("gold sent " + sent + "/" + parts.length + " parts (HTML)");
      return true;
    }
    case "/health": {
      const os = await import("node:os");
      const fsm = await import("node:fs");
      const freeMB = Math.round(os.freemem() / 1048576);
      const totalMB = Math.round(os.totalmem() / 1048576);
      let diskFree = "?";
      try {
        const st = fsm.statfsSync("/");
        diskFree = Math.round((st.bsize * st.bavail) / 1073741824) + " GB";
      } catch (e) { diskFree = "err"; }
      let swapMB = 0;
      try {
        const mi = fsm.readFileSync("/proc/meminfo", "utf8");
        const m = mi.match(/SwapTotal:\s+(\d+)/);
        if (m) swapMB = Math.round(parseInt(m[1]) / 1024);
      } catch (e) {}
      let r9 = "err", tmux = "?";
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        const res = await fetch("http://127.0.0.1:20128/v1/models", { signal: ctl.signal });
        clearTimeout(t);
        r9 = String(res.status);
      } catch (e) { r9 = "down"; }
      try {
        const { execSync } = await import("node:child_process");
        execSync("tmux has-session -t 9router 2>/dev/null", { stdio: "ignore", timeout: 2000 });
        tmux = "up";
      } catch (e) { tmux = "down"; }
      const upSec = Math.floor(process.uptime());
      const hh = Math.floor(upSec / 3600);
      const mm = Math.floor((upSec % 3600) / 60);
      const ramIcon = freeMB > 200 ? "🟢" : freeMB > 100 ? "🟡" : "🔴";
      const lines = [
        "🏥 CodeClaw Health",
        "",
        "🟢 Bot: alive (" + hh + "h " + mm + "m)",
        ramIcon + " RAM: " + freeMB + " / " + totalMB + " MB",
        "🟢 Disk: " + diskFree + " free",
        (r9 === "200" ? "🟢" : "🔴") + " 9router: HTTP " + r9,
        (tmux === "up" ? "🟢" : "🔴") + " tmux: " + tmux,
        (swapMB > 0 ? "🟢" : "🟡") + " Swap: " + swapMB + " MB",
        "🟢 LLM: " + (CONFIG.llm?.modelRef || "?"),
      ];
      await tg.sendMessage(chatId, lines.join("\n"));
      return true;
    }
    case "/9router": {
      const { execSync } = await import("node:child_process");
      const sub = (text.split(/\s+/)[1] || "status").toLowerCase();
      if (sub === "restart") {
        await tg.sendMessage(chatId, "🔄 Restart 9router...");
        try { execSync("tmux kill-session -t 9router 2>/dev/null", { stdio: "ignore", timeout: 3000 }); } catch (e) {}
        await new Promise(r => setTimeout(r, 2000));
        try { execSync("tmux new-session -d -s 9router '/usr/bin/9router -l --no-browser --port 20128'", { stdio: "ignore", timeout: 5000 }); } catch (e) {}
        await new Promise(r => setTimeout(r, 4000));
      }
      let http = "err", tmux = "?";
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        const res = await fetch("http://127.0.0.1:20128/v1/models", { signal: ctl.signal });
        clearTimeout(t);
        http = String(res.status);
      } catch (e) { http = "down"; }
      try {
        execSync("tmux has-session -t 9router 2>/dev/null", { stdio: "ignore", timeout: 2000 });
        tmux = "up";
      } catch (e) { tmux = "down"; }
      const ok = http === "200";
      await tg.sendMessage(chatId, (ok ? "🟢" : "🔴") + " 9router\n\nHTTP: " + http + "\ntmux: " + tmux + (ok ? "" : "\n\nGunakan /9router restart"));
      return true;
    }
    case "/brain": {
      const lvl = (text.split(/\s+/)[1] || "").toLowerCase();
      const valid = ["off", "normal", "high", "genius"];
      if (!lvl) {
        await tg.sendMessage(chatId, "🧠 Brain Level\n\nAktif: " + (CONFIG.agent?.brainLevel || "normal") + "\n\nPilihan: " + valid.join(" / "));
        return true;
      }
      if (!valid.includes(lvl)) {
        await tg.sendMessage(chatId, "❌ Tidak valid. Pilih: " + valid.join(" / "));
        return true;
      }
      CONFIG.agent = CONFIG.agent || {};
      CONFIG.agent.brainLevel = lvl;
      try {
        const fsm = await import("node:fs");
        const raw = JSON.parse(fsm.readFileSync(CONFIG_FILE, "utf8"));
        raw.agent = raw.agent || {};
        raw.agent.brainLevel = lvl;
        fsm.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2));
        const note = lvl === "genius" ? "4 LLM call, lambat" : lvl === "high" ? "2 LLM call" : lvl === "normal" ? "1 LLM call" : "tanpa cognitive";
        await tg.sendMessage(chatId, "✅ Brain → " + lvl + "\n" + note);
      } catch (e) {
        await tg.sendMessage(chatId, "⚠️ Memory set " + lvl + "\n❌ Save gagal: " + e.message);
      }
      return true;
    }
    case "/doctor": {
      const os = await import("node:os");
      const fsm = await import("node:fs");
      const results = [];
      const check = (name, status, detail) => results.push({ name, status, detail: String(detail) });

      check("Node.js", "ok", process.version);

      const cfgPath = CONFIG_FILE;
      if (fsm.existsSync(cfgPath)) {
        const st = fsm.statSync(cfgPath);
        check("Config file", "ok", Math.round(st.size / 1024) + " KB");
        try {
          const raw = JSON.parse(fsm.readFileSync(cfgPath, "utf8"));
          check("Config parse", "ok", "valid JSON");
          try {
            const { validateConfig } = await import("./lib/config-schema.js");
            validateConfig(raw);
            check("Config schema", "ok", "Zod valid");
          } catch (e) {
            check("Config schema", "fail", String(e.message).slice(0, 60));
          }
        } catch (e) {
          check("Config parse", "fail", String(e.message).slice(0, 60));
        }
      } else {
        check("Config file", "fail", "missing");
      }

      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        const res = await fetch("http://127.0.0.1:20128/v1/models", { signal: ctl.signal });
        clearTimeout(t);
        check("9router", res.status === 200 ? "ok" : "warn", "HTTP " + res.status);
      } catch (e) {
        check("9router", "fail", "unreachable");
      }

      const ppid = process.ppid;
      check("Supervisor", (ppid && ppid !== 1) ? "ok" : "warn", "ppid " + ppid);

      const freeMB = Math.round(os.freemem() / 1048576);
      check("RAM", freeMB > 200 ? "ok" : freeMB > 100 ? "warn" : "fail", freeMB + " MB free");

      try {
        const st = fsm.statfsSync("/");
        const freeGB = Math.round((st.bsize * st.bavail) / 1073741824);
        check("Disk", freeGB > 5 ? "ok" : "warn", freeGB + " GB free");
      } catch (e) {
        check("Disk", "fail", "statfs error");
      }

      let swapMB = 0;
      try {
        const mi = fsm.readFileSync("/proc/meminfo", "utf8");
        const m = mi.match(/SwapTotal:\s+(\d+)/);
        if (m) swapMB = Math.round(parseInt(m[1]) / 1024);
      } catch (e) {}
      check("Swap", swapMB > 0 ? "ok" : "warn", swapMB + " MB");

      try {
        const memPath = MEMORY_FILE;
        if (fsm.existsSync(memPath)) {
          const st = fsm.statSync(memPath);
          const cnt = fsm.readFileSync(memPath, "utf8").split("\n").filter(Boolean).length;
          check("Memory", "ok", Math.round(st.size / 1024) + " KB, " + cnt + " entries");
        } else {
          check("Memory", "warn", "no memory.jsonl yet");
        }
      } catch (e) {
        check("Memory", "fail", String(e.message).slice(0, 40));
      }

      try {
        const lsPath = LEARNING_STATE;
        if (fsm.existsSync(lsPath)) {
          const st = JSON.parse(fsm.readFileSync(lsPath, "utf8"));
          if (st.lastRun) {
            const agoH = Math.round((Date.now() - st.lastRun) / 3600000);
            const cnt = st.todayCount || 0;
            check("Learning", agoH < 24 ? "ok" : "warn", "last " + agoH + "h ago, " + cnt + "/4 today");
          }
        }
      } catch (e) {}

      const icons = { ok: "✅", warn: "⚠️", fail: "❌" };
      const lines = ["🩺 CodeClaw Doctor", ""];
      let okC = 0, warnC = 0, failC = 0;
      for (const r of results) {
        if (r.status === "ok") okC++;
        else if (r.status === "warn") warnC++;
        else failC++;
        lines.push(icons[r.status] + " " + r.name + ": " + r.detail);
      }
      lines.push("");
      lines.push("Total: " + results.length + " check (" + okC + " ok, " + warnC + " warn, " + failC + " fail)");
      if (failC > 0) lines.push("⚠️ Ada yang gagal — cek detail di atas.");
      await tg.sendMessage(chatId, lines.join("\n"));
      return true;
    }
    case "/restart": {
      await tg.sendMessage(chatId, "🔄 Restart dalam 2 detik...\nSupervisor akan start ulang otomatis.");
      try {
        const { spawn } = await import("node:child_process");
        spawn("bash", ["-c", `sleep 2 && cd "${__dirname}" && ./run.sh stop && sleep 1 && ./run.sh start`], {
          detached: true,
          stdio: "ignore",
          cwd: __dirname
        }).unref();
      } catch (e) {
        await tg.sendMessage(chatId, "❌ Restart gagal: " + e.message);
        return true;
      }
      setTimeout(() => process.exit(0), 3000);
      return true;
    }
    case "/goldplan": {
      await tg.sendMessage(chatId, "⏳ Mengumpulkan data XAU/USD (harga, makro, berita)...");
      try {
        const { spawn } = await import("node:child_process");
        const rawData = await new Promise((resolve) => {
          const child = spawn("node", ["scripts/gold-analysis.mjs", "--no-telegram"], { cwd: __dirname });
          let buf = "";
          child.stdout.on("data", d => buf += d.toString());
          child.stderr.on("data", d => buf += d.toString());
          child.on("close", () => resolve(buf));
          setTimeout(() => { child.kill(); resolve(buf + "\n[timeout]"); }, 60000);
        });

        await tg.sendMessage(chatId, "🧠 Menyusun analisis dengan standar Senior Analyst...");
        
        const { GOLDPLAN_PROMPT } = await import("./lib/goldplan-prompt.js");
        
        const userPrompt = "Berikut adalah data mentah terkini XAU/USD, Makro, dan Berita dari sistem:\n" +
          "=== DATA MENTAH ===\n" + rawData + "\n=== END DATA ===\n\n" +
          "Gunakan data di atas untuk mengisi bagian INPUT. Jika ada data yang kurang, tulis 'data tidak tersedia'.\n" +
          "Eksekusi METODOLOGI dan hasilkan laporan sesuai FORMAT OUTPUT FINAL.\n\n" +
          GOLDPLAN_PROMPT;

        const res = await llm.chat({
          messages: [
            { role: "system", content: "Anda adalah analis trading senior XAU/USD. Jawab dalam Bahasa Indonesia. Patuhi aturan keras dan FORMAT KHUSUS TELEGRAM." },
            { role: "user", content: userPrompt }
          ]
        });
        
        let md = (res.message.content || "Gagal menghasilkan analisis.").trim();

        // Konversi markdown sederhana ke HTML
        const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        let html = esc(md)
          .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
          .replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, "<i>$1</i>")
          .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

        // Smart split: by paragraph (\n\n), fallback by line
        function smartSplit(t, maxLen) {
          if (t.length <= maxLen) return [t];
          const parts = [];
          const chunks = t.split(/\n\n+/);
          let buf = "";
          for (const c of chunks) {
            if ((buf + "\n\n" + c).length <= maxLen) {
              buf = buf ? buf + "\n\n" + c : c;
            } else {
              if (buf) parts.push(buf);
              if (c.length <= maxLen) buf = c;
              else {
                const lines = c.split(/\n/);
                let sub = "";
                for (const ln of lines) {
                  if ((sub + "\n" + ln).length <= maxLen) sub = sub ? sub + "\n" + ln : ln;
                  else { if (sub) parts.push(sub); sub = ln; }
                }
                buf = sub;
              }
            }
          }
          if (buf) parts.push(buf);
          return parts;
        }

        const parts = smartSplit(html, 3900);
        for (let i = 0; i < parts.length; i++) {
          try {
            await tg.sendMessage(chatId, parts[i], { parse_mode: "HTML", disable_web_page_preview: true });
          } catch (e) {
            log("goldplan part " + (i+1) + " error: " + e.message);
            try {
              await tg.sendMessage(chatId, parts[i].replace(/<[^>]+>/g, ""));
            } catch (e2) { log("goldplan fallback error: " + e2.message); }
          }
          if (i < parts.length - 1) await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        await tg.sendMessage(chatId, "❌ Gagal: " + e.message);
      }
      return true;
    }
    case "/clear":
      session.clear(chatId); session.todoClear(chatId);
      await tg.sendMessage(chatId, "✅ Cleared");
      return true;
    case "/todo": {
      const t = session.todoList(chatId);
      if (!t.length) { await tg.sendMessage(chatId, "(no todos)"); return true; }
      await tg.sendMessage(chatId, t.map(x => `[${x.id}] ${x.status} — ${x.task}`).join("\n"));
      return true;
    }
    case "/mem": {
      const all = session.memList(chatId);
      const m = all.filter(x => !String(x.key || "").startsWith("think_"));
      const hidden = all.length - m.length;
      if (!m.length) {
        await tg.sendMessage(chatId, __escTg("(empty)" + (hidden ? " — " + hidden + " think_* disembunyikan" : "")), { parse_mode: "HTML" });
        return true;
      }
      const core = [], learned = [], other = [];
      const CORE_PREFIX = ["agent_weaknesses", "honesty_over_claims", "response_style", "identity", "user"];
      for (const x of m) {
        const k = String(x.key || "");
        const raw = String(x.value == null ? "" : x.value);
        const short = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
        const line = "<b>" + __escTg(k) + "</b>\n" + __escTg(short);
        if (CORE_PREFIX.some(p => k.startsWith(p))) core.push(line);
        else if (k.startsWith("skill_") || k.startsWith("learned_")) learned.push(line);
        else other.push(line);
      }
      const parts = [];
      if (core.length) parts.push("📌 <b>Core</b>\n" + core.join("\n\n"));
      if (learned.length) parts.push("📚 <b>Learned</b>\n" + learned.join("\n\n"));
      if (other.length) parts.push("🗂 <b>Other</b>\n" + other.join("\n\n"));
      let out = "🧠 <b>Memory</b>\n\n" + parts.join("\n\n");
      if (hidden) out += "\n\n<i>(" + hidden + " think_* disembunyikan)</i>";
      if (out.length > 3800) out = out.slice(0, 3800) + "\n\n<i>… (dipotong)</i>";
      await tg.sendMessage(chatId, out, { parse_mode: "HTML", disable_web_page_preview: true });
      return true;
    }
    case "/status": {
      const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      await tg.sendMessage(chatId,
        `<b>Status</b>\nModel: <code>${__escTg(CONFIG.llm.modelRef)}</code>\n` +
        `History: ${session.count(chatId)} msgs\n` +
        `Todos: ${session.todoList(chatId).length}\n` +
        `RAM: ${mem} MB\nUptime: ${Math.floor(process.uptime())}s\n` +
        `PID: <code>${process.pid}</code>`, { parse_mode: "HTML" });
      return true;
    }
    case "/whoami":
      await tg.sendMessage(chatId,
        `User ID: <code>${from.id}</code>\nChat ID: <code>${chatId}</code>\n\n` +
        `Lock bot: tambahkan <code>${from.id}</code> ke allowlist:\n` +
        `<code>node cli.js channel telegram allow ${from.id}</code>`, { parse_mode: "HTML" });
      return true;

    case "/research_methods": {
      try {
        const { runMethodsResearch, readMethodsState, writeMethodsState, readRecentResearch, computeMethodsStats } = await import("./lib/methods-research.js");
        const args = text.slice(18).trim().split(/\s+/);
        const sub = args[0] || "";

        if (sub === "auto") {
          const toggle = args[1] || "";
          const state = readMethodsState();
          if (toggle === "on") {
            state.autoEnabled = true;
            writeMethodsState(state);
            await tg.sendMessage(chatId, __escTg("✅ Auto-research ON.\nSetiap hari 03:00 WIB riset 3 topik (agent, trading, tools) + auto-save skill."), { parse_mode: "HTML" });
          } else if (toggle === "off") {
            state.autoEnabled = false;
            writeMethodsState(state);
            await tg.sendMessage(chatId, __escTg("⛔ Auto-research OFF."), { parse_mode: "HTML" });
          } else {
            const st = state.autoEnabled ? "ON" : "OFF";
            const last = state.lastAutoRun ? new Date(state.lastAutoRun).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "belum pernah";
            await tg.sendMessage(chatId, __escTg("Auto-research: " + st + "\nLast run: " + last + "\nUsage: /research_methods auto on|off"), { parse_mode: "HTML" });
          }
          return true;
        }

        if (sub === "list") {
          const recents = readRecentResearch(5);
          if (!recents.length) {
            await tg.sendMessage(chatId, __escTg("📭 Belum ada riwayat riset."), { parse_mode: "HTML" });
            return true;
          }
          let msg = "📜 5 Riset Terakhir:\n\n";
          for (const r of recents) {
            const d = new Date(r.ts).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
            msg += d + "\n  Saved: " + r.saved + " | Skip: " + r.skipped + " | Fail: " + r.failed + "\n";
            if (r.results?.length) r.results.forEach(x => msg += "    • [" + x.category + "] " + x.method + "\n");
            msg += "\n";
          }
          await tg.sendMessage(chatId, __escTg(msg), { parse_mode: "HTML", disable_web_page_preview: true });
          return true;
        }

        if (sub === "stats") {
          const s = computeMethodsStats();
          let msg = "📊 Research Stats\n\n";
          msg += "Total runs: " + s.totalRuns + "\n";
          msg += "Saved: " + s.total.saved + "\n";
          msg += "Skipped: " + s.total.skipped + "\n";
          msg += "Failed: " + s.total.failed + "\n\n";
          msg += "Per kategori:\n";
          msg += "• 🤖 AI Agent: " + s.byCategory.agent + "\n";
          msg += "• 📈 Trading: " + s.byCategory.trading + "\n";
          msg += "• 🔧 Tools: " + s.byCategory.tools + "\n";
          await tg.sendMessage(chatId, __escTg(msg), { parse_mode: "HTML" });
          return true;
        }

        const cats = [];
        if (sub === "agent" || sub === "trading" || sub === "tools") cats.push(sub);
        else cats.push("agent", "trading", "tools");

        await tg.sendMessage(chatId, "🔬 Riset metode terbaru... (2-4 menit)\nKategori: " + cats.join(", ")).catch(() => {});

        const result = await runMethodsResearch(llm, msg => log(msg), { force: true, categories: cats });

        if (result.skipped) {
          await tg.sendMessage(chatId, __escTg("⏭ Skip: " + (result.reason || "limit")), { parse_mode: "HTML" });
          return true;
        }
        if (result.error) {
          await tg.sendMessage(chatId, __escTg("❌ Error: " + (result.message || result.error)), { parse_mode: "HTML" });
          return true;
        }

        let reply = "✅ Riset selesai.\n\n";
        reply += "📚 Topik diriset: " + result.totalTopics + "\n";
        reply += "✨ Skill tersimpan: " + result.savedCount + "\n";
        if (result.skippedCount > 0) reply += "⏭ Dilewati: " + result.skippedCount + "\n";
        if (result.failedCount > 0) reply += "❌ Gagal: " + result.failedCount + "\n";
        reply += "\n*Skill baru:*\n";
        for (const cat of ["agent", "trading", "tools"]) {
          if (result.byCategory[cat]?.length) {
            reply += "\n" + cat.toUpperCase() + ":\n";
            result.byCategory[cat].forEach(m => reply += "  • " + m + "\n");
          }
        }
        reply += "\nCek /skills untuk semua";
        await tg.sendMessage(chatId, __escTg(reply), { parse_mode: "HTML", disable_web_page_preview: true });
      } catch (e) {
        await tg.sendMessage(chatId, __escTg("❌ Research error: " + e.message), { parse_mode: "HTML" });
      }
      return true;
    }

    case "/import_memory": {
      try {
        const { MEMORY_FILE } = await import("./lib/paths.js");
        const { SkillStore } = await import("./lib/skills.js");
        const fsm = await import("node:fs");
        if (!fsm.existsSync(MEMORY_FILE)) {
          await tg.sendMessage(chatId, "❌ Memory file tidak ada.");
          return true;
        }
        const lines = fsm.readFileSync(MEMORY_FILE, "utf8").split("\n").filter(Boolean);
        const store = new SkillStore();
        let saved = 0, skipped = 0;
        for (const line of lines) {
          try {
            const m = JSON.parse(line);
            const task = String(m.task || "").trim();
            const insight = String(m.insight || "").trim();
            if (!task || !insight || insight.length < 20) { skipped++; continue; }
            const existing = store.find(task.slice(0, 30), 3);
            if (existing.some(s => (s.name+s.trigger).toLowerCase().includes(task.toLowerCase().slice(0,25)))) { skipped++; continue; }
            const tags = [...new Set((task+" "+insight).toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>4))].slice(0,6);
            const cleanTask = task.replace(/^\[RISET\]\s*/, "").trim();
            store.save({ name: (task.startsWith("[RISET]")?"riset: ":"memory: ")+cleanTask.slice(0,55), trigger: cleanTask+" | "+insight.slice(0,100), procedure: "## Insight\n\n"+insight+"\n\n## Sumber\n\nDari memory.", tags, examples: [] });
            saved++;
          } catch { skipped++; }
        }
        await tg.sendMessage(chatId, `📚 Import memory → skill\n\n✅ Saved: ${saved}\n⏭ Skipped: ${skipped}\n\nCek /skills`);
      } catch (e) {
        await tg.sendMessage(chatId, "❌ Error: " + e.message);
      }
      return true;
    }
    case "/skills": {
      const { SkillStore: SK } = await import("./lib/skills.js");
      const store = new SK();
      const skills = store.list();
      const stats = store.stats();
      let txt = "📚 Skills: " + skills.length + "\n\n";
      txt += "Uses: " + stats.totalUses + " | OK: " + stats.totalSuccesses + " | Fail: " + stats.totalFailures + "\n\n";
      if (!skills.length) {
        txt += "Belum ada skill.";
      } else {
        const list = skills.slice(0, 25);
        for (const s of list) {
          const rate = s.uses ? Math.round(100 * s.successes / s.uses) + "%" : "unused";
          txt += "• " + s.id + " — " + (s.name || "") + " (" + rate + ")\n";
        }
        if (skills.length > 25) txt += "\n...dan " + (skills.length - 25) + " lainnya";
        txt += "\n\n Usage: /skill [id] | /skill search [q]";
      }
      await tg.sendMessage(chatId, __escTg(txt));
      return true;
    }
    case "/skill": {
      const { SkillStore: SK2 } = await import("./lib/skills.js");
      const store = new SK2();
      const parts = text.slice(7).trim().split(/\s+/);
      const sub = parts[0] || "";
      if (sub === "search") {
        const q = parts.slice(1).join(" ");
        if (!q) { await tg.sendMessage(chatId, "Usage: /skill search [query]"); return true; }
        const results = store.find(q, 10);
        let msg = "🔍 " + results.length + " skill cocok dengan \"" + q + "\":\n\n";
        if (!results.length) msg = "❌ Tidak ada cocok dengan \"" + q + "\"";
        else for (const s of results) msg += "• " + s.id + " — " + (s.name || "") + "\n";
        await tg.sendMessage(chatId, __escTg(msg));
        return true;
      }
      if (sub === "delete" || sub === "rm") {
        const id = parts[1];
        if (!id) { await tg.sendMessage(chatId, "Usage: /skill delete [id]"); return true; }
        const ok = store.delete(id);
        await tg.sendMessage(chatId, ok ? "✅ Skill " + id + " dihapus" : "❌ Skill " + id + " tidak ada");
        return true;
      }
      if (!sub) {
        await tg.sendMessage(chatId, " Usage: /skill [id] | /skill search [q] | /skill delete [id]");
        return true;
      }
      const content = store.read(sub);
      if (!content) { await tg.sendMessage(chatId, "❌ Skill " + sub + " tidak ditemukan"); return true; }
      const safeContent = content.length > 4000 ? content.slice(0, 3800) + "\n\n(dipotong)" : content;
      await tg.sendMessage(chatId, __escTg(safeContent));
      return true;
    }

    case "/help":
      await tg.sendMessage(chatId,
        `*Commands:*\n/start /gold /goldplan /memory /learn /learned /clear /todo /mem /status /whoami /help\n\n` +
        `*Contoh prompt:*\n` +
        `• "clone repo X, baca README, ringkas 5 poin"\n` +
        `• "buat website portfolio di ~/portfolio"\n` +
        `• "debug error di ~/app: [paste error]"\n` +
        `• "index codebase ~/app dan cari fungsi auth"`);
      return true;
  }
  return false;
}

async function handleFile(chatId, message) {
  const doc = message.document;
  const photo = message.photo;
  if (!doc && !photo) return null;
  const fileId = doc?.file_id ?? photo[photo.length - 1].file_id;
  const name = doc?.file_name ?? `photo_${Date.now()}.jpg`;
  const dest = path.join(DL_DIR, `${Date.now()}_${name.replace(/[^\w.\-]/g, "_")}`);
  try {
    const { size } = await tg.downloadFile(fileId, dest);
    return { path: dest, size };
  } catch (e) { return { error: e.message }; }
}


async function transcribeAudio(filePath) {
  const apiKey = CONFIG.raw.audio?.groqApiKey || process.env.GROQ_API_KEY;
  if (!apiKey) return "[Voice note diterima, tapi GROQ_API_KEY belum diset di config.json]";
  try {
    const fileBlob = new Blob([fs.readFileSync(filePath)], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', fileBlob, 'audio.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.text || "[Gagal transkripsi]";
  } catch (e) { return `[Error transkripsi: ${e.message}]`; }
}

async function processImage(chatId, text, imagePath, from) {
  const b64 = fs.readFileSync(imagePath).toString("base64");
  const userContent = [
    { type: "text", text: text || "Tolong jelaskan gambar ini." },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }
  ];
  const messages = [ { role: "system", content: buildSystem(chatId, text) }, { role: "user", content: userContent } ];
  let responseText = "";
  const typing = setInterval(() => tg.sendChatAction(chatId).catch(() => {}), 4500);
  tg.sendChatAction(chatId).catch(() => {});
  try {
    const res = await llm.chat({ messages, tools: TOOL_DEFINITIONS, onStream: c => responseText += c });
    session.add(chatId, { role: "user", content: text || "[Gambar]" });
    session.add(chatId, res.message);
    if (responseText.trim()) await tg.sendMessage(chatId, responseText);
    else await tg.sendMessage(chatId, "(no response)").catch(() => {});
  } catch (e) { await tg.sendMessage(chatId, `❌ Gagal memproses gambar: ${e.message}`); }
  finally { clearInterval(typing); }
}

async function main() {
  log("Starting CodeClaw Pro Telegram...");
  fs.writeFileSync(PID_FILE, String(process.pid));
  log(`Model: ${CONFIG.llm.modelRef}`);
  let me;
  try {
    me = await tg.getMe();
  } catch (e) {
    log(`Fatal: getMe gagal — ${e.message}`);
    cleanupAndExit(1);
    return;
  }
  log(`Bot: @${me.username} | Brain: ${CONFIG.agent.brainLevel || "normal"} | PID ${process.pid}`);

  // 🎓 Autonomous learning scheduler (30 menit sekali cek, 24 jam sekali eksekusi)
  const LEARN_INTERVAL = 30 * 60 * 1000;
  setInterval(() => {
    runDailyLearning(llm, msg => log(msg)).catch(e => log("learning err: " + e.message));
  }, LEARN_INTERVAL);
  setTimeout(() => {
    runDailyLearning(llm, msg => log(msg)).catch(e => log("learning startup: " + e.message));
  }, 2 * 60 * 1000);
  log("🎓 Learning scheduler aktif (check tiap 30m, run tiap 6h)");

  // ===== HOURLY ICT CRON =====
  setInterval(async () => {
    try {
      const { readTradeState } = await import("./lib/trade-analyzer.js");
      const st = readTradeState();
      if (!st.autoEnabled) return;
      const now = new Date();
      if (now.getMinutes() !== 0) return;
      if (now.getUTCHours() % 4 !== 0) return;   // every 4h UTC (00,04,08,12,16,20)
      const hourKey = now.toISOString().slice(0, 13);
      if (HOURLY_ICT_LAST_HOUR === hourKey) return;
      HOURLY_ICT_LAST_HOUR = hourKey;
      const allowlist = (process.env.TG_ALLOWLIST || "6206096363").split(",").map(s => s.trim()).filter(Boolean);
      log("🕐 ICT tick " + hourKey + " → " + allowlist.join(","));
      for (const cid of allowlist) {
        await runHourlyIctForChat(cid).catch(e => log("hourly chat " + cid + " err: " + e.message));
      }
    } catch (e) { log("hourly cron err: " + e.message); }
  }, 60 * 1000);
  log("🕐 ICT cron aktif — setiap 4 jam (00,04,08,12,16,20 UTC = 07,11,15,19,23,03 WIB) kalau /trade auto on");

  log(ALLOWED.size ? `Allowlist: ${[...ALLOWED].join(",")}` : "⚠️  Allowlist kosong — semua user bisa pakai");

  // Heartbeat independen dari poll loop. Timer tetap jalan walau proses LLM
  // sedang blocking berjam-jam, jadi watchdog tidak salah kira hang.
  fs.writeFileSync(HEALTH_FILE, String(Date.now()));
  const heartbeat = setInterval(() => {
    try { fs.writeFileSync(HEALTH_FILE, String(Date.now())); } catch {}
  }, 15_000);
  heartbeat.unref?.();

  let offset = 0, errors = 0;
  while (!shuttingDown) {
    try {
      const updates = await tg.getUpdates(offset, CONFIG.telegram.pollTimeout ?? 30);
      errors = 0;
      for (const u of updates) {
        offset = u.update_id + 1;
        const m = u.message; if (!m) continue;
        const chatId = m.chat.id, from = m.from;
        const text = m.text ?? m.caption ?? "";

        if (ALLOWED.size && !ALLOWED.has(from.id)) {
          tg.sendMessage(chatId, "⛔ Unauthorized").catch(() => {});
          continue;
        }
        log(`[${from.id}] ${text.slice(0, 80)}`);
        try {
          if (m.voice) {
            const dest = path.join(DL_DIR, `voice_${Date.now()}.ogg`);
            await tg.downloadFile(m.voice.file_id, dest);
            const transcript = await transcribeAudio(dest);
            await processMessage(chatId, transcript, from);
            continue;
          }
          if (m.photo) {
            const dest = path.join(DL_DIR, `photo_${Date.now()}.jpg`);
            await tg.downloadFile(m.photo[m.photo.length - 1].file_id, dest);
            await processImage(chatId, m.caption || "", dest, from);
            continue;
          }
          const file = await handleFile(chatId, m);
          if (file) {
            if (file.error) await tg.sendMessage(chatId, `❌ ${file.error}`);
            else if (text.trim()) await processMessage(chatId, `File: ${file.path}\n\n${text}`, from);
            else await tg.sendMessage(chatId, `📎 Saved: \`${file.path}\``);
            continue;
          }
          if (!text) continue;
          if (text.startsWith("/") && await handleCommand(chatId, text, from)) continue;
          await processMessage(chatId, text, from);
        } catch (e) {
          log(`err: ${e.message}`);
          await tg.sendMessage(chatId, `❌ ${escapeHtml(e.message)}`).catch(() => {});
        }
      }
    } catch (e) {
      if (shuttingDown) break;
      errors++;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(errors, 5));
      log(`poll err #${errors}: ${e.message} — retry in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// --- Lapis 3: jangan biarkan satu error acak mematikan bot ---
let shuttingDown = false;
let crashCount = 0;
let crashWindowStart = Date.now();

function cleanupAndExit(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
  try { session.close(); } catch {}
  process.exit(code);
}

process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  log(`⚠️ unhandledRejection (diabaikan, bot lanjut): ${msg.slice(0, 500)}`);
});

process.on("uncaughtException", (err) => {
  log(`⚠️ uncaughtException: ${(err?.stack || err?.message || err).toString().slice(0, 500)}`);
  // Error non-fatal (network, parse) tidak boleh membunuh proses.
  // Kalau error berulang dalam waktu singkat, baru menyerah ke supervisor.
  const now = Date.now();
  if (now - crashWindowStart > 60_000) { crashWindowStart = now; crashCount = 0; }
  crashCount++;
  if (crashCount > 10) {
    log("❌ Terlalu banyak crash dalam 60s — keluar supaya supervisor restart");
    cleanupAndExit(1);
  }
});

main().catch((e) => {
  log(`Fatal: ${e.message}`);
  cleanupAndExit(1);
});

