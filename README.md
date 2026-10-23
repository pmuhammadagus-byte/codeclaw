# CodeClaw Pro

Coding agent untuk terminal. Jalan di Termux (Android), Ubuntu PRoot, Linux, macOS, dan WSL. Tanpa dependency NPM — cukup Node.js 22.5+.

- **27 tools** — file ops, shell, git/gh, web, code indexer, todo, memory, research, skills
- **Self-evolving** — agent menyimpan pengalaman sukses jadi skill reusable
- **Knowledge base** — riset ArXiv + Hacker News masuk SQLite, otomatis di-inject ke prompt
- **Multi-channel** — REPL terminal dan bot Telegram
- **Multi-provider** — format `models.providers`, kompatibel API OpenAI

---

## Daftar Isi

1. [Persyaratan](#persyaratan)
2. [Instalasi](#instalasi)
3. [Setup Provider LLM](#setup-provider-llm)
4. [Jalankan Agent](#jalankan-agent)
5. [Setup Telegram](#setup-telegram)
6. [Perintah CLI](#perintah-cli)
7. [Perintah REPL](#perintah-repl)
8. [27 Tools](#27-tools)
9. [Konfigurasi](#konfigurasi)
10. [Self-Evolving Skills](#self-evolving-skills)
11. [Troubleshooting](#troubleshooting)

---

## Persyaratan

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | **>= 22.5** | Wajib. Pakai `node:sqlite` built-in |
| git | any | Clone repo, versioning |
| bash | any | Untuk shell tool |
| gh CLI | any | Opsional, untuk operasi GitHub |

Cek versi:

```bash
node -v   # harus v22.5.0 atau lebih baru
```

---

## Instalasi

### Termux (Android)

Install Termux dari **F-Droid**, jangan dari Play Store (versinya usang dan tidak bisa `pkg upgrade` normal).

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs git
```

Lalu lanjut ke [langkah clone](#clone-repo).

### Ubuntu PRoot di Termux

```bash
pkg install -y proot-distro
proot-distro install ubuntu
proot-distro login ubuntu

# di dalam Ubuntu:
apt update && apt upgrade -y
apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

### Linux / macOS / WSL

Node 22.5+ lewat NodeSource (Debian/Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git
```

macOS: `brew install node git`

### Clone repo

```bash
git clone https://github.com/pmuhammadagus-byte/codeclaw.git ~/codeclaw
cd ~/codeclaw
chmod +x cli.js
```

Tidak ada `npm install` — zero dependency. Pastikan bisa jalan:

```bash
node cli.js
```

---

## Setup Provider LLM

Copy contoh config lalu isi API key:

```bash
cp config.example.json config.json
```

Struktur minimal `config.json`:

```json
{
  "models": {
    "default": "groq/llama-3.3-70b-versatile",
    "providers": {
      "groq": {
        "baseUrl": "https://api.groq.com/openai/v1",
        "apiKey": "gsk_xxx",
        "api": "openai-completions",
        "models": [
          { "id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B" }
        ]
      }
    }
  }
}
```

Referensi model selalu `provider/modelId`. Provider apa pun yang kompatibel endpoint `/chat/completions` bisa dipakai — cukup daftarkan `baseUrl` + `apiKey`.

Set model aktif:

```bash
node cli.js model list
node cli.js model set groq/llama-3.3-70b-versatile
```

Atau pakai panel interaktif:

```bash
node cli.js panel
```

---

## Jalankan Agent

```bash
node cli.js start
# atau
npm start
```

Masuk ke REPL. Ketik permintaan langsung, misalnya:

```
baca lib/tools.js lalu tambah tool baru untuk baca file JSON
```

---

## Setup Telegram

1. Buat bot lewat [@BotFather](https://t.me/BotFather), simpan token.
2. Isi config atau lewat CLI:

```bash
node cli.js channel telegram enable
node cli.js channel telegram set-token 123456:ABC-DEF...
node cli.js channel telegram allow 123456789   # Telegram user ID kamu
```

3. Jalankan:

```bash
node cli.js telegram
# atau
npm run tg
```

Ambil user ID kamu sendiri lewat [@userinfobot](https://t.me/userinfobot). Tanpa `allowedUserIds`, bot menolak semua pesan.

---

## Perintah CLI

| Perintah | Fungsi |
|---|---|
| `node cli.js` | Tampilkan help |
| `node cli.js start` | Jalankan agent (REPL) |
| `node cli.js telegram` | Jalankan bot Telegram |
| `node cli.js panel` | Panel config interaktif |
| `node cli.js model list` | Daftar model |
| `node cli.js model current` | Model aktif + detail |
| `node cli.js model set <ref>` | Ganti model aktif |
| `node cli.js model add-provider` | Tambah provider |
| `node cli.js model add-model` | Tambah model ke provider |
| `node cli.js channel telegram status` | Status channel Telegram |
| `node cli.js channel telegram enable` | Aktifkan channel |
| `node cli.js channel telegram disable` | Nonaktifkan channel |
| `node cli.js channel telegram set-token <t>` | Set bot token |
| `node cli.js channel telegram allow <id>` | Tambah user ke allowlist |
| `node cli.js channel telegram disallow <id>` | Hapus user dari allowlist |
| `node cli.js config show` | Tampilkan config (API key dimasking) |
| `node cli.js config path` | Lokasi `config.json` |
| `node cli.js config migrate` | Migrasi format config lama |
| `node cli.js research <topik>` | Riset ArXiv + HN → knowledge base |
| `node cli.js research stats` | Statistik knowledge base |
| `node cli.js cron status` | Status cron research |
| `node cli.js cron run` | Jalankan cron sekali |

---

## Perintah REPL

| Perintah | Fungsi |
|---|---|
| `/help` | Daftar perintah |
| `/clear` | Hapus riwayat chat + todo |
| `/todo` | Lihat daftar todo |
| `/mem` | Lihat memory tersimpan |
| `/skills` | Daftar skill + success rate |
| `/research <topik>` | Riset ArXiv + HN |
| `/knowledge` | Statistik knowledge base |
| `/ksearch <query>` | Cari di knowledge base |
| `/exit`, `/quit` | Keluar |

Perintah bot Telegram: `/start`, `/clear`, `/todo`, `/mem`, `/status`, `/whoami`, `/help`.

---

## 27 Tools

**File & kode**

| Tool | Fungsi |
|---|---|
| `read_file` | Baca file dengan line numbers |
| `write_file` | Tulis / overwrite file |
| `edit_file` | Replace teks unik di file |
| `list_dir` | List folder (opsional rekursif) |
| `search_code` | Grep seluruh codebase |
| `diff_preview` | Preview diff sebelum menulis |
| `refactor_multi` | Replace pola di banyak file, ada `dry_run` |

**Eksekusi & environment**

| Tool | Fungsi |
|---|---|
| `shell` | Jalankan command (cwd + timeout) |
| `install_package` | Install paket, auto-detect manager |
| `run_tests` | Jalankan test framework |
| `parse_error` | Ekstrak `file:line` dari stack trace |

**Web & riset**

| Tool | Fungsi |
|---|---|
| `web_fetch` | Ambil URL → teks |
| `web_search` | Cari di DuckDuckGo |
| `research_topic` | ArXiv + HN + GitHub trending |
| `knowledge_add` | Simpan insight ke knowledge base |
| `knowledge_search` | Cari di knowledge base |

**Indexing**

| Tool | Fungsi |
|---|---|
| `index_codebase` | Index codebase untuk pencarian cepat |
| `search_index` | Cari di index |

**State & planning**

| Tool | Fungsi |
|---|---|
| `todo_write` | Tambah / update / list / clear todo |
| `memory_set` | Simpan preferensi user |
| `memory_get` | Ambil memory |
| `branch_save` | Snapshot file sebelum edit berisiko |
| `branch_restore` | Restore snapshot |

**Self-evolving**

| Tool | Fungsi |
|---|---|
| `skill_save` | Simpan skill baru |
| `skill_find` | Cari skill relevan |
| `skill_list` | Daftar skill + success rate |
| `skill_record` | Catat hasil pakai skill (success/fail) |

---

## Konfigurasi

`config.json` punya beberapa blok utama:

```json
{
  "gateway": { "mode": "local", "httpPort": 3000 },
  "models":  { "default": "...", "providers": { } },
  "agents":  { "main": { "default": true, "model": "...", "systemPromptFile": "system.md" } },
  "channels":{ "telegram": { "enabled": false, "accounts": { } } },
  "agent": {
    "maxToolIterations": 30,
    "contextWindow": 80,
    "approvalMode": "dangerous-only",
    "maxSubagentDepth": 2,
    "maxSubagentIterations": 15
  },
  "research": { "enabled": false, "topics": [], "sources": ["arxiv", "hn"] }
}
```

- `agent.approvalMode` — `dangerous-only` minta konfirmasi hanya untuk command berisiko
- `agent.maxToolIterations` — batas loop tool call per turn
- `systemPromptFile` — file prompt sistem, default `system.md`

File yang tidak ikut ke git: `config.json`, `data.db`, `knowledge.db`, `skills/`, `.branches/`, `downloads/`.

---

## Self-Evolving Skills

Setelah task kompleks berhasil, agent bisa menyimpulkan prosedurnya jadi skill dan menyimpannya ke `skills/` (SQLite). Skill relevan otomatis dicari dan disuntik ke prompt untuk task berikutnya, jadi agent tidak mengulang kesalahan yang sama.

Kelola manual:

```bash
node cli.js start
/skills
```

Atau langsung dari shell:

```bash
node -e "import('./lib/skills.js').then(m=>{const s=new m.SkillStore();console.log(s.stats())})"
```

---

## Troubleshooting

**`SqliteError` / `node:sqlite` tidak ditemukan**
Node kamu di bawah 22.5. Upgrade: `pkg upgrade nodejs` (Termux) atau lewat NodeSource (Linux).

**Warning `ExperimentalWarning: SQLite is an experimental feature`**
Normal. Bisa diabaikan.

**`Tidak ada model`**
`config.json` belum ada atau `models.providers` kosong. Jalankan `cp config.example.json config.json` lalu isi API key, atau `node cli.js panel`.

**401 / unauthorized dari provider**
API key salah atau `baseUrl` kurang `/v1`. Cek `node cli.js model current`.

**Bot Telegram tidak merespons**
Cek `allowedUserIds` sudah berisi Telegram user ID kamu, dan `channels.telegram.enabled` bernilai `true`.

**Agent berhenti di tengah task**
Naikkan `agent.maxToolIterations` di config (default 30).

**`EACCES` saat install paket**
Jangan jalankan sebagai root kalau tidak perlu, atau pakai `install_package` dengan manager `pkg` di Termux.

---

MIT License.
