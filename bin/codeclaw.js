#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirs, CONFIG_FILE, CONFIG_DIR, DATA_DIR } from "../lib/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const cmd = process.argv[2] || "start";

async function main() {
  ensureDirs();

  if (!fs.existsSync(CONFIG_FILE)) {
    const example = path.join(PKG_ROOT, "config.example.json");
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, CONFIG_FILE);
      console.log(`✅ Config dibuat: ${CONFIG_FILE}`);
      console.log(`   Edit dulu (isi token 9router, Telegram, dll), lalu jalankan lagi.`);
      process.exit(0);
    }
    console.error(`❌ Config tidak ada: ${CONFIG_FILE}`);
    process.exit(1);
  }

  switch (cmd) {
    case "start":
    case "telegram":
    case "tg":
      await import(path.join(PKG_ROOT, "telegram.js"));
      break;
    case "tui":
      await import(path.join(PKG_ROOT, "index.js"));
      break;
    case "skill":
      process.argv = [process.argv[0], "skill-manager", ...process.argv.slice(3)];
      await import(path.join(PKG_ROOT, "bin", "skill-manager.js"));
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(pkg.version);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`codeclaw ${pkg.version}

Usage: codeclaw [command]

Commands:
  start, tg      Start telegram bot (default)
  tui            Start TUI mode
  skill <cmd>    Manage skills (list|show|search|save|delete|stats)
  version        Show version
  help           Show this help

Config: ${CONFIG_FILE}
Data:   ${DATA_DIR}
`);
      break;
    default:
      console.error(`Unknown command: ${cmd}. Run 'codeclaw help'.`);
      process.exit(1);
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
