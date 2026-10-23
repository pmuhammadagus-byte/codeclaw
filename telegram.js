import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "./lib/llm.js";
import { Session } from "./lib/session.js";
import { TOOL_DEFINITIONS, executeTool } from "./lib/tools.js";
import { TelegramAPI } from "./lib/telegram-api.js";
import { todoSection } from "./lib/planner.js";
import { memorySection } from "./lib/memory.js";
import { loadConfig, migrateIfNeeded } from "./lib/config.js";
import { getBrainPrompt } from "./lib/brain.js";

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
  return BASE_SYSTEM + getBrainPrompt(brainLevel) + todoSection(session, chatId) + memorySection(session, chatId);
}

async function processMessage(chatId, userInput, from) {
  session.add(chatId, { role: "user", content: userInput });

  const toolActivity = [];
  let statusMsgId = null;
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

  for (let iter = 0; iter < CONFIG.agent.maxToolIterations; iter++) {
    const history = session.history(chatId, CONFIG.agent.contextWindow);
    const messages = [{ role: "system", content: buildSystem(chatId) }, ...history];

    let responseText = "";
    const typing = setInterval(() => tg.sendChatAction(chatId).catch(() => {}), 4500);
    tg.sendChatAction(chatId).catch(() => {});

    let result;
    try {
      result = await llm.chat({ messages, tools: TOOL_DEFINITIONS, onStream: (c) => { responseText += c; } });
    } finally { clearInterval(typing); }

    const { message, finishReason } = result;
    session.add(chatId, message);

    if (finishReason === "tool_calls" || message.tool_calls?.length) {
      const currentIter = iter + 1;
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

    if (responseText.trim()) await sendText(chatId, responseText);
    else await tg.sendMessage(chatId, "(no response)").catch(() => {});
    return;
  }
  await sendText(chatId, "⚠️ Max iterations. Persempit task atau pecah jadi beberapa prompt.");
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
        `*Commands:* /clear /todo /mem /status /whoami /help\n\n` +
        `Langsung ketik permintaan untuk mulai.`);
      return true;
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
        `*Commands:*\n/start /clear /todo /mem /status /whoami /help\n\n` +
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

async function main() {
  log("Starting CodeClaw Pro Telegram...");
  log(`Model: ${CONFIG.llm.modelRef}`);
  const me = await tg.getMe();
  log(`Bot: @${me.username} | Brain: ${CONFIG.agent.brainLevel || "normal"} | PID ${process.pid}`);
  log(ALLOWED.size ? `Allowlist: ${[...ALLOWED].join(",")}` : "⚠️  Allowlist kosong — semua user bisa pakai");

  let offset = 0, errors = 0;
  while (true) {
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
          await sendText(chatId, `❌ ${e.message}`).catch(() => {});
        }
      }
    } catch (e) {
      errors++;
      log(`poll err #${errors}: ${e.message}`);
      await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** errors)));
    }
  }
}

process.on("SIGINT", () => { session.close(); process.exit(0); });
process.on("SIGTERM", () => { session.close(); process.exit(0); });
main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
