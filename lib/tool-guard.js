import { setTimeout as sleep } from "timers/promises";

const SCHEMAS = {
  read_file: { required: ["path"], props: { path: { t: "string" }, start: { t: "number" }, end: { t: "number" } } },
  write_file: { required: ["path", "content"], props: { path: { t: "string" }, content: { t: "string" } } },
  edit_file: { required: ["path", "old_text", "new_text"], props: { path: { t: "string" }, old_text: { t: "string" }, new_text: { t: "string" } } },
  list_dir: { required: [], props: { path: { t: "string" }, recursive: { t: "boolean" } } },
  search_code: { required: ["pattern"], props: { pattern: { t: "string" }, path: { t: "string" }, glob: { t: "string" } } },
  shell: { required: ["command"], props: { command: { t: "string" }, cwd: { t: "string" }, timeout: { t: "number" } } },
  web_search: { required: ["query"], props: { query: { t: "string" }, limit: { t: "number" } } },
  web_fetch: { required: ["url"], props: { url: { t: "string" }, max_bytes: { t: "number" } } },
};

function checkType(v, t) {
  if (t === "string") return typeof v === "string";
  if (t === "number") return typeof v === "number" && !isNaN(v);
  if (t === "boolean") return typeof v === "boolean";
  if (t === "array") return Array.isArray(v);
  if (t === "object") return typeof v === "object" && v !== null && !Array.isArray(v);
  return true;
}

export function validateArgs(toolName, args = {}) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { ok: true };
  const a = args || {};
  for (const req of schema.required) {
    if (!(req in a)) return { ok: false, error: `Error: missing required argument "${req}" for ${toolName}` };
    if (typeof a[req] === "string" && a[req].trim() === "") return { ok: false, error: `Error: empty string argument "${req}" for ${toolName}` };
  }
  for (const k of Object.keys(schema.props)) {
    if (k in a && a[k] !== undefined) {
      const prop = schema.props[k];
      if (!checkType(a[k], prop.t)) {
        return { ok: false, error: `Error: argument "${k}" must be of type ${prop.t} for ${toolName}` };
      }
    }
  }
  return { ok: true };
}

function isNetworkError(e) {
  const msg = (e?.message || e?.toString() || "").toLowerCase();
  const code = e?.code || e?.cause?.code;
  const netCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ECANCELLED"];
  if (code && netCodes.includes(String(code))) return true;
  const netMsgs = ["fetch failed", "timeout", "econnreset", "network", "socket hang up", "enotfound"];
  return netMsgs.some((n) => msg.includes(n));
}

export async function withRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isNetworkError(e)) throw e;
      if (i === maxRetries) throw e;
      const delay = Math.pow(2, i) * 1000;
      await sleep(delay);
    }
  }
  throw lastErr;
}
