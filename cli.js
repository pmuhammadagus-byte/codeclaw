#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, listModels, setActiveModel, migrateIfNeeded, parseModelRef } from "./lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

function load() {
  const cfg = loadConfig(CONFIG_PATH);
  migrateIfNeeded(cfg, CONFIG_PATH);
  return loadConfig(CONFIG_PATH);
}

function save(cfg) { saveConfig(cfg, CONFIG_PATH); }

// === Model ===
function handleModel(args) {
  const [sub, ...rest] = args;
  const cfg = load();

  if (sub === "list" || !sub) {
    const models = listModels(cfg);
    if (!models.length) {
      console.log("Tidak ada model. Tambah provider di config.json → models.providers");
      return;
    }
    console.log(`${C.bold}Available models:${C.reset}\n`);
    for (const m of models) {
      const mark = m.active ? `${C.green}▶${C.reset}` : " ";
      console.log(`  ${mark} ${m.ref}${m.name !== m.modelId ? `  ${C.dim}(${m.name})${C.reset}` : ""}`);
    }
    console.log();
    return;
  }

  if (sub === "current") {
    console.log(`${C.bold}Active model:${C.reset} ${C.cyan}${cfg.llm.modelRef}${C.reset}`);
    console.log(`  Provider: ${cfg.llm.providerId}`);
    console.log(`  Base URL: ${cfg.llm.baseUrl}`);
    console.log(`  Model:    ${cfg.llm.model}`);
    console.log(`  MaxTok:   ${cfg.llm.maxTokens}`);
    console.log(`  Temp:     ${cfg.llm.temperature}`);
    return;
  }

  if (sub === "set") {
    const ref = rest[0];
    if (!ref) { console.error(`${C.red}Usage: codeclaw model set <provider>/<model>${C.reset}`); process.exit(1); }
    try {
      setActiveModel(cfg, ref, CONFIG_PATH);
      console.log(`${C.green}✅ Active model: ${ref}${C.reset}`);
    } catch (e) {
      console.error(`${C.red}${e.message}${C.reset}`);
      process.exit(1);
    }
    return;
  }

  if (sub === "add-provider") {
    const [id, baseUrl, apiKey] = rest;
    if (!id || !baseUrl || !apiKey) {
      console.error(`${C.red}Usage: codeclaw model add-provider <id> <baseUrl> <apiKey>${C.reset}`);
      process.exit(1);
    }
    cfg.raw.models = cfg.raw.models || { providers: {} };
    cfg.raw.models.providers = cfg.raw.models.providers || {};
    cfg.raw.models.providers[id] = {
      baseUrl,
      apiKey,
      api: "openai-completions",
      models: [],
    };
    save(cfg);
    console.log(`${C.green}✅ Provider "${id}" ditambahkan. Edit models.providers.${id}.models untuk isi model.${C.reset}`);
    return;
  }

  if (sub === "add-model") {
    const [providerId, modelId, ...nameParts] = rest;
    if (!providerId || !modelId) {
      console.error(`${C.red}Usage: codeclaw model add-model <provider> <model-id> [name]${C.reset}`);
      process.exit(1);
    }
    const p = cfg.providers[providerId];
    if (!p) {
      console.error(`${C.red}Provider "${providerId}" tidak ada.${C.reset}`);
      process.exit(1);
    }
    const name = nameParts.join(" ") || modelId;
    cfg.raw.models.providers[providerId].models = cfg.raw.models.providers[providerId].models || [];
    const existing = cfg.raw.models.providers[providerId].models.find(m => m.id === modelId);
    if (existing) { console.log(`${C.yellow}Model "${modelId}" sudah ada.${C.reset}`); return; }
    cfg.raw.models.providers[providerId].models.push({ id: modelId, name });
    save(cfg);
    console.log(`${C.green}✅ Model "${providerId}/${modelId}" ditambahkan${C.reset}`);
    return;
  }

  console.log(`Usage:
  ${C.cyan}codeclaw model list${C.reset}                        List semua model
  ${C.cyan}codeclaw model current${C.reset}                     Model aktif
  ${C.cyan}codeclaw model set <provider>/<model>${C.reset}      Set aktif
  ${C.cyan}codeclaw model add-provider <id> <url> <key>${C.reset} Tambah provider
  ${C.cyan}codeclaw model add-model <provider> <id> [name]${C.reset} Tambah model ke provider`);
}

// === Brain ===
function handleBrain(args) {
  const [sub, val] = args;
  const cfg = load();
  const { BRAIN_LEVELS, isValidLevel } = require_brain();

  if (sub === "status" || !sub) {
    const level = cfg.raw.agent?.brainLevel || "normal";
    console.log(`${C.bold}Brain level:${C.reset} ${C.cyan}${level}${C.reset}\n`);
    console.log(`Levels:`);
    const desc = {
      off: "tanpa ritual (paling cepat)",
      normal: "verify dasar (balanced)",
      high: "think + verify untuk task kompleks (recommended)",
      genius: "5 fase ritual untuk SEMUA task (paling lambat, paling teliti)",
    };
    for (const l of BRAIN_LEVELS) {
      const mark = l === level ? `${C.green}▶${C.reset}` : " ";
      console.log(`  ${mark} ${l.padEnd(8)} ${C.dim}${desc[l]}${C.reset}`);
    }
    return;
  }

  if (sub === "set") {
    if (!val || !isValidLevel(val)) {
      console.error(`${C.red}Usage: codeclaw brain set <${BRAIN_LEVELS.join("|")}>${C.reset}`);
      process.exit(1);
    }
    cfg.raw.agent = cfg.raw.agent || {};
    cfg.raw.agent.brainLevel = val;
    save(cfg);
    console.log(`${C.green}✅ Brain level: ${val}${C.reset}`);
    return;
  }

  console.log(`Usage:\n  ${C.cyan}codeclaw brain status${C.reset}\n  ${C.cyan}codeclaw brain set <level>${C.reset}`);
}

function require_brain() {
  // dynamic import workaround for ESM in CJS context
  return { BRAIN_LEVELS: ["off", "normal", "high", "genius"], isValidLevel: (l) => ["off","normal","high","genius"].includes(l) };
}

// === Research ===
async function handleResearch(args) {
  const [sub, ...rest] = args;
  if (sub === "run" || !sub) {
    const topic = rest.join(" ").trim();
    if (!topic) { console.error(`${C.red}Usage: codeclaw research <topic>${C.reset}`); process.exit(1); }
    console.log(`${C.cyan}🔍 Researching: ${topic}${C.reset}`);
    const { Knowledge } = await import("./lib/knowledge.js");
    const { research } = await import("./lib/research.js");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
    const kb = new Knowledge(path.join(__dirname2, "knowledge.db"));
    const r = await research({ topic, sources: ["arxiv", "hn"], limit: 3 });
    let added = 0;
    for (const [src, items] of Object.entries(r.sources)) {
      for (const item of items ?? []) {
        const res = kb.add({ topic, title: item.title, content: item.content, url: item.url || "", source: src });
        if (!res.duplicate) added++;
        console.log(`  [${src}] ${item.title}`);
      }
    }
    console.log(`\n${C.green}✅ ${added} new entries saved${C.reset}`);
    kb.close();
    return;
  }
  if (sub === "stats") {
    const { Knowledge } = await import("./lib/knowledge.js");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
    const kb = new Knowledge(path.join(__dirname2, "knowledge.db"));
    const stats = kb.stats();
    console.log(`${C.bold}Knowledge Base:${C.reset} ${stats.count} entries`);
    for (const t of stats.topics) console.log(`  ${t.topic} (${t.c})`);
    kb.close();
    return;
  }
  console.log(`Usage:\n  ${C.cyan}codeclaw research <topic>${C.reset}   Riset topik\n  ${C.cyan}codeclaw research stats${C.reset}     Stats KB`);
}

// === Cron ===
async function handleCron(args) {
  const [sub] = args;
  const { runCronOnce, cronStatus } = await import("./lib/cron.js");
  if (sub === "status" || !sub) {
    const s = cronStatus();
    console.log(`${C.bold}Cron Status:${C.reset}`);
    console.log(`  Last run:      ${s.lastRunAgo}`);
    console.log(`  Today:         ${s.todayCount}/${s.budget}`);
    console.log(`  Next eligible: ${s.nextEligible}`);
    return;
  }
  if (sub === "run") {
    console.log(`${C.cyan}Running cron research...${C.reset}`);
    const r = await runCronOnce();
    if (r.skipped) { console.log(`${C.yellow}⏭ Skipped: ${r.reason}${C.reset}`); return; }
    console.log(`${C.green}✅ ${r.results.length} topics processed${C.reset}`);
    for (const x of r.results) console.log(`  ${x.topic}: +${x.added ?? 0} (${x.error || "ok"})`);
    console.log(`Budget: ${r.todayCount}/${r.budget}`);
    return;
  }
  console.log(`Usage:\n  ${C.cyan}codeclaw cron status${C.reset}\n  ${C.cyan}codeclaw cron run${C.reset}`);
}

// === Channel ===
function handleChannel(args) {
  const [channel, sub, ...rest] = args;
  const cfg = load();

  if (channel !== "telegram") {
    console.log(`Channel didukung: ${C.cyan}telegram${C.reset}`);
    return;
  }

  if (sub === "status" || !sub) {
    const t = cfg.telegram;
    console.log(`${C.bold}Telegram:${C.reset} ${t.enabled ? `${C.green}ENABLED${C.reset}` : `${C.dim}disabled${C.reset}`}`);
    console.log(`  Account:   ${t.accountId}`);
    console.log(`  Bot token: ${t.botToken ? `***${t.botToken.slice(-8)}` : `${C.dim}(not set)${C.reset}`}`);
    console.log(`  Allowed:   [${t.allowedUserIds.join(", ")}]`);
    return;
  }

  if (sub === "enable") {
    ensureChannel(cfg);
    cfg.raw.channels.telegram.enabled = true;
    save(cfg);
    console.log(`${C.green}✅ Telegram channel enabled${C.reset}`);
    return;
  }

  if (sub === "disable") {
    ensureChannel(cfg);
    cfg.raw.channels.telegram.enabled = false;
    save(cfg);
    console.log(`${C.yellow}⏸  Telegram channel disabled${C.reset}`);
    return;
  }

  if (sub === "set-token") {
    const token = rest[0];
    if (!token) { console.error(`${C.red}Usage: codeclaw channel telegram set-token <token>${C.reset}`); process.exit(1); }
    ensureChannel(cfg);
    cfg.raw.channels.telegram.accounts.default.botToken = token;
    save(cfg);
    console.log(`${C.green}✅ Bot token updated${C.reset}`);
    return;
  }

  if (sub === "allow") {
    const id = rest[0];
    if (!id) { console.error(`${C.red}Usage: codeclaw channel telegram allow <userId>${C.reset}`); process.exit(1); }
    ensureChannel(cfg);
    const list = cfg.raw.channels.telegram.accounts.default.allowedUserIds || [];
    const num = Number(id);
    if (isNaN(num)) { console.error(`${C.red}userId harus angka${C.reset}`); process.exit(1); }
    if (!list.includes(num)) list.push(num);
    cfg.raw.channels.telegram.accounts.default.allowedUserIds = list;
    save(cfg);
    console.log(`${C.green}✅ User ${id} allowed${C.reset}`);
    return;
  }

  if (sub === "disallow") {
    const id = rest[0];
    if (!id) { console.error(`${C.red}Usage: codeclaw channel telegram disallow <userId>${C.reset}`); process.exit(1); }
    ensureChannel(cfg);
    const num = Number(id);
    const list = (cfg.raw.channels.telegram.accounts.default.allowedUserIds || []).filter(x => x !== num);
    cfg.raw.channels.telegram.accounts.default.allowedUserIds = list;
    save(cfg);
    console.log(`${C.green}✅ User ${id} removed${C.reset}`);
    return;
  }

  console.log(`Usage:
  ${C.cyan}codeclaw channel telegram status${C.reset}              Status
  ${C.cyan}codeclaw channel telegram enable${C.reset}              Enable
  ${C.cyan}codeclaw channel telegram disable${C.reset}             Disable
  ${C.cyan}codeclaw channel telegram set-token <token>${C.reset}   Set bot token
  ${C.cyan}codeclaw channel telegram allow <userId>${C.reset}      Allow user
  ${C.cyan}codeclaw channel telegram disallow <userId>${C.reset}   Disallow user`);
}

function ensureChannel(cfg) {
  cfg.raw.channels = cfg.raw.channels || {};
  cfg.raw.channels.telegram = cfg.raw.channels.telegram || { enabled: false, accounts: {} };
  cfg.raw.channels.telegram.accounts = cfg.raw.channels.telegram.accounts || { default: {} };
  cfg.raw.channels.telegram.accounts.default = cfg.raw.channels.telegram.accounts.default || { botToken: "", allowedUserIds: [] };
  cfg.raw.channels.telegram.accounts.default.allowedUserIds = cfg.raw.channels.telegram.accounts.default.allowedUserIds || [];
}

// === Config ===
function handleConfig(args) {
  const [sub] = args;
  const cfg = load();

  if (sub === "show" || !sub) {
    console.log(JSON.stringify(cfg.raw, null, 2).replace(/(sk-|gsk_|AIza|bns_)([A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1$2***"));
    return;
  }

  if (sub === "path") {
    console.log(CONFIG_PATH);
    return;
  }

  if (sub === "edit") {
    console.log(`Edit: nano ${CONFIG_PATH}`);
    return;
  }

  if (sub === "migrate") {
    const changed = migrateIfNeeded(cfg, CONFIG_PATH);
    console.log(changed ? `${C.green}✅ Migrated${C.reset}` : `${C.dim}Already new format${C.reset}`);
    return;
  }

  console.log(`Usage:
  ${C.cyan}codeclaw config show${C.reset}    Show config (API keys masked)
  ${C.cyan}codeclaw config path${C.reset}    Path ke config.json
  ${C.cyan}codeclaw config edit${C.reset}    Petunjuk edit
  ${C.cyan}codeclaw config migrate${C.reset} Migrate old → new format`);
}

// === Main ===
function printHelp() {
  console.log(`${C.bold}CodeClaw Pro — CLI${C.reset}\n`);
  console.log(`Usage: codeclaw <command> [args]\n`);
  console.log(`${C.bold}Commands:${C.reset}`);
  console.log(`  ${C.cyan}model${C.reset}      Manajemen model (list, current, set, add-provider, add-model)`);
  console.log(`  ${C.cyan}channel${C.reset}    Manajemen channel (telegram status/enable/set-token/allow)`);
  console.log(`  ${C.cyan}panel${C.reset}      Config panel interaktif (atau: config tanpa arg)`);
  console.log(`  ${C.cyan}config${C.reset}     Config (show, path, edit, migrate)`);
  console.log(`  ${C.cyan}brain${C.reset}      Brain level (off/normal/high/genius)`);
  console.log(`  ${C.cyan}research${C.reset}   Riset topik (ArXiv, HN) → knowledge base`);
  console.log(`  ${C.cyan}cron${C.reset}       Cron research (status, run)`);
  console.log(`  ${C.cyan}start${C.reset}      Jalankan agent (default)`);
  console.log(`  ${C.cyan}telegram${C.reset}   Jalankan telegram bot`);
  console.log("");
}

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case "model":     handleModel(args); break;
    case "channel":   handleChannel(args); break;
    case "config":
      if (!args.length || args[0] === "panel") { await import("./panel.js"); }
      else handleConfig(args);
      break;
    case "panel":     await import("./panel.js"); break;
    case "brain":     handleBrain(args); break;
    case "research":  await handleResearch(args); break;
    case "cron":      await handleCron(args); break;
    case "start":     await import("./index.js"); break;
    case "telegram":  await import("./telegram.js"); break;
    case undefined:   printHelp(); break;
    default:          printHelp();
  }
} catch (e) {
  console.error(`${C.red}Error: ${e.message}${C.reset}`);
  process.exit(1);
}
