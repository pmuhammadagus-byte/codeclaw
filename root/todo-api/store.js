const fs = require("fs");
const path = require("path");

// Lokasi default; bisa dioverride lewat env TODO_DATA_FILE (dipakai juga oleh test).
const DEFAULT_FILE = path.join(__dirname, "todos.json");

// Baris data dianggap valid hanya kalau bentuknya sesuai. Baris rusak dibuang,
// bukan bikin seluruh file dianggap korup.
function isValidTodo(t) {
  return (
    t !== null &&
    typeof t === "object" &&
    Number.isSafeInteger(t.id) &&
    t.id > 0 &&
    typeof t.title === "string" &&
    t.title.trim() !== "" &&
    typeof t.completed === "boolean"
  );
}

function normalizeTodo(t) {
  const todo = {
    id: t.id,
    title: t.title,
    completed: t.completed,
    createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
  };
  if (typeof t.updatedAt === "string") todo.updatedAt = t.updatedAt;
  return todo;
}

/**
 * Store todo berbasis file JSON.
 * - Tulis atomik: tulis ke `*.tmp` lalu rename (tidak pernah setengah jadi).
 * - File korup/tidak terbaca: dicadangkan ke `todos.json.corrupt-<timestamp>`,
 *   lalu store mulai dari kosong supaya server tetap bisa jalan.
 */
function createStore(file = DEFAULT_FILE) {
  let todos = [];
  let nextId = 1;
  let ready = false;

  function ensureDir() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  function backupCorrupt(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = `${file}.corrupt-${stamp}`;
    try {
      fs.renameSync(file, target);
      console.warn(
        `[store] File data korup (${reason}) → dicadangkan sebagai ${path.basename(target)}`
      );
    } catch (err) {
      console.warn(`[store] Gagal mencadangkan file korup: ${err.message}`);
    }
  }

  function load() {
    ready = true;
    todos = [];
    nextId = 1;

    if (!fs.existsSync(file)) return;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      backupCorrupt(err.message);
      return;
    }

    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.todos)) {
      backupCorrupt("struktur tidak valid (harus { nextId, todos: [] })");
      return;
    }

    const seen = new Set();
    todos = parsed.todos.filter(isValidTodo).filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).map(normalizeTodo);

    const maxId = todos.reduce((max, t) => Math.max(max, t.id), 0);
    nextId =
      Number.isSafeInteger(parsed.nextId) && parsed.nextId > maxId ? parsed.nextId : maxId + 1;
  }

  function save() {
    ensureDir();
    const tmp = `${file}.tmp`;
    const payload = `${JSON.stringify({ nextId, todos }, null, 2)}\n`;

    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd); // pastikan benar-benar tersentuh disk sebelum rename
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file); // atomik dalam filesystem yang sama
  }

  function init() {
    if (!ready) load();
  }

  return {
    file,

    /** Paksa baca ulang dari disk (dipakai test). */
    reload() {
      load();
      return todos;
    },

    all() {
      init();
      return todos;
    },

    find(id) {
      init();
      return todos.find((t) => t.id === id) || null;
    },

    create({ title, completed }) {
      init();
      const todo = {
        id: nextId++,
        title,
        completed: completed === true,
        createdAt: new Date().toISOString(),
      };
      todos.push(todo);
      save();
      return todo;
    },

    update(id, patch) {
      init();
      const todo = this.find(id);
      if (!todo) return null;

      if (patch.title !== undefined) todo.title = patch.title;
      if (patch.completed !== undefined) todo.completed = patch.completed;
      todo.updatedAt = new Date().toISOString();

      save();
      return todo;
    },

    remove(id) {
      init();
      const index = todos.findIndex((t) => t.id === id);
      if (index === -1) return null;
      const [deleted] = todos.splice(index, 1);
      save();
      return deleted;
    },
  };
}

module.exports = { createStore, DEFAULT_FILE };
