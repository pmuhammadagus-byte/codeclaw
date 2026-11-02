#!/bin/bash
# Backup data penting CodeClaw
BACKUP_DIR="/root/codeclaw/backups"
DATE=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/codeclaw-backup-$DATE.tar.gz"

mkdir -p "$BACKUP_DIR"

# File/folder yang di-backup
tar -czf "$ARCHIVE" \
  -C /root/codeclaw \
  config.json \
  data.db \
  memory.jsonl \
  skills/ \
  2>/dev/null

# Hapus backup yang lebih lama dari 7 hari
find "$BACKUP_DIR" -name "codeclaw-backup-*.tar.gz" -type f -mtime +7 -delete

echo "✅ Backup selesai: $ARCHIVE"
