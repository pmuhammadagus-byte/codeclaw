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
  return BASE_SYSTEM + todoSection(session, chatId) + memorySection(session, chatId);
}

async function processMessage(chatId, userInput, from) {
  session.add(chatId, { role: "user", content: userInput });

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
      const toolNames = (message.tool_calls ?? []).map(tc => tc.function.name).join(", ");
      tg.sendMessage(chatId, `⚙️ ${toolNames}`).catch(() => {});

      for (const tc of message.tool_calls ?? []) {
        let args; try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
        log(`tool ${tc.function.name} from ${from.id}`);
        const toolResult = await executeTool(tc.function.name, args, {
          session, chatId, config: CONFIG,
          approvalCallback: async () => true,
          approvalMode: "none",
        });
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
  log(`Bot: @${me.username} | PID ${process.pid}`);
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
