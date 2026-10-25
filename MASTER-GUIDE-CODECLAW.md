# 📘 MASTER GUIDE ULTIMATE: CodeClaw VPS
> Panduan super lengkap dari beli VPS kosong sampai bot AI berjalan 24/7.
> Terakhir diupdate: 25 Oktober 2026

---

# 📑 DAFTAR ISI
1. Prasyarat & Akun yang Dibutuhkan
2. Cara Dapat Semua API Key
3. Setup VPS Baru dari Nol
4. Setup Tailscale (Android + VPS)
5. Setup 9Router (Otak AI)
6. Setup CodeClaw
7. Konfigurasi via Panel.js
8. Menjalankan Bot 24/7
9. Optimasi RAM & Keamanan
10. Perintah Harian (Cheat Sheet)
11. Update & Push ke GitHub
12. Backup & Recovery
13. Troubleshooting Lengkap
14. Referensi Penting

---

# 1️⃣ PRASYARAT & AKUN YANG DIBUTUHKAN

## 1.1 Akun Wajib
- [ ] **VPS** (RAM minimal 1GB, OS Ubuntu 22/24) - beli di Hetzner, Contabo, DigitalOcean, Vultr
- [ ] **Akun GitHub** - https://github.com/signup
- [ ] **Bot Telegram** - dibuat di @BotFather
- [ ] **Akun Tailscale** - https://login.tailscale.com (login pakai Google)

## 1.2 Akun Opsional (untuk fitur tambahan)
- [ ] **Exa AI** (Web Search + Vector Memory) - https://dashboard.exa.ai
- [ ] **Groq** (Voice Note) - https://console.groq.com
- [ ] **Kiro/OpenCode** (provider LLM gratis di 9Router)
- [ ] **Vercel** (deploy website) - https://vercel.com
- [ ] **Supabase** (database) - https://supabase.com

## 1.3 Aplikasi di HP
- [ ] **Termux** (dari F-Droid, BUKAN Play Store)
- [ ] **Telegram**
- [ ] **Tailscale** (dari Play Store / APK)

---

# 2️⃣ CARA DAPAT SEMUA API KEY

## 2.1 Bot Telegram (@BotFather)
1. Buka Telegram, cari **@BotFather**
2. Ketik `/newbot`
3. Isi nama bot (contoh: `CodeClaw`)
4. Isi username (harus berakhiran `bot`, contoh: `myclaw_bot`)
5. Copy token: `7123456789:AAHxxxxxx...`
6. **Simpan token ini.**

## 2.2 Exa AI (Web Search + Vector Memory)
1. Buka https://dashboard.exa.ai
2. Login pakai Google
3. Klik **API Keys** di sidebar
4. Klik **Create API Key**
5. Copy key (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
6. **Kuota gratis:** $10/bulan (~2500 pencarian)

## 2.3 Groq (Voice Note Transcription)
1. Buka https://console.groq.com/keys
2. Login pakai Google
3. Klik **Create API Key**
4. Copy key (format: `gsk_xxxxxx...`)
5. **Kuota gratis:** 14.400 request/hari

## 2.4 Provider LLM di 9Router
Setelah 9Router jalan (bagian 5), buka dashboard 9Router dan connect:
- **Kiro AI** (gratis): OAuth, ~50 credits/bulan, akses Claude/Gemini
- **OpenCode Free** (gratis): no auth, akses model gratis
- **Bandelbanget** (paid): API key `sk-qwen-...`, quota harian
- **DeepSeek** (paid murah): API key dari platform.deepseek.com

---

# 3️⃣ SETUP VPS BARU DARI NOL

## 3.1 Login SSH Pertama Kali
Dari Termux:
    ssh root@IP_VPS -p PORT_SSH
    # Ketik password dari provider VPS Anda

## 3.2 Update & Install Dependensi Dasar
    apt update && apt upgrade -y
    apt install -y git tmux curl wget nano ufw fail2ban

## 3.3 Install Node.js 22
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
    node -v   # Harus v22.x

## 3.4 Install Docker
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    docker --version

## 3.5 Buat Swap 2GB (WAJIB untuk RAM 1GB)
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
    free -h   # Pastikan Swap 2GB muncul

## 3.6 Setup Firewall (Keamanan)
    ufw allow 22/tcp
    ufw allow 27700/tcp
    ufw --force enable
    ufw status

## 3.7 Setup GitHub CLI
    (type -p wget >/dev/null || (apt update && apt-get install wget -y)) \
      && mkdir -p -m 755 /etc/apt/keyrings \
      && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
      && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
      && apt update && apt install gh -y

    gh auth login
    # Pilih: GitHub.com -> HTTPS -> Yes -> Login with web browser
    # Copy kode 8 digit, buka https://github.com/login/device di HP
    # Paste kode -> Authorize -> Kembali ke VPS

    git config --global user.name "USERNAME_GITHUB_ANDA"
    git config --global user.email "USERNAME_GITHUB_ANDA@users.noreply.github.com"

---

# 4️⃣ SETUP TAILSCALE (ANDROID + VPS)

## 4.1 Install Tailscale di Android
1. Buka Play Store, cari **Tailscale**
2. Install, buka app
3. Login pakai Google
4. Aktifkan VPN (toggle di app)

## 4.2 Install Tailscale di VPS
    curl -fsSL https://tailscale.com/install.sh | sh
    tailscale up
    # Akan muncul link: https://login.tailscale.com/a/xxxxx
    # Copy link, buka di browser HP
    # Login pakai akun Google yang SAMA -> Authorize

## 4.3 Catat IP Tailscale VPS
    tailscale ip -4
    # Contoh output: 100.78.237.39
    # CATAT IP INI!

## 4.4 Uji Akses
Dari Termux HP:
    ssh root@100.78.237.39 -p 27700
    # Jika bisa masuk = Tailscale sukses!

---

# 5️⃣ SETUP 9ROUTER (OTAK AI)

## 5.1 Jalankan Container
    docker run -d \
      --name 9router \
      --restart unless-stopped \
      --network host \
      -v "$HOME/.9router:/app/data" \
      -e DATA_DIR=/app/data \
      -e INITIAL_PASSWORD="PASSWORD_BARU_ANDA" \
      decolua/9router:latest

## 5.2 Tunggu Boot & Cek
    sleep 15
    docker ps | grep 9router
    curl -s http://127.0.0.1:20128/v1/models | head -c 200
    # Jika muncul JSON = OK

## 5.3 Akses Dashboard dari HP
Pastikan Tailscale di HP aktif, lalu buka browser:
    http://100.78.237.39:20128
    # Login dengan password yang Anda set di 5.1

## 5.4 Connect Provider di Dashboard
1. Menu **Providers** di sidebar
2. Klik **Connect** pada:
   - **Kiro AI** (OAuth, gratis) - direkomendasikan
   - **OpenCode Free** (no auth, gratis)
   - Atau tambah **OpenCode/Bandelbanget** dengan API key
3. Setelah connected, menu **Models** akan menampilkan daftar model

## 5.5 Generate API Key 9Router
1. Menu **API Keys** di dashboard
2. Klik **Create Key**
3. Copy key (contoh: `sk-2445356914...`)
4. **Simpan!** Akan dipakai CodeClaw

## 5.6 Jika Lupa/Reset Password
    docker stop 9router && docker rm 9router
    docker run -d --name 9router --restart unless-stopped --network host \
      -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data \
      -e INITIAL_PASSWORD="PASSWORD_BARU" decolua/9router:latest

---

# 6️⃣ SETUP CODECLAW

## 6.1 Clone Repo
    cd ~
    git clone https://github.com/pmuhammadagus-byte/codeclaw.git
    cd codeclaw

## 6.2 Buat Config (Pilih Salah Satu)

**A. Jika Anda Pengguna Baru / Forker:**
Copy dari template, lalu isi manual via panel (Langkah 7).
    cp config.example.json config.json

**B. Jika Anda Melakukan Recovery VPS Sendiri:**
Unduh langsung dari Secret Gist Anda (lewati Langkah 7).
    curl -o config.json "URL_RAW_GIST_CONFIG_ANDA"
    node cli.js model current # Verifikasi

## 6.3 Install Dependensi Node
    npm install

## 6.4 Verifikasi Struktur
    ls -la
    # Harus ada: config.json, IDENTITY.md, SOUL.md, system.md, telegram.js, index.js, panel.js, lib/

---

# 7️⃣ KONFIGURASI VIA PANEL
> ⚠️ **CATATAN:** Langkah ini HANYA untuk Pengguna Baru / Forker yang menggunakan `config.example.json`. 
> Jika Anda melakukan recovery dari Gist (Langkah 6.2 B), Anda bisa LANGSUNG MELOMPAT ke Langkah 8.

## 7.1 Buka Panel
    cd ~/codeclaw
    node panel.js

## 7.2 Menu 1: Model
- Tekan **[1]** -> Masuk ke Model settings
- Tekan **[2]** -> Add provider
  - Provider ID: `9router`
  - Base URL: `http://127.0.0.1:20128/v1`
  - API Key: (dari langkah 5.5)
- Tekan **[3]** -> Add model to provider
  - Provider ID: `9router`
  - Model ID: `kc/kilo-auto/free` (atau `kc/deepseek/deepseek-chat`)
- Tekan **[1]** -> Set active model -> pilih `9router/kc/kilo-auto/free`
- Tekan **[b]** -> Back

## 7.3 Menu 2: Telegram
- Tekan **[2]** -> Masuk Telegram channel
- Tekan **[1]** -> Enable telegram channel
- Tekan **[2]** -> Set bot token (paste dari @BotFather)
- Tekan **[3]** -> Allow user (masukkan ID Telegram Anda)
- Tekan **[b]** -> Back
- **Cara dapat ID Telegram:** Kirim `/start` ke bot `@userinfobot`, akan dibalas ID Anda

## 7.4 Menu 3: Agent Settings
- Tekan **[3]** -> Masuk Agent settings
- **Max iterations:** 60 (untuk tugas kompleks)
- **Brain level:** `genius` (paling pintar)
- **Approval mode:** `dangerous-only` (aman)
- Tekan **[b]** -> Back

## 7.5 Menu 5: Web Search (Exa)
- Tekan **[5]** -> Masuk Web Search
- Tekan **[1]** -> Set Exa API Key (paste dari dashboard.exa.ai)
- Tekan **[b]** -> Back

## 7.6 Menu 6: Audio (Groq)
- Tekan **[6]** -> Masuk Audio & Voice
- Tekan **[1]** -> Set Groq API Key (paste dari console.groq.com)
- Tekan **[b]** -> Back

## 7.7 Keluar Panel
- Tekan **[q]** -> Quit

## 7.8 Verifikasi Config
    node cli.js model current
    node cli.js channel telegram status
    # Semua harus OK

---

# 8️⃣ MENJALANKAN BOT 24/7

## 8.1 Jalankan di tmux
    tmux new-session -d -s codeclaw
    tmux send-keys -t codeclaw 'cd ~/codeclaw && node telegram.js > telegram.log 2>&1' C-m
    sleep 3
    tail -n 10 ~/codeclaw/telegram.log
    # Harus muncul: Bot: @username | Brain: ... | PID xxx

## 8.2 Keluar dari tmux (Bot tetap jalan)
Tekan: **Ctrl+B**, lepas, lalu **D**

## 8.3 Auto-Start saat VPS Reboot
    cat > /root/start-codeclaw.sh << 'SCRIPT'
    #!/bin/bash
    sleep 15
    tmux new-session -d -s codeclaw
    tmux send-keys -t codeclaw 'cd /root/codeclaw && node telegram.js > telegram.log 2>&1' C-m
    SCRIPT
    chmod +x /root/start-codeclaw.sh
    (crontab -l 2>/dev/null; echo "@reboot /root/start-codeclaw.sh") | crontab -
    crontab -l | grep codeclaw   # Verifikasi

---

# 9️⃣ OPTIMASI RAM & KEAMANAN

## 9.1 Verifikasi Swap
    free -h
    swapon --show

## 9.2 Batasi RAM Node.js (Opsional)
Edit `/root/start-codeclaw.sh`, tambahkan:
    tmux send-keys -t codeclaw 'export NODE_OPTIONS="--max-old-space-size=384"; cd /root/codeclaw && node telegram.js > telegram.log 2>&1' C-m

## 9.3 Fail2ban (Cegah Brute Force SSH)
    systemctl enable fail2ban
    systemctl start fail2ban
    fail2ban-client status

## 9.4 Log Rotation (Cegah Disk Penuh)
    cat > /etc/logrotate.d/codeclaw << 'EOF'
    /root/codeclaw/telegram.log {
        daily
        rotate 7
        compress
        missingok
        notifempty
        copytruncate
    }
    EOF

---

# 🔟 PERINTAH HARIAN (CHEAT SHEET)

## Masuk VPS
    ssh root@100.78.237.39 -p 27700

## Lihat Log Bot
    tail -f ~/codeclaw/telegram.log

## Masuk Layar Bot
    tmux attach -t codeclaw
    # Ctrl+B lalu D untuk keluar

## Restart Bot
    tmux kill-server 2>/dev/null
    pkill -9 -f "node telegram.js" 2>/dev/null
    sleep 2
    tmux new-session -d -s codeclaw
    tmux send-keys -t codeclaw 'cd ~/codeclaw && node telegram.js > telegram.log 2>&1' C-m
    sleep 3
    tail -n 5 telegram.log

## Cek Semua Layanan
    echo "=== Bot ===" && pgrep -af "node telegram.js"
    echo "=== 9Router ===" && docker ps | grep 9router
    echo "=== Tailscale ===" && tailscale status | head -n 3
    echo "=== RAM ===" && free -h

## Cek 9Router Hidup
    curl -s http://127.0.0.1:20128/v1/models | head -c 100

## Restart 9Router
    docker restart 9router

## Ganti Model
    cd ~/codeclaw
    node cli.js model set 9router/kc/kilo-auto/free
    # Atau model lain: 9router/kc/deepseek/deepseek-chat
    # Restart bot setelahnya

## Buka Dashboard 9Router dari HP
    http://100.78.237.39:20128

## Cek Disk Space
    df -h

## Cek Log Ukuran
    du -sh ~/codeclaw/*.log

---

# 1️⃣1️⃣ UPDATE & PUSH KE GITHUB

## 11.1 Alur Edit-Push
    cd ~/codeclaw
    chmod -R u+w *.js *.md lib/*.js *.sh *.json

    # (Lakukan edit)
    nano system.md

    # Cek apa yang berubah
    git status

    # Push
    git add -A
    git commit -m "update: keterangan perubahan"
    git push origin main

    # Lock balik
    chmod 444 *.js *.md lib/*.js *.sh
    chmod 644 config.json

## 11.2 Pull Update (jika edit dari tempat lain)
    cd ~/codeclaw
    chmod -R u+w *.js *.md lib/*.js
    git pull origin main
    chmod 444 *.js *.md lib/*.js

## 11.3 Push dari HP (Termux)
Masuk Ubuntu HP:
    proot-distro login ubuntu
    cd ~/codeclaw
    chmod -R u+w *.js *.md lib/*.js
    git add -A && git commit -m "update" && git push origin main
    chmod 444 *.js *.md lib/*.js

---

# 1️⃣2️⃣ BACKUP & RECOVERY

## 12.1 Backup Config ke Gist (Rahasia)
    cd ~/codeclaw
    gh gist create config.json --desc "Backup Config CodeClaw"

## 12.2 Backup Full CodeClaw (ke HP)
Dari Termux HP:
    ssh root@100.78.237.39 -p 27700 "cd ~/codeclaw && tar czf - --exclude='node_modules' ." > ~/codeclaw-backup.tar.gz

## 12.3 Backup ke GitHub (Otomatis)
    cd ~/codeclaw
    git add -A && git commit -m "backup $(date +%Y%m%d)" && git push

## 12.4 Recovery dari Gist (Untuk Anda Sendiri)
Jika VPS rusak dan Anda sudah melakukan `git clone`, tapi belum punya `config.json`:
    cd ~/codeclaw
    curl -o config.json "URL_RAW_GIST_CONFIG"
    node cli.js model current # Pastikan model sudah benar
    tmux new-session -d -s codeclaw
    tmux send-keys -t codeclaw 'node telegram.js > telegram.log 2>&1' C-m
    cd ~/codeclaw
    curl -o config.json "URL_RAW_GIST_CONFIG"
    # Lalu restart bot

## 12.5 Recovery VPS Rusak / Hapus Total
Ikuti ulang bagian 3 s/d 8 dari awal (30 menit):
1. SSH ke VPS baru
2. Setup dasar (bagian 3)
3. Tailscale (bagian 4)
4. Docker + 9Router (bagian 5)
5. Clone repo + restore config dari Gist (bagian 6)
6. Jalankan bot (bagian 8)

---

# 1️⃣3️⃣ TROUBLESHOOTING LENGKAP

## 13.1 Bot Tidak Merespons
    # 1. Cek proses
    pgrep -af "node telegram.js"

    # 2. Cek log
    tail -n 30 ~/codeclaw/telegram.log

    # 3. Cek isi tmux (error yang tidak tercatat di log)
    tmux attach -t codeclaw

    # 4. Cek 9Router
    curl -s http://127.0.0.1:20128/v1/models | head -c 100

    # 5. Restart semuanya
    docker restart 9router
    tmux kill-server
    /root/start-codeclaw.sh

## 13.2 AI Menjawab Quotes Bahasa Inggris
**Penyebab:** Provider murahan (bandelbanget) mengabaikan `system.md` dan route ke model bodoh.
**Solusi:**
    cd ~/codeclaw
    node cli.js model set 9router/kc/deepseek/deepseek-chat
    # Restart bot

## 13.3 Error "fetch failed" / "SSL Wrong Version"
**Penyebab:** Jaringan HP memblokir SSL ke Telegram API.
**Solusi:** Pindahkan bot ke VPS (sudah dilakukan). Jika masih muncul di VPS:
    # Cek DNS
    getent hosts api.telegram.org
    # Jika hanya IPv6, tambahkan ke /etc/hosts
    cat >> /etc/hosts << 'EOF'
    149.154.167.220 api.telegram.org
    149.154.167.221 api.telegram.org
    EOF

## 13.4 RAM Penuh / VPS Hang
    free -h
    swapon --show
    # Jika Swap tidak aktif
    swapon /swapfile
    # Kalau belum ada, buat swap (lihat bagian 3.5)

## 13.5 VPS Reboot, Bot Tidak Hidup
    # Cek crontab
    crontab -l | grep codeclaw
    # Jalankan manual
    /root/start-codeclaw.sh
    # Jika crontab hilang, daftar ulang (bagian 8.3)

## 13.6 Lupa Password 9Router
Lihat bagian 5.6.

## 13.7 Kode Rusak Setelah Edit
    cd ~/codeclaw
    git reset --hard origin/main
    # File kembali ke versi GitHub

## 13.8 Error "Provider tidak ada" di Panel
    # Cek config
    grep -A3 '"9router"' ~/codeclaw/config.json
    # Kalau kosong, tambah manual via nano atau ulangi bagian 7.2

## 13.9 CodeClaw Jawab Bahasa Lain Padahal system.md Sudah Indonesia
    # Cek isi IDENTITY.md
    cat ~/codeclaw/IDENTITY.md
    # Pastikan ada baris "WAJIB Bahasa Indonesia"
    # Cek IDENTITY.md masuk ke system prompt
    grep -A5 'loadFileIfExists' ~/codeclaw/telegram.js

## 13.10 Lupa IP Tailscale
    tailscale ip -4

## 13.11 Bot kirim pesan aneh / private key
**Penyebab:** Bot menjalankan perintah SSH dan menampilkan output mentah.
**Solusi:** Lihat bagian aturan di `system.md`, hapus pesan di Telegram.
**Preventif:** Di `system.md` sudah ada aturan "JANGAN tampilkan Private Key".

## 13.12 Telegram Error "Conflict" (Bot Double)
    # Bot lama masih jalan di HP
    pkill -9 -f "node telegram.js"   # Di HP
    # Atau matikan bot di HP via Termux

## 13.13 Docker Error LXC (sysctl ip_unprivileged)
**Penyebab:** Bug containerd di LXC container.
**Solusi:**
    apt install -y --allow-downgrades containerd.io=1.7.28-1~ubuntu.24.04~noble
    apt-mark hold containerd.io
    systemctl restart docker
    docker start 9router

## 13.14 VPS Lemot Parah
    # Cek proses pemakan RAM/CPU
    top -bn1 | head -n 20
    # Cek disk
    df -h
    # Cek Docker
    docker stats --no-stream

## 13.15 Kode Error Saat npm install
    cd ~/codeclaw
    rm -rf node_modules package-lock.json
    npm install

## 13.16 9Router Dashboard Error 401 (Invalid API Key)
**Penyebab:** API key di config.json salah.
**Solusi:**
    # Test langsung
    curl -s http://127.0.0.1:20128/v1/models \
      -H "Authorization: Bearer API_KEY_ANDA"
    # Jika 401, generate key baru di dashboard 9Router
    # Update config via panel atau nano

---

# 1️⃣4️⃣ REFERENSI PENTING

## Link
- **Repo:** https://github.com/pmuhammadagus-byte/codeclaw
- **9Router Docs:** https://github.com/decolua/9router
- **Exa Dashboard:** https://dashboard.exa.ai
- **Groq Console:** https://console.groq.com
- **Tailscale Admin:** https://login.tailscale.com/admin/machines

## Data VPS
- **IP Tailscale VPS:** 100.78.237.39
- **Port SSH:** 27700
- **Port 9Router:** 20128
- **Path CodeClaw:** /root/codeclaw
- **Log Bot:** /root/codeclaw/telegram.log

## Struktur File
    /root/codeclaw/
    ├── config.json          # RAHASIA - API keys & tokens
    ├── IDENTITY.md          # Nama & bahasa
    ├── SOUL.md              # Karakter & etika
    ├── system.md            # Aturan teknis
    ├── MASTER-GUIDE-CODECLAW.md
    ├── README.md
    ├── package.json
    ├── install.sh
    ├── setup-auth.sh
    ├── telegram.js          # Bot entry point
    ├── index.js             # CLI entry point
    ├── panel.js             # Config panel
    ├── cli.js               # CLI utilities
    ├── data.db              # Chat history
    ├── knowledge.db         # RAG knowledge
    ├── skills/              # Auto-generated skills
    ├── downloads/           # Files dari Telegram
    └── lib/                 # Core modules
        ├── llm.js
        ├── tools.js
        ├── session.js
        ├── safety.js
        ├── web.js
        ├── telegram-api.js
        └── ... (30+ modules)

---

# 🚨 ATURAN EMAS

1. **JANGAN PERNAH** push `config.json` ke GitHub public.
2. **JANGAN PERNAH** buka lock (`chmod 444`) kecuali mau edit.
3. **SELALU** restart bot setelah ubah config.
4. **SELALU** backup config ke Gist setelah set API key baru.
5. **SELALU** pakai Tailscale untuk akses remote (jangan IP publik).
6. **SELALU** cek `free -h` kalau VPS terasa lambat.
7. **JANGAN** jalankan bot di HP dan VPS bersamaan (bikin "Conflict").
8. **JANGAN** kirim private key / token ke bot.
9. **SELALU** update model kalau bot jawab ngaco.
10. **SELALU** simpan link Gist ini.

---

# 📅 CHECKLIST HARI PERTAMA

Setup pertama kali? Ikuti checklist ini:

- [ ] VPS aktif + SSH access
- [ ] Node.js 22 terinstall
- [ ] Docker terinstall
- [ ] Swap 2GB aktif
- [ ] UFW firewall aktif
- [ ] GitHub CLI login
- [ ] Tailscale install di HP + VPS
- [ ] IP Tailscale VPS dicatat
- [ ] Docker 9Router running
- [ ] Dashboard 9Router bisa dibuka dari HP
- [ ] Provider LLM (Kiro/DeepSeek) connected di 9Router
- [ ] API Key 9Router dicatat
- [ ] Repo CodeClaw di-clone
- [ ] Config diisi via panel (model, telegram, exa, groq)
- [ ] Bot pertama kali jalan (lihat "Bot: @username" di log)
- [ ] Auto-start crontab terpasang
- [ ] Bot balas pesan "Halo" di Telegram
- [ ] Backup config ke Gist

Jika semua ✅ = Setup selesai!

---

> **Selamat!** Anda sudah punya AI Agent kelas enterprise yang jalan 24/7 di server.
> Simpan link Gist ini. Jika lupa sesuatu, buka lagi.
