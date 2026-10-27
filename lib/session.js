import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export class Session {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT, tool_calls TEXT, tool_call_id TEXT, name TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat ON messages(chat_id, id);

      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL, task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 3,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_todo ON todos(chat_id, status);

      CREATE TABLE IF NOT EXISTS memory (
        chat_id TEXT NOT NULL, key TEXT NOT NULL,
        value TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, key)
      );
    `);
    
    // Tambah kolom embedding dengan aman
    try {
      this.db.exec("ALTER TABLE memory ADD COLUMN embedding TEXT");
    } catch (e) {
      // Kolom sudah ada, abaikan
    }
  }

  add(chatId, msg) {
    this.db.prepare(
      `INSERT INTO messages (chat_id, role, content, tool_calls, tool_call_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      chatId, msg.role, msg.content ?? null,
      msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      msg.tool_call_id ?? null, msg.name ?? null, Date.now()
    );
  }

  history(chatId, limitOrTokens = 80) {
    // 🛡️ P0-3: TOKEN-BASED history (bukan jumlah pesan)
    // Backward compat: angka kecil (<500) dianggap jumlah pesan → konversi ke token budget
    // Angka besar dianggap langsung token budget
    const MAX_TOKENS = limitOrTokens < 500 ? limitOrTokens * 250 : limitOrTokens;
    const FETCH_LIMIT = 500;   // raw rows max dari DB
    const PER_MSG_CAP = 2000;  // per pesan jangan lebih dari 2000 token (cegah 1 pesan raksasa)
    
    const rows = this.db.prepare(
      `SELECT role, content, tool_calls, tool_call_id, name FROM messages
       WHERE chat_id = ? ORDER BY id DESC LIMIT ?`
    ).all(chatId, FETCH_LIMIT).reverse();
    
    let total = 0;
    const out = [];
    for (let k = rows.length - 1; k >= 0; k--) {
      const r = rows[k];
      const payload = String(r.content || '') + String(r.tool_calls || '');
      const est = Math.min(Math.ceil(payload.length / 4), PER_MSG_CAP);
      if (total + est > MAX_TOKENS && out.length > 0) break;
      const m = { role: r.role, content: r.content ?? "" };
      if (r.tool_calls) m.tool_calls = JSON.parse(r.tool_calls);
      if (r.tool_call_id) m.tool_call_id = r.tool_call_id;
      if (r.name) m.name = r.name;
      out.unshift(m);
      total += est;
    }
    return out;
  }

  count(chatId) {
    return this.db.prepare(`SELECT COUNT(*) as c FROM messages WHERE chat_id = ?`).get(chatId)?.c ?? 0;
  }

  clear(chatId) {
    this.db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
  }

  todoAdd(chatId, task, priority = 3) {
    const r = this.db.prepare(
      `INSERT INTO todos (chat_id, task, status, priority, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`
    ).run(chatId, task, priority, Date.now(), Date.now());
    return Number(r.lastInsertRowid);
  }

  todoUpdate(chatId, id, status) {
    this.db.prepare(`UPDATE todos SET status = ?, updated_at = ? WHERE id = ? AND chat_id = ?`)
      .run(status, Date.now(), id, chatId);
  }

  todoList(chatId) {
    return this.db.prepare(`SELECT id, task, status, priority FROM todos WHERE chat_id = ? ORDER BY priority ASC, id ASC`).all(chatId);
  }

  todoClear(chatId) {
    this.db.prepare(`DELETE FROM todos WHERE chat_id = ?`).run(chatId);
  }

  memSet(chatId, key, value, embedding = null) {
    this.db.prepare(
      `INSERT INTO memory (chat_id, key, value, embedding, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, key) DO UPDATE SET value = excluded.value, embedding = excluded.embedding, updated_at = excluded.updated_at`
    ).run(chatId, key, value, embedding ? JSON.stringify(embedding) : null, Date.now());
  }

  memGet(chatId, key) {
    return this.db.prepare(`SELECT value FROM memory WHERE chat_id = ? AND key = ?`).get(chatId, key)?.value ?? null;
  }

  memList(chatId) {
    return this.db.prepare(`SELECT key, value FROM memory WHERE chat_id = ? ORDER BY key`).all(chatId);
  }

  close() { this.db.close(); }
}
