#!/bin/bash
# Safe deploy wrapper — hemat RAM, timeout, log bersih
# Dipakai CodeClaw untuk deploy TOKENOBRAL tanpa hang VPS

cd /root/tokenobral || { echo "❌ Folder tokenobral tidak ada"; exit 1; }

# Batas memori Node.js
export NODE_OPTIONS="--max-old-space-size=384"

# Cek token ada
if [ -z "$VERCEL_TOKEN" ]; then
  export VERCEL_TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN env required — export dulu}"
fi

# Deploy dengan timeout 180 detik (3 menit)
timeout 180 vercel --prod --yes --force --token "$VERCEL_TOKEN" 2>&1 | tail -20
EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 124 ]; then
  echo "❌ DEPLOY TIMEOUT (>3 menit). Kemungkinan RAM penuh."
  echo "Saran: matikan 9router sementara (tmux kill-session -t 9router-svc), lalu coba lagi"
  exit 1
elif [ $EXIT_CODE -ne 0 ]; then
  echo "❌ DEPLOY GAGAL. Exit code: $EXIT_CODE"
  exit $EXIT_CODE
else
  echo "✅ DEPLOY SUKSES"
fi
