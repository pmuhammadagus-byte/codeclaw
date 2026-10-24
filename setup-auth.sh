#!/bin/bash
# Setup Auth dari Termux ke Ubuntu PRoot (CodeClaw)
# Jalankan ini SEKALI setelah install di device baru

echo "🔐 Setup Autentikasi CodeClaw (GH, Vercel, Supabase)"
echo "=================================================="

TERMUX_HOME="/data/data/com.termux/files/home"

# 1. GitHub
if [ -f "$TERMUX_HOME/.config/gh/hosts.yml" ]; then
    mkdir -p ~/.config/gh
    cp "$TERMUX_HOME/.config/gh/hosts.yml" ~/.config/gh/hosts.yml
    echo "✅ GitHub auth disalin."
else
    echo "⚠️  GitHub auth tidak ditemukan di Termux."
fi

# 2. Vercel
if [ -f "$TERMUX_HOME/.local/share/com.vercel.cli/auth.json" ]; then
    mkdir -p ~/.local/share/com.vercel.cli
    cp "$TERMUX_HOME/.local/share/com.vercel.cli/auth.json" ~/.local/share/com.vercel.cli/auth.json
    echo "✅ Vercel auth disalin."
elif [ -f "$TERMUX_HOME/.vercel/auth.json" ]; then
    mkdir -p ~/.vercel
    cp "$TERMUX_HOME/.vercel/auth.json" ~/.vercel/auth.json
    echo "✅ Vercel auth disalin (legacy path)."
else
    echo "⚠️  Vercel auth tidak ditemukan di Termux."
fi

# 3. Supabase
if [ -f "$TERMUX_HOME/.supabase/access-token" ]; then
    mkdir -p ~/.supabase
    cp "$TERMUX_HOME/.supabase/access-token" ~/.supabase/access-token
    echo "✅ Supabase auth disalin."
else
    echo "⚠️  Supabase auth tidak ditemukan di Termux."
fi

echo ""
echo "=================================================="
echo "📋 Verifikasi (pastikan tidak ada error):"
echo "gh auth status"
echo "vercel whoami"
echo "supabase projects list"
