import { LLM } from "./llm.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

const SUBAGENT_SYSTEM = `Anda adalah CodeClaw sub-agent. Tugas Anda SPESIFIK dan TERBATAS.
ATURAN:
- Kerjakan HANYA task yang diberikan, jangan melenceng
- Jangan buat todo, jangan spawn sub-agent lagi
- Selesaikan dengan efisien (max 10 iterasi)
- Setelah selesai, ringkas hasil dalam 3-5 baris
- Output akhir: ringkasan task + hasil + file yang diubah (kalau ada)`;

export async function spawnSubagent({ task, config, allowedTools = null, onLog = () => {} }) {
  const llm = new LLM(config.llm);
  
  // Batasi tool jika diminta, atau gunakan default (tanpa spawn_subagent)
  const tools = allowedTools
    ? TOOL_DEFINITIONS.filter(t => allowedTools.includes(t.function.name))
    : TOOL_DEFINITIONS.filter(t => !["spawn_subagent"].includes(t.function.name));

  const messages = [
    { role: "system", content: SUBAGENT_SYSTEM },
    { role: "user", content: `TASK: ${task}` },
  ];

  const maxIter = config.agent?.maxSubagentIterations ?? 15;
  let lastContent = "";

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
    return { ok: true, result: lastContent, iterations: i + 1 };
  }
  return { ok: false, result: lastContent || "Sub-agent reached max iterations", iterations: maxIter };
}
