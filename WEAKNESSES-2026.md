# Riset Mendalam: Kelemahan CodeClaw (Self-Audit)

Tanggal: 26 Oktober 2026
Sumber: arXiv 2607.05775 (Beyond the Leaderboard), arXiv 2610.17418 (Why Agentic Workflows Fail), arXiv 2610.02503 (Compound AI Reliability), ACM Queue (Failure Is a Feature), audit internal lib/brain.js, lib/planner.js, lib/tools.js.

## 6 Cluster Kegagalan Agent (literatur)

1. Tool invocation & parameter errors
2. Planning & constraint-satisfaction failures
3. Long-horizon degradation (context accumulation)
4. Multi-agent coordination failures
5. Safety & security failures
6. Measurement validity problems

## Pemetaan ke CodeClaw (kelemahan konkret)

### A. Tool invocation / parameter errors
- `executeTool` (tools.js:122-130) hanya try/catch generik, tidak ada validasi argumen sebelum eksekusi.
- Tidak ada retry/backoff. Tool yang gagal (network, timeout) langsung dikembalikan sebagai string error; agent sering lanjut tanpa retry.
- `shell` (tools.js:233) pakai `exec` dengan shell string → rentan command injection jika approvalCallback tidak aktif. `needsApproval` (safety.js) hanya cek pattern, bukan sandbox.
- `refactor_multi` (tools.js:210) menelan error per-file (`catch {}`) → silent failure, tidak ada laporan file mana yang gagal.

### B. Planning & constraint failures
- `planner.js` (10 baris) hanya formatter todo, tidak ada enforcement: tidak ada validasi dependency, tidak ada deteksi todo yang stuck in_progress, tidak ada auto-fail timeout.
- Brain prompt meminta todo_write tapi tidak ada guard yang memaksa. Agent bisa skip todo_write tanpa konsekuensi.
- Tidak ada constraint checker: mis. "jangan edit file X" tidak di-enforce di tool layer.

### C. Long-horizon degradation
- Tidak ada context budget monitoring. `read_file` cap 500KB/500 lines tapi tidak ada akumulasi token tracking.
- Session memory (session.js) tidak ada compaction/summarization → context window blindness.
- `think` menyimpan reasoning ke memory tapi tidak ada retrieval otomatis saat context penuh.

### D. Multi-agent coordination
- `spawn_subagent` (tools.js:452) depth check ada, tapi tidak ada fault isolation: jika sub-agent gagal, parent tetap lanjut tanpa rollback.
- Tidak ada idempotency check: sub-agent bisa menulis file yang sama → race condition.
- Tidak ada timeout per sub-agent (hanya depth).

### E. Safety & security
- `write_file`/`edit_file` tidak ada path traversal guard (expand() resolve tapi tidak cek escape dari HOME).
- `shell` tidak sandbox; approvalCallback opsional.
- Tidak ada audit log immutable untuk tool call.

### F. Measurement validity
- Tidak ada telemetry/trace untuk tool call success rate.
- `verify` tool ada tapi opsional; tidak ada enforcement "verify sebelum selesai".
- Skill distiller (skill-distiller.js) mencatat success/fail tapi tidak ada baseline comparison.

## Mitigasi yang direkomendasikan (prioritas)

1. **Tool layer**: tambah validasi argumen + retry exponential backoff (max 3x) + idempotency key untuk write_file.
2. **Planner**: tambah state machine enforcement (todo tidak boleh stuck in_progress > N turn), dependency graph.
3. **Context**: tambah token budget tracker di session, auto-summarize saat > 80% window.
4. **Sub-agent**: tambah timeout per agent, fault isolation (rollback on fail), idempotency.
5. **Safety**: path traversal guard, sandbox shell, audit log.
6. **Telemetry**: trace setiap tool call (name, args hash, result, latency, success) ke SQLite.

## Kelemahan spesifik CodeClaw (dari memory + audit)

- Over-trust tool output: tool return string "OK" tapi tidak diverifikasi.
- No retry with backoff: network flaky → fail langsung.
- Context window blindness: tidak tahu kapan context penuh.
- No fault isolation: satu tool gagal bisa cascade.

## Kesimpulan

CodeClaw punya scaffolding (brain, planner, tools) tapi enforcement lemah. Sebagian besar "aturan" hanya di prompt, bukan di code. Perbaikan harus di layer code (guard, retry, validation), bukan hanya prompt engineering.
