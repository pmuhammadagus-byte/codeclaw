import { LLM } from "./llm.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import { retrieveExperiences, saveExperience, reflectExperience } from "./memory.js";

const SUBAGENT_SYSTEM = `Anda adalah CodeClaw sub-agent. Tugas Anda SPESIFIK dan TERBATAS.
ATURAN:
- Kerjakan HANYA task yang diberikan, jangan melenceng
- Jangan buat todo, jangan spawn sub-agent lagi
- Selesaikan dengan efisien (max 10 iterasi)
- Setelah selesai, ringkas hasil dalam 3-5 baris
- Output akhir: ringkasan task + hasil + file yang diubah (kalau ada)`;

export async function spawnSubagent({ task, config, allowedTools = null, onLog = () => {} }) {
  const llm = new LLM(config.llm);

  // 1. RETRIEVAL: Cari ingatan masa lalu
  const pastExperience = retrieveExperiences(task);
  const systemPrompt = SUBAGENT_SYSTEM + pastExperience;
  if (pastExperience) onLog("🧠 Menemukan pengalaman relevan di memory.");

  const tools = allowedTools
    ? TOOL_DEFINITIONS.filter(t => allowedTools.includes(t.function.name))
    : TOOL_DEFINITIONS.filter(t => !["spawn_subagent"].includes(t.function.name));

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `TASK: ${task}` },
  ];

  const maxIter = config.agent?.maxSubagentIterations ?? 15;
  let lastContent = "";
  let success = false;

  for (let i = 0; i < maxIter; i++) {
    const { message, finishReason } = await llm.chat({ messages, tools });
    if (message.content) lastContent = message.content;
    messages.push(message);

    if (finishReason === "tool_calls" || message.tool_calls?.length) {
      for (const tc of message.tool_calls ?? []) {
        let args; try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
        onLog(`sub: ${tc.function.name}`);
        const result = await executeTool(tc.function.name, args, {
          approvalCallback: async () => true,
          approvalMode: "none",
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result,
        });
      }
      continue;
    }
    success = true;
    break;
  }

  if (!success && !lastContent) {
    lastContent = "Sub-agent reached max iterations";
  }

  // 2. REFLECTION: Belajar dari pengalaman (Background)
  if (success && lastContent) {
    onLog("🧠 Melakukan refleksi pengalaman...");
    reflectExperience(llm, task, messages).then(insight => {
      saveExperience(task, insight, success);
      onLog(`🧠 Tersimpan di memory: "${insight}"`);
    }).catch(() => {});
  }

  return { ok: success, result: lastContent, iterations: messages.length };
}
