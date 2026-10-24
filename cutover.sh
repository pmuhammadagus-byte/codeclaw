#!/bin/bash
# Cutover sekali jalan: matikan bot lama (di luar supervisor), lalu serahkan ke run.sh.
# Dijalankan detached dengan delay supaya respons bot sempat terkirim.

sleep 45
cd /root/codeclaw || exit 1

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === cutover mulai ==="

  # Matikan semua node telegram.js yang tidak dikelola supervisor.
  for p in $(pgrep -f "node .*telegram\.js" 2>/dev/null); do
    if ! pgrep -f "run\.sh __supervise" >/dev/null 2>&1; then
      echo "[cutover] kill app lama pid=$p"
      kill -TERM "$p" 2>/dev/null
    fi
  done
  sleep 5
  for p in $(pgrep -f "node .*telegram\.js" 2>/dev/null); do
    echo "[cutover] force kill pid=$p"
    kill -KILL "$p" 2>/dev/null
  done
  sleep 2

  # Pastikan watchdog lama (versi pkill node) tidak hidup.
  pkill -f "/root/watchdog.sh" 2>/dev/null
  sleep 1

  echo "[cutover] start supervisor"
  ./run.sh start
  sleep 10
  ./run.sh status

  echo "[cutover] start watchdog baru"
  setsid nohup /root/watchdog.sh > /root/codeclaw/watchdog.log 2>&1 < /dev/null &
  sleep 3

  echo "[cutover] watchdog pid=$(pgrep -f '/root/watchdog.sh' | head -n1)"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === cutover selesai ==="
} >> /root/codeclaw/cutover.log 2>&1
