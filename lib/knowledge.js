import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export class Knowledge {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        url TEXT,
        source TEXT,
        added_at INTEGER NOT NULL,
        used_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_topic ON entries(topic);
      CREATE INDEX IF NOT EXISTS idx_added ON entries(added_at);
    `);
  }

  add({ topic, title, content, url = "", source = "manual" }) {
    // Dedup: kalau title + url sama, skip
    const existing = this.db.prepare(
      `SELECT id FROM entries WHERE title = ? AND url = ? LIMIT 1`
    ).get(title, url);
    if (existing) return { id: existing.id, duplicate: true };

    // Guard: max 1000 entries
    const count = this.db.prepare(`SELECT COUNT(*) as c FROM entries`).get().c;
    if (count >= 1000) {
      // Hapus yang paling jarang dipakai + paling lama
      this.db.prepare(`
        DELETE FROM entries WHERE id IN (
          SELECT id FROM entries ORDER BY used_count ASC, added_at ASC LIMIT 50
        )
      `).run();
    }

    const r = this.db.prepare(
      `INSERT INTO entries (topic, title, content, url, source, added_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(topic, title, content, url, source, Date.now());
    return { id: Number(r.lastInsertRowid), duplicate: false };
  }

  search(query, limit = 5) {
    const tokens = (query.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? []).slice(0, 5);
    if (!tokens.length) return [];

    // Simple keyword match di title + content
    const likeTerms = tokens.map(() => "(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)").join(" AND ");
    const params = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);
    const rows = this.db.prepare(
      `SELECT id, topic, title, content, url, source, added_at FROM entries
       WHERE ${likeTerms} ORDER BY added_at DESC LIMIT ?`
    ).all(...params, limit);

    // Increment used_count
    for (const r of rows) {
      this.db.prepare(`UPDATE entries SET used_count = used_count + 1 WHERE id = ?`).run(r.id);
    }
    return rows;
  }

  list(limit = 20) {
    return this.db.prepare(
      `SELECT id, topic, title, source, added_at FROM entries ORDER BY added_at DESC LIMIT ?`
    ).all(limit);
  }

  stats() {
    const count = this.db.prepare(`SELECT COUNT(*) as c FROM entries`).get().c;
    const topics = this.db.prepare(
      `SELECT topic, COUNT(*) as c FROM entries GROUP BY topic ORDER BY c DESC LIMIT 10`
    ).all();
    return { count, topics };
  }

  clear(topic = null) {
    if (topic) this.db.prepare(`DELETE FROM entries WHERE topic = ?`).run(topic);
    else this.db.prepare(`DELETE FROM entries`).run();
  }

  close() { this.db.close(); }
}
