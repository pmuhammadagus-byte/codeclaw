#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, listModels, setActiveModel, migrateIfNeeded } from "./lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m" };
let rl;
const ask = (p) => new Promise(r => rl.question(p, r));
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

function box(title) {
  clear();
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
    console.log(`  ${C.bold}Gateway${C.reset}`);
    console.log(`    Mode:       ${cfg.raw.gateway?.mode || "local"}`);
    console.log(`    Port:       ${cfg.raw.gateway?.httpPort || 3000}`);
    console.log();
    const models = listModels(cfg);
    console.log(`  ${C.bold}Model${C.reset}`);
    console.log(`    Active:     ${C.green}${cfg.llm.modelRef}${C.reset}`);
    console.log(`    Available:  ${models.length} model(s) dari ${Object.keys(cfg.providers).length} provider`);
    console.log();
    const t = cfg.telegram;
    console.log(`  ${C.bold}Telegram${C.reset}`);
    console.log(`    Status:     ${t.enabled ? C.green + "ENABLED" + C.reset : C.dim + "DISABLED" + C.reset}`);
    console.log(`    Token:      ${maskToken(t.botToken)}`);
    console.log(`    Allowed:    ${t.allowedUserIds.length} user(s)`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Model settings`);
    console.log(`  ${C.cyan}[2]${C.reset} Telegram channel`);
    console.log(`  ${C.cyan}[3]${C.reset} Agent settings (${cfg.agent.brainLevel || "normal"} brain)`);
    console.log(`  ${C.cyan}[4]${C.reset} Config tools`);
    console.log(`  ${C.cyan}[5]${C.reset} ${C.green}Start agent (CLI)${C.reset}`);
    console.log(`  ${C.cyan}[6]${C.reset} ${C.green}Start Telegram bot${C.reset}`);
    console.log();
    console.log(`  ${C.dim}[q] Quit${C.reset}`);
    console.log();
    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "q" || ch === "quit" || ch === "exit") return;
    if (ch === "1") await modelMenu();
    else if (ch === "2") await telegramMenu();
    else if (ch === "3") await agentMenu();
    else if (ch === "4") await configMenu();
    else if (ch === "5") return startAgent();
    else if (ch === "6") return startTelegram();
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
    if (!models.length) console.log(`    ${C.dim}(belum ada)${C.reset}`);
    for (const m of models) {
      const mark = m.active ? `${C.green}▶${C.reset}` : " ";
      console.log(`    ${mark} ${m.ref}${m.name !== m.modelId ? `  ${C.dim}(${m.name})${C.reset}` : ""}`);
    }
    console.log();
    console.log(`  ${C.bold}Providers:${C.reset}`);
    for (const [pid, p] of Object.entries(cfg.providers)) {
      console.log(`    ${pid}  ${C.dim}${p.baseUrl}${C.reset}  ${C.dim}(${(p.models || []).length} model)${C.reset}`);
    }
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Set active model`);
    console.log(`  ${C.cyan}[2]${C.reset} Add provider`);
    console.log(`  ${C.cyan}[3]${C.reset} Add model to provider`);
    console.log(`  ${C.cyan}[4]${C.reset} Remove model`);
    console.log(`  ${C.cyan}[5]${C.reset} Remove provider`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") await setActiveFlow();
    else if (ch === "2") await addProviderFlow();
    else if (ch === "3") await addModelFlow();
    else if (ch === "4") await removeModelFlow();
    else if (ch === "5") await removeProviderFlow();
  }
}

async function setActiveFlow() {
  const cfg = load();
  const models = listModels(cfg);
  if (!models.length) { console.log(`\n  ${C.red}Belum ada model.${C.reset}\n`); return pause(); }
  console.log(`\n  ${C.bold}Pilih model:${C.reset}`);
  models.forEach((m, i) => console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${m.ref}${m.active ? ` ${C.green}(active)${C.reset}` : ""}`));
  const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) return;
  try { setActiveModel(cfg, models[idx].ref, CONFIG_PATH); console.log(`\n  ${C.green}✅ Active: ${models[idx].ref}${C.reset}`); }
  catch (e) { console.log(`\n  ${C.red}❌ ${e.message}${C.reset}`); }
  return pause();
}

async function addProviderFlow() {
  console.log();
  const id = (await ask("  Provider ID (mis. groq): ")).trim();
  if (!id) return;
  const baseUrl = (await ask("  Base URL: ")).trim();
  if (!baseUrl) return;
  const apiKey = (await ask("  API Key: ")).trim();
  if (!apiKey) return;
  const cfg = load();
  cfg.raw.models = cfg.raw.models || { providers: {} };
  cfg.raw.models.providers = cfg.raw.models.providers || {};
  cfg.raw.models.providers[id] = { baseUrl, apiKey, api: "openai-completions", models: [] };
  saveConfig(cfg, CONFIG_PATH);
  console.log(`\n  ${C.green}✅ Provider "${id}" ditambahkan${C.reset}`);
  return pause();
}

async function addModelFlow() {
  const cfg = load();
  const providers = Object.keys(cfg.providers);
  if (!providers.length) { console.log(`\n  ${C.red}Belum ada provider.${C.reset}\n`); return pause(); }
  console.log(`\n  ${C.bold}Pilih provider:${C.reset}`);
  providers.forEach((p, i) => console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${p}`));
  const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= providers.length) return;
  const pid = providers[idx];
  const modelId = (await ask(`  Model ID: `)).trim();
  if (!modelId) return;
  const name = (await ask(`  Display name (Enter = sama): `)).trim() || modelId;
  const raw = load();
  const p = raw.raw.models.providers[pid];
  p.models = p.models || [];
  if (p.models.find(m => m.id === modelId)) { console.log(`\n  ${C.yellow}⚠️  Sudah ada${C.reset}`); return pause(); }
  p.models.push({ id: modelId, name });
  saveConfig(raw, CONFIG_PATH);
  console.log(`\n  ${C.green}✅ ${pid}/${modelId} ditambahkan${C.reset}`);
  return pause();
}

async function removeModelFlow() {
  const cfg = load();
  const models = listModels(cfg);
  if (!models.length) return;
  console.log(`\n  ${C.bold}Pilih model yang dihapus:${C.reset}`);
  models.forEach((m, i) => console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${m.ref}`));
  const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) return;
  const target = models[idx];
  if (target.active) { console.log(`\n  ${C.red}❌ Tidak bisa hapus model aktif${C.reset}`); return pause(); }
  const raw = load();
  const p = raw.raw.models.providers[target.providerId];
  if (p) { p.models = (p.models || []).filter(m => m.id !== target.modelId); saveConfig(raw, CONFIG_PATH); console.log(`\n  ${C.green}✅ ${target.ref} dihapus${C.reset}`); }
  return pause();
}

async function removeProviderFlow() {
  const cfg = load();
  const providers = Object.keys(cfg.providers);
  if (!providers.length) return;
  console.log(`\n  ${C.bold}Pilih provider:${C.reset}`);
  providers.forEach((p, i) => console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${p}`));
  const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= providers.length) return;
  const pid = providers[idx];
  if (cfg.llm.providerId === pid) { console.log(`\n  ${C.red}❌ Provider sedang dipakai model aktif${C.reset}`); return pause(); }
  if ((await ask(`\n  Hapus "${pid}"? (y/N): `)).trim().toLowerCase() !== "y") return;
  const raw = load();
  delete raw.raw.models.providers[pid];
  saveConfig(raw, CONFIG_PATH);
  console.log(`\n  ${C.green}✅ "${pid}" dihapus${C.reset}`);
  return pause();
}

// ============= TELEGRAM =============
async function telegramMenu() {
  while (true) {
    const cfg = load();
    const t = cfg.telegram;
    box("Telegram Channel");
    console.log(`  Status:    ${t.enabled ? C.green + "ENABLED" + C.reset : C.dim + "DISABLED" + C.reset}`);
    console.log(`  Account:   ${t.accountId}`);
    console.log(`  Token:     ${maskToken(t.botToken)}`);
    console.log(`  Allowed:   ${t.allowedUserIds.length ? t.allowedUserIds.join(", ") : C.dim + "(kosong = semua user)" + C.reset}`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} ${t.enabled ? "Disable" : "Enable"} telegram channel`);
    console.log(`  ${C.cyan}[2]${C.reset} Set bot token`);
    console.log(`  ${C.cyan}[3]${C.reset} Allow user (add to allowlist)`);
    console.log(`  ${C.cyan}[4]${C.reset} Disallow user`);
    console.log(`  ${C.cyan}[5]${C.reset} Clear allowlist (allow all)`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") { const raw = load(); ensureCh(raw.raw); raw.raw.channels.telegram.enabled = !raw.raw.channels.telegram.enabled; saveConfig(raw, CONFIG_PATH); console.log(`\n  ${raw.raw.channels.telegram.enabled ? C.green + "✅ Enabled" : C.yellow + "⏸  Disabled"}${C.reset}`); await pause(); }
    else if (ch === "2") { console.log(`\n  ${C.dim}Dari @BotFather, format: 1234567890:ABC...${C.reset}`); const token = (await ask("  Token: ")).trim(); if (token) { const raw = load(); ensureCh(raw.raw); raw.raw.channels.telegram.accounts.default.botToken = token; saveConfig(raw, CONFIG_PATH); console.log(`\n  ${C.green}✅ Token updated${C.reset}`); } await pause(); }
    else if (ch === "3") { const inp = (await ask("\n  User ID (angka): ")).trim(); const num = Number(inp); if (Number.isInteger(num) && num > 0) { const raw = load(); ensureCh(raw.raw); const l = raw.raw.channels.telegram.accounts.default.allowedUserIds; if (!l.includes(num)) l.push(num); saveConfig(raw, CONFIG_PATH); console.log(`\n  ${C.green}✅ ${num} allowed${C.reset}`); } else console.log(`\n  ${C.red}❌ User ID harus angka${C.reset}`); await pause(); }
    else if (ch === "4") { const list = t.allowedUserIds; if (!list.length) { console.log(`\n  ${C.dim}Allowlist kosong.${C.reset}`); await pause(); continue; } console.log(`\n  ${C.bold}Allowlist:${C.reset}`); list.forEach((id, i) => console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${id}`)); const idx = parseInt((await ask("\n  ❯ ")).trim()) - 1; if (!isNaN(idx) && idx >= 0 && idx < list.length) { const raw = load(); raw.raw.channels.telegram.accounts.default.allowedUserIds = list.filter(x => x !== list[idx]); saveConfig(raw, CONFIG_PATH); console.log(`\n  ${C.green}✅ Removed${C.reset}`); } await pause(); }
    else if (ch === "5") { if ((await ask(`\n  Clear allowlist? (y/N): `)).trim().toLowerCase() === "y") { const raw = load(); ensureCh(raw.raw); raw.raw.channels.telegram.accounts.default.allowedUserIds = []; saveConfig(raw, CONFIG_PATH); console.log(`\n  ${C.green}✅ Cleared${C.reset}`); } await pause(); }
  }
}

function ensureCh(raw) {
  raw.channels = raw.channels || {};
  raw.channels.telegram = raw.channels.telegram || { enabled: false, accounts: {} };
  raw.channels.telegram.accounts = raw.channels.telegram.accounts || { default: {} };
  raw.channels.telegram.accounts.default = raw.channels.telegram.accounts.default || { botToken: "", allowedUserIds: [] };
  raw.channels.telegram.accounts.default.allowedUserIds = raw.channels.telegram.accounts.default.allowedUserIds || [];
}

// ============= AGENT =============
async function agentMenu() {
  while (true) {
    const cfg = load();
    const a = cfg.agent;
    box("Agent Settings");
    console.log(`  Max iterations:  ${a.maxToolIterations}`);
    console.log(`  Context window:  ${a.contextWindow} msgs`);
    console.log(`  Approval mode:   ${a.approvalMode}`);
    console.log(`  Subagent depth:  ${a.maxSubagentDepth}`);
    console.log(`  Subagent iters:  ${a.maxSubagentIterations}`);
    console.log();
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Max tool iterations     (${a.maxToolIterations})`);
    console.log(`  ${C.cyan}[2]${C.reset} Context window          (${a.contextWindow} msgs)`);
    console.log(`  ${C.cyan}[3]${C.reset} Approval mode           (${a.approvalMode})`);
    console.log(`  ${C.cyan}[4]${C.reset} Subagent depth          (${a.maxSubagentDepth})`);
    console.log(`  ${C.cyan}[5]${C.reset} Subagent iterations     (${a.maxSubagentIterations})`);
  console.log(`  ${C.cyan}[6]${C.reset} Brain level             (${a.brainLevel || "normal"})`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    const fields = {
      "1": ["maxToolIterations", "Max tool iterations", "number"],
      "2": ["contextWindow", "Context window", "number"],
      "3": ["approvalMode", "Mode (dangerous-only/all/none)", "enum"],
      "4": ["maxSubagentDepth", "Subagent depth", "number"],
      "5": ["maxSubagentIterations", "Subagent iterations", "number"],
      "6": ["brainLevel", "Brain level (off/normal/high/genius)", "enum-brain"],
    };
    const f = fields[ch]; if (!f) continue;
    const [key, label, type] = f;
    const inp = (await ask(`\n  ${label}: `)).trim();
    if (!inp) continue;
    const raw = load();
    raw.raw.agent = raw.raw.agent || {};
    if (type === "number") {
      const n = parseInt(inp);
      if (isNaN(n) || n <= 0) { console.log(`\n  ${C.red}❌ Angka positif${C.reset}`); await pause(); continue; }
      raw.raw.agent[key] = n;
    } else if (type === "enum-brain") {
      if (!["off", "normal", "high", "genius"].includes(inp)) { console.log(`\n  ${C.red}❌ Pilihan: off, normal, high, genius${C.reset}`); await pause(); continue; }
      raw.raw.agent[key] = inp;
    } else {
      if (!["dangerous-only", "all", "none"].includes(inp)) { console.log(`\n  ${C.red}❌ Pilihan: dangerous-only, all, none${C.reset}`); await pause(); continue; }
      raw.raw.agent[key] = inp;
    }
    saveConfig(raw, CONFIG_PATH);
    console.log(`\n  ${C.green}✅ Updated${C.reset}`);
    await pause();
  }
}

// ============= CONFIG =============
async function configMenu() {
  while (true) {
    box("Config Tools");
    console.log(`  Path:  ${CONFIG_PATH}\n`);
    divider();
    console.log(`  ${C.cyan}[1]${C.reset} Show config (API keys masked)`);
    console.log(`  ${C.cyan}[2]${C.reset} Show config path`);
    console.log(`  ${C.cyan}[3]${C.reset} Migrate old format → new`);
    console.log(`  ${C.cyan}[4]${C.reset} Backup config`);
    console.log();
    console.log(`  ${C.dim}[b] Back${C.reset}    ${C.dim}[q] Quit${C.reset}`);
    console.log();
    const ch = (await ask("  ❯ ")).trim().toLowerCase();
    if (ch === "b") return;
    if (ch === "q") process.exit(0);
    if (ch === "1") { clear(); const cfg = load(); console.log(JSON.stringify(cfg.raw, null, 2).replace(/(sk-|gsk_|AIza|bns_)([A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1$2***")); console.log(); await pause(); }
    else if (ch === "2") { console.log(`\n  ${CONFIG_PATH}\n`); await pause(); }
    else if (ch === "3") { const c = load(); const changed = migrateIfNeeded(c, CONFIG_PATH); console.log(`\n  ${changed ? C.green + "✅ Migrated" : C.dim + "Already new"}${C.reset}`); await pause(); }
    else if (ch === "4") { const ts = new Date().toISOString().replace(/[:.]/g, "-"); const dest = `${CONFIG_PATH}.bak.${ts}`; fs.copyFileSync(CONFIG_PATH, dest); console.log(`\n  ${C.green}✅ ${dest}${C.reset}`); await pause(); }
  }
}

// ============= START =============
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
    console.error(`   cp config.example.json config.json`);
    process.exit(1);
  }
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => { console.log("\n"); rl.close(); process.exit(0); });
  try { await mainMenu(); } finally { if (rl) rl.close(); }
}

main().catch((e) => { console.error(`\n${C.red}Error: ${e.message}${C.reset}`); process.exit(1); });
