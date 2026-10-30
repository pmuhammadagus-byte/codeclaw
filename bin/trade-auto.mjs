#!/usr/bin/env node
import fs from "node:fs";
import { loadConfig } from "/root/codeclaw/lib/config.js";
import { LLM } from "/root/codeclaw/lib/llm.js";
import { runTradeAnalysis, readTradeState, writeTradeState } from "/root/codeclaw/lib/trade-analyzer.js";
import { TelegramAPI } from "/root/codeclaw/lib/telegram-api.js";

async function main() {
  console.log("[trade-auto] start", new Date().toISOString());

  const state = readTradeState();
  if (!state.autoEnabled) {
    console.log("[trade-auto] SKIP: auto-trade OFF (set via /trade auto on)");
    process.exit(0);
  }

  const CFG = loadConfig("/root/codeclaw/config.json");
  console.log("[trade-auto] llm:", { model: CFG.llm?.model, baseUrl: CFG.llm?.baseUrl?.slice(0, 40) });

  if (!CFG.llm?.apiKey) {
    console.error("[trade-auto] ❌ CFG.llm.apiKey kosong");
    process.exit(1);
  }

  // Read twelvedata.apiKey from raw config.json
  let twelveDataKey = "";
  try {
    const rawCfg = JSON.parse(fs.readFileSync("/root/codeclaw/config.json", "utf8"));
    twelveDataKey = rawCfg.twelvedata?.apiKey || "";
  } catch {}

  const llm = new LLM(CFG.llm);
  const bot = new TelegramAPI(CFG.telegram.botToken);
  const chatId = CFG.telegram.chatId || CFG.telegram.accounts?.default?.chatId;
  if (!chatId) {
    console.error("[trade-auto] ❌ chatId tidak ditemukan");
    process.exit(1);
  }

  console.log("[trade-auto] twelvedata:", twelveDataKey ? "✅ set" : "❌ kosong (akan WAIT tanpa price)");

  const result = await runTradeAnalysis({ llm, price: null, twelveDataKey });
  await bot.sendMessage(chatId, "🤖 [AUTO-TRADE]\n\n" + result.formatted);
  console.log("[trade-auto] ✅ sent to Telegram");

  state.lastAutoRun = new Date().toISOString();
  writeTradeState(state);
}

main().catch(e => { console.error("[trade-auto] ❌", e.message, e.stack); process.exit(1); });
