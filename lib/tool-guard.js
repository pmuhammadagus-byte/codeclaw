import { setTimeout as sleep } from "timers/promises";

const SCHEMAS = {
  read_file: { required: ["path"], props: { path: { t: "string" }, start: { t: "number" }, end: { t: "number" } } },
  write_file: { required: ["path", "content"], props: { path: { t: "string" }, content: { t: "string" } } },
  edit_file: { required: ["path", "old_text", "new_text"], props: { path: { t: "string" }, old_text: { t: "string" }, new_text: { t: "string" } } },
  list_dir: { required: [], props: { path: { t: "string" }, recursive: { t: "boolean" } } },
  search_code: { required: ["pattern"], props: { pattern: { t: "string" }, path: { t: "string" }, glob: { t: "string" } } },
  diff_preview: { required: ["path", "new_content"], props: { path: { t: "string" }, new_content: { t: "string" } } },
  refactor_multi: { required: ["pattern", "replacement", "glob"], props: { pattern: { t: "string" }, replacement: { t: "string" }, glob: { t: "string" }, dry_run: { t: "boolean" } } },
  shell: { required: ["command"], props: { command: { t: "string" }, cwd: { t: "string" }, timeout: { t: "number" } } },
  install_package: { required: ["packages"], props: { manager: { t: "string" }, packages: { t: "array" }, cwd: { t: "string" } } },
  run_tests: { required: [], props: { pattern: { t: "string" }, cwd: { t: "string" } } },
  parse_error: { required: ["output"], props: { output: { t: "string" } } },
  web_search: { required: ["query"], props: { query: { t: "string" }, limit: { t: "number" } } },
  web_fetch: { required: ["url"], props: { url: { t: "string" }, max_bytes: { t: "number" } } },
  todo_write: { required: ["action"], props: { action: { t: "string" }, task: { t: "string" }, task_id: { t: "number" }, status: { t: "string" }, priority: { t: "number" } } },
  memory_set: { required: ["key", "value"], props: { key: { t: "string" }, value: { t: "string" } } },
  memory_get: { required: [], props: { key: { t: "string" } } },
  branch_save: { required: ["name", "paths"], props: { name: { t: "string" }, paths: { t: "array" } } },
  branch_restore: { required: ["name"], props: { name: { t: "string" } } },
  index_codebase: { required: [], props: { path: { t: "string" } } },
  search_index: { required: ["query"], props: { query: { t: "string" }, limit: { t: "number" } } },
  skill_save: { required: ["name", "trigger", "procedure"], props: { name: { t: "string" }, trigger: { t: "string" }, procedure: { t: "string" }, tags: { t: "array" } } },
  skill_find: { required: ["task"], props: { task: { t: "string" }, limit: { t: "number" } } },
  skill_list: { required: [], props: {} },
  skill_record: { required: ["id", "success"], props: { id: { t: "string" }, success: { t: "boolean" } } },
  research_topic: { required: ["topic"], props: { topic: { t: "string" }, sources: { t: "array" }, limit: { t: "number" } } },
  knowledge_search: { required: ["query"], props: { query: { t: "string" }, limit: { t: "number" } } },
  knowledge_add: { required: ["topic", "title", "content"], props: { topic: { t: "string" }, title: { t: "string" }, content: { t: "string" }, url: { t: "string" } } },
  spawn_subagent: { required: ["task"], props: { task: { t: "string" }, allowed_tools: { t: "array" } } },
  think: { required: ["topic", "reasoning"], props: { topic: { t: "string" }, reasoning: { t: "string" } } },
  verify: { required: ["claim", "command"], props: { claim: { t: "string" }, command: { t: "string" }, cwd: { t: "string" } } },
  fetch_calendar: { required: [], props: { date: { t: "string" } } },
  browser_use: { required: ["action"], props: { action: { t: "string" }, url: { t: "string" }, selector: { t: "string" }, value: { t: "string" }, script: { t: "string" } } }
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
    if (schema.props[req]?.t === "array" && !Array.isArray(a[req])) {
      return { ok: false, error: `Error: argument "${req}" must be of type array for ${toolName}` };
    }
  }
  for (const k of Object.keys(schema.props)) {
    if (k in a && a[k] !== undefined && a[k] !== null) {
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
  const netMsgs = ["fetch failed", "timeout", "econnreset", "network", "socket hang up", "enotfound", "getaddrinfo"];
  return netMsgs.some((n) => msg.includes(n));
}

function isRetryableError(e) {
  if (isNetworkError(e)) return true;
  const msg = (e?.message || e?.toString() || "").toLowerCase();
  const retryMsgs = ["temporary", "try again", "busy", "locked", "ebusy", "emfile", "enfile"];
  return retryMsgs.some((n) => msg.includes(n));
}

export async function withRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableError(e)) throw e;
      if (i === maxRetries) throw e;
      const base = Math.pow(2, i) * 250;
      const jitter = Math.floor(Math.random() * 150);
      await sleep(base + jitter);
    }
  }
  throw lastErr;
}

export function withTimeout(promise, ms = 60000, label = "tool") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms executing ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const TOOL_OUTPUT_CAP = 100 * 1024;
export function capOutput(s) {
  if (typeof s !== "string") s = String(s);
  if (s.length <= TOOL_OUTPUT_CAP) return s;
  return s.slice(0, TOOL_OUTPUT_CAP) + `\n\n[TRUNCATED: output exceeded ${TOOL_OUTPUT_CAP} bytes]`;
}
