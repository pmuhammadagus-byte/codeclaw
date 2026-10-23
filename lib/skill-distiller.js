import { LLM } from "./llm.js";

export async function distillSkill({ llmConfig, task, messages }) {
  const llm = new LLM(llmConfig);

  const transcript = messages
    .filter(m => m.role === "user" || m.role === "assistant" || m.role === "tool")
    .slice(-30)
    .map(m => {
      if (m.role === "tool") return `[TOOL ${m.name}] ${String(m.content).slice(0, 300)}`;
      if (m.role === "assistant" && m.tool_calls) {
        return `[ASSISTANT called: ${m.tool_calls.map(t => t.function.name).join(", ")}] ${(m.content || "").slice(0, 300)}`;
      }
      return `[${m.role.toUpperCase()}] ${String(m.content || "").slice(0, 500)}`;
    })
    .join("\n\n");

  const prompt = `Analisis percakapan coding agent di bawah. Jika berhasil menyelesaikan task dengan baik, ekstrak menjadi SKILL yang bisa dipakai ulang.

TASK: ${task}

TRANSCRIPT:
${transcript}

---

Jika task selesai SUKSES dan prosedurnya bisa digeneralisasi, output JSON (persis format ini):

{
  "action": "save",
  "name": "Nama skill singkat (max 60 char)",
  "trigger": "Deskripsi kapan skill ini dipakai (1 kalimat)",
  "tags": ["tag1", "tag2"],
  "procedure": "Langkah-langkah detail dalam markdown (min 3 langkah, spesifik, actionable)",
  "examples": ["Contoh nyata dari percakapan (input → output)"]
}

Jika task GAGAL, TIDAK bisa digeneralisasi, atau terlalu sederhana (<3 langkah), output:

{
  "action": "skip",
  "reason": "alasan singkat"
}

HANYA output JSON, tanpa teks lain.`;

  const res = await llm.chat({ messages: [{ role: "user", content: prompt }], tools: null });
  const text = (res.message.content || "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { action: "skip", reason: "LLM tidak keluarkan JSON" };

  try { return JSON.parse(jsonMatch[0]); }
  catch (e) { return { action: "skip", reason: `JSON parse error: ${e.message}` }; }
}

export async function improveSkill({ llmConfig, skillContent, failures }) {
  const llm = new LLM(llmConfig);
  const prompt = `Skill di bawah ini punya track record GAGAL (${failures} kegagalan). Perbaiki agar lebih reliable.

SKILL LAMA:
${skillContent}

---

Output: skill LENGKAP versi improved (markdown format sama). JANGAN tambahkan teks penjelasan.`;

  const res = await llm.chat({ messages: [{ role: "user", content: prompt }], tools: null });
  return (res.message.content || "").trim();
}

export function isComplexTask(messages) {
  const toolCalls = messages.filter(m => m.role === "assistant" && m.tool_calls?.length);
  const totalTools = toolCalls.reduce((a, m) => a + m.tool_calls.length, 0);
  return totalTools >= 4;
}
