#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, listModels, setActiveModel, migrateIfNeeded } from "./lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m", blue: "\x1b[34m" };
let rl;
const ask = (p) => new Promise(r => rl.question(p, r));
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

const LOGO = `
${C.cyan}${C.bold}
    ██████╗ ██████╗ ███████╗██╗     ██████╗  █████╗  ██████╗██╗  ███████╗██╗   ██╗
    ██╔══██╗██╔══██╗██╔════╝██║     ██╔══██╗██╔══██╗██╔════╝██║  ██╔════╝██║   ██║
    ██████╔╝██████╔╝█████╗  ██║     ██████╔╝███████║██║     ██║  █████╗  ███████╔╝
    ██╔══██╗██╔══██╗██╔══╝  ██║     ██╔══██╗██╔══██║██║     ██║  ██╔══╝  ╚══════╝
    ██████╔╝██████╔╝███████╗███████╗██║  ██║██║  ██║╚██████╗██║  ███████╗     ██║
    ╚═════╝ ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚══════╝     ╚═╝
${C.reset}
${C.dim}    Senior Software Engineer & AI Agent${C.reset}
`;

function box(title) {
  clear();
  console.log(LOGO);
  const w = 62;
  console.log(C.cyan + C.bold + "╔" + "═".repeat(w) + "╗" + C.reset);
  console.log(C.cyan + C.bold + "║  " + title.padEnd(w - 2) + "║" + C.reset);
  console.log(C.cyan + C.bold + "╚" + "═".repeat(w) + "╝" + C.reset);
  console.log();
}

function divider() { console.log(C.dim + "─".repeat(64) + C.reset); console.log(); }
function load() { const c = loadConfig(CONFIG_PATH); migrateIfNeeded(c, CONFIG_PATH); return loadConfig(CONFIG_PATH); }
function maskToken(t) { return t ? "***" + t.slice(-8) : "(not set)"; }
function pause() { return ask("  Press Enter..."); }

// ============= MAIN =============
async function mainMenu() {
  while (true) {
    const cfg = load();
    box("CodeClaw Pro — Configuration Panel");
    
    console.log(`  ${C.bold}Model${C.reset}`);
    console.log(`    Active:     ${C.green}${cfg.llm.modelRef}${C.reset}`);
    console.log();
    const t = cfg.telegram;
    console.log(`  ${C.bold}Telegram${C.reset}`);
    console.log(`    Status:     ${t.enabled ? C.green + "ENABLED" + C.reset : C.dim + "DISABLED" + C.reset}`);
    console.log();
    const exaKey = cfg.raw.web?.exaApiKey || "";
    console.log(`  ${C.bold}Web Search${C.reset}`);
    console.log(`    Provider:   ${exaKey ? C.green + "Exa AI" + C.reset : "DuckDuckGo (Free)"}`);
    console.log();
    divider();
    
    console.log(`  ${C.cyan}[1]${C.reset} Model settings`);
    console.log(`  ${C.cyan}[2]${C.reset} Telegram channel`);
    console.log(`  ${C.cyan}[3]${C.reset} Agent settings`);
    console.log(`  ${C.cyan}[4]${C.reset} Config tools`);
    console.log(`  ${C.cyan}[5]${C.reset} Web Search (Exa)`);
    console.log(`  ${C.cyan}[6]${C.reset} Audio & Voice (Groq)`);
    console.log(`  ${C.cyan}[7]${C.reset} Market Data (Twelve Data)`);
    console.log(`  ${C.cyan}[8]${C.reset} ${C.green}Start agent (CLI)${C.reset}`);
    console.log(`  ${C.cyan}[9]${C.reset} ${C.green}Start Telegram bot${C.reset}`);
    console.log();
    console.log(`  ${C.dim}[q] Quit${C.reset}`);
    console.log();
    
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

// ============= WEB MENU =============
async function webMenu() {
  while (true) {
    const cfg = load();
    const exaKey = cfg.raw.web?.exaApiKey || "";
    box("Web Search Settings");
    console.log(`  Provider  : ${exaKey ? "Exa AI (Premium)" : "DuckDuckGo (Free Scrape)"}`);
    console.log(`  Exa Key   : ${exaKey ? "***" + exaKey.slice(-6) : C.dim + "(not set)" + C.reset}`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Set Exa API Key (exa.ai)`);
    console.log(`  ${C.cyan}[2]${C.reset} Hapus Exa API Key`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    
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
        console.log(`\n  ${C.green}✅ Exa API Key disimpan${C.reset}`);
      }
      await pause();
    } else if (ch === "2") {
      const raw = load();
      if (raw.raw.web) delete raw.raw.web.exaApiKey;
      saveConfig(raw, CONFIG_PATH);
      console.log(`\n  ${C.green}✅ Exa dihapus, fallback ke DuckDuckGo${C.reset}`);
      await pause();
    }
  }
}

// ============= MODEL =============
async function modelMenu() {
  while (true) {
    const cfg = load();
    box("Model Settings");
    console.log(`  Active: ${C.green}${cfg.llm.modelRef}${C.reset}\n`);
    const models = listModels(cfg);
    console.log(`  ${C.bold}Available models:${C.reset}`);
    for (const m of models) {
      const mark = m.active ? `${C.green}▶${C.reset}` : " ";
      console.log(`    ${mark} ${m.ref}`);
    }
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Set active model`);
    console.log(`  ${C.cyan}[2]${C.reset} Add provider`);
    console.log(`  ${C.cyan}[3]${C.reset} Add model to provider`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") {
      console.log(`\n  ${C.bold}Pilih model:${C.reset}`);
      models.forEach((m, i) => console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${m.ref}${m.active ? ` ${C.green}(active)${C.reset}` : ""}`));
      const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < models.length) {
        try { setActiveModel(cfg, models[idx].ref, CONFIG_PATH); console.log(`\n  ${C.green}✅ Active: ${models[idx].ref}${C.reset}`); }
        catch (e) { console.log(`\n  ${C.red}❌ ${e.message}${C.reset}`); }
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
        console.log(`\n  ${C.green}✅ Provider "${id}" ditambahkan${C.reset}`);
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
          console.log(`\n  ${C.green}✅ ${pid}/${modelId} ditambahkan${C.reset}`);
        } else { console.log(`\n  ${C.red}❌ Provider tidak ada${C.reset}`); }
      }
      await pause();
    }
  }
}

// ============= TELEGRAM =============
async function telegramMenu() {
  while (true) {
    const cfg = load();
    const t = cfg.telegram;
    box("Telegram Channel");
    console.log(`  Status:    ${t.enabled ? C.green + "ENABLED" + C.reset : C.dim + "DISABLED" + C.reset}`);
    console.log(`  Token:     ${maskToken(t.botToken)}`);
    console.log(`  Allowed:   ${t.allowedUserIds.length ? t.allowedUserIds.join(", ") : C.dim + "(kosong = semua user)" + C.reset}`);
    console.log(`  Chat ID:   ${t.chatId ? t.chatId : C.dim + "(kosong = notifikasi cron gagal)" + C.reset}`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} ${t.enabled ? "Disable" : "Enable"} telegram channel`);
    console.log(`  ${C.cyan}[2]${C.reset} Set bot token`);
    console.log(`  ${C.cyan}[3]${C.reset} Allow user (add to allowlist)`);
    console.log(`  ${C.cyan}[4]${C.reset} Set chat ID (tujuan notifikasi)`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
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
        console.log(`\n  ${C.green}✅ Token disimpan${C.reset}`);
      }
      await pause();
    } else if (ch === "3") {
      const id = (await ask("\n  User ID (angka): ")).trim();
      if (id) {
        const raw = load();
        raw.raw.channels.telegram.accounts.default.allowedUserIds = raw.raw.channels.telegram.accounts.default.allowedUserIds || [];
        if (!raw.raw.channels.telegram.accounts.default.allowedUserIds.includes(Number(id))) {
            raw.raw.channels.telegram.accounts.default.allowedUserIds.push(Number(id));
        }
        saveConfig(raw, CONFIG_PATH);
        console.log(`\n  ${C.green}✅ User ${id} diizinkan${C.reset}`);
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
      console.log(`\n  ${C.green}✅ Chat ID ${id ? "disimpan: " + id : "dihapus"}${C.reset}`);
      await pause();
    }
  }
}

// ============= AGENT =============
async function agentMenu() {
  const cfg = load();
  box("Agent Settings");
  console.log(`  Max iterations:  ${cfg.agent.maxToolIterations}`);
  console.log(`  Approval mode:   ${cfg.agent.approvalMode}`);
  console.log(`  Brain level:     ${cfg.agent.brainLevel || "normal"}`);
  console.log();
  await pause();
}

// ============= CONFIG =============
async function configMenu() {
  const cfg = load();
  box("Config Tools");
  console.log(`  Path:  ${CONFIG_PATH}\n`);
  await pause();
}

// ============= START =============

async function audioMenu() {
  while (true) {
    const cfg = load();
    const groqKey = cfg.raw.audio?.groqApiKey || "";
    box("Audio & Voice Settings");
    console.log(`  Engine    : ${groqKey ? "Groq Whisper (Fast)" : "Disabled"}`);
    console.log(`  Groq Key  : ${groqKey ? "***" + groqKey.slice(-6) : C.dim + "(not set)" + C.reset}`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Set Groq API Key (console.groq.com)`);
    console.log(`  ${C.cyan}[2]${C.reset} Hapus Groq API Key`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    
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
        console.log(`\n  ${C.green}✅ Groq API Key disimpan${C.reset}`);
      }
      await pause();
    } else if (ch === "2") {
      const raw = load();
      if (raw.raw.audio) delete raw.raw.audio.groqApiKey;
      saveConfig(raw, CONFIG_PATH);
      console.log(`\n  ${C.green}✅ Groq Key dihapus${C.reset}`);
      await pause();
    }
  }
}


async function twelvedataMenu() {
  while (true) {
    const cfg = load();
    const tdKey = cfg.raw.twelvedata?.apiKey || "";
    box("Market Data Settings");
    console.log(`  Provider  : Twelve Data`);
    console.log(`  API Key   : ${tdKey ? "***" + tdKey.slice(-6) : C.dim + "(not set)" + C.reset}`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Set Twelve Data API Key`);
    console.log(`  ${C.cyan}[2]${C.reset} Hapus API Key`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
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
        console.log(`\n  ${C.green}✅ Twelve Data API Key disimpan${C.reset}`);
      }
      await pause();
    } else if (ch === "2") {
      const raw = load();
      if (raw.raw.twelvedata) delete raw.raw.twelvedata.apiKey;
      saveConfig(raw, CONFIG_PATH);
      console.log(`\n  ${C.green}✅ API Key dihapus${C.reset}`);
      await pause();
    }
  }
}

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

// ============= ENTRY =============
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
