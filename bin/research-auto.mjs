#!/usr/bin/env node
import { loadConfig } from "../lib/config.js";
import { LLM } from "../lib/llm.js";
import { runMethodsResearch, readMethodsState } from "../lib/methods-research.js";
import { TelegramAPI } from "../lib/telegram-api.js";
import { CONFIG_FILE, ensureDirs } from "../lib/paths.js";

async function main() {
  console.log("[research-auto] start", new Date().toISOString());

  const state = readMethodsState();
  if (!state.autoEnabled) {
    console.log("[research-auto] SKIP: auto-research OFF (set via /research-methods auto on)");
    process.exit(0);
  }

  ensureDirs();
  const CFG = loadConfig(CONFIG_FILE);
  console.log("[research-auto] llm:", { model: CFG.llm?.model });

  if (!CFG.llm?.apiKey) {
    console.error("[research-auto] ❌ CFG.llm.apiKey kosong");
    process.exit(1);
  }

  const llm = new LLM(CFG.llm);
  const bot = new TelegramAPI(CFG.telegram.botToken);
  const chatId = CFG.telegram.chatId || CFG.telegram.accounts?.default?.chatId;

  const result = await runMethodsResearch(llm, (m) => console.log(m), { force: false });
  if (result.skipped) {
    console.log("[research-auto] SKIP:", result.reason);
    process.exit(0);
  }

  let reply = "🤖 [AUTO-RESEARCH]\n\n";
  reply += "Topik: " + result.totalTopics + "\n";
  reply += "Skill saved: " + result.savedCount + "\n\n";
  for (const cat of ["agent", "trading", "tools"]) {
    if (result.byCategory[cat]?.length) {
      reply += cat.toUpperCase() + ":\n";
      result.byCategory[cat].forEach(m => reply += "  • " + m + "\n");
    }
  }
  await bot.sendMessage(chatId, reply);
  console.log("[research-auto] ✅ sent");
}

main().catch(e => { console.error("[research-auto] ❌", e.message); process.exit(1); });
