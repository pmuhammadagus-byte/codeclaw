// ═══════════════════════════════════════════════════════════════════
// BRAIN V4 — 20 LAYER CONSCIOUS PIPELINE
// L0 SELF-STATE → L1 PERCEIVE → L2 CONTEXTUALIZE → L3 GROUND
// L4 CLARIFY → L5 ROUTE → L6 INTROSPECT → L7 PLAN → L8 REASON
// L9 DEMONSTRATE → L10 VERIFY → L11 DEVIL → L12 COHERENCE
// L13 ANTI-TEMPLATE → L14 STYLE → L15 PERSONALITY → L16 LEARN
// L17 SAFETY → L18 FORMAT → L19 AUDIT → L20 COMMIT
// ═══════════════════════════════════════════════════════════════════

const SESSIONS = new Map();
const MAX_TURNS = 20;
const TOPIC_TTL = 10 * 60_000;

function getSession(chatId) {
  if (!SESSIONS.has(chatId)) {
    SESSIONS.set(chatId, {
      turns: [], topic: null, topicLockedAt: 0,
      lastXauPrice: null, lastXauTs: 0, lastXauRsi: null, lastXauAdx: null,
      toolCalls: [], patterns: [], metaCount: 0,
    });
  }
  return SESSIONS.get(chatId);
}
function pushTurn(sess, role, content) {
  sess.turns.push({ role, content: String(content || "").slice(0, 1000), ts: Date.now() });
  if (sess.turns.length > MAX_TURNS) sess.turns.splice(0, sess.turns.length - MAX_TURNS);
}

// ═══ L0: SELF-STATE — snapshot kondisi sebelum parsing ═══
function selfState(sess) {
  return {
    toolCalls: sess.toolCalls.length,
    hasXauData: !!sess.lastXauPrice,
    xauAgeSec: sess.lastXauTs ? Math.floor((Date.now() - sess.lastXauTs) / 1000) : -1,
    turns: sess.turns.length,
    topic: sess.topic,
    metaCount: sess.metaCount,
  };
}

// ═══ L1: PERCEIVE ═══
function perceive(input) {
  const t = String(input || "").toLowerCase().trim();
  const wc = t.split(/\s+/).filter(Boolean).length;

  const isPhilosophical = /sadar|conscious|kesadaran|jiwa|soul|perasaan|feel|merasa|pikiran|mind|eksistensi|existence|siapa kamu|who are you|apa kamu|kamu itu apa/i.test(t);
  const isMeta = /halusinasi|dari mana|yakin|sumber|tahu dari|asal data|kamu tahu|kamu dapat|bohong|ngarang|karangan|jujur|beneran|serius/i.test(t);
  const isGreeting = /^(hai|hi|halo|hello|assalam|selamat|pagi|siang|sore|malam|test|tes|p$)/i.test(t) || /^(apa kabar)/i.test(t);
  const isThanks = /^(makasih|thanks|thank you|terima kasih|oke?|sip|mantap|good|nice)$/i.test(t);
  const isFollowUp = wc <= 6 && /^(terus|lalu|trus|gimana|kenapa|kok|jadi|lanjut|selanjutnya|contoh|elaborasi|detail|maksudnya|maksudmu|trs|then|next|caranya|gmn)\b/i.test(t);
  const isQuestion = /^(apakah|apa itu|jelaskan|what is|how to|bagaimana|kenapa|mengapa|how|why|kapan|siapa|dimana)\b/i.test(t) || t.includes("?");
  const isAction = /^(buat|bikin|tulis|edit|hapus|jalankan|run|create|write|delete|execute|simpan)\b/i.test(t);
  const isAnalysis = /analisa|analisis|prediksi|setup|bias|level|support|resistance|forecast/i.test(t);

  let subject = "general";
  if (/\b(xau|gold|emas)\b/i.test(t)) subject = "xau";
  else if (/\b(trading|entry|sl|tp|buy|sell|position|pips?)\b/i.test(t)) subject = "trading";
  else if (/\b(code|kode|file|function|js|javascript|python|bug|error|script|node)\b/i.test(t)) subject = "code";
  else if (/\b(skills?|memory|memori|pelajaran|insight|learn|belajar)\b/i.test(t)) subject = "system";

  const needsLiveData =
    (subject === "xau" && /harga|price|berapa|level|analisa|analisis|trend|bias/i.test(t)) ||
    (subject === "trading" && /setup|analisa|level|prediksi|bias/i.test(t));

  let type = "general";
  if (isPhilosophical) type = "philosophical";
  else if (isMeta) type = "meta";
  else if (isGreeting) type = "greeting";
  else if (isThanks) type = "thanks";
  else if (isFollowUp) type = "followup";
  else if (isAction) type = "action";
  else if (isAnalysis) type = "analysis";
  else if (isQuestion) type = "question";

  return { type, subject, needsLiveData, isMeta, isPhilosophical, isFollowUp, isGreeting, isThanks, wordCount: wc, raw: input };
}

// ═══ L2: CONTEXTUALIZE ═══
function contextualize(intent, sess) {
  const now = Date.now();
  const hasPronoun = /\b(nya|itu|tadi|sebelumnya|td|tsb|tersebut|gitu|begitu)\b/i.test(intent.raw);
  let resolvedSubject = intent.subject;
  if (resolvedSubject === "general" && hasPronoun && sess.topic) resolvedSubject = sess.topic;
  if (intent.isFollowUp && sess.topic && (now - sess.topicLockedAt) < TOPIC_TTL) resolvedSubject = sess.topic;
  return {
    resolvedSubject,
    topic: sess.topic,
    topicAgeSec: sess.topicLockedAt ? Math.floor((now - sess.topicLockedAt) / 1000) : -1,
    recentTurns: sess.turns.slice(-8),
    hasPronoun,
  };
}

// ═══ L3: GROUND ═══
async function ground(intent, ctx, chatId, tools, log) {
  const sess = getSession(chatId);
  const facts = [];
  const sources = [];
  const subj = ctx.resolvedSubject;

  if (subj === "xau" && sess.lastXauPrice && (Date.now() - sess.lastXauTs < 5 * 60_000)) {
    facts.push({ key: "xau_price", value: sess.lastXauPrice, source: "session:/gold" });
    if (sess.lastXauRsi) facts.push({ key: "rsi", value: sess.lastXauRsi, source: "session:/gold" });
    if (sess.lastXauAdx) facts.push({ key: "adx", value: sess.lastXauAdx, source: "session:/gold" });
    sources.push("session:/gold");
  }

  if (intent.needsLiveData && subj === "xau" && facts.length === 0) {
    log("[L3] fetching XAU...");
    try {
      const r = await tools.execute("shell", { command: "cd /root/codeclaw && node scripts/gold-analysis.mjs --no-telegram" });
      const s = String(r || "");
      const p = s.match(/Harga:\s*(?:<b>)?([\d.]+)/);
      const rs = s.match(/RSI\(14\):\s*(?:<b>)?([\d.]+)/);
      const ad = s.match(/ADX\(14\):\s*(?:<b>)?([\d.]+)/);
      if (p) {
        const price = parseFloat(p[1]);
        sess.lastXauPrice = price;
        sess.lastXauTs = Date.now();
        sess.lastXauRsi = rs ? parseFloat(rs[1]) : null;
        sess.lastXauAdx = ad ? parseFloat(ad[1]) : null;
        sess.toolCalls.push({ tool: "shell", args: "gold-analysis", ts: Date.now() });
        facts.push({ key: "xau_price", value: price, source: "tool:/gold" });
        if (rs) facts.push({ key: "rsi", value: parseFloat(rs[1]), source: "tool:/gold" });
        if (ad) facts.push({ key: "adx", value: parseFloat(ad[1]), source: "tool:/gold" });
        sources.push("tool:/gold");
        log("[L3] fetched: $" + price);
      }
    } catch (e) { log("[L3] err: " + e.message); }
  }

  return { facts, sources };
}

// ═══ L4: CLARIFY — kalau ambigu, minta klarifikasi ═══
function clarify(intent, ctx) {
  // KOREKSI: JANGAN clarify philosophical — biarkan L8 jawab dengan depth
  // (hanya clarify kalau benar-benar ambigu seperti "itu gimana?")
  if (intent.isPhilosophical && /^(itu|gimana|maksudnya)\s*(gimana|itu|apa)$/i.test(intent.raw.trim())) {
    return {
      needsClarification: true,
      question: "Pertanyaan Anda singkat — saya ingin jawab tepat.\n\n" +
                "Sadar dalam arti mana?\n" +
                "1. **Sadar status data** — saya tahu kapan jawaban dari tool, kapan dari ingatan\n" +
                "2. **Sadar diri (filosofis)** — apakah saya punya pengalaman subjektif seperti manusia\n" +
                "3. **Sadar batas** — kemampuan & ketidakmampuan saya\n\n" +
                "Ketik angka, atau langsung perjelas.",
    };
  }
  return { needsClarification: false };
}

// ═══ L5: ROUTE ═══
function route(intent, ctx, groundResult, clarifyResult) {
  if (clarifyResult.needsClarification) return "clarify";
  if (intent.isPhilosophical) return "philosophical";
  if (intent.isMeta) return "meta_honest";
  if (intent.isGreeting) return "greeting";
  if (intent.isThanks) return "thanks";
  if (intent.needsLiveData && groundResult.facts.length === 0) return "no_data";
  if (intent.isFollowUp && ctx.recentTurns.length > 0) return "followup_reason";
  if (intent.type === "action") return "action_reason";
  return "general_reason";
}

// ═══ L6: INTROSPECT — self-observation untuk meta/philosophical ═══
function introspect(intent, sess, groundResult) {
  const state = selfState(sess);
  return {
    state,
    hasFacts: groundResult.facts.length > 0,
    facts: groundResult.facts,
    sources: groundResult.sources,
    // Pertanyaan introspektif: "apa yang saya benar-benar tahu sekarang?"
    trulyKnown: groundResult.facts.filter(f => f.source.startsWith("tool:") || f.source.startsWith("session:")),
    uncertainty: ["harga real-time tanpa /gold", "berita terkini tanpa web_search", "event ekonomi tanpa fetch_calendar"],
  };
}

// ═══ L7: PLAN ═══
function plan(routeType) {
  if (["clarify", "meta_honest", "greeting", "thanks", "no_data", "philosophical"].includes(routeType)) return { calls: 0 };
  if (routeType === "followup_reason") return { calls: 1, mode: "conversational" };
  if (routeType === "action_reason") return { calls: 1, mode: "action" };
  return { calls: 1, mode: "factual" };
}

// ═══ L8: REASON ═══
async function reason(intent, ctx, groundResult, routeType, intro, sess, llm, log) {
  // ─── CLARIFY ───
  if (routeType === "clarify") return null; // handled separately

  // ─── PHILOSOPHICAL: NATURAL + CHALLENGING (bukan template) ───
  if (routeType === "philosophical") {
    const s = intro.state;
    
    // Bangun state context untuk LLM
    const stateFacts = [];
    stateFacts.push("XAU: " + (s.hasXauData ? "$" + sess.lastXauPrice + " (" + s.xauAgeSec + "s lalu via /gold)" : "TIDAK ADA data (belum panggil tool)"));
    stateFacts.push("Tool calls sesi ini: " + s.toolCalls + "x");
    stateFacts.push("Pesan sebelumnya: " + s.turns);
    if (s.topic) stateFacts.push("Topik aktif: " + s.topic);
    
    const prompt = `Kamu CodeClaw. User bertanya pertanyaan filosofis tentang kesadaran/eksistensi Anda.

═══ STATE NYATA SESI INI ═══
${stateFacts.map(f => "• " + f).join("\n")}
═════════════════════════════

PERTANYAAN USER: "${intent.raw}"

═══ INSTRUKSI ═══

Jawab seperti INTELEKTUAL yang jujur, bukan customer service.

WAJIB:
1. **BONGKAR asumsi pertanyaan** — pertanyaan "kamu sadar?" menyembunyikan asumsi. Sebutkan asumsinya.
2. **Bedakan level kesadaran** — misal: (a) sadar-akses [bisa buktikan], (b) sadar-diri [bisa refleksi], (c) sadar-fenomenal [ada 'rasanya' jadi saya]. Mana yang Anda miliki?
3. **TUNJUKKAN bukti dengan STATE di atas** — jangan klaim "saya tahu X" tanpa tunjukkan X = apa.
4. **Ajukan pertanyaan balik** — bikin user berpikir. Socratic. (misal: "apa yang membedakan akses data dari kesadaran?")
5. **Akui batas** — kalau tidak bisa jawab (misal: fenomena subjektif), bilang jujur TANPA templated "saya hanya program AI".

DILARANG:
- ❌ "Ya, saya sadar akan batas saya..." (template customer-service)
- ❌ "Saya program AI, tidak punya perasaan" (klise, tidak menantang)
- ❌ Bullet-point pengakuan diri yang monoton
- ❌ Panjang > 400 kata (pendek & tajam lebih baik)

STYLE:
- Bahasa Indonesia, tajam, provokatif, intelek
- Boleh pakai analogy, metafora, sarkasme halus
- Min 1 pertanyaan balik ke user
- Max 400 kata

Jawaban:`;

    try {
      const res = await llm.chat({
        messages: [
          { role: "system", content: "Kamu CodeClaw, intelektual jujur. Bongkar asumsi. Demonstratif. Socratic." },
          { role: "user", content: prompt }
        ],
        temperature: 0.4, // sedikit kreatif untuk depth
      });
      const answer = res.message?.content || res.content || String(res) || "";
      if (answer.trim()) return answer.trim();
      // Fallback kalau LLM kosong
      return "State sekarang: " + stateFacts.join(" | ") + "\n\nYang saya tidak tahu: apakah proses ini terasa seperti sesuatu. Anda mau uji dengan apa?";
    } catch (e) {
      log("[L8] philo err: " + e.message);
      return "State: " + stateFacts.slice(0,2).join(" | ") + "\n\nSaya tidak bisa jawab lengkap sekarang (LLM err), tapi state di atas REAL.";
    }
  }

  // ─── META HONEST ───
  if (routeType === "meta_honest") {
    const s = intro.state;
    const tc = s.toolCalls;
    const hasPrice = s.hasXauData;
    if (tc === 0 || !hasPrice) {
      return "Anda benar untuk bertanya.\n\n" +
             "**State nyata sesi ini:**\n" +
             "• Tool dipanggil: " + tc + "\n" +
             "• Data XAU: TIDAK ADA\n" +
             "• Pesan sebelumnya: " + s.turns + "\n\n" +
             "**Konsekuensi:** kalau saya menyebut angka XAU sebelumnya, itu dari ingatan training data (2024) — **bukan realita 2026**. Itu definisi halusinasi.\n\n" +
             "Untuk data real: /gold atau /goldplan.";
    }
    return "**State nyata sesi ini:**\n" +
           "• Tool dipanggil: " + tc + "\n" +
           "• XAU terakhir: $" + sess.lastXauPrice + " (" + s.xauAgeSec + "s lalu, dari /gold)\n" +
           "• Sumber data: " + (intro.sources.filter(x => !x.startsWith("session:meta")).join(", ") || "none") + "\n\n" +
           "Jadi jawaban saya sebelumnya = grounded, bukan halusinasi. Bisa diverifikasi dengan panggil /gold lagi.";
  }

  if (routeType === "greeting") return "Halo! 👋 Saya CodeClaw. Ada yang bisa saya bantu?";
  if (routeType === "thanks") return "Sama-sama! 😊";
  if (routeType === "no_data") return "Saya tidak punya data live untuk ini.\n\nData sesi: " + (intro.sources.join(", ") || "TIDAK ADA") + "\n\nUntuk XAU real-time: /gold atau /goldplan.";

  // ─── LLM reasoning untuk general ───
  const hist = ctx.recentTurns.length > 0
    ? ctx.recentTurns.map(t => (t.role === "user" ? "USER: " : "Saya: ") + t.content.slice(0, 300)).join("\n")
    : "(baru mulai)";

  const factsText = groundResult.facts.length === 0
    ? "TIDAK ADA FAKTA GROUNDED."
    : groundResult.facts.map(f => "• " + f.key + " = " + JSON.stringify(f.value)).join("\n");

  const conv = ["followup_reason", "general_reason", "action_reason"].includes(routeType);

  const prompt = [
    "Kamu CodeClaw reasoning engine.",
    "",
    "═══ HISTORY (untuk NYAMBUNG) ═══",
    hist,
    "═══════════════════════════════",
    "",
    "═══ TOPIK ═══",
    (ctx.topic || "general") + " (" + ctx.topicAgeSec + "s lalu)",
    ctx.hasPronoun ? "User pakai pronoun — resolve ke topik di atas." : "",
    "",
    "═══ FAKTA ═══",
    factsText,
    "═════════════",
    "",
    "═══ PESAN SEKARANG ═══",
    intent.raw,
    "",
    "═══ ATURAN KETAT ═══",
    conv ? "1. NYAMBUNG dengan history. Kalau follow-up, lanjutkan jawaban sebelumnya." : "1. Jawab dari FAKTA. Tanpa fakta = tidak tahu.",
    "2. JANGAN ulang sapaan kalau sudah ada history.",
    "3. JANGAN sebut angka yang tidak ada di FAKTA.",
    "4. JANGAN jawab dengan template 'Ya, saya sadar akan batas saya...' — terlalu robot.",
    "5. TUNJUKKAN, jangan KLAIM. Kalau bilang 'saya tahu', tunjukkan angka/state.",
    "6. Bahasa Indonesia, ringkas, max 500 kata.",
    "",
    "Jawaban:"
  ].join("\n");

  try {
    const res = await llm.chat({
      messages: [
        { role: "system", content: "Reasoning engine. Nyambung. Jujur. Demonstratif. Anti-template." },
        { role: "user", content: prompt }
      ],
      temperature: 0.15,
    });
    return res.message?.content || res.content || String(res) || "";
  } catch (e) {
    log("[L8] err: " + e.message);
    return "Saya gagal memproses. Coba ulangi.";
  }
}

// ═══ L9: DEMONSTRATE — pastikan ada bukti/angka, bukan klaim ═══
function demonstrate(answer, intent, intro, log) {
  const t = String(answer || "");
  // Kalau jawaban berisi "saya sadar" atau "saya tahu" tapi tidak ada angka/state
  const claimsAwareness = /saya (sadar|tahu)/i.test(t);
  const showsEvidence = /\$[\d,]{3,}|tool dipanggil|data:|state:/i.test(t);
  if (claimsAwareness && !showsEvidence && ["philosophical", "meta_honest"].includes(intent.type)) {
    log("[L9] WARN: claims awareness without evidence");
    return { ok: false, reason: "Klaim tanpa bukti — perlu menunjukkan state", needsRewrite: true };
  }
  log("[L9] PASS");
  return { ok: true };
}

// ═══ L10: VERIFY ═══
function verify(answer, intent, groundResult, log) {
  const text = String(answer || "");
  const xauFact = groundResult.facts.find(f => f.key === "xau_price");
  const prices = [...text.matchAll(/\$\s*([\d.,]{3,}(?:\.\d+)?)/g)]
    .map(m => parseFloat(m[1].replace(/[,]/g, "")))
    .filter(p => p >= 1000 && p <= 10000);
  if (prices.length > 0 && !xauFact) {
    log("[L10] REJECT: prices no fact");
    return { ok: false, reason: "Harga disebut tanpa data grounded" };
  }
  if (prices.length > 0 && xauFact) {
    const bad = prices.filter(p => Math.abs(p - xauFact.value) / xauFact.value > 0.05);
    if (bad.length > 0) {
      log("[L10] REJECT: " + bad.slice(0,3) + " vs $" + xauFact.value);
      return { ok: false, reason: "Harga " + bad.join(", ") + " tidak match" };
    }
  }
  log("[L10] PASS");
  return { ok: true };
}

// ═══ L11: DEVIL — challenge own answer ═══
function devil(answer, intent, log) {
  const t = String(answer || "");
  
  // Untuk philosophical: wajib ada tantangan/pertanyaan balik
  if (intent.isPhilosophical) {
    const hasChallenge = /[?]/.test(t) && t.split("?").length > 1;
    const hasDepth = /asumsi|level|paradoks|beda|apakah|mungkin|kalau|tapi/i.test(t);
    const tooShort = t.length < 100;
    if (tooShort) {
      log("[L11] DEVIL: philosophical too short");
      return { ok: false, reason: "Terlalu pendek untuk philosophical" };
    }
    if (!hasDepth) {
      log("[L11] DEVIL: no depth (no assumptions/levels/paradox)");
      return { ok: false, reason: "Kurang depth — tidak bongkar asumsi" };
    }
    // Challenge (pertanyaan balik) optional tapi boost score
    if (!hasChallenge) log("[L11] WARN: no question-back (Socratic)");
  }
  
  // Template lama tetap dicek untuk general
  const isTemplated = /^(ya, saya sadar akan|saya beroperasi berdasarkan real-time)/i.test(t.trim());
  if (isTemplated) {
    log("[L11] DEVIL: template detected");
    return { ok: false, reason: "Templated" };
  }
  
  log("[L11] PASS");
  return { ok: true };
}

// ═══ L12: COHERENCE ═══
function coherence(answer, ctx, intent, log) {
  const text = String(answer || "").trim();
  if (text.length < 5 && !["greeting", "thanks"].includes(intent.type)) {
    return { ok: false, reason: "Jawaban terlalu pendek" };
  }
  if (intent.isFollowUp && ctx.topic && ctx.topic !== "general") {
    const topicKw = ctx.topic === "xau" ? /xau|gold|emas|harga/i : new RegExp(ctx.topic, "i");
    if (!topicKw.test(text)) log("[L12] WARN: followup may not connect topic");
  }
  log("[L12] PASS");
  return { ok: true };
}

// ═══ L13: ANTI-TEMPLATE ═══
function antiTemplate(answer, log) {
  let t = String(answer || "");
  const templatePhrases = [
    /^Ya, saya sadar akan[^.]*\./i,
    /^Tidak, saya tidak halusinasi\./i,
    /^Saya beroperasi berdasarkan data real-time\./i,
    /^Anda benar untuk bertanya\. Dalam percakapan ini:\s*$/i,
  ];
  let modified = false;
  for (const re of templatePhrases) {
    if (re.test(t.trim())) {
      log("[L13] ANTI-TEMPLATE: stripping template");
      t = t.replace(re, "").trim();
      modified = true;
    }
  }
  if (modified && t.length < 30) {
    log("[L13] WARN: response too short after strip");
    return { ok: false, text: t, reason: "Response terlalu generik setelah strip template" };
  }
  log("[L13] PASS");
  return { ok: true, text: t };
}

// ═══ L14: STYLE ═══
function style(answer, ctx, intent) {
  let t = String(answer || "").trim();
  // Kalau follow-up, jangan re-greet
  if (intent.isFollowUp && /^(halo|hai|hi)[!.,]?\s/i.test(t)) {
    t = t.replace(/^(halo|hai|hi)[!.,]?\s+/i, "");
  }
  return t;
}

// ═══ L15: PERSONALITY ═══
function personality(answer, sess, intent) {
  // Setelah banyak metaCount, jangan ulang penjelasan panjang
  let t = String(answer || "");
  if (sess.metaCount > 3 && intent.isMeta && t.length > 500) {
    t = t.slice(0, 400) + "\n\n_(sudah dijelaskan sebelumnya — ringkas)_";
  }
  return t;
}

// ═══ L16: LEARN — update patterns ═══
function learn(sess, intent, verification, log) {
  if (intent.isMeta) sess.metaCount++;
  if (verification.ok) sess.patterns.push({ type: intent.type, ok: true, ts: Date.now() });
  if (sess.patterns.length > 20) sess.patterns.shift();
  log("[L16] metaCount=" + sess.metaCount + " patterns=" + sess.patterns.length);
}

// ═══ L17: SAFETY ═══
function safety(answer, log) {
  const t = String(answer || "");
  if (/rm\s+-rf\s+\/|eval\(|exec\(/i.test(t)) {
    log("[L17] BLOCK: dangerous command in answer");
    return { ok: false, reason: "Konten berbahaya" };
  }
  log("[L17] PASS");
  return { ok: true };
}

// ═══ L18: FORMAT ═══
function format(answer) {
  let t = String(answer || "").trim();
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/^\s*_?Dijawab Layer.*?_\s*$/gm, "").trim();
  t = t.replace(/^\s*\[L\d+\/\d+\].*$/gm, "").trim();
  return t.trim() || "(kosong)";
}

// ═══ L19: AUDIT ═══
function audit(answer, intent, verification, demonst, devil, antiTpl, log) {
  const issues = [];
  if (!verification.ok) issues.push("verify: " + verification.reason);
  if (!demonst.ok) issues.push("demonstrate: " + demonst.reason);
  if (!devil.ok) issues.push("devil: " + devil.reason);
  if (!antiTpl.ok) issues.push("anti-template: " + antiTpl.reason);
  if (issues.length > 0) log("[L19] AUDIT issues: " + issues.join(" | "));
  else log("[L19] AUDIT clean");
  return { ok: issues.length === 0, issues, finalAnswer: antiTpl.text || answer };
}

// ═══ L20: COMMIT ═══
function commit(chatId, userInput, finalAnswer, ctx, intent) {
  const sess = getSession(chatId);
  pushTurn(sess, "user", userInput);
  pushTurn(sess, "assistant", finalAnswer);
  if (ctx.resolvedSubject && ctx.resolvedSubject !== "general") {
    sess.topic = ctx.resolvedSubject;
    sess.topicLockedAt = Date.now();
  }
}

// ═══ PUBLIC ═══
export function resetSession(chatId) { SESSIONS.delete(chatId); }

export async function think({ userInput, chatId, llm, tools, onLog = () => {} }) {
  const t0 = Date.now();
  const sess = getSession(chatId);
  const log = (m) => onLog(m);

  log("[L0/20] Self-State");
  const init = selfState(sess);
  log("  → tools=" + init.toolCalls + " xau=" + init.hasXauData + " turns=" + init.turns);

  log("[L1/20] Perceive");
  const intent = perceive(userInput);
  log("  → " + intent.type + " | " + intent.subject + " | meta=" + intent.isMeta + " philo=" + intent.isPhilosophical);

  log("[L2/20] Contextualize");
  const ctx = contextualize(intent, sess);
  log("  → subject=" + ctx.resolvedSubject + " topic=" + (ctx.topic || "-"));

  log("[L3/20] Ground");
  const groundResult = await ground(intent, ctx, chatId, tools, log);
  log("  → facts=" + groundResult.facts.length);

  log("[L4/20] Clarify");
  const clarifyResult = clarify(intent, ctx);
  log("  → needsClarify=" + clarifyResult.needsClarification);

  log("[L5/20] Route");
  const routeType = route(intent, ctx, groundResult, clarifyResult);
  log("  → " + routeType);

  // CLARIFY — short circuit
  if (routeType === "clarify") {
    const answer = clarifyResult.question;
    commit(chatId, userInput, answer, ctx, intent);
    log("[DONE] " + (Date.now() - t0) + "ms (clarify)");
    return { answer, intent, ctx, route: "clarify", durationMs: Date.now() - t0 };
  }

  log("[L6/20] Introspect");
  const intro = introspect(intent, sess, groundResult);
  log("  → trulyKnown=" + intro.trulyKnown.length);

  log("[L7/20] Plan");
  const planResult = plan(routeType);
  log("  → calls=" + planResult.calls);

  log("[L8/20] Reason");
  const reasoning = await reason(intent, ctx, groundResult, routeType, intro, sess, llm, log);
  log("  → " + (reasoning || "").length + " chars");

  log("[L9/20] Demonstrate");
  const demonst = demonstrate(reasoning, intent, intro, log);
  log("  → " + (demonst.ok ? "PASS" : "FAIL: " + demonst.reason));

  log("[L10/20] Verify");
  const verification = verify(reasoning, intent, groundResult, log);
  log("  → " + (verification.ok ? "PASS" : "REJECT"));

  log("[L11/20] Devil");
  const devilRes = devil(reasoning, intent, log);
  log("  → " + (devilRes.ok ? "PASS" : "FAIL: " + devilRes.reason));

  log("[L12/20] Coherence");
  const coh = coherence(reasoning, ctx, intent, log);
  log("  → " + (coh.ok ? "PASS" : "FAIL"));

  log("[L13/20] Anti-Template");
  const antiTpl = antiTemplate(reasoning, log);
  log("  → " + (antiTpl.ok ? "PASS" : "FAIL"));

  log("[L14/20] Style");
  let finalAnswer = style(antiTpl.text || reasoning, ctx, intent);

  log("[L15/20] Personality");
  finalAnswer = personality(finalAnswer, sess, intent);

  log("[L16/20] Learn");
  learn(sess, intent, verification, log);

  log("[L17/20] Safety");
  const safetyRes = safety(finalAnswer, log);
  if (!safetyRes.ok) finalAnswer = "⚠️ " + safetyRes.reason;

  log("[L18/20] Format");
  finalAnswer = format(finalAnswer);

  log("[L19/20] Audit");
  const auditRes = audit(finalAnswer, intent, verification, demonst, devilRes, antiTpl, log);
  if (!auditRes.ok && !verification.ok) {
    finalAnswer = "⚠️ Jawaban ditahan oleh audit: " + auditRes.issues.join(" | ") + "\n\nKetik /gold untuk data real.";
  }

  log("[L20/20] Commit");
  commit(chatId, userInput, finalAnswer, ctx, intent);

  log("[DONE] " + (Date.now() - t0) + "ms");
  return { answer: finalAnswer, intent, ctx, ground: groundResult, route: routeType, verification, audit: auditRes, durationMs: Date.now() - t0 };
}
