import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "./lib/llm.js";
import { TOOL_DEFINITIONS } from "./lib/tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const llm = new LLM(CONFIG.llm);

console.log("Testing tool call...\n");
console.log("  baseUrl:", llm.baseUrl);
console.log("  model:  ", llm.model);
console.log("");

try {
  const res = await llm.chat({
    messages: [
      { role: "system", content: "You are a coding agent. Use tools when needed." },
      { role: "user", content: "Buat file /tmp/test-tc.txt dengan isi 'hello tool'. Gunakan write_file." }
    ],
    tools: TOOL_DEFINITIONS,
  });

  console.log("✅ Response:");
  console.log("  Content:", (res.message.content || "").slice(0, 100) || "(empty)");
  console.log("  finish_reason:", res.finishReason);
  console.log("  tool_calls:", res.message.tool_calls?.length ?? 0);

  if (res.message.tool_calls?.length) {
    for (const tc of res.message.tool_calls) {
      console.log(`\n  🔧 ${tc.function.name}`);
      console.log(`     args: ${tc.function.arguments.slice(0, 200)}`);
    }
    console.log("\n✅ Tool calling WORKS!");
  } else {
    console.log("\n⚠️  Model tidak memanggil tool.");
  }
} catch (e) {
  console.log("❌ Error:", e.message);
  process.exit(1);
}
