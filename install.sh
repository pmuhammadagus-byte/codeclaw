#!/usr/bin/env bash
# CodeClaw one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/pmuhammadagus-byte/codeclaw/main/install.sh | bash
set -euo pipefail

REPO="pmuhammadagus-byte/codeclaw"
TARGET_DIR="${CODECLAW_DIR:-$HOME/codeclaw}"

# --- 1. Deteksi OS ---
detect_os() {
  if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ]; then
    echo "termux"
  elif [ "$(uname -s)" = "Darwin" ]; then
    echo "macos"
  elif [ -f /etc/os-release ]; then
    . /etc/os-release
    case "${ID:-}" in
      ubuntu) echo "ubuntu" ;;
      debian) echo "debian" ;;
      *) echo "linux" ;;
    esac
  else
    echo "linux"
  fi
}

OS=$(detect_os)
echo "Detected OS: $OS"

# --- 2. Cek Node.js ---
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v
  v=$(node -e 'console.log(process.versions.node)' 2>/dev/null || echo "0")
  # bandingkan major.minor
  local major minor
  major=$(echo "$v" | cut -d. -f1)
  minor=$(echo "$v" | cut -d. -f2)
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 5 ]; then return 0; fi
  return 1
}

if ! node_ok; then
  echo "Node.js tidak ditemukan atau versi < 22.5. Menginstall..."
  case "$OS" in
    termux)
      pkg update -y && pkg install -y nodejs
      ;;
    ubuntu|debian|linux)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
      ;;
    macos)
      if command -v brew >/dev/null 2>&1; then
        brew install node@22
      else
        echo "Homebrew tidak ditemukan. Install manual: https://nodejs.org"
        exit 1
      fi
      ;;
  esac
fi

node --version
npm --version

# --- 3. Clone repo ---
if [ -d "$TARGET_DIR/.git" ]; then
  echo "Repo sudah ada di $TARGET_DIR, pull terbaru..."
  git -C "$TARGET_DIR" pull --ff-only
else
  echo "Cloning ke $TARGET_DIR..."
  git clone "https://github.com/$REPO.git" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

# --- 4. Copy config.example.json -> config.json ---
if [ ! -f config.json ] && [ -f config.example.json ]; then
  cp config.example.json config.json
  echo "config.json dibuat dari config.example.json"
fi

# --- 5. ASCII banner + next steps ---
cat <<'BANNER'

  ██████╗ ██████╗ ██████╗ ███████╗ ██████╗██╗      █████╗ ██╗    ██╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔════╝██║     ██╔══██╗██║    ██║
 ██║     ██║   ██║██║  ██║█████╗  ██║     ██║     ███████║██║ █╗ ██║
 ██║     ██║   ██║██║  ██║██╔══╝  ██║     ██║     ██╔══██║██║███╗██║
 ╚██████╗╚██████╔╝██████╔╝███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝

  CodeClaw — Senior Software Engineer & AI Agent
BANNER

echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  npm install"
echo "  node index.js"
echo ""
echo "Edit config.json untuk API keys (Telegram, dll)."
echo "Dokumentasi: https://github.com/$REPO"
