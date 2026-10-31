# CodeClaw Pro

AI agent terminal + Telegram bot untuk coding, trading, dan research — dengan skill system auto-upgrade.

[![npm version](https://badge.fury.io/js/@cakagus%2Fcodeclaw.svg)](https://www.npmjs.com/package/@cakagus/codeclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5.0-brightgreen)](https://nodejs.org)

## ✨ Fitur

- 🤖 **Telegram bot** — kontrol AI dari HP, tanpa buka terminal
- 🖥️ **TUI mode** — terminal interaktif untuk task kompleks
- 📊 **Trade signal XAU/USD** — analisa OHLC real-time via TwelveData
- 🔬 **Research methods** — auto-riset AI agent, trading, tools
- 📚 **Skill system** — auto-save, auto-load, auto-upgrade dari pengalaman
- ⏰ **Cron scheduler** — trade daily 09:00 WIB, research daily 03:00 WIB
- 🔒 **Security layer** — path sandbox, command allowlist, secret protection

## 🧠 Fitur Otomatis (tanpa perlu /command)

- 🎯 **Skill injection** — 2 skill paling relevan otomatis di-inject ke context LLM per pesan
- 📈 **Skill tracking** — setiap skill yang di-inject tercatat `uses`/lastUsed di `skills/_index.json`
- 🧠 **Cognitive pipeline** (`/brain high` atau `genius`) — Planner → Executor → Critic → Fixer
- 💾 **Auto-memory** — setiap task (sukses/gagal) di-reflect → disimpan ke `memory.jsonl`
- ⏰ **Auto-learning** — riset mandiri tiap 6 jam, insight baru disimpan sebagai skill


## 📦 Instalasi

### NPM (Recommended)

```bash
npm install -g @cakagus/codeclaw
codeclaw version
```

### Dari Source

```bash
git clone https://github.com/pmuhammadagus-byte/codeclaw.git
cd codeclaw
npm install
npm link
```

## 🚀 Quick Start

### 1. Setup Bot Telegram

1. Telegram → @BotFather → /newbot → copy token
2. Telegram → @userinfobot → /start → copy user ID

### 2. First Run

```bash
codeclaw tg
```

Config otomatis dibuat di `~/.config/codeclaw/config.json`. Edit dulu:

```json
{
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN",
          "allowedUserIds": [YOUR_USER_ID],
          "chatId": "YOUR_USER_ID"
        }
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "YOUR_9ROUTER_KEY"
      }
    }
  }
}
```

### 3. Jalankan

```bash
codeclaw tg
```

## 🎯 CLI Commands

| Command | Fungsi |
|---|---|
| `codeclaw start` / `codeclaw tg` | Start Telegram bot |
| `codeclaw tui` | Start TUI mode |
| `codeclaw skill <cmd>` | Manage skills |
| `codeclaw version` | Show version |
| `codeclaw help` | Show help |

### Skill Manager

```bash
codeclaw skill list
codeclaw skill show <id>
codeclaw skill search <query>
codeclaw skill stats
codeclaw skill delete <id>
```

## 💬 Telegram Commands

### Coding

| Command | Fungsi |
|---|---|
| `/skills` | List semua skill |
| `/skill <id>` | Detail skill |
| `/skill search <q>` | Cari skill |
| `/skill delete <id>` | Hapus skill |
| `/learn` | Riset + auto-save skill baru |
| `/learned` | 5 riset terakhir |
| `/memory` | 5 memory terakhir |
| `/import_memory` | Import memory dari sesi lain |
| `/clear` | Hapus history |
| `/todo` | Todo planning |
| `/status` | Status sistem |
| `/help` | Bantuan |

### Trading

| Command | Fungsi |
|---|---|
| `/trade` | Analisa XAU/USD (auto-fetch price) |
| `/trade <price>` | Analisa dengan harga manual |
| `/trade auto on\|off` | Cron daily 09:00 WIB |
| `/trade list` | 10 trade terakhir |
| `/trade stats` | Statistik BUY/SELL/WAIT |

### Research

| Command | Fungsi |
|---|---|
| `/research_methods` | Riset 3 kategori sekaligus |
| `/research_methods agent` | AI agent methods only |
| `/research_methods trading` | Trading methods only |
| `/research_methods tools` | Tools & techniques only |
| `/research_methods auto on\|off` | Cron daily 03:00 WIB |
| `/research_methods list` | 5 riset terakhir |
| `/research_methods stats` | Statistik per kategori |

## ⏰ Cron Setup (Opsional)

Setup auto-run trade + research tanpa perlu buka Telegram:

```bash
crontab -e
```

Tambah 2 baris:

```
# Trade analysis — 09:00 WIB (02:00 UTC)
0 2 * * * cd /root/codeclaw && /usr/bin/node bin/trade-auto.mjs >> logs/trade-auto.log 2>&1

# Research methods — 03:00 WIB (20:00 UTC prev day)
0 20 * * * cd /root/codeclaw && /usr/bin/node bin/research-auto.mjs >> logs/research-auto.log 2>&1
```

Aktifkan auto di Telegram:

```
/trade auto on
/research_methods auto on
```

## 🏗️ Arsitektur

```
┌──────────────┐         ┌──────────────┐
│  (user HP)   │         │  9router     │
└──────┬───────┘         │  (LLM)       │
       │                └──────┬───────┘
       ▼                       │
┌──────────────┐               │
│ codeclaw tg  │───────────────┘
│ (agent bot)  │
└──────┬───────┘
       │
       ├──► tools (file, git, web, shell)
       │
       ├──► SkillStore (auto-learn)
       │
       ├──► TwelveData (XAU/USD OHLC)
       │
       └──► Supabase (user data, optional)
```

## 📁 Struktur Data

### Config (read-only)

- `~/.config/codeclaw/config.json` — main config
- `~/.config/codeclaw/.env` — secrets (optional)

### Data (runtime)

- `~/.local/share/codeclaw/skills/` — semua skill (.md)
- `~/.local/share/codeclaw/logs/` — log files
- `~/.local/share/codeclaw/memory.jsonl` — memory pelajaran
- `~/.local/share/codeclaw/trade-log.jsonl` — riwayat trade
- `~/.local/share/codeclaw/methods-research-log.jsonl` — riwayat riset

### Legacy Mode

Kalau `~/codeclaw/config.json` (atau `/root/codeclaw/config.json`) ada, otomatis pakai lokasi itu — kompatibel dengan setup lama.

## 🔒 Security

CodeClaw punya 4 layer proteksi default:

| Layer | Fungsi |
|---|---|
| P0-1a | Block FORBIDDEN commands (rm -rf, sudo, mkfs, dll) |
| P0-1b | Allowlist commands (ls, cat, git, node, dll) |
| P0-1d | Secret protection — block sk-*, ghp_*, Bearer * di output |
| P0-2 | Path sandbox — hanya akses folder diizinkan |

Override untuk debug (tidak direkomendasikan di production):

```bash
export CODECLAW_UNSAFE=1
codeclaw tui
```

## 🔧 Environment Variables (Opsional)

Tambahkan di `~/.config/codeclaw/.env`:

```env
TWELVEDATA_API_KEY=...     # untuk auto-fetch XAU/USD
VERCEL_TOKEN=...            # deploy Vercel
GH_TOKEN=...                # GitHub CLI
SUPABASE_ACCESS_TOKEN=...   # query database
```

## 🐛 Troubleshooting

| Error | Solusi |
|---|---|
| EACCES saat install | `sudo npm install -g @cakagus/codeclaw` |
| config not found | `codeclaw help` → ikuti instruksi |
| Bot tidak respond | `pm2 logs codeclaw-tg --lines 50` |
| 409 Conflict | Hanya boleh 1 instance: `pm2 delete codeclaw-tg && pm2 start codeclaw --name codeclaw-tg -- tg` |
| better-sqlite3 error | `npm rebuild better-sqlite3` |
| EOTP publish | Pakai Granular Access Token + "Bypass 2FA" |

## 📄 License

MIT — lihat [LICENSE](LICENSE)

## 🙏 Credits

Built with:

- 9router — LLM router
- TwelveData — market data
- grammY-style Telegram API — bot framework
- Node.js 22+

---

Made with 🦞 by @cakagus