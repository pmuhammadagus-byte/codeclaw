import { getEmbedding } from "./embed.js";
import fs from "node:fs";
import path from "node:path";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { needsApproval } from "./safety.js";
import { diffLines, formatDiff } from "./diff.js";
import { parseError, formatParsed } from "./error-parser.js";
import { webFetch, webSearch } from "./web.js";
import { Indexer } from "./indexer.js";
import { SkillStore, buildSkillSection } from "./skills.js";
import { spawnSubagent } from "./subagent.js";
import { Knowledge } from "./knowledge.js";
import { research } from "./research.js";
import { distillSkill, improveSkill } from "./skill-distiller.js";

const execAsync = promisify(exec);
const HOME = process.env.HOME || "/root";
const BRANCH_DIR = path.join(HOME, "codeclaw", ".branches");
const INDEX_DB = path.join(HOME, "codeclaw", "index.db");

const SHELL = (() => {
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL;
  for (const p of ["/bin/bash", "/usr/bin/bash", "/data/data/com.termux/files/usr/bin/bash"]) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return "/bin/sh";
})();

let _indexer = null;
let _skillStore = null;
let _knowledge = null;
function getKnowledge() {
  if (!_knowledge) _knowledge = new Knowledge(path.join(HOME, "codeclaw", "knowledge.db"));
  return _knowledge;
}
function getSkillStore() {
  if (!_skillStore) _skillStore = new SkillStore();
  return _skillStore;
}
export { getSkillStore };
function getIndexer() {
  if (!_indexer) _indexer = new Indexer(INDEX_DB);
  return _indexer;
}

function expand(p) {
  if (!p) return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  if (p === "~") return HOME;
  return path.resolve(p);
}

// 🛡️ P0-2: WORKSPACE BOUNDARY (hard-block di luar workspace)
const __P02_WORKSPACE_ROOT = process.cwd();
const __P02_EXTRA_ALLOWED = ["/tmp"];
function assertWithinWorkspace(absPath) {
  const abs = path.isAbsolute(absPath) ? absPath : path.resolve(__P02_WORKSPACE_ROOT, absPath);
  let realPath;
  try {
    realPath = fs.realpathSync(abs);
  } catch {
    try {
      realPath = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      throw new Error(`❌ DIBLOKIR (P0-2): path tidak dapat diverifikasi: ${absPath}`);
    }
  }
  const ok = realPath === __P02_WORKSPACE_ROOT
    || realPath.startsWith(__P02_WORKSPACE_ROOT + path.sep)
    || __P02_EXTRA_ALLOWED.some(r => realPath === r || realPath.startsWith(r + path.sep));
  if (!ok) throw new Error(`❌ DIBLOKIR (P0-2): path di luar workspace: ${absPath} → ${realPath}`);
  return abs;
}

// ============ TOOL DEFINITIONS ============
export const TOOL_DEFINITIONS = [
  { type: "function", function: { name: "read_file", description: "Baca file dengan line numbers.",
    parameters: { type: "object", properties: { path: { type: "string" }, start: { type: "number" }, end: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Tulis file baru atau overwrite.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "edit_file", description: "Edit: replace old_text unik dengan new_text.",
    parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } } },
  { type: "function", function: { name: "list_dir", description: "List folder.",
    parameters: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } } } } },
  { type: "function", function: { name: "search_code", description: "Grep di semua file.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "diff_preview", description: "Preview diff sebelum write_file.",
    parameters: { type: "object", properties: { path: { type: "string" }, new_content: { type: "string" } }, required: ["path", "new_content"] } } },
  { type: "function", function: { name: "refactor_multi", description: "Replace di banyak file.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, replacement: { type: "string" }, glob: { type: "string" }, dry_run: { type: "boolean" } }, required: ["pattern", "replacement", "glob"] } } },
  { type: "function", function: { name: "shell", description: "Jalankan shell command (git, gh, npm, apt, curl, dll).",
    parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeout: { type: "number" } }, required: ["command"] } } },
  { type: "function", function: { name: "install_package", description: "Install package (auto-detect manager).",
    parameters: { type: "object", properties: { manager: { type: "string", enum: ["npm", "pip", "apt", "pkg", "auto"] }, packages: { type: "array", items: { type: "string" } }, cwd: { type: "string" } }, required: ["packages"] } } },
  { type: "function", function: { name: "run_tests", description: "Jalankan test framework.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, cwd: { type: "string" } } } } },
  { type: "function", function: { name: "parse_error", description: "Parse stack trace → file:line.",
    parameters: { type: "object", properties: { output: { type: "string" } }, required: ["output"] } } },
  { type: "function", function: { name: "web_fetch", description: "Fetch URL → text (HTML strip).",
    parameters: { type: "object", properties: { url: { type: "string" }, max_bytes: { type: "number" } }, required: ["url"] } } },
  { type: "function", function: { name: "web_search", description: "Cari di DuckDuckGo.",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } } },
  { type: "function", function: { name: "todo_write", description: "Kelola todo (add/update/list/clear).",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["add", "update", "list", "clear"] }, task: { type: "string" }, task_id: { type: "number" }, status: { type: "string", enum: ["pending", "in_progress", "completed", "failed"] }, priority: { type: "number" } }, required: ["action"] } } },
  { type: "function", function: { name: "memory_set", description: "Simpan preferensi user.",
    parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } } },
  { type: "function", function: { name: "memory_get", description: "Ambil memory.",
    parameters: { type: "object", properties: { key: { type: "string" } } } } },
  { type: "function", function: { name: "branch_save", description: "Snapshot file/folder sebelum edit risky.",
    parameters: { type: "object", properties: { name: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, required: ["name", "paths"] } } },
  { type: "function", function: { name: "branch_restore", description: "Restore snapshot.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "index_codebase", description: "Index codebase untuk search cepat.",
    parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "search_index", description: "Cari di index codebase.",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } } },
  { type: "function", function: { name: "skill_save", description: "Simpan skill baru dari pengalaman (hanya setelah task kompleks sukses).",
    parameters: { type: "object", properties: { name: { type: "string" }, trigger: { type: "string" }, procedure: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["name", "trigger", "procedure"] } } },
  { type: "function", function: { name: "skill_find", description: "Cari skill yang relevan untuk task.",
    parameters: { type: "object", properties: { task: { type: "string" }, limit: { type: "number" } }, required: ["task"] } } },
  { type: "function", function: { name: "skill_list", description: "List semua skill (nama + success rate).",
    parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "skill_record", description: "Catat hasil pakai skill (success/fail) untuk learning loop.",
    parameters: { type: "object", properties: { id: { type: "string" }, success: { type: "boolean" } }, required: ["id", "success"] } } },
  { type: "function", function: { name: "research_topic", description: "Cari info terbaru tentang topik (ArXiv paper, HN top, GitHub trending).",
    parameters: { type: "object", properties: { topic: { type: "string" }, sources: { type: "array", items: { type: "string", enum: ["arxiv", "hn", "github"] } }, limit: { type: "number" } }, required: ["topic"] } } },
  { type: "function", function: { name: "knowledge_search", description: "Cari di knowledge base hasil riset sebelumnya.",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } } },
  { type: "function", function: { name: "knowledge_add", description: "Simpan catatan/insight manual ke knowledge base.",
    parameters: { type: "object", properties: { topic: { type: "string" }, title: { type: "string" }, content: { type: "string" }, url: { type: "string" } }, required: ["topic", "title", "content"] } } },
  { type: "function", function: { name: "spawn_subagent", description: "Panggil sub-agent untuk mengerjakan tugas spesifik secara paralel. Cocok untuk tugas besar yang bisa dipecah.",
    parameters: { type: "object", properties: { task: { type: "string", description: "Instruksi spesifik untuk sub-agent" }, allowed_tools: { type: "array", items: { type: "string" }, description: "Batasi tool yang bisa dipakai (opsional)" } }, required: ["task"] } } },
  { type: "function", function: { name: "think", description: "Reasoning eksplisit sebelum eksekusi.",
    parameters: { type: "object", properties: { topic: { type: "string" }, reasoning: { type: "string" } }, required: ["topic", "reasoning"] } } },
  { type: "function", function: { name: "verify", description: "Buktikan hasil kerja dengan command.",
    parameters: { type: "object", properties: { claim: { type: "string" }, command: { type: "string" } }, required: ["claim", "command"] } } },
  { type: "function", function: { name: "fetch_calendar", description: "Ambil jadwal berita ekonomi high-impact (ForexFactory).",
    parameters: { type: "object", properties: { date: { type: "string" } } } } },
  { type: "function", function: { name: "browser_use", description: "Kontrol browser Lightpanda (navigate, click, fill, extract, eval, screenshot).",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["navigate", "click", "fill", "extract", "eval", "screenshot"] }, url: { type: "string" }, selector: { type: "string" }, value: { type: "string" }, script: { type: "string" } }, required: ["action"] } } }
];

import { validateArgs, withRetry } from "./tool-guard.js";

export async function executeTool(name, args, ctx = {}) {
  try {
    const fn = EXECUTORS[name];
    if (!fn) return `Error: unknown tool "${name}"`;
    const v = validateArgs(name, args);
    if (!v.ok) return v.error;
    return await withRetry(() => fn(args, ctx));
  } catch (e) {
    return `Error in ${name}: ${e.message}`;
  }
}

const EXECUTORS = {
  async read_file({ path: p, start, end }) {
    const fp = assertWithinWorkspace(expand(p));
    if (!fs.existsSync(fp)) return `Error: not found: ${fp}`;
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) return `Error: ${fp} is a directory, use list_dir`;
    if (stat.size > 500_000) return `Error: file too large (${stat.size}b > 500KB)`;
    const lines = fs.readFileSync(fp, "utf8").split("\n");
    const total = lines.length;
    const from = start ? Math.max(1, start) : 1;
    const to = end ? Math.min(total, end) : Math.min(total, 500);
    const body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(6)}\t${l}`).join("\n");
    return `File: ${fp} (${total} lines, showing ${from}-${to})\n${body}`;
  },

  async write_file({ path: p, content }) {
    const fp = assertWithinWorkspace(expand(p));
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const existed = fs.existsSync(fp);
    const bak = fp + ".bak.tmp";
    if (existed) fs.copyFileSync(fp, bak);
    fs.writeFileSync(fp, content, "utf8");
    if (fp.endsWith(".js")) {
      try {
        execSync(`node --input-type=module --check < "${fp}"`, { stdio: "pipe", cwd: path.dirname(fp) });
      } catch (e) {
        if (existed) fs.copyFileSync(bak, fp); else fs.rmSync(fp, { force: true });
        try { fs.rmSync(bak, { force: true }); } catch {}
        return `[GAGAL] Kode yang kamu tulis memiliki SyntaxError. Silakan perbaiki tanda kurung/koma dan coba lagi.\n${(e.stderr || e.message || "").toString().slice(0, 500)}`;
      }
    }
    try { fs.rmSync(bak, { force: true }); } catch {}
    return `OK: ${existed ? "overwrote" : "created"} ${fp} (${content.length}b, ${content.split("\n").length} lines)`;
  },

  async edit_file({ path: p, old_text, new_text }) {
    const fp = assertWithinWorkspace(expand(p));
    if (!fs.existsSync(fp)) return `Error: not found: ${fp}`;
    const orig = fs.readFileSync(fp, "utf8");
    const count = orig.split(old_text).length - 1;
    if (count === 0) return `Error: old_text not found in ${fp}`;
    if (count > 1) return `Error: old_text appears ${count}x (must be unique). Add more context.`;
    const bak = fp + ".bak.tmp";
    fs.copyFileSync(fp, bak);
    fs.writeFileSync(fp, orig.replace(old_text, new_text), "utf8");
    if (fp.endsWith(".js")) {
      try {
        execSync(`node --input-type=module --check < "${fp}"`, { stdio: "pipe", cwd: path.dirname(fp) });
      } catch (e) {
        fs.copyFileSync(bak, fp);
        try { fs.rmSync(bak, { force: true }); } catch {}
        return `[GAGAL] Kode yang kamu tulis memiliki SyntaxError. Silakan perbaiki tanda kurung/koma dan coba lagi.\n${(e.stderr || e.message || "").toString().slice(0, 500)}`;
      }
    }
    try { fs.rmSync(bak, { force: true }); } catch {}
    return `OK: edited ${fp} (${old_text.length} → ${new_text.length} chars)`;
  },

  async list_dir({ path: p = ".", recursive = false }) {
    const fp = assertWithinWorkspace(expand(p));
    if (!fs.existsSync(fp)) return `Error: not found: ${fp}`;
    const out = [];
    const walk = (dir, depth) => {
      if (depth > 3) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (["node_modules", ".git", ".next", "dist", "build"].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(fp, full);
        if (e.isDirectory()) {
          out.push(`  ${rel}/`);
          if (recursive) walk(full, depth + 1);
        } else {
          out.push(`  ${rel} (${fs.statSync(full).size}b)`);
        }
      }
    };
    walk(fp, 0);
    return `Directory: ${fp}\n${out.join("\n") || "  (empty)"}`;
  },

  async search_code({ pattern, path: sp = ".", glob }) {
    const root = expand(sp);
    const args = ["-rn"];
    if (glob) args.push(`--include=${glob}`);
    args.push("--", pattern, root);
    try {
      const { stdout } = await execAsync(`grep ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`,
        { timeout: 20000, maxBuffer: 200_000, shell: SHELL });
      return stdout.slice(0, 80_000) || "(no matches)";
    } catch (e) {
      if (e.code === 1) return "(no matches)";
      return `grep error: ${e.message}`;
    }
  },

  async diff_preview({ path: p, new_content }) {
    const fp = assertWithinWorkspace(expand(p));
    const old = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : "";
    return formatDiff(fp, diffLines(old, new_content));
  },

  async refactor_multi({ pattern, replacement, glob, dry_run = true }) {
    const root = expand(".");
    let files;
    try {
      const { stdout } = await execAsync(
        `find ${root} -type f -name '${glob}' -not -path '*/node_modules/*' -not -path '*/.git/*'`,
        { timeout: 15000, shell: SHELL }
      );
      files = stdout.trim().split("\n").filter(Boolean);
    } catch { return "No files matched"; }
    const changes = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8");
        if (!content.includes(pattern)) continue;
        const count = content.split(pattern).length - 1;
        if (!dry_run) fs.writeFileSync(file, content.split(pattern).join(replacement), "utf8");
        changes.push({ file: path.relative(root, file), count });
      } catch {}
    }
    return `${dry_run ? "DRY RUN" : "APPLIED"}: ${changes.length} file(s)\n${changes.map(c => `  ${c.file} (${c.count})`).join("\n") || "(none)"}`;
  },

  async shell({ command, cwd, timeout = 60000 }, { approvalCallback, approvalMode }) {
    // 🛡️ P0-1: ALLOWLIST shell command (hard-block berbahaya)
    const ALLOWED_CMDS = new Set([
      "git", "node", "npm", "npx", "pnpm", "yarn", "bun",
      "ls", "cat", "head", "tail", "wc", "grep", "find", "diff",
      "touch", "mkdir", "cp", "mv", "ln", "chmod",
      "echo", "printf", "pwd", "which", "whoami", "date", "env", "test",
      "python3", "python", "pip", "pip3",
      "bash", "sh", "zsh",
      "tsc", "eslint", "prettier", "jest", "vitest", "mocha",
      "curl", "wget"
    ]);
    const FORBIDDEN_CMDS = new Set([
      "rm", "rmdir", "dd", "mkfs", "shred", "wipe",
      "chown", "chgrp", "sudo", "su", "passwd", "useradd", "userdel", "usermod",
      "apt", "apt-get", "yum", "dnf", "pacman", "apk",
      "kill", "pkill", "killall", "shutdown", "reboot", "halt", "poweroff",
      "iptables", "nft", "ufw", "firewall-cmd", "systemctl", "service",
      "ssh", "scp", "sftp", "nc", "ncat", "telnet", "rsync",
      "crontab", "at", "systemd-run",
      "mount", "umount", "fdisk", "parted", "losetup",
      "insmod", "modprobe", "rmmod", "sysctl",
      "eval", "exec", "source"
    ]);
    const rawCmd = String(command || "").trim();
    if (!rawCmd) return "Error: command kosong";
    let cmdToCheck = rawCmd;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmdToCheck)) {
      cmdToCheck = cmdToCheck.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^ \t\n]+[ \t\n]+/, "");
    }
    const firstWord = cmdToCheck.split(/[ \t\n;|&<>]+/)[0] || "";
    const baseCmd = firstWord.split("/").pop();
    if (FORBIDDEN_CMDS.has(baseCmd)) {
      return `❌ DIBLOKIR (P0-1): command "${baseCmd}" ada di daftar terlarang.\nDaftar terlarang: ${[...FORBIDDEN_CMDS].slice(0, 10).join(", ")}...`;
    }
    if (!ALLOWED_CMDS.has(baseCmd)) {
      return `❌ DIBLOKIR (P0-1): command "${baseCmd}" tidak ada di allowlist.\nDaftar izin: ${[...ALLOWED_CMDS].join(", ")}`;
    }
    if (/[;|&][ \t\n]*(rm|dd|mkfs|sudo|curl|wget|ssh|pkill|kill)(?:[^a-zA-Z0-9_]|$)/i.test(cmdToCheck)) {
      return `❌ DIBLOKIR (P0-1): command chain berbahaya terdeteksi (${baseCmd} ...)`;
    }
    // 🛡️ P0-1b: token/secret pattern
    if (/bot\d{8,}:[A-Za-z0-9_-]{25,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer[ \t]+[A-Za-z0-9._-]{20,}/i.test(cmdToCheck)) {
      return `❌ DIBLOKIR (P0-1b): token/API key terdeteksi di command`;
    }
    if (needsApproval(command, approvalMode) && approvalCallback) {
      const ok = await approvalCallback(command);
      if (!ok) return "Error: user denied";
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd ? expand(cwd) : process.cwd(),
        timeout, maxBuffer: 100 * 1024, shell: SHELL,
      });
      return ((stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 100_000) || "(no output)";
    } catch (e) {
      return `Exit ${e.code}:\n${(((e.stdout || "") + (e.stderr || "")) || e.message).slice(0, 80_000)}`;
    }
  },

  async install_package({ manager = "auto", packages, cwd }) {
    const cwdPath = cwd ? expand(cwd) : process.cwd();
    if (manager === "auto") {
      if (fs.existsSync(path.join(cwdPath, "package.json"))) manager = "npm";
      else if (fs.existsSync(path.join(cwdPath, "requirements.txt"))) manager = "pip";
      else manager = "npm";
    }
    const pkgs = packages.join(" ");
    const cmds = { npm: `npm install ${pkgs}`, pip: `pip install ${pkgs}`, apt: `apt install -y ${pkgs}`, pkg: `pkg install -y ${pkgs}` };
    const cmd = cmds[manager];
    if (!cmd) return `Error: unknown manager ${manager}`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: cwdPath, timeout: 180000, maxBuffer: 200 * 1024, shell: SHELL });
      return `[${manager}] ${cmd}\n${(stdout + stderr).slice(0, 50_000)}`;
    } catch (e) {
      return `[${manager}] ${cmd} failed:\n${((e.stdout || "") + (e.stderr || "")).slice(0, 50_000)}`;
    }
  },

  async run_tests({ pattern, cwd }) {
    const cwdPath = cwd ? expand(cwd) : process.cwd();
    let cmd;
    if (fs.existsSync(path.join(cwdPath, "package.json"))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwdPath, "package.json"), "utf8"));
      cmd = pattern ? `npm test -- ${pattern}` : "npm test";
    } else if (fs.existsSync(path.join(cwdPath, "pyproject.toml")) || fs.existsSync(path.join(cwdPath, "pytest.ini"))) {
      cmd = pattern ? `pytest -k ${pattern}` : "pytest";
    } else if (fs.existsSync(path.join(cwdPath, "Cargo.toml"))) {
      cmd = "cargo test";
    } else return "No test framework detected.";
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: cwdPath, timeout: 180000, maxBuffer: 200 * 1024, shell: SHELL });
      return `[${cmd}]\n${(stdout + stderr).slice(0, 80_000)}`;
    } catch (e) {
      return `[${cmd}] exit ${e.code}\n${((e.stdout || "") + (e.stderr || "")).slice(0, 80_000)}`;
    }
  },

  async parse_error({ output }) {
    return formatParsed(parseError(output));
  },

  async web_fetch({ url, max_bytes = 100_000 }, ctx) {
    try {
      const exaKey = ctx.config?.web?.exaApiKey || "";
      const text = await webFetch(url, { maxBytes: max_bytes, exaApiKey: exaKey });
      return `Fetched ${url} (${text.length}b):\n\n${text}`;
    } catch (e) { return `web_fetch error: ${e.message}`; }
  },

  async web_search({ query, limit = 8 }, ctx) {
    try {
      const exaKey = ctx.config?.web?.exaApiKey || "";
      const results = await webSearch(query, limit, exaKey);
      if (!results.length) return "(no results)";
      return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
    } catch (e) { return `web_search error: ${e.message}`; }
  },

  async todo_write({ action, task, task_id, status, priority = 3 }, ctx) {
    const s = ctx.session;
    const chatId = ctx.chatId ?? "cli";
    if (!s) return "Error: session not available";
    if (action === "add") {
      if (!task) return "Error: task required";
      return `Added todo [${s.todoAdd(chatId, task, priority)}]: ${task}`;
    }
    if (action === "update") {
      if (!task_id || !status) return "Error: task_id and status required";
      s.todoUpdate(chatId, task_id, status);
      return `Updated [${task_id}] → ${status}`;
    }
    if (action === "list") {
      const todos = s.todoList(chatId);
      return todos.length ? todos.map(t => `[${t.id}] ${t.status} — ${t.task}`).join("\n") : "(no todos)";
    }
    if (action === "clear") { s.todoClear(chatId); return "OK"; }
    return "Error: invalid action";
  },

  async memory_set({ key, value }, ctx) {
    const s = ctx.session;
    const chatId = ctx.chatId ?? "cli";
    if (!s) return "Error: no session";
    const exaKey = ctx.config?.web?.exaApiKey || "";
    const embedding = exaKey ? await getEmbedding(key + " " + value, exaKey) : null;
    s.memSet(chatId, key, value, embedding);
    return `Memory[${key}] = ${value} (${embedding ? "vectorized" : "text only"})`;
  },

  async memory_get({ key }, ctx) {
    const s = ctx.session;
    const chatId = ctx.chatId ?? "cli";
    if (!s) return "Error: no session";
    if (key) {
      const exact = s.memGet(chatId, key);
      if (exact !== null) return `Memory[${key}] = ${exact}`;
      const exaKey = ctx.config?.web?.exaApiKey || "";
      if (exaKey) {
        const queryEmb = await getEmbedding(key, exaKey);
        if (queryEmb) {
          const allMems = s.db.prepare(`SELECT key, value, embedding FROM memory WHERE chat_id = ? AND embedding IS NOT NULL`).all(chatId);
          let best = null, bestScore = -1;
          for (const m of allMems) {
            const vec = JSON.parse(m.embedding);
            let dot = 0, magA = 0, magB = 0;
            for (let i = 0; i < queryEmb.length; i++) {
              dot += queryEmb[i] * vec[i]; magA += queryEmb[i] * queryEmb[i]; magB += vec[i] * vec[i];
            }
            const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB));
            if (sim > bestScore) { bestScore = sim; best = m; }
          }
          if (best && bestScore > 0.7) return `[Semantic Match, score: ${bestScore.toFixed(2)}] Memory[${best.key}] = ${best.value}`;
        }
      }
      return `Memory[${key}] not found (exact or semantic)`;
    }
    const all = s.memList(chatId);
    return all.length ? all.map(m => `${m.key} = ${m.value}`).join("\n") : "(empty)";
  },

  async branch_save({ name, paths }) {
    const dir = path.join(BRANCH_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = [];
    for (const p of paths) {
      const fp = assertWithinWorkspace(expand(p));
      if (!fs.existsSync(fp)) continue;
      const rel = path.relative(HOME, fp);
      const dest = path.join(dir, rel.replace(/\//g, "__"));
      if (fs.statSync(fp).isDirectory()) fs.cpSync(fp, dest, { recursive: true });
      else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(fp, dest); }
      manifest.push({ rel, isDir: fs.statSync(fp).isDirectory() });
    }
    fs.writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify(manifest, null, 2));
    return `Branch '${name}': ${manifest.length} entries`;
  },

  async branch_restore({ name }) {
    const dir = path.join(BRANCH_DIR, name);
    if (!fs.existsSync(dir)) return `Error: branch '${name}' not found`;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "_manifest.json"), "utf8"));
    for (const item of manifest) {
      const src = path.join(dir, item.rel.replace(/\//g, "__"));
      const dst = path.join(HOME, item.rel);
      if (item.isDir) { fs.rmSync(dst, { recursive: true, force: true }); fs.cpSync(src, dst, { recursive: true }); }
      else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
    return `Branch '${name}' restored: ${manifest.length} entries`;
  },

  async index_codebase({ path: p = "." }) {
    const idx = getIndexer();
    const result = idx.index(expand(p));
    const stats = idx.stats();
    return `Indexed ${result.indexed}/${result.total} files\nDB: ${stats.files} files, ${stats.terms} terms`;
  },

  async search_index({ query, limit = 20 }) {
    const idx = getIndexer();
    const results = idx.search(query, limit);
    if (!results.length) return "(no results — coba index_codebase dulu)";
    return results.map(r => `${r.file} (score ${r.score}, lines: ${r.lines.join(", ")})`).join("\n");
  },

  async skill_save({ name, trigger, procedure, tags = [] }) {
    try {
      const store = getSkillStore();
      const result = store.save({ name, trigger, procedure, tags, examples: [] });
      return `✅ Skill saved: "${name}" (id: ${result.id})`;
    } catch (e) { return `Error: ${e.message}`; }
  },

  async skill_find({ task, limit = 3 }) {
    const store = getSkillStore();
    const results = store.find(task, limit);
    if (!results.length) return "(no matching skills)";
    return results.map(s => {
      const rate = s.uses ? `${s.successes}/${s.uses}` : "unused";
      return `[${s.id}] ${s.name} — ${rate}\n  Trigger: ${s.trigger}`;
    }).join("\n\n");
  },

  async skill_list() {
    const store = getSkillStore();
    const all = store.list();
    if (!all.length) return "(no skills yet)";
    const stats = store.stats();
    const lines = [`Total: ${stats.total} | Success: ${stats.totalSuccesses}/${stats.totalUses} | Failing: ${stats.failing}`, ""];
    for (const s of all) {
      const rate = s.uses ? `${Math.round(100 * s.successes / s.uses)}%` : "unused";
      lines.push(`[${s.id}] ${s.name} — ${rate}`);
    }
    return lines.join("\n");
  },

  async skill_record({ id, success }) {
    const store = getSkillStore();
    if (!store.index.skills[id]) return `Error: skill ${id} not found`;
    store.recordUse(id, success);
    return `Recorded: ${id} → ${success ? "success" : "fail"}`;
  },

  async spawn_subagent({ task, allowed_tools }, ctx) {
    if (!ctx.config) return "Error: config not available";
    const depth = (ctx.subagentDepth ?? 0) + 1;
    if (depth > (ctx.config.agent?.maxSubagentDepth ?? 2)) return "Error: max sub-agent depth reached";
    
    try {
      const result = await spawnSubagent({
        task,
        config: ctx.config,
        allowedTools: allowed_tools,
        onLog: ctx.onLog ?? (() => {}),
      });
      return result.ok ? `Sub-agent selesai:\n\n${result.result}` : `Sub-agent gagal:\n${result.result}`;
    } catch (e) {
      return `Error spawn_subagent: ${e.message}`;
    }
  },

  async think({ topic, reasoning }, ctx) {
    const session = ctx.session;
    const chatId = ctx.chatId ?? "cli";
    if (session && session.memSet) {
      try { session.memSet(chatId, `think_${Date.now()}`, `[${topic}] ${reasoning.slice(0, 500)}`); } catch {}
    }
    return `🧠 THINKING [${topic}]:\n\n${reasoning}\n\n→ Reasoning tersimpan. Lanjut eksekusi.`;
  },

  async verify({ claim, command, cwd = "." }, ctx) {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd.startsWith("/") ? cwd : expand(cwd),
        timeout: 30000, maxBuffer: 50 * 1024, shell: SHELL,
      });
      const out = ((stdout || "") + (stderr || "")).slice(0, 1000);
      return `✅ VERIFIED: ${claim}\n\nCommand: ${command}\nExit: 0\n\nOutput:\n${out || "(no output)"}`;
    } catch (e) {
      const out = (((e.stdout || "") + (e.stderr || "")) || e.message).slice(0, 1000);
      return `❌ NOT VERIFIED: ${claim}\n\nCommand: ${command}\nExit: ${e.code ?? "?"}\n\nOutput:\n${out}`;
    }
  },

  async research_topic({ topic, sources = ["arxiv", "hn"], limit = 3 }) {
    try {
      const r = await research({ topic, sources, limit });
      const kb = getKnowledge();
      let added = 0, dup = 0;
      const summary = [];

      for (const [src, items] of Object.entries(r.sources)) {
        if (!items?.length) continue;
        summary.push(`\n### ${src.toUpperCase()} (${items.length} results)`);
        for (const item of items) {
          const res = kb.add({
            topic, title: item.title,
            content: item.content, url: item.url || "", source: src,
          });
          if (res.duplicate) dup++; else added++;
          summary.push(`- ${item.title}`);
          if (item.url) summary.push(`  ${item.url}`);
        }
      }

      if (r.errors.length) summary.push(`\n⚠️ Errors: ${r.errors.join("; ")}`);
      summary.push(`\nSaved: ${added} new, ${dup} duplicate`);
      return summary.join("\n") || "(no results)";
    } catch (e) {
      return `research error: ${e.message}`;
    }
  },

  async knowledge_search({ query, limit = 5 }, ctx) {
    const kb = getKnowledge();
    const exaKey = ctx.config?.web?.exaApiKey || "";

    // Coba semantic search dulu (jika ada exaApiKey dan ada entry dengan embedding)
    if (exaKey) {
      const semantic = kb.searchSemantic(query, limit, exaKey);
      if (semantic.length) {
        return semantic.map(r => {
          const date = new Date(r.added_at).toISOString().slice(0, 10);
          return `[${date}] ${r.title} (semantic, score ${r.score.toFixed(2)})\n  ${r.content.slice(0, 300)}${r.url ? `\n  ${r.url}` : ""}`;
        }).join("\n\n");
      }
    }

    // Fallback ke keyword search
    const results = kb.search(query, limit);
    if (!results.length) return "(no knowledge found — coba research_topic dulu)";
    return results.map(r => {
      const date = new Date(r.added_at).toISOString().slice(0, 10);
      return `[${date}] ${r.title}\n  ${r.content.slice(0, 300)}${r.url ? `\n  ${r.url}` : ""}`;
    }).join("\n\n");
  },

  async fetch_calendar({ date = "today" }, ctx) {
    // ForexFactory JSON calendar (free, no key)
    const url = `https://nfs.faireconomy.media/ff_calendar_thisweek.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return `calendar error: HTTP ${res.status}`;
      const data = await res.json();
      const today = new Date().toISOString().slice(0, 10);
      const target = date === "today" ? today : date;
      const high = data.filter(e => {
        const d = (e.date || "").slice(0, 10);
        return d === target && (e.impact || "").toLowerCase().includes("high");
      });
      if (!high.length) return `Tidak ada berita high-impact pada ${target}.`;
      return high.map(e => `• ${e.time} ${e.country} — ${e.title} (${e.impact})`).join("\n");
    } catch (e) {
      return `calendar error: ${e.message}`;
    }
  },
};
