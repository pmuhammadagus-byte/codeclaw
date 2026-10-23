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

  history(chatId, limit = 80) {
    const rows = this.db.prepare(
      `SELECT role, content, tool_calls, tool_call_id, name FROM messages
       WHERE chat_id = ? ORDER BY id DESC LIMIT ?`
    ).all(chatId, limit).reverse();
    return rows.map(r => {
      const m = { role: r.role, content: r.content ?? "" };
      if (r.tool_calls) m.tool_calls = JSON.parse(r.tool_calls);
      if (r.tool_call_id) m.tool_call_id = r.tool_call_id;
      if (r.name) m.name = r.name;
      return m;
    });
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

  memSet(chatId, key, value) {
    this.db.prepare(
      `INSERT INTO memory (chat_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(chatId, key, value, Date.now());
  }

  memGet(chatId, key) {
    return this.db.prepare(`SELECT value FROM memory WHERE chat_id = ? AND key = ?`).get(chatId, key)?.value ?? null;
  }

  memList(chatId) {
    return this.db.prepare(`SELECT key, value FROM memory WHERE chat_id = ? ORDER BY key`).all(chatId);
  }

  close() { this.db.close(); }
}
