#!/usr/bin/env bash
# CodeClaw supervisor — satu-satunya yang boleh start/stop proses bot.
# Pakai: ./run.sh start|stop|restart|status|foreground
#
# Aturan main:
#   - Hanya satu supervisor hidup (dijaga flock + pidfile).
#   - Hanya supervisor yang boleh spawn node telegram.js.
#   - Semua start/stop lewat sini, tidak ada script lain yang pkill node.

set -uo pipefail
# Pure-bash: hindari fork/exec di startup (sandbox PRoot bisa hang saat exec).
_d="${0%/*}"
[[ $_d == "$0" ]] && _d="."
cd "$_d" || exit 1

APP="${CODECLAW_APP:-bin/codeclaw.js}"
LOG="${CODECLAW_LOG:-telegram.log}"
SUP_LOG="supervisor.log"
PID_FILE="${CODECLAW_PID:-telegram.pid}"
SUP_PID_FILE="${CODECLAW_SUP_PID:-supervisor.pid}"
LOCK_FILE="${CODECLAW_LOCK:-.supervisor.lock}"
HEALTH_FILE="${CODECLAW_HEALTH:-.health}"
RESTART_LOG="${CODECLAW_RESTARTS:-.restarts}"
APP_RE="${APP//./\\.}"
APP_RE="${APP_RE//+/\\+}"

MIN_BACKOFF=2
MAX_BACKOFF=60
# Preload patch isolated-exec: exec jadi spawn detached + stdio file, supaya
# command tidak membunuh dirinya sendiri lewat process group bot.
EXEC_PATCH="${CODECLAW_EXEC_PATCH:-patches/isolated-exec.mjs}"
NODE_OPTS_BASE="--dns-result-order=ipv4first"
if [[ -f $EXEC_PATCH ]]; then
  NODE_OPTS_BASE="--import $PWD/$EXEC_PATCH $NODE_OPTS_BASE"
else
  echo "⚠️  patch exec tidak ditemukan: $EXEC_PATCH (lanjut tanpa isolasi)" >&2
fi
HEALTH_TIMEOUT="${CODECLAW_HEALTH_TIMEOUT:-180}"
MAX_CRASH_10MIN="${CODECLAW_MAX_CRASH:-20}"
HALTED_FILE="${CODECLAW_HALTED:-.halted}"
HALT_COOLDOWN="${CODECLAW_HALT_COOLDOWN:-900}"
BOOT_GRACE=20     # beri waktu bot init (getMe + DNS) sebelum dianggap gagal

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*" >> "$SUP_LOG"; }

# Tidur tanpa bergantung coreutils: kalau `sleep` hilang/rusak (mis. sandbox
# PRoot degradasi), fallback ke busy-wait pakai builtin $SECONDS.
nap() {
  local d="${1:-1}"
  sleep "$d" 2>/dev/null && return 0
  local until=$(( SECONDS + d ))
  while (( SECONDS < until )); do :; done
}

# Probe: apakah lingkungan ini masih bisa exec binary eksternal?
# Di PRoot/Android yang degradasi, fork/exec hang tanpa error — akibatnya
# `stop` sukses tapi `start` gagal = bot mati permanen. Deteksi lebih dulu.
#
# PENTING: probe ini sengaja TIDAK memakai `wait` (builtin) karena `wait`
# bisa memblokir lama justru saat fork/exec sedang lambat — persis kondisi
# yang ingin dideteksi. Untuk mendeteksi selesai, pakai kill -0 + cek zombie.
running() {
  local p="$1" st
  [[ -n $p && -d /proc/$p ]] || return 1
  st="$(awk '{print $3}' "/proc/$p/stat" 2>/dev/null)"
  [[ -n $st && $st != Z ]]     # zombie = sudah selesai, jangan dianggap hidup
}

exec_ok() {
  local timeout="${CODECLAW_PROBE_TIMEOUT:-15}" end pf bp

  # 1) fork saja, tanpa exec. Subshell selesai sangat cepat.
  ( : ) >/dev/null 2>&1 &
  pf=$!
  [[ -n $pf ]] || return 1
  end=$(( SECONDS + timeout ))
  while (( SECONDS < end )); do
    running "$pf" || break
    sleep 0.1 2>/dev/null || nap 1
  done
  if running "$pf"; then kill -KILL "$pf" 2>/dev/null; return 1; fi
  wait "$pf" 2>/dev/null || :   # reap; proses sudah selesai jadi tidak memblokir

  # 2) fork + exec binary eksternal — ini yang sebenarnya diuji.
  ( /bin/true ) >/dev/null 2>&1 &
  bp=$!
  end=$(( SECONDS + timeout ))
  while (( SECONDS < end )); do
    running "$bp" || { wait "$bp" 2>/dev/null || :; return 0; }
    sleep 0.1 2>/dev/null || nap 1
  done
  kill -KILL "$bp" 2>/dev/null
  wait "$bp" 2>/dev/null || :
  return 1
}

# Binary wajib. command -v itu builtin → aman walau exec rusak.
require_bins() {
  local missing=() b
  for b in node setsid flock; do
    command -v "$b" >/dev/null 2>&1 || missing+=("$b")
  done
  if (( ${#missing[@]} )); then
    echo "❌ binary wajib tidak ada: ${missing[*]}" >&2
    return 1
  fi
  return 0
}

# PID valid = proses hidup DAN cmdline-nya memang telegram.js.
# Ini mencegah PID reuse (pidfile lama kepakai proses lain).
app_pid() {
  local p=""
  [[ -f $PID_FILE ]] && p="$(cat "$PID_FILE" 2>/dev/null)"
  if [[ -n $p ]] && kill -0 "$p" 2>/dev/null && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "$APP_RE"; then
    echo "$p"; return 0
  fi
  rm -f "$PID_FILE"
  # Filter ketat: hanya proses yang /proc/PID/comm-nya "node".
  # Tanpa ini, pgrep -f bisa self-match ke pemanggil yang cmdline-nya memuat pola.
  local cand
  for cand in $(pgrep -f "node .*${APP_RE}" 2>/dev/null); do
    [[ "$(cat "/proc/$cand/comm" 2>/dev/null)" == "node" ]] && { echo "$cand"; return 0; }
  done
  return 1
}

sup_alive() {
  local p=""
  [[ -f $SUP_PID_FILE ]] && p="$(cat "$SUP_PID_FILE" 2>/dev/null)"
  [[ -n $p ]] && kill -0 "$p" 2>/dev/null && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "run\.sh"
}

# Apakah proses pemanggil berada di bawah pohon proses ${1}?
# Kalau ya, mematikan ${1} berarti membunuh pemanggil sendiri di tengah jalan:
# promise/stdio-nya putus dan perintah "stop" tidak pernah selesai.
# Pakai BASHPID (bukan $) supaya nilainya tidak ikut diinterpolasi saat ditulis.
caller_descends_from() {
  local target="${1:-}" p="${BASHPID:-}" depth=0
  [[ $target =~ ^[0-9]+$ ]] || return 1
  [[ $p =~ ^[0-9]+$ ]] || return 1
  while (( depth < 40 )); do
    (( p > 1 )) || return 1
    p="$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null)"
    [[ $p =~ ^[0-9]+$ ]] || return 1
    [[ $p == "$target" ]] && return 0
    depth=$(( depth + 1 ))
  done
  return 1
}

# Jalankan ulang subcommand ini di sesi terpisah supaya tidak ikut mati
# bersama app. CODECLAW_DETACHED mencegah rekursi tanpa akhir.
detach_self() {
  local sub="$1"
  log "pemanggil adalah turunan app — re-exec detached: $sub"
  CODECLAW_DETACHED=1 setsid bash "$0" "$sub" >>"$SUP_LOG" 2>&1 < /dev/null &
  echo "⤴️  '$sub' dijalankan detached (pid $!) karena pemanggil adalah turunan app."
  echo "   Pantau: tail -f $SUP_LOG"
}

# Bersihkan artefak detach yang menumpuk.
prune_detached() {
  local d=".detached"
  [[ -d $d ]] || return 0
  find "$d" -type f -mtime +1 -delete 2>/dev/null
}


stop_app() {
  local pid; pid="$(app_pid)"
  [[ -z $pid ]] && { rm -f "$PID_FILE"; return 0; }
  log "stop app pid=$pid"
  kill -TERM "$pid" 2>/dev/null
  local i
  for (( i = 0; i < 15; i++ )); do kill -0 "$pid" 2>/dev/null || break; nap 1; done
  if kill -0 "$pid" 2>/dev/null; then log "force kill pid=$pid"; kill -KILL "$pid" 2>/dev/null; nap 1; fi
  rm -f "$PID_FILE"
}

start_app() {
  # Jangan sampai dua instance bot jalan bersamaan (double-polling = update hilang).
  local existing; existing="$(app_pid)"
  [[ -n $existing ]] && { log "start dilewati, app sudah jalan pid=$existing"; return 0; }

  log "start $APP"
  NODE_OPTIONS="$NODE_OPTS_BASE" setsid node "$APP" >>"$LOG" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  echo "$(date +%s)" > "$HEALTH_FILE"
  log "app pid=$pid"
}

count_crash() {
  local now; now=$(date +%s)
  echo "$now" >> "$RESTART_LOG"
  awk -v t="$now" '$1 > t-600' "$RESTART_LOG" > "$RESTART_LOG.tmp" 2>/dev/null && mv "$RESTART_LOG.tmp" "$RESTART_LOG"
  wc -l < "$RESTART_LOG" | tr -d ' '
}

# Catat crash lalu putuskan: lanjut restart, atau halt (butuh intervensi).
# Halt menulis HALTED_FILE supaya watchdog tidak ikut restart tanpa henti.
register_crash() {
  local reason="$1" crashes
  crashes="$(count_crash)"
  log "app mati ($reason, crash #$crashes / 10 menit)"
  if (( crashes > MAX_CRASH_10MIN )); then
    log "❌ crash >${MAX_CRASH_10MIN}x/10min — halt, butuh intervensi manual"
    log "   hapus $HALTED_FILE untuk mengizinkan restart lagi"
    date +%s > "$HALTED_FILE"
    rm -f "$SUP_PID_FILE"
    return 1
  fi
  return 0
}

supervise() {
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "supervisor lain sudah pegang lock, keluar"
    exit 0
  fi

  echo $$ > "$SUP_PID_FILE"
  log "=== supervisor start pid=$$ ==="

  trap 'log "supervisor dapat signal, stop bersih"; stop_app; rm -f "$SUP_PID_FILE"; exit 0' INT TERM

  local backoff=$MIN_BACKOFF
  local last_stable; last_stable=$(date +%s)

  # Bersihkan sisa proses lama sebelum mulai — penting saat cutover.
  stop_app
  start_app

  while true; do
    nap 5

    if ! app_pid >/dev/null || [[ -z "$(app_pid)" ]]; then
      local cooldown
      register_crash "crash" || { stop_app; exit 1; }
      cooldown="$(cat "$HALTED_FILE" 2>/dev/null || echo 0)"
      (( $(date +%s) - cooldown < HALT_COOLDOWN )) && { log "halt cooldown aktif — berhenti"; exit 1; }
      log "restart dalam ${backoff}s"
      nap "$backoff"
      start_app
      backoff=$(( backoff * 2 )); (( backoff > MAX_BACKOFF )) && backoff=$MAX_BACKOFF
      last_stable=$(date +%s)
      continue
    fi

    # Proses stabil >2 menit → reset backoff ke minimum.
    if (( $(date +%s) - last_stable > 120 )); then
      backoff=$MIN_BACKOFF
      last_stable=$(date +%s)
    fi

    # Watchdog hang: heartbeat ditulis timer 15s di dalam app.
    if [[ -f $HEALTH_FILE ]]; then
      local hb hb_age
      hb="$(stat -c %Y "$HEALTH_FILE" 2>/dev/null || echo 0)"
      hb_age=$(( $(date +%s) - hb ))
      if (( hb_age > HEALTH_TIMEOUT )); then
        log "⏱ heartbeat basi ${hb_age}s — proses hang, restart paksa"
        register_crash "hang ${hb_age}s" || { stop_app; exit 1; }
        stop_app
        start_app
        last_stable=$(date +%s)
      fi
    else
      log "⚠️ heartbeat hilang — proses mungkin macet di init, restart"
      register_crash "heartbeat hilang" || { stop_app; exit 1; }
      stop_app
      start_app
      last_stable=$(date +%s)
    fi
  done
}

case "${1:-start}" in
  start)
    # Hormati status halt: crash-loop berat butuh mata manusia, bukan restart buta.
    if [[ -f $HALTED_FILE ]]; then
      halt_since="$(cat "$HALTED_FILE" 2>/dev/null || echo 0)"
      if (( $(date +%s) - halt_since < HALT_COOLDOWN )); then
        echo "⛔ halt aktif ($(( $(date +%s) - halt_since ))s lalu, cooldown ${HALT_COOLDOWN}s)"
        echo "   cek $SUP_LOG / $LOG, lalu: rm $HALTED_FILE && ./run.sh start"
        exit 1
      fi
      echo "⟳ cooldown halt lewat — reset penanda"
      rm -f "$HALTED_FILE"
    fi
    if sup_alive; then
      echo "supervisor sudah jalan (pid $(cat "$SUP_PID_FILE"))"
      exit 0
    fi
    require_bins || exit 1
    if ! exec_ok; then
      echo "❌ fork/exec tidak sehat — start dibatalkan (jalan: $0 __probe)"
      exit 1
    fi
    setsid bash "$0" __supervise >>"$SUP_LOG" 2>&1 < /dev/null &
    nap 3
    if sup_alive; then
      echo "✅ supervisor pid $(cat "$SUP_PID_FILE")"
      [[ -n "$(app_pid)" ]] && echo "✅ app pid $(app_pid)" || { echo "❌ app gagal start — cek $LOG"; exit 1; }
    else
      echo "❌ supervisor gagal start — cek $SUP_LOG"; exit 1
    fi
    ;;

  __supervise) supervise ;;

  # Selftest: buktikan cabang detach hidup tanpa benar-benar mematikan bot.
  __selftest)
    _t="${2:-$(app_pid)}"
    echo "app_pid=${_t:-<kosong>} BASHPID=$BASHPID"
    if caller_descends_from "${_t:-}"; then
      echo "deteksi: TRUE (pemanggil turunan app) -> detach dipicu"
      detach_self __noop
    else
      echo "deteksi: FALSE (pemanggil bukan turunan app) -> cabang detach wajar dilewati"
    fi
    ;;

  # Target no-op untuk menguji detach_self tanpa efek samping.
  __noop)
    log "detach selftest sampai di __noop (BASHPID=$BASHPID) — mekanisme OK"
    echo "noop ok"
    ;;

  # Debug: apakah pemanggil berada di bawah pohon proses <pid>?
  __anc)
    _t="${2:-}"
    if caller_descends_from "$_t"; then
      echo "TRUE: pemanggil (BASHPID=$BASHPID) turunan dari $_t"
    else
      echo "FALSE: pemanggil (BASHPID=$BASHPID) bukan turunan dari ${_t:-<kosong>}"
    fi
    ;;

  stop)
    # Kalau yang menjalankan stop adalah turunan app (mis. tool shell di dalam
    # bot yang sama), lsg hentikan diri sendiri = promise pemanggil putus.
    # Alihkan ke sesi terpisah supaya stop selesai utuh.
    if [[ -z "${CODECLAW_DETACHED:-}" ]]; then
      _tgt="$(app_pid)"
      if caller_descends_from "${_tgt:-}"; then
        detach_self stop
        exit 0
      fi
      if caller_descends_from "$(cat "$SUP_PID_FILE" 2>/dev/null || echo)"; then
        detach_self stop
        exit 0
      fi
    fi
    prune_detached
    if sup_alive; then
      sp="$(cat "$SUP_PID_FILE")"
      log "stop supervisor pid=$sp"
      kill -TERM "$sp" 2>/dev/null
      i=0
      for (( i = 0; i < 15; i++ )); do kill -0 "$sp" 2>/dev/null || break; nap 1; done
      kill -0 "$sp" 2>/dev/null && kill -KILL "$sp" 2>/dev/null
      rm -f "$SUP_PID_FILE"
    fi
    stop_app
    echo "✅ stopped"
    ;;

  restart)
    if [[ -z "${CODECLAW_DETACHED:-}" ]]; then
      _tgt="$(app_pid)"
      if caller_descends_from "${_tgt:-}"; then
        detach_self restart
        exit 0
      fi
    fi
    # Jangan pernah stop dulu kalau environment tidak bisa start —
    # itu mengubah "restart gagal" jadi "bot mati permanen".
    if ! exec_ok; then
      echo "❌ fork/exec tidak sehat — restart dibatalkan, bot lama dibiarkan hidup"
      echo "   probe: $0 __probe"
      exit 1
    fi
    "$0" stop
    nap 1
    "$0" start
    ;;

  # Preflight: cek fork/exec + binary wajib tanpa menyentuh proses bot.
  __probe)
    _ok=0
    if exec_ok; then echo "fork+exec: OK"; else echo "fork+exec: FAIL"; _ok=1; fi
    printf 'bins:'
    for b in node setsid flock sleep date; do
      command -v "$b" >/dev/null 2>&1 && printf ' %s=ok' "$b" || printf ' %s=MISSING' "$b"
    done
    echo
    exit "$_ok"
    ;;

  status)
    if sup_alive; then echo "supervisor: ✅ pid $(cat "$SUP_PID_FILE")"; else echo "supervisor: ❌ mati"; fi
    p="$(app_pid)"
    if [[ -n $p ]]; then
      echo "app: ✅ pid $p (rss $(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')KB, uptime $(ps -o etime= -p "$p" 2>/dev/null | tr -d ' '))"
      hb="$(stat -c %Y "$HEALTH_FILE" 2>/dev/null || echo 0)"
      echo "heartbeat: $(( $(date +%s) - hb ))s lalu"
    else
      echo "app: ❌ mati"
    fi
    ;;

  foreground)
    NODE_OPTIONS="$NODE_OPTS_BASE" exec node "$APP"
    ;;

  *)
    echo "Pakai: $0 {start|stop|restart|status|foreground|__supervise}"; exit 1 ;;
esac
