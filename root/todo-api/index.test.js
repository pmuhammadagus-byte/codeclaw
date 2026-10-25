const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("./index.js");
const { createStore } = require("./store.js");

// ===== Helper harness =====

// Setiap suite pakai file data di tmpdir supaya file produksi tidak tersentuh.
function makeTempFile(name = "todos.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-api-test-"));
  return path.join(dir, name);
}

// Jalankan app di port acak, kembalikan {base, close}.
async function startServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

const req = (base, method, urlPath, body) =>
  fetch(base + urlPath, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

// ===== Test API (store di-inject, file sementara) =====

let base;
let closeServer;
let dataFile;

test.before(async () => {
  dataFile = makeTempFile();
  const { base: b, close } = await startServer(createApp(createStore(dataFile)));
  base = b;
  closeServer = close;
});

test.after(async () => {
  await closeServer();
});

test("GET /todos awal kosong", async () => {
  const r = await req(base, "GET", "/todos");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.length, 0);
});

test("POST /todos valid -> 201 dan title di-trim", async () => {
  const r = await req(base, "POST", "/todos", { title: "  Belajar Express  " });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.title, "Belajar Express");
  assert.strictEqual(r.body.data.completed, false);
});

test("POST /todos tanpa title -> 400", async () => {
  const r = await req(base, "POST", "/todos", {});
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.success, false);
});

test("POST /todos title kosong -> 400", async () => {
  const r = await req(base, "POST", "/todos", { title: "   " });
  assert.strictEqual(r.status, 400);
});

test("POST /todos completed non-boolean -> 400", async () => {
  const r = await req(base, "POST", "/todos", { title: "x", completed: "false" });
  assert.strictEqual(r.status, 400);
});

test("PUT /todos/:id update completed", async () => {
  const created = await req(base, "POST", "/todos", { title: "Belanja" });
  const r = await req(base, "PUT", `/todos/${created.body.data.id}`, { completed: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.completed, true);
});

test("PUT /todos/:id body kosong -> 400", async () => {
  const created = await req(base, "POST", "/todos", { title: "Kosong" });
  const r = await req(base, "PUT", `/todos/${created.body.data.id}`, {});
  assert.strictEqual(r.status, 400);
});

test("GET /todos?completed=true hanya yang selesai", async () => {
  const r = await req(base, "GET", "/todos?completed=true");
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.data.length > 0);
  assert.ok(r.body.data.every((t) => t.completed === true));
});

test("GET /todos/:id tidak ada -> 404", async () => {
  const r = await req(base, "GET", "/todos/99999");
  assert.strictEqual(r.status, 404);
});

test("GET /todos/:id format salah -> 400", async () => {
  const r = await req(base, "GET", "/todos/abc");
  assert.strictEqual(r.status, 400);
});

test("DELETE /todos/:id -> 200 lalu 404", async () => {
  const created = await req(base, "POST", "/todos", { title: "Hapus aku" });
  const id = created.body.data.id;
  const del = await req(base, "DELETE", `/todos/${id}`);
  assert.strictEqual(del.status, 200);
  const again = await req(base, "GET", `/todos/${id}`);
  assert.strictEqual(again.status, 404);
});

test("Route tak dikenal -> 404 JSON", async () => {
  const r = await req(base, "GET", "/tidak-ada");
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.success, false);
});

// ===== Test persistence =====

test("PERSIST: file JSON dibuat dan isinya sesuai state", async () => {
  const file = makeTempFile();
  const app = createApp(createStore(file));
  const { base: b, close } = await startServer(app);

  await req(b, "POST", "/todos", { title: "Satu" });
  await req(b, "POST", "/todos", { title: "Dua", completed: true });
  await close();

  assert.ok(fs.existsSync(file), "todos.json harus ada di disk");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(raw.todos.length, 2);
  assert.strictEqual(raw.todos[0].title, "Satu");
  assert.strictEqual(raw.todos[1].completed, true);
  assert.strictEqual(raw.nextId, 3);

  // Tidak boleh ada file tmp tersisa (bukti penulisan atomik selesai).
  assert.ok(!fs.existsSync(`${file}.tmp`), "file .tmp harus sudah di-rename");
});

test("PERSIST: data tetap ada setelah server restart (instance baru)", async () => {
  const file = makeTempFile();

  // --- Boot #1: tulis data ---
  const first = await startServer(createApp(createStore(file)));
  const created = await req(first.base, "POST", "/todos", { title: "Tahan restart" });
  const id = created.body.data.id;
  await req(first.base, "PUT", `/todos/${id}`, { completed: true });
  await first.close(); // server mati, memori hilang

  // --- Boot #2: proses baru baca file yang sama ---
  const second = await startServer(createApp(createStore(file)));
  const all = await req(second.base, "GET", "/todos");
  const one = await req(second.base, "GET", `/todos/${id}`);
  await second.close();

  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.body.count, 1);
  assert.strictEqual(all.body.data[0].title, "Tahan restart");
  assert.strictEqual(all.body.data[0].completed, true, "status completed harus ikut tersimpan");
  assert.strictEqual(one.status, 200);
  assert.strictEqual(one.body.data.id, id);

  // id baru lanjut dari nextId, bukan bentrok dengan data lama.
  const third = await startServer(createApp(createStore(file)));
  const next = await req(third.base, "POST", "/todos", { title: "Baru" });
  await third.close();
  assert.strictEqual(next.body.data.id, id + 1, "nextId harus lanjut setelah restart");
});

test("PERSIST: delete ikut terhapus dari disk setelah restart", async () => {
  const file = makeTempFile();
  const key = "Akan dihapus";

  const first = await startServer(createApp(createStore(file)));
  const created = await req(first.base, "POST", "/todos", { title: key });
  await req(first.base, "DELETE", `/todos/${created.body.data.id}`);
  await first.close();

  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(onDisk.todos.length, 0, "file tidak boleh menyimpan todo yang dihapus");

  const second = await startServer(createApp(createStore(file)));
  const all = await req(second.base, "GET", "/todos");
  await second.close();
  assert.strictEqual(all.body.count, 0);
});

test("PERSIST: file korup dicadangkan, server tetap jalan", async () => {
  const file = makeTempFile();
  fs.writeFileSync(file, '{ "todos": [ ini bukan json');

  const store = createStore(file);
  const { base: b, close } = await startServer(createApp(store));

  const all = await req(b, "GET", "/todos");
  assert.strictEqual(all.status, 200, "server harus tetap melayani request");
  assert.strictEqual(all.body.count, 0, "store mulai dari kosong");

  const created = await req(b, "POST", "/todos", { title: "Setelah korup" });
  assert.strictEqual(created.status, 201);
  await close();

  const dir = path.dirname(file);
  const backups = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  assert.strictEqual(backups.length, 1, "file korup harus dicadangkan tepat satu kali");

  // File baru yang valid sudah terbentuk.
  const fresh = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(fresh.todos[0].title, "Setelah korup");
});

test("PERSIST: entri rusak/duplikat di file dibuang, data valid dipertahankan", async () => {
  const file = makeTempFile();
  fs.writeFileSync(
    file,
    JSON.stringify({
      nextId: 10,
      todos: [
        { id: 1, title: "Valid", completed: false, createdAt: "2024-01-01T00:00:00.000Z" },
        { id: 1, title: "Duplikat id", completed: false },
        { id: 2, title: "", completed: false },
        { id: 3, title: "Completed bukan boolean", completed: "yes" },
        null,
        { title: "Tanpa id" },
      ],
    })
  );

  const store = createStore(file);
  const todos = store.all();

  assert.strictEqual(todos.length, 1, "hanya 1 entri valid");
  assert.strictEqual(todos[0].title, "Valid");

  const created = store.create({ title: "Baru" });
  assert.strictEqual(created.id, 10, "nextId dari file dipakai kalau lebih besar dari max id");
});

test("PERSIST: reload() membaca ulang perubahan di disk", async () => {
  const file = makeTempFile();
  const store = createStore(file);
  store.create({ title: "Dari store" });
  assert.strictEqual(store.all().length, 1);

  // Simulasikan proses lain menulis file.
  fs.writeFileSync(
    file,
    JSON.stringify({
      nextId: 50,
      todos: [{ id: 7, title: "Dari luar", completed: true }],
    })
  );

  const after = store.reload();
  assert.strictEqual(after.length, 1);
  assert.strictEqual(after[0].title, "Dari luar");
  assert.strictEqual(store.create({ title: "Lanjut" }).id, 50);
});
