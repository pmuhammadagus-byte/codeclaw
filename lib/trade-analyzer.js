import fs from "node:fs";

const TRADE_LOG = "/root/codeclaw/trade-log.jsonl";
const TRADE_STATE = "/root/codeclaw/.trade-state.json";

export function readTradeState() {
  try {
    if (!fs.existsSync(TRADE_STATE)) return { lastAutoRun: null, autoEnabled: false };
    return JSON.parse(fs.readFileSync(TRADE_STATE, "utf8"));
  } catch { return { lastAutoRun: null, autoEnabled: false }; }
}

export function writeTradeState(s) {
  fs.writeFileSync(TRADE_STATE, JSON.stringify(s, null, 2));
}

export function readRecentTrades(limit = 10) {
  try {
    if (!fs.existsSync(TRADE_LOG)) return [];
    return fs.readFileSync(TRADE_LOG, "utf8").split("\n").filter(Boolean).slice(-limit).reverse().map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function computeTradeStats() {
  const all = readRecentTrades(1000);
  const byEntry = { BUY: 0, SELL: 0, WAIT: 0 };
  all.forEach(t => { if (byEntry[t.entry] !== undefined) byEntry[t.entry]++; });
  return { total: all.length, byEntry, recent: all.slice(0, 5) };
}

export async function fetchGoldPrice(twelveDataKey) {
  if (!twelveDataKey) return { price: null, source: "none" };
  try {
    const res = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${twelveDataKey}`);
    const data = await res.json();
    if (data.price) return { price: parseFloat(data.price), source: "twelvedata" };
  } catch {}
  return { price: null, source: "none" };
}

const TRADE_PROMPT = `Kamu senior XAU/USD trader. Analisa gold dan berikan signal trading.

Harga saat ini: {PRICE}
Waktu: {TIMESTAMP}

Output WAJIB format exact berikut (jangan tambah/kurangi):

TREND: [BULLISH/BEARISH/SIDEWAYS]
ENTRY: [BUY/SELL/WAIT]
ENTRY_PRICE: [angka]
STOP_LOSS: [angka]
TP1: [angka]
TP2: [angka]
TP3: [angka]
CONFIDENCE: [0-100]%

ALASAN_TEKNIKAL:
- [poin 1]
- [poin 2]

RISIKO:
- [risiko 1]
- [risiko 2]

INVALIDASI: [level harga]`;

export function parseTradeAnalysis(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : null;
  };
  const getList = (key) => {
    const m = text.match(new RegExp(`${key}:\\s*\\n((?:- .+\\n?)+)`, "im"));
    if (!m) return [];
    return m[1].split("\n").filter(l => l.trim().startsWith("- ")).map(l => l.slice(2).trim());
  };
  return {
    trend: get("TREND"),
    entry: get("ENTRY"),
    entry_price: parseFloat(get("ENTRY_PRICE") || "0"),
    stop_loss: parseFloat(get("STOP_LOSS") || "0"),
    tp1: parseFloat(get("TP1") || "0"),
    tp2: parseFloat(get("TP2") || "0"),
    tp3: parseFloat(get("TP3") || "0"),
    confidence: get("CONFIDENCE"),
    reasons_technical: getList("ALASAN_TEKNIKAL"),
    risks: getList("RISIKO"),
    invalidation: get("INVALIDASI"),
    raw: text,
  };
}

export function formatTradeForTelegram(p, price, ts) {
  const fmt = (n) => n ? n.toFixed(2) : "-";
  let txt = `📊 XAU/USD Signal\n🗓 ${ts}\n\n`;
  txt += `📈 TREND: ${p.trend || "-"}\n`;
  txt += `🎯 ENTRY: ${p.entry || "WAIT"}\n`;
  if (p.entry && p.entry !== "WAIT") {
    txt += `📍 Entry: ${fmt(p.entry_price)}\n`;
    txt += `🛑 SL: ${fmt(p.stop_loss)}\n`;
    txt += `✅ TP1: ${fmt(p.tp1)}\n`;
    txt += `✅ TP2: ${fmt(p.tp2)}\n`;
    txt += `✅ TP3: ${fmt(p.tp3)}\n`;
  }
  txt += `🎲 Confidence: ${p.confidence || "-"}\n`;
  if (p.reasons_technical?.length) {
    txt += `\n📝 TEKNIKAL:\n${p.reasons_technical.map(r => "• " + r).join("\n")}\n`;
  }
  if (p.risks?.length) {
    txt += `\n⚠️ RISIKO:\n${p.risks.map(r => "• " + r).join("\n")}\n`;
  }
  if (p.invalidation) txt += `\n❌ INVALIDASI: ${p.invalidation}\n`;
  txt += `\n⚠️ Bukan financial advice. Risk 1-2% per trade.`;
  return txt;
}

export async function runTradeAnalysis({ llm, price, twelveDataKey, saveSkill = true }) {
  const timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  let currentPrice = price;
  let priceSource = price ? "manual" : "auto";

  if (!currentPrice) {
    const res = await fetchGoldPrice(twelveDataKey);
    currentPrice = res.price;
    priceSource = res.source;
  }
  if (!currentPrice) {
    throw new Error("Harga XAU/USD tidak tersedia. Kirim manual: /trade 2745.50 atau set TWELVEDATA_API_KEY");
  }

  const prompt = TRADE_PROMPT
    .replace("{PRICE}", currentPrice.toFixed(2))
    .replace("{TIMESTAMP}", timestamp);

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const analysisText = resp.message?.content || "";
  const parsed = parseTradeAnalysis(analysisText);
  const formatted = formatTradeForTelegram(parsed, currentPrice, timestamp);

  try {
    fs.appendFileSync(TRADE_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      price: currentPrice,
      price_source: priceSource,
      entry: parsed.entry,
      entry_price: parsed.entry_price,
      sl: parsed.stop_loss,
      tp1: parsed.tp1,
      tp2: parsed.tp2,
      tp3: parsed.tp3,
      confidence: parsed.confidence,
      trend: parsed.trend,
    }) + "\n");
  } catch {}

  // Auto-save sebagai skill
  let skillSaved = false;
  if (saveSkill && parsed.entry && parsed.entry !== "WAIT") {
    try {
      const { SkillStore } = await import("./skills.js");
      const store = new SkillStore();
      const dateStr = new Date().toISOString().slice(0, 10);
      store.save({
        name: `trade: XAU/USD ${dateStr} ${parsed.entry}`,
        trigger: `XAU/USD gold trade signal ${parsed.entry} ${parsed.trend || ""} ${dateStr}`,
        procedure: analysisText,
        tags: ["xauusd", "gold", "trade", (parsed.entry || "").toLowerCase(), (parsed.trend || "").toLowerCase(), dateStr],
        examples: [],
      });
      skillSaved = true;
    } catch (e) {
      console.error("[trade-analyzer] skill save error:", e.message);
    }
  }

  return { parsed, formatted, price: currentPrice, priceSource, skillSaved };
}
