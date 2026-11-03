# 🤖 CodeClaw Pro

**CodeClaw** is a lightweight, highly customizable AI Agent and Telegram Bot designed for autonomous coding, real-time trading analysis (XAU/USD), and continuous learning. It runs efficiently on low-resource VPS environments.

## ✨ Core Features

### 🧠 Cognitive Engine (20-Layer Brain)
- **Conscious Pipeline**: 20-layer reasoning to minimize hallucinations.
- **Action-Route**: Seamlessly bypasses cognitive pipeline for tool execution (coding, shell, git).
- **Zero-LLM Commands**: Crucial commands like /health and /lessons are hardcoded for instant, hallucination-free responses.

### 📊 Trading & Market Analysis (XAU/USD)
- **/gold**: 6-section ICT/SMC analysis with real-time TwelveData OHLC and EXA news integration.
- **/goldplan**: Detailed macro-to-micro trading plan enriched with live DXY and Economic Calendar events.
- **Anti-Hallucination**: Validator rejects outputs with impossible prices.

### 📚 Continuous Learning & Memory
- **Auto-Save Skills**: /learn and autonomous cron distills research into reusable skills.
- **/lessons**: View the 5 most recent long-term insights from complex tasks.
- **/mem**: Short-term session memory (key-value).

## 🚀 Commands
| Category | Commands |
|----------|----------|
| **Trading** | /gold, /goldplan |
| **Skill & Memory** | /skills, /skill, /lessons, /learn, /mem, /todo |
| **Research** | /research_methods |
| **System** | /health, /status, /doctor, /start, /help, /whoami, /clear |

## 🛠️ Tech Stack
- **Runtime**: Node.js (v22+)
- **Database**: SQLite (session & memory), Markdown files (skills)
- **LLM Provider**: OpenAI-compatible (9router, Gemini, Groq, etc.)
- **Data Providers**: TwelveData (OHLC), EXA (Search)
- **Deployment**: PM2

## 📦 Installation
1. npm install -g @cakagus/codeclaw
2. Configure config.json based on config.example.json.
3. pm2 start bin/codeclaw.js --name codeclaw-tg

## ⚠️ Security Notes
Never commit config.json to GitHub. It contains sensitive API keys.