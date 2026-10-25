const express = require("express");
const { createStore, DEFAULT_FILE } = require("./store");

const PORT = process.env.PORT || 3000;

// ===== Helper =====
// Mengembalikan id integer positif, atau null kalau format tidak valid.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateTitle(title) {
  if (title === undefined) return "Title wajib diisi";
  if (typeof title !== "string") return "Title harus berupa string";
  if (title.trim() === "") return "Title tidak boleh kosong";
  return null;
}

/**
 * Factory app. Store di-inject supaya route bisa dites tanpa menyentuh
 * file data produksi.
 */
function createApp(store = createStore(process.env.TODO_DATA_FILE || DEFAULT_FILE)) {
  const app = express();
  app.use(express.json());

  // ===== GET /todos - Read All =====
  app.get("/todos", (req, res) => {
    const { completed } = req.query;
    let data = store.all();

    if (completed !== undefined) {
      if (completed !== "true" && completed !== "false") {
        return res
          .status(400)
          .json({ success: false, error: "Query 'completed' hanya boleh true/false" });
      }
      const flag = completed === "true";
      data = data.filter((t) => t.completed === flag);
    }

    res.status(200).json({ success: true, data, count: data.length });
  });

  // ===== GET /todos/:id - Read One =====
  app.get("/todos/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, error: "ID tidak valid" });
    }

    const todo = store.find(id);
    if (!todo) {
      return res.status(404).json({ success: false, error: "Todo tidak ditemukan" });
    }

    res.status(200).json({ success: true, data: todo });
  });

  // ===== POST /todos - Create =====
  app.post("/todos", (req, res) => {
    const body = req.body || {};
    const error = validateTitle(body.title);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    if (body.completed !== undefined && typeof body.completed !== "boolean") {
      return res
        .status(400)
        .json({ success: false, error: "Field 'completed' harus boolean" });
    }

    const todo = store.create({
      title: body.title.trim(),
      completed: body.completed === true,
    });
    res.status(201).json({ success: true, data: todo });
  });

  // ===== PUT /todos/:id - Update =====
  app.put("/todos/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, error: "ID tidak valid" });
    }

    if (!store.find(id)) {
      return res.status(404).json({ success: false, error: "Todo tidak ditemukan" });
    }

    const body = req.body || {};
    if (body.title === undefined && body.completed === undefined) {
      return res.status(400).json({
        success: false,
        error: "Minimal kirim 'title' atau 'completed' untuk diupdate",
      });
    }

    const patch = {};
    if (body.title !== undefined) {
      const error = validateTitle(body.title);
      if (error) {
        return res.status(400).json({ success: false, error });
      }
      patch.title = body.title.trim();
    }

    if (body.completed !== undefined) {
      if (typeof body.completed !== "boolean") {
        return res
          .status(400)
          .json({ success: false, error: "Field 'completed' harus boolean" });
      }
      patch.completed = body.completed;
    }

    res.status(200).json({ success: true, data: store.update(id, patch) });
  });

  // ===== DELETE /todos/:id - Delete =====
  app.delete("/todos/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, error: "ID tidak valid" });
    }

    const deleted = store.remove(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Todo tidak ditemukan" });
    }

    res
      .status(200)
      .json({ success: true, data: deleted, message: "Todo berhasil dihapus" });
  });

  // ===== 404 handler (JSON, bukan HTML) =====
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`,
    });
  });

  // ===== Error handler (mis. body JSON rusak) =====
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ success: false, error: "Body JSON tidak valid" });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Internal server error" });
  });

  return app;
}

const app = createApp();

// ===== Bootstrap =====
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Todo API berjalan di http://localhost:${PORT}`);
    console.log(`Data tersimpan di ${process.env.TODO_DATA_FILE || DEFAULT_FILE}`);
  });
}

module.exports = app;
module.exports.createApp = createApp;
