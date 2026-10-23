import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "target", "__pycache__", ".venv", "venv"]);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg", ".pdf", ".zip", ".tar", ".gz", ".mp4", ".mp3", ".wasm", ".lock", ".bin", ".so", ".dylib"]);
const MAX_FILE = 200_000;

export class Indexer {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime INTEGER, size INTEGER, indexed_at INTEGER);
      CREATE TABLE IF NOT EXISTS terms (term TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL, PRIMARY KEY (term, path, line));
      CREATE INDEX IF NOT EXISTS idx_term ON terms(term);
      CREATE INDEX IF NOT EXISTS idx_path ON terms(path);
    `);
  }

  index(rootDir) {
    const root = path.resolve(rootDir);
    const files = this._walk(root);
    let count = 0;

    for (const file of files) {
      try {
        const rel = path.relative(root, file);
        const stat = fs.statSync(file);
        const existing = this.db.prepare(`SELECT mtime, size FROM files WHERE path = ?`).get(rel);
        if (existing && existing.mtime === stat.mtimeMs && existing.size === stat.size) continue;

        this.db.prepare(`DELETE FROM terms WHERE path = ?`).run(rel);
        const content = fs.readFileSync(file, "utf8").slice(0, MAX_FILE);
        const lines = content.split("\n");
        const insert = this.db.prepare(`INSERT OR IGNORE INTO terms (term, path, line) VALUES (?, ?, ?)`);
        for (let i = 0; i < lines.length; i++) {
          const tokens = lines[i].toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? [];
          const unique = [...new Set(tokens)];
          for (const t of unique) insert.run(t, rel, i + 1);
        }
        this.db.prepare(`INSERT OR REPLACE INTO files (path, mtime, size, indexed_at) VALUES (?, ?, ?, ?)`)
          .run(rel, stat.mtimeMs, stat.size, Date.now());
        count++;
      } catch {}
    }
    return { indexed: count, total: files.length, root };
  }

  _walk(dir, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) this._walk(full, out);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (SKIP_EXT.has(ext)) continue;
        try { if (fs.statSync(full).size > MAX_FILE) continue; } catch { continue; }
        out.push(full);
      }
    }
    return out;
  }

  search(query, limit = 20) {
    const tokens = (query.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []).slice(0, 5);
    if (!tokens.length) return [];
    const ph = tokens.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT path, line, term FROM terms WHERE term IN (${ph}) ORDER BY path, line`).all(...tokens);
    const scores = new Map();
    for (const r of rows) {
      const s = scores.get(r.path) ?? { count: 0, lines: new Set() };
      s.count++; s.lines.add(r.line);
      scores.set(r.path, s);
    }
    return [...scores.entries()]
      .sort((a, b) => b[1].count - a[1].count).slice(0, limit)
      .map(([file, s]) => ({ file, score: s.count, lines: [...s.lines].sort((a, b) => a - b).slice(0, 5) }));
  }

  stats() {
    return {
      files: this.db.prepare(`SELECT COUNT(*) as c FROM files`).get().c,
      terms: this.db.prepare(`SELECT COUNT(*) as c FROM terms`).get().c,
    };
  }

  close() { this.db.close(); }
}
