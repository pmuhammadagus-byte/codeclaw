import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { LLM } from "./lib/llm.js";
import { Session } from "./lib/session.js";
import { TOOL_DEFINITIONS, executeTool } from "./lib/tools.js";
import { todoSection } from "./lib/planner.js";
import { memorySection } from "./lib/memory.js";
import { loadConfig, migrateIfNeeded } from "./lib/config.js";
import { SkillStore, buildSkillSection } from "./lib/skills.js";
import { Knowledge } from "./lib/knowledge.js";
import { getBrainPrompt } from "./lib/brain.js";
import { distillSkill, isComplexTask } from "./lib/skill-distiller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
let CFG = loadConfig(CONFIG_PATH);
if (migrateIfNeeded(CFG, CONFIG_PATH)) {
  console.log("⚠️  Config lama terdeteksi, sudah dimigrasi ke format baru (models.providers + channels.telegram)");
  CFG = loadConfig(CONFIG_PATH);
}
const CONFIG = { ...CFG.raw, llm: CFG.llm, agent: CFG.agent, telegram: CFG.telegram };
function loadFileIfExists(name) {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
const BASE_SYSTEM = [
  loadFileIfExists("IDENTITY.md"),
  loadFileIfExists("system.md"),
].filter(Boolean).join("\n\n---\n\n");
const DB_PATH = path.join(__dirname, "data.db");

const llm = new LLM(CONFIG.llm);
const session = new Session(DB_PATH);
const CHAT_ID = "cli";
const skillStore = new SkillStore();
const knowledge = new Knowledge(path.join(__dirname, "knowledge.db"));
const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m" };

function stripMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

console.log(`${C.cyan}${C.bold}╔════════════════════════════════════════╗`);
console.log(`║       CodeClaw Pro v1.0                ║`);
console.log(`║  Coding agent for Ubuntu PRoot         ║`);
console.log(`╚════════════════════════════════════════╝${C.reset}`);
console.log(`${C.dim}Model: ${CONFIG.llm.modelRef} | Brain: ${CONFIG.agent.brainLevel || "normal"} | DB: ${DB_PATH}${C.reset}`);
console.log(`${C.dim}/clear /todo /mem /help /exit${C.reset}\n`);

async function askApproval(cmd) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${C.yellow}⚠ Approve? [y/N] ${C.reset}${C.dim}${cmd.slice(0, 100)}${C.reset} `, (a) => {
      rl.close(); resolve(a.trim().toLowerCase() === "y");
    });
  });
}

function buildSystem(currentTask = "") {
  const skillSection = currentTask ? buildSkillSection(skillStore, currentTask) : "";
  let knowledgeSection = "";
  if (currentTask) {
    const results = knowledge.search(currentTask, 3);
    if (results.length) {
      knowledgeSection = "\n\n## RELEVANT KNOWLEDGE (dari riset sebelumnya)\n" +
        results.map(r => `- ${r.title}: ${r.content.slice(0, 200)}`).join("\n");
    }
  }
  const brainLevel = CONFIG.agent.brainLevel || CONFIG.agent.brain || "normal";
  const brainSection = getBrainPrompt(brainLevel);
  return BASE_SYSTEM + brainSection + todoSection(session, CHAT_ID) + memorySection(session, CHAT_ID) + skillSection + knowledgeSection;
}

async function runTurn(userInput) {
  session.add(CHAT_ID, { role: "user", content: userInput });

  for (let iter = 0; iter < CONFIG.agent.maxToolIterations; iter++) {
    const history = session.history(CHAT_ID, CONFIG.agent.contextWindow);
    const messages = [{ role: "system", content: buildSystem(userInput) }, ...history];

    process.stdout.write(`${C.green}🤖 ${C.reset}`);
    let streamed = "";
    const { message, finishReason } = await llm.chat({
      messages, tools: TOOL_DEFINITIONS,
      onStream: (c) => { streamed += c; process.stdout.write(stripMarkdown(c)); },
    });
    if (streamed) console.log();
    session.add(CHAT_ID, message);

    if (finishReason === "tool_calls" || message.tool_calls?.length) {
      for (const tc of message.tool_calls ?? []) {
        let args; try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
        console.log(`${C.dim}🔧 ${tc.function.name}(${Object.keys(args).join(", ")})${C.reset}`);
        const result = await executeTool(tc.function.name, args, {
          session, chatId: CHAT_ID, config: CONFIG,
          approvalCallback: askApproval,
          approvalMode: CONFIG.agent.approvalMode,
        });
        const preview = stripMarkdown(result).slice(0, 200).replace(/\n/g, " ");
        console.log(`${C.dim}   → ${preview}${result.length > 200 ? "..." : ""}${C.reset}\n`);
        session.add(CHAT_ID, { role: "tool", tool_call_id: tc.id, name: tc.function.name, content: result });
      }
      continue;
    }
    await selfImprove(userInput, false);
    return;
  }
  console.log(`${C.red}⚠ Max iterations.${C.reset}`);
  await selfImprove(userInput, true);
}

async function selfImprove(task, failed) {
  try {
    const history = session.history(CHAT_ID, 40);

    if (failed) {
      // Refleksi kegagalan
      console.log(`${C.dim}🧠 Reflecting on failure...${C.reset}`);
      const reflection = `[${new Date().toISOString()}] FAILED TASK: ${task.slice(0, 100)}\nReason: max iterations reached without completion.`;
      session.memSet(CHAT_ID, `reflection_${Date.now()}`, reflection);
      console.log(`${C.dim}   Reflection saved${C.reset}`);
      return;
    }

    if (isComplexTask(history)) {
      console.log(`${C.dim}🧬 Distilling skill...${C.reset}`);
      const result = await distillSkill({ llmConfig: CONFIG.llm, task, messages: history });
      if (result.action === "save") {
        const saved = skillStore.save({
          name: result.name, trigger: result.trigger,
          procedure: result.procedure, tags: result.tags || [], examples: result.examples || [],
        });
        console.log(`${C.green}🧬 New skill: "${result.name}" [${saved.id}]${C.reset}`);
      }
    }
  } catch (e) {
    console.log(`${C.dim}⚠ self-improve error: ${e.message}${C.reset}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${C.bold}${C.magenta}❯ ${C.reset}` });
rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) return rl.prompt();
  if (input === "/exit" || input === "/quit") return rl.close();
  if (input === "/clear") { session.clear(CHAT_ID); session.todoClear(CHAT_ID); console.log(`${C.dim}cleared${C.reset}\n`); return rl.prompt(); }
  if (input === "/todo") {
    const todos = session.todoList(CHAT_ID);
    if (!todos.length) console.log(`${C.dim}(no todos)${C.reset}`);
    else todos.forEach(t => console.log(`  [${t.id}] ${t.status} — ${t.task}`));
    return rl.prompt();
  }
  if (input === "/mem") {
    const mems = session.memList(CHAT_ID);
    if (!mems.length) console.log(`${C.dim}(empty)${C.reset}`);
    else mems.forEach(m => console.log(`  ${m.key} = ${m.value}`));
    return rl.prompt();
  }
  if (input.startsWith("/research ")) {
    const topic = input.slice(10).trim();
    if (!topic) { console.log(`${C.red}Usage: /research <topic>${C.reset}\n`); return rl.prompt(); }
    console.log(`${C.cyan}🔍 Researching: ${topic}${C.reset}`);
    try {
      const result = await executeTool("research_topic", { topic, sources: ["arxiv", "hn"], limit: 3 }, { session, chatId: CHAT_ID, config: CONFIG });
      console.log(result);
    } catch (e) { console.log(`${C.red}Error: ${e.message}${C.reset}`); }
    console.log();
    return rl.prompt();
  }
  if (input === "/knowledge") {
    const stats = knowledge.stats();
    console.log(`${C.cyan}═══ KNOWLEDGE BASE (${stats.count} entries) ═══${C.reset}`);
    if (stats.topics.length) {
      console.log(`${C.dim}Top topics:${C.reset}`);
      for (const t of stats.topics) console.log(`  ${t.topic} (${t.c})`);
    } else console.log(`${C.dim}(kosong)${C.reset}`);
    console.log();
    return rl.prompt();
  }
  if (input.startsWith("/ksearch ")) {
    const q = input.slice(9).trim();
    const results = knowledge.search(q, 5);
    if (!results.length) console.log(`${C.dim}(tidak ada hasil)${C.reset}`);
    else for (const r of results) {
      console.log(`  [${new Date(r.added_at).toISOString().slice(0,10)}] ${r.title}`);
      console.log(`    ${r.content.slice(0, 120)}...`);
    }
    console.log();
    return rl.prompt();
  }
  if (input === "/skills") {
    const all = skillStore.list();
    const stats = skillStore.stats();
    console.log(`${C.cyan}═══ SKILLS (${stats.total}) ═══${C.reset}`);
    console.log(`${C.dim}Uses: ${stats.totalUses} | Success: ${stats.totalSuccesses} | Failing: ${stats.failing}${C.reset}`);
    if (!all.length) console.log(`${C.dim}(belum ada)${C.reset}`);
    for (const s of all) {
      const rate = s.uses ? `${Math.round(100*s.successes/s.uses)}%` : "unused";
      console.log(`  [${s.id}] ${s.name} — ${rate}`);
    }
    console.log();
    return rl.prompt();
  }
  if (input === "/help") {
    console.log(`${C.dim}/clear  hapus history\n/todo   list todos\n/mem    list memory\n/skills list skills\n/research <topic> riset ArXiv + HN\n/knowledge lihat KB stats\n/ksearch <q> cari di KB\n/exit   keluar\n/help   bantuan${C.reset}\n`);
    return rl.prompt();
  }
  try { await runTurn(input); } catch (e) { console.error(`${C.red}Error: ${e.message}${C.reset}`); }
  console.log();
  rl.prompt();
});

rl.on("close", () => { session.close(); console.log(`${C.dim}Bye.${C.reset}`); process.exit(0); });
