import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const HOME = os.homedir();

// Legacy mode (dev): config ada di ~/codeclaw/config.json
// NPM mode: config di ~/.config/codeclaw, data di ~/.local/share/codeclaw
const LEGACY_CONFIG = path.join(HOME, "codeclaw", "config.json");
const LEGACY_ROOT = path.join(HOME, "codeclaw");
const USE_LEGACY = fs.existsSync(LEGACY_CONFIG);

export const CONFIG_DIR = process.env.CODECLAW_CONFIG_DIR
  || (USE_LEGACY ? LEGACY_ROOT : path.join(HOME, ".config", "codeclaw"));

export const DATA_DIR = process.env.CODECLAW_DATA_DIR
  || (USE_LEGACY ? LEGACY_ROOT : path.join(HOME, ".local", "share", "codeclaw"));

export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const ENV_FILE = path.join(CONFIG_DIR, ".env");
export const SKILLS_DIR = path.join(DATA_DIR, "skills");
export const SKILLS_INDEX = path.join(SKILLS_DIR, "_index.json");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const MEMORY_FILE = path.join(DATA_DIR, "memory.jsonl");
export const LEARNING_LOG = path.join(DATA_DIR, "learning-log.jsonl");
export const TRADE_LOG = path.join(DATA_DIR, "trade-log.jsonl");
export const METHODS_LOG = path.join(DATA_DIR, "methods-research-log.jsonl");
export const TRADE_STATE = path.join(DATA_DIR, ".trade-state.json");
export const METHODS_STATE = path.join(DATA_DIR, ".methods-research-state.json");
export const AGENT_SKILLS_DIR = path.join(DATA_DIR, ".agents", "skills");

export const IS_LEGACY = USE_LEGACY;

export function ensureDirs() {
  for (const d of [CONFIG_DIR, DATA_DIR, SKILLS_DIR, LOGS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
export const LEARNING_STATE = path.join(DATA_DIR, ".learning-state.json");
