#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, listModels, setActiveModel, migrateIfNeeded } from "./lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
  red: "\x1b[31m", magenta: "\x1b[35m", blue: "\x1b[34m"
};

let rl;
const ask = (p) => new Promise(r => rl.question(p, r));
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

// Satu sumber lebar untuk semua elemen
const W = () => Math.min(50, (process.stdout.columns || 80) - 4);

// LOGO: hanya dicetak di main menu (printHeader)
const LOGO = [
  " ██████╗ ██████╗ ██████╗ ███████╗",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  "██║     ██║   ██║██║  ██║█████╗  ",
  "██║     ██║   ██║██║  ██║██╔══╝  ",
  "╚██████╗╚██████╔╝██████╔╝███████╗",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
  "",
  " ██████╗██╗      █████╗ ██╗    ██╗",
  "██╔════╝██║     ██╔══██╗██║    ██║",
  "██║     ██║     ███████║██║ █╗ ██║",
  "██║     ██║     ██╔══██║██║███╗██║",
  "╚██████╗███████╗██║  ██║╚███╔███╔╝",
  " ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝",
  "",
  "  Senior Software Engineer & AI Agent"
].join("\n");

// ==== UI primitives ====

function hr() {
  console.log(C.dim + "─".repeat(W()) + C.reset);
}

function section(title) {
  console.log(`\n  ${C.bold}${C.cyan}${title}${C.reset}`);
  hr();
}

function kv(key, value, color = "") {
  const c = color || "";
  console.log(`  ${C.dim}${key.padEnd(12)}${C.reset} ${c}${value}${C.reset}`);
}

function item(n, label, color = "") {
  const c = color || "";
  console.log(`  ${C.cyan}[${n}]${C.reset} ${c}${label}${C.reset}`);
}

function backBar() {
  console.log(`\n  ${C.dim}[b] Back    [q] Quit${C.reset}\n`);
}

function ok(msg)  { console.log(`\n  ${C.green}✅ ${msg}${C.reset}`); }
function err(msg) { console.log(`\n  ${C.red}❌ ${msg}${C.reset}`); }

function printHeader() {
  clear();
  console.log(LOGO);
  console.log();
}

// ==== Data helpers ====

function load() {
  const c = loadConfig(CONFIG_PATH);
  migrateIfNeeded(c, CONFIG_PATH);
  return loadConfig(CONFIG_PATH);
}

function maskToken(t) { return t ? "***" + t.slice(-8) : "(not set)"; }
function pause() { return ask("  Press Enter..."); }

// ==== MAIN MENU ====

async function mainMenu() {
  while (true) {
    const cfg = load();
    const t = cfg.telegram;
    const exaKey = cfg.raw.web?.exaApiKey || "";

    printHeader();
    section("Configuration");
    kv("Model", cfg.llm.modelRef, C.green);
    kv("Telegram", t.enabled ? "ENABLED" : "DISABLED", t.enabled ? C.green : C.dim);
    kv("Web Search", exaKey ? "Exa AI" : "DuckDuckGo (Free)");

    section("Settings");
    item(1, "Model settings");
    item(2, "Telegram channel");
    item(3, "Agent settings");
    item(4, "Config tools");
    item(5, "Web Search (Exa)");
    item(6, "Audio & Voice (Groq)");
    item(7, "Market Data (Twelve Data)");

    section("Actions");
    item(8, "Start agent (CLI)", C.green);
    item(9, "Start Telegram bot", C.green);

    console.log(`\n  ${C.dim}[q] Quit${C.reset}\n`);

    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "q" || ch === "quit" || ch === "exit") return;
    if (ch === "1") await modelMenu();
    else if (ch === "2") await telegramMenu();
    else if (ch === "3") await agentMenu();
    else if (ch === "4") await configMenu();
    else if (ch === "5") await webMenu();
    else if (ch === "6") await audioMenu();
    else if (ch === "7") await twelvedataMenu();
    else if (ch === "8") return startAgent();
    else if (ch === "9") return startTelegram();
  }
}

// ==== WEB MENU ====

async function webMenu() {
  while (true) {
    const cfg = load();
    const exaKey = cfg.raw.web?.exaApiKey || "";

    clear();
    section("Web Search Settings");
    kv("Provider", exaKey ? "Exa AI (Premium)" : "DuckDuckGo (Free Scrape)");
    kv("Exa Key", exaKey ? maskToken(exaKey) : "(not set)", exaKey ? "" : C.dim);

    section("Options");
    item(1, "Set Exa API Key (exa.ai)");
    item(2, "Remove Exa API Key");
    backBar();

    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") {
      console.log(`\n  ${C.dim}Buka https://dashboard.exa.ai/api-keys untuk membuat key.${C.reset}`);
      const key = (await ask("  Exa API Key: ")).trim();
      if (key) {
        const raw = load();
        raw.raw.web = raw.raw.web || {};
        raw.raw.web.exaApiKey = key;
        saveConfig(raw, CONFIG_PATH);
        ok("Exa API Key disimpan");
      }
      await pause();
    } else if (ch === "2") {
      const raw = load();
      if (raw.raw.web) delete raw.raw.web.exaApiKey;
      saveConfig(raw, CONFIG_PATH);
      ok("Exa dihapus, fallback ke DuckDuckGo");
      await pause();
    }
  }
}

// ==== MODEL MENU ====

async function modelMenu() {
  while (true) {
    const cfg = load();
    const models = listModels(cfg);

    clear();
    section("Model Settings");
    kv("Active", cfg.llm.modelRef, C.green);
    kv("Available", String(models.length));

    console.log();
    for (const m of models) {
      const mark = m.active ? `${C.green}▶${C.reset}` : " ";
      const ref = m.active ? `${C.green}${m.ref}${C.reset}` : m.ref;
      console.log(`    ${mark} ${ref}`);
    }

    section("Options");
    item(1, "Set active model");
    item(2, "Add provider");
    item(3, "Add model to provider");
    backBar();

    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") {
      console.log(`\n  ${C.bold}Pilih model:${C.reset}`);
      models.forEach((m, i) =>
        console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${m.ref}${m.active ? ` ${C.green}(active)${C.reset}` : ""}`)
      );
      const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < models.length) {
        try {
          setActiveModel(cfg, models[idx].ref, CONFIG_PATH);
          ok(`Active: ${models[idx].ref}`);
        } catch (e) {
          err(e.message);
        }
      }
      await pause();
    } else if (ch === "2") {
      const id = (await ask("\n  Provider ID: ")).trim();
      const baseUrl = (await ask("  Base URL: ")).trim();
      const apiKey = (await ask("  API Key: ")).trim();
      if (id && baseUrl && apiKey) {
        const raw = load();
        raw.raw.models = raw.raw.models || { providers: {} };
        raw.raw.models.providers[id] = { baseUrl, apiKey, api: "openai-completions", models: [] };
        saveConfig(raw, CONFIG_PATH);
        ok(`Provider "${id}" ditambahkan`);
      }
      await pause();
    } else if (ch === "3") {
      const pid = (await ask("\n  Provider ID: ")).trim();
      const modelId = (await ask("  Model ID: ")).trim();
      if (pid && modelId) {
        const raw = load();
        const p = raw.raw.models?.providers?.[pid];
        if (p) {
          p.models = p.models || [];
          if (!p.models.find(m => m.id === modelId)) p.models.push({ id: modelId, name: modelId });
          saveConfig(raw, CONFIG_PATH);
          ok(`${pid}/${modelId} ditambahkan`);
        } else {
          err("Provider tidak ada");
        }
      }
      await pause();
    }
  }
}

// ==== TELEGRAM MENU ====

async function telegramMenu() {
  while (true) {
    const cfg = load();
    const t = cfg.telegram;

    clear();
    section("Telegram Channel");
    kv("Status", t.enabled ? "ENABLED" : "DISABLED", t.enabled ? C.green : C.dim);
    kv("Token", maskToken(t.botToken));
    kv("Allowed", t.allowedUserIds.length ? t.allowedUserIds.join(", ") : "(semua user)", t.allowedUserIds.length ? "" : C.dim);
    kv("Chat ID", t.chatId || "(belum diset)", t.chatId ? "" : C.dim);

    section("Options");
    item(1, `${t.enabled ? "Disable" : "Enable"} telegram channel`);
    item(2, "Set bot token");
    item(3, "Allow user (add to allowlist)");
    item(4, "Set chat ID (tujuan notifikasi)");
    backBar();

    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") {
      const raw = load();
      raw.raw.channels = raw.raw.channels || {};
      raw.raw.channels.telegram = raw.raw.channels.telegram || { accounts: { default: {} } };
      raw.raw.channels.telegram.enabled = !raw.raw.channels.telegram.enabled;
      saveConfig(raw, CONFIG_PATH);
      await pause();
    } else if (ch === "2") {
      const token = (await ask("\n  Bot Token: ")).trim();
      if (token) {
        const raw = load();
        raw.raw.channels = raw.raw.channels || {};
        raw.raw.channels.telegram = raw.raw.channels.telegram || { accounts: { default: {} } };
        raw.raw.channels.telegram.accounts = raw.raw.channels.telegram.accounts || { default: {} };
        raw.raw.channels.telegram.accounts.default.botToken = token;
        saveConfig(raw, CONFIG_PATH);
        ok("Token disimpan");
      }
      await pause();
    } else if (ch === "3") {
      const id = (await ask("\n  User ID (angka): ")).trim();
      if (id) {
        const raw = load();
        raw.raw.channels.telegram.accounts.default.allowedUserIds =
          raw.raw.channels.telegram.accounts.default.allowedUserIds || [];
        if (!raw.raw.channels.telegram.accounts.default.allowedUserIds.includes(Number(id))) {
          raw.raw.channels.telegram.accounts.default.allowedUserIds.push(Number(id));
        }
        saveConfig(raw, CONFIG_PATH);
        ok(`User ${id} diizinkan`);
      }
      await pause();
    } else if (ch === "4") {
      const id = (await ask("\n  Chat ID (angka, kosongkan untuk hapus): ")).trim();
      const raw = load();
      raw.raw.channels = raw.raw.channels || {};
      raw.raw.channels.telegram = raw.raw.channels.telegram || { accounts: { default: {} } };
      raw.raw.channels.telegram.accounts = raw.raw.channels.telegram.accounts || { default: {} };
      raw.raw.channels.telegram.accounts.default.chatId = id;
      saveConfig(raw, CONFIG_PATH);
      ok(`Chat ID ${id ? "disimpan: " + id : "dihapus"}`);
      await pause();
    }
  }
}

// ==== AGENT ====

async function agentMenu() {
  const cfg = load();
  clear();
  section("Agent Settings");
  kv("Max iter", String(cfg.agent.maxToolIterations));
  kv("Approval", cfg.agent.approvalMode);
  kv("Brain", cfg.agent.brainLevel || "normal");
  console.log();
  await pause();
}

// ==== CONFIG ====

async function configMenu() {
  clear();
  section("Config Tools");
  kv("Path", CONFIG_PATH);
  console.log();
  await pause();
}

// ==== AUDIO ====

async function audioMenu() {
  while (true) {
    const cfg = load();
    const groqKey = cfg.raw.audio?.groqApiKey || "";

    clear();
    section("Audio & Voice Settings");
    kv("Engine", groqKey ? "Groq Whisper (Fast)" : "Disabled");
    kv("Groq Key", groqKey ? maskToken(groqKey) : "(not set)", groqKey ? "" : C.dim);

    section("Options");
    item(1, "Set Groq API Key (console.groq.com)");
    item(2, "Remove Groq API Key");
    backBar();

    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") {
      console.log(`\n  ${C.dim}Buka https://console.groq.com/keys (gratis)${C.reset}`);
      const key = (await ask("  Groq API Key: ")).trim();
      if (key) {
        const raw = load();
        raw.raw.audio = raw.raw.audio || {};
        raw.raw.audio.groqApiKey = key;
        saveConfig(raw, CONFIG_PATH);
        ok("Groq API Key disimpan");
      }
      await pause();
    } else if (ch === "2") {
      const raw = load();
      if (raw.raw.audio) delete raw.raw.audio.groqApiKey;
      saveConfig(raw, CONFIG_PATH);
      ok("Groq Key dihapus");
      await pause();
    }
  }
}

// ==== TWELVEDATA ====

async function twelvedataMenu() {
  while (true) {
    const cfg = load();
    const tdKey = cfg.raw.twelvedata?.apiKey || "";

    clear();
    section("Market Data Settings");
    kv("Provider", "Twelve Data");
    kv("API Key", tdKey ? maskToken(tdKey) : "(not set)", tdKey ? "" : C.dim);

    section("Options");
    item(1, "Set Twelve Data API Key");
    item(2, "Remove API Key");
    backBar();

    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") {
      console.log(`\n  ${C.dim}Buka https://twelvedata.com/account/api-keys${C.reset}`);
      const key = (await ask("  Twelve Data API Key: ")).trim();
      if (key) {
        const raw = load();
        raw.raw.twelvedata = raw.raw.twelvedata || {};
        raw.raw.twelvedata.apiKey = key;
        saveConfig(raw, CONFIG_PATH);
        ok("Twelve Data API Key disimpan");
      }
      await pause();
    } else if (ch === "2") {
      const raw = load();
      if (raw.raw.twelvedata) delete raw.raw.twelvedata.apiKey;
      saveConfig(raw, CONFIG_PATH);
      ok("API Key dihapus");
      await pause();
    }
  }
}

// ==== START ACTIONS ====

async function startAgent() {
  clear();
  console.log(C.dim + "Starting agent... (Ctrl+C untuk keluar)\n" + C.reset);
  rl.close();
  await import("./index.js");
}

async function startTelegram() {
  clear();
  console.log(C.dim + "Starting Telegram bot... (Ctrl+C untuk keluar)\n" + C.reset);
  rl.close();
  await import("./telegram.js");
}

// ==== ENTRY ====

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`${C.red}❌ config.json tidak ada.${C.reset}`);
    process.exit(1);
  }
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => { console.log("\n"); rl.close(); process.exit(0); });
  try { await mainMenu(); } finally { if (rl) rl.close(); }
}

main().catch((e) => { console.error(`\n${C.red}Error: ${e.message}${C.reset}`); process.exit(1); });
