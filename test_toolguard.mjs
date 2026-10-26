import { validateArgs } from "./lib/tool-guard.js";
import { executeTool } from "./lib/tools.js";

// 1) read_file tanpa path harus return error tanpa crash
const r1 = validateArgs("read_file", {});
console.log("validate read_file empty:", r1.ok ? "BAD" : r1.error);

// 2) simulasi fetch gagal 2x lalu sukses harus lolos dengan retry
import { withRetry } from "./lib/tool-guard.js";
let count = 0;
const fn = async () => {
  count++;
  if (count < 3) {
    const e = new Error("fetch failed");
    throw e;
  }
  return "OK";
};
const r = await withRetry(fn, 3);
console.log("retry test:", r, "count:", count);
