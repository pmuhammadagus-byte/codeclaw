// Session Awareness Layer — real state, bukan template
const contexts = new Map();

export function getContext(chatId) {
  if (!contexts.has(chatId)) {
    contexts.set(chatId, { toolsCalled: [], hasXauData: false, xauDataTs: null, lastXauPrice: null });
  }
  return contexts.get(chatId);
}

export function recordToolCall(chatId, toolName, args, result) {
  const ctx = getContext(chatId);
  const argStr = args?.command || args?.query || args?.url || null;
  ctx.toolsCalled.push({ tool: toolName, args: argStr, ts: Date.now() });
  if (ctx.toolsCalled.length > 50) ctx.toolsCalled.shift();

  const cmd = String(args?.command || "");
  const q = String(args?.query || "");
  if (/gold-analysis|gold\.mjs|goldplan/.test(cmd) || (/web_search|web_fetch/.test(toolName) && /xau|gold|emas/i.test(q))) {
    ctx.hasXauData = true;
    ctx.xauDataTs = Date.now();
    const m = String(result || "").match(/Harga:\s*(?:<b>)?([\d.]+)/);
    if (m) ctx.lastXauPrice = parseFloat(m[1]);
  }
}

export function resetContext(chatId) { contexts.delete(chatId); }

export function buildContextBlock(chatId) {
  const ctx = getContext(chatId);
  const lines = ["## SESSION CONTEXT (state nyata, bukan tebakan)"];
  lines.push(`Tool calls this session: ${ctx.toolsCalled.length === 0 ? "NONE" : ctx.toolsCalled.length + " total, terakhir: " + ctx.toolsCalled.slice(-5).map(t => t.tool + "(" + (t.args || "?") + ")").join(", ")}`);
  const ageMin = ctx.hasXauData ? Math.floor((Date.now() - ctx.xauDataTs) / 60000) : null;
  if (ctx.hasXauData && ageMin < 5) {
    lines.push(`XAU live data: TERSEDIA (${ageMin}m lalu, harga terakhir: $${ctx.lastXauPrice || "?"})`);
  } else if (ctx.hasXauData) {
    lines.push(`XAU live data: STALE (${ageMin}m lalu — refresh via /gold)`);
  } else {
    lines.push(`XAU live data: TIDAK TERSEDIA. Kamu BELUM memanggil /gold atau web_search untuk XAU di sesi ini.`);
  }
  return lines.join("\n") + "\n\n";
}

export function validateResponse(text, chatId) {
  const ctx = getContext(chatId);
  const errors = [];
  const prices = [...String(text).matchAll(/\$\s*([\d,]{4,}(?:\.\d+)?)/g)].map(m => parseFloat(m[1].replace(/,/g, "")));
  const xauPrices = prices.filter(p => p >= 2000 && p <= 6000);
  if (xauPrices.length > 0 && !ctx.hasXauData) {
    errors.push(`Response menyebut harga XAU (${xauPrices.slice(0, 3).join(", ")}) tapi TIDAK ADA data XAU yang di-fetch sesi ini. Halusinasi.`);
  }
  return { ok: errors.length === 0, errors };
}
