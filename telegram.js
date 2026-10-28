import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "./lib/llm.js";
import { Session } from "./lib/session.js";
import { TOOL_DEFINITIONS, executeTool } from "./lib/tools.js";
import { TelegramAPI } from "./lib/telegram-api.js";
import { todoSection } from "./lib/planner.js";
import { memorySection, retrieveExperiences, reflectExperience, saveExperience } from "./lib/memory.js";
import { distillSkill, improveSkill, autoImproveFailingSkills, isComplexTask } from "./lib/skill-distiller.js";
import { loadConfig, migrateIfNeeded } from "./lib/config.js";
import { TOOL_USE_RULES } from "./lib/tool-use-rules.js";
import { getBrainPrompt } from "./lib/brain.js";
import { shouldChunk, saveMission, buildMissionPrompt } from "./lib/long-task.js";
import { runDailyLearning, readRecentLearning } from "./lib/autonomous-learning.js";
import { planTask, critiqueResult, fixResult, shouldCritique } from "./lib/cognitive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
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

function buildSystem(chatId) {
  const brainLevel = CONFIG.agent.brainLevel || CONFIG.agent.brain || "normal";
  return BASE_SYSTEM + getBrainPrompt(brainLevel) + TOOL_USE_RULES + todoSection(session, chatId) + memorySection(session, chatId);
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
    const messages = [{ role: "system", content: buildSystem(chatId) + pastExp + planBlock }, ...history];
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
      await sendText(chatId,
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
        await sendText(chatId, 
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
    
    if (responseText.trim()) await sendText(chatId, responseText);
    else await tg.sendMessage(chatId, "(no response)").catch(() => {});
    reflectExperience(llm, userInput, lastMessages).then(ins => saveExperience(userInput, ins, true)).catch(() => {});
    return;
  }
  await sendText(chatId, "⚠️ Max iterations. Persempit task atau pecah jadi beberapa prompt.");
  reflectExperience(llm, userInput, lastMessages).then(ins => saveExperience(userInput, ins, false)).catch(() => {});
}

async function handleCommand(chatId, text, from) {
  const cmd = text.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case "/start":
      await sendText(chatId,
        `👋 *CodeClaw Pro*\n\n` +
        `Saya coding agent canggih:\n` +
        `• Buat/edit file\n` +
        `• Git, gh CLI (GitHub)\n` +
        `• Web search + fetch\n` +
        `• Code indexer (RAG)\n` +
        `• Todo planning\n\n` +
        `*Model aktif:* \`${CONFIG.llm.modelRef}\`\n\n` +
        `*Commands:* /gold /goldplan /memory /learn /learned /clear /todo /mem /status /whoami /help\n\n` +
        `Langsung ketik permintaan untuk mulai.`);
      return true;
    case "/memory":
      try {
        const mems = fs.readFileSync(path.join(__dirname, "memory.jsonl"), "utf8").split("\n").filter(Boolean).slice(-5).reverse();
        if (mems.length === 0) {
          await tg.sendMessage(chatId, "🧠 Memori masih kosong. Ajak saya mengerjakan tugas!");
        } else {
          let text = "🧠 *5 Pelajaran Terakhir yang Saya Ingat:*\n\n";
          mems.forEach((m, i) => {
            const d = JSON.parse(m);
            text += `${i + 1}. _Task:_ ${d.task.slice(0, 40)}...\n   💡 *Insight:* ${d.insight}\n\n`;
          });
          await tg.sendMessage(chatId, text, { parse_mode: "Markdown" });
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
        await tg.sendMessage(chatId, `✅ Selesai. ${n} insight baru dipelajari. Cek /learned`);
      } catch (e) {
        await tg.sendMessage(chatId, "❌ Learning gagal: " + e.message);
      }
      return true;
    }
    case "/learned": {
      const recents = readRecentLearning(5);
      if (!recents.length) {
        await tg.sendMessage(chatId, "📚 Belum ada riset tersimpan. Coba /learn dulu.");
        return true;
      }
      let text = "📚 *5 Riset Terakhir:*\n\n";
      recents.forEach((r, i) => {
        text += `${i+1}. *${r.topic}*\n   ${r.insight}\n\n`;
      });
      await tg.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(() => {});
      return true;
    }
    case "/gold": {
      await tg.sendMessage(chatId, "🥇 Menganalisis XAU/USD (30-60 detik)...").catch(() => {});
      const { spawn } = await import("node:child_process");
      const output = await new Promise((resolve) => {
        const child = spawn("node", ["scripts/gold-analysis.mjs", "--no-telegram"], {
          cwd: "/root/codeclaw",
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
      await sendText(chatId, lines.join("\n"));
      return true;
    }
    case "/9router": {
      const { execSync } = await import("node:child_process");
      const sub = (text.split(/\s+/)[1] || "status").toLowerCase();
      if (sub === "restart") {
        await sendText(chatId, "🔄 Restart 9router...");
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
      await sendText(chatId, (ok ? "🟢" : "🔴") + " 9router\n\nHTTP: " + http + "\ntmux: " + tmux + (ok ? "" : "\n\nGunakan /9router restart"));
      return true;
    }
    case "/brain": {
      const lvl = (text.split(/\s+/)[1] || "").toLowerCase();
      const valid = ["off", "normal", "high", "genius"];
      if (!lvl) {
        await sendText(chatId, "🧠 Brain Level\n\nAktif: " + (CONFIG.agent?.brainLevel || "normal") + "\n\nPilihan: " + valid.join(" / "));
        return true;
      }
      if (!valid.includes(lvl)) {
        await sendText(chatId, "❌ Tidak valid. Pilih: " + valid.join(" / "));
        return true;
      }
      CONFIG.agent = CONFIG.agent || {};
      CONFIG.agent.brainLevel = lvl;
      try {
        const fsm = await import("node:fs");
        const raw = JSON.parse(fsm.readFileSync("/root/codeclaw/config.json", "utf8"));
        raw.agent = raw.agent || {};
        raw.agent.brainLevel = lvl;
        fsm.writeFileSync("/root/codeclaw/config.json", JSON.stringify(raw, null, 2));
        const note = lvl === "genius" ? "4 LLM call, lambat" : lvl === "high" ? "2 LLM call" : lvl === "normal" ? "1 LLM call" : "tanpa cognitive";
        await sendText(chatId, "✅ Brain → " + lvl + "\n" + note);
      } catch (e) {
        await sendText(chatId, "⚠️ Memory set " + lvl + "\n❌ Save gagal: " + e.message);
      }
      return true;
    }
    case "/doctor": {
      const os = await import("node:os");
      const fsm = await import("node:fs");
      const results = [];
      const check = (name, status, detail) => results.push({ name, status, detail: String(detail) });

      check("Node.js", "ok", process.version);

      const cfgPath = "/root/codeclaw/config.json";
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
        const memPath = "/root/codeclaw/memory.jsonl";
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
        const lsPath = "/root/codeclaw/.learning-state.json";
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
      await sendText(chatId, lines.join("\n"));
      return true;
    }
    case "/restart": {
      await sendText(chatId, "🔄 Restart dalam 2 detik...\nSupervisor akan start ulang otomatis.");
      try {
        const { spawn } = await import("node:child_process");
        spawn("bash", ["-c", "sleep 2 && cd /root/codeclaw && ./run.sh stop && sleep 1 && ./run.sh start"], {
          detached: true,
          stdio: "ignore",
          cwd: "/root/codeclaw"
        }).unref();
      } catch (e) {
        await sendText(chatId, "❌ Restart gagal: " + e.message);
        return true;
      }
      setTimeout(() => process.exit(0), 3000);
      return true;
    }
    case "/goldplan": {
      await sendText(chatId, "⏳ Mengumpulkan data XAU/USD (harga, makro, berita)...");
      try {
        const { spawn } = await import("node:child_process");
        const rawData = await new Promise((resolve) => {
          const child = spawn("node", ["scripts/gold-analysis.mjs", "--no-telegram"], { cwd: "/root/codeclaw" });
          let buf = "";
          child.stdout.on("data", d => buf += d.toString());
          child.stderr.on("data", d => buf += d.toString());
          child.on("close", () => resolve(buf));
          setTimeout(() => { child.kill(); resolve(buf + "\n[timeout]"); }, 60000);
        });

        await sendText(chatId, "🧠 Menyusun analisis dengan standar Senior Analyst...");
        
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
        await sendText(chatId, "❌ Gagal: " + e.message);
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
      await sendText(chatId, t.map(x => `[${x.id}] ${x.status} — ${x.task}`).join("\n"));
      return true;
    }
    case "/mem": {
      const m = session.memList(chatId);
      if (!m.length) { await tg.sendMessage(chatId, "(empty)"); return true; }
      await sendText(chatId, m.map(x => `${x.key} = ${x.value}`).join("\n"));
      return true;
    }
    case "/status": {
      const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      await sendText(chatId,
        `*Status*\nModel: \`${CONFIG.llm.modelRef}\`\n` +
        `History: ${session.count(chatId)} msgs\n` +
        `Todos: ${session.todoList(chatId).length}\n` +
        `RAM: ${mem} MB\nUptime: ${Math.floor(process.uptime())}s\n` +
        `PID: \`${process.pid}\``);
      return true;
    }
    case "/whoami":
      await sendText(chatId,
        `User ID: \`${from.id}\`\nChat ID: \`${chatId}\`\n\n` +
        `Lock bot: tambahkan \`${from.id}\` ke allowlist:\n` +
        `\`node cli.js channel telegram allow ${from.id}\``);
      return true;
    case "/help":
      await sendText(chatId,
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
  const messages = [ { role: "system", content: buildSystem(chatId) }, { role: "user", content: userContent } ];
  let responseText = "";
  const typing = setInterval(() => tg.sendChatAction(chatId).catch(() => {}), 4500);
  tg.sendChatAction(chatId).catch(() => {});
  try {
    const res = await llm.chat({ messages, tools: TOOL_DEFINITIONS, onStream: c => responseText += c });
    session.add(chatId, { role: "user", content: text || "[Gambar]" });
    session.add(chatId, res.message);
    if (responseText.trim()) await sendText(chatId, responseText);
    else await tg.sendMessage(chatId, "(no response)").catch(() => {});
  } catch (e) { await sendText(chatId, `❌ Gagal memproses gambar: ${e.message}`); }
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
            else await sendText(chatId, `📎 Saved: \`${file.path}\``);
            continue;
          }
          if (!text) continue;
          if (text.startsWith("/") && await handleCommand(chatId, text, from)) continue;
          await processMessage(chatId, text, from);
        } catch (e) {
          log(`err: ${e.message}`);
          await sendText(chatId, `❌ ${escapeHtml(e.message)}`).catch(() => {});
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

