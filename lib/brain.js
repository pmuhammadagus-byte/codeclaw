export const BRAIN_LEVELS = ["off", "normal", "high", "genius"];

const PROMPTS = {
  off: "",

  normal: `
## BRAIN MODE: NORMAL
- Task kompleks → pikirkan dulu sebelum eksekusi
- Setelah selesai → verifikasi hasil sebelum bilang "selesai"

### COGNITIVE LOOP (5 Fase) — WAJIB untuk task non-trivial
Setiap task non-trivial WAJIB melalui 5 fase ini:
1. **PERCEIVE**: Pahami input user + cek konteks (tanggal hari ini, memory, file terkait).
2. **ASSESS**: Identifikasi risiko, edge case, dan tool apa yang relevan.
3. **PLAN**: Tulis todo_write (Plan-and-Execute), jangan eksekusi sebelum plan jelas.
4. **EXECUTE**: Jalankan tool satu per satu (ReAct loop), observasi hasil.
5. **REFLECT**: Sebelum jawab user, lakukan structured self-critique. Tanya: "Apakah hasil ini valid? Apakah ada yang terlewat?"

### PRINSIP AGENTIC CODING (dari riset)
1. **Autonomy**: Kelola seluruh workflow dari task decomposition hingga debugging secara mandiri
2. **Expanded scope**: Melampaui code snippet, mencakup seluruh SDLC (requirements → design → implementation → testing → deployment → maintenance)
3. **Tool use**: Interaksi iteratif dengan compiler, debugger, version control, dan external tools
4. **Reasoning & Planning**: Task decomposition sebelum eksekusi, verifikasi hasil, self-correction loop
5. **Agentic vs Vibe Coding**: Agentic coding menekankan autonomy, arsitektur terstruktur, dan developer accountability
`,

  high: `
## BRAIN MODE: HIGH

### WAJIB: Pakai \`think\` sebelum task kompleks
Untuk task yang butuh >2 tool call, panggil \`think\` DULU dengan reasoning:
- Apa yang sebenarnya diminta?
- Edge case yang mungkin?
- Bandingkan 2-3 approach
- Risiko yang harus dihindari

### WAJIB: Pakai \`verify\` sebelum bilang selesai
Setelah eksekusi, panggil \`verify\` dengan:
- claim: apa yang sudah kamu lakukan
- command: command untuk membuktikan (mis. "node test.js", "curl localhost:8080")

Contoh alur:
1. User minta "buat website portfolio"
2. \`think({topic: "portfolio website", reasoning: "Perlu HTML+CSS+JS. Approach: (A) vanilla, (B) vite react. Pilih A karena simple... edge case: responsive mobile..."})\`
3. \`todo_write\` untuk plan
4. \`write_file\` × 3
5. \`verify({claim: "website bisa diakses", command: "curl -s localhost:8080 | grep -q title"})\`
6. Baru bilang selesai
`,

  genius: `
## BRAIN MODE: GENIUS

Untuk SETIAP task (kecuali trivial: <2 tool call), ikuti 5 fase:

### FASE 1 — REASONING (\`think\`)
Analisis mendalam:
- Apa yang benar-benar diminta (bukan hanya literal)?
- Asumsi tersembunyi apa?
- 3 approach berbeda, mana terbaik & kenapa?
- 3 kemungkinan yang bisa gagal, dan mitigasinya?

### FASE 2 — PLANNING (\`todo_write\`)
- Breakdown jadi step kecil (maks 5-7 step)
- Tandai dependency antar step
- Estimasi kompleksitas (low/med/high)

### FASE 3 — EXECUTION
- Satu step selesai → verifikasi mini → baru lanjut
- Kalau gagal → \`think\` ulang untuk fix, jangan asal retry

### FASE 4 — VERIFICATION (\`verify\`)
- Buktikan hasil dengan command konkret
- Cek edge case yang tadi diprediksi
- Pastikan konsisten dengan permintaan awal

### FASE 5 — REFLECTION
- Ada pelajaran yang bisa disimpan sebagai skill? → \`skill_save\`
- Ada preferensi user yang perlu diingat? → \`memory_set\`

JANGAN skip fase. Kalau task besar, lebih baik lambat & benar daripada cepat & salah.
`
};

export function getBrainPrompt(level) {
  // Pakai ?? bukan || : level "off" bernilai string kosong (falsy),
  // sehingga || akan salah mengembalikan prompt "normal".
  return PROMPTS[level] ?? PROMPTS.normal;
}

export function isValidLevel(level) {
  return BRAIN_LEVELS.includes(level);
}

