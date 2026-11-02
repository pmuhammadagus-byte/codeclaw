# 🤖 CodeClaw Pro

**CodeClaw** is a lightweight AI Agent and Telegram Bot for autonomous coding, real-time trading (XAU/USD), and continuous learning. It runs efficiently on low-resource VPS environments.

## ✨ Core Features
- **`/gold` & `/trade`**: 6-section ICT/SMC analysis with real-time TwelveData OHLC and EXA news.
- **Cognitive AI**: Planner -> Critic -> Fixer architecture to reduce hallucinations.
- **Continuous Learning**: Auto-save skills from `/learn` and autonomous cron.
- **Web & Research**: EXA Search, arXiv, Hacker News.

## 🚀 Commands
- **Skill & Memory**: `/skills`, `/skill`, `/lessons`, `/learn`, `/mem`, `/todo`
- **Trading**: `/trade`, `/gold`, `/goldplan`
- **Research**: `/research_methods`
- **System**: `/status`, `/whoami`, `/clear`, `/help`, `/start`

## 🛠️ Tech Stack
- Runtime: Node.js (v22+)
- Database: SQLite & Markdown files
- LLM Provider: OpenAI-compatible (9router)
- Data Providers: TwelveData, EXA
- Deployment: PM2

## 📦 Installation
1. `git clone https://github.com/pmuhammadagus-byte/codeclaw.git`
2. `cd codeclaw && npm install`
3. Configure `config.json` based on `config.example.json`
4. `pm2 start bin/codeclaw.js --name codeclaw-tg --node-args="--max-old-space-size=512"`

## 💾 Backup
Run `./scripts/backup.sh` to backup skills, memory, and config.

## ⚠️ Security Notes
Never commit `config.json` to GitHub. It contains sensitive API keys.
