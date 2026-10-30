import fs from "node:fs";

import { TRADE_LOG, TRADE_STATE } from "./paths.js";

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

export async function fetchGoldMarketData(twelveDataKey) {
  if (!twelveDataKey) return { price: null, candles: [], source: "none" };
  try {
    // 1. Price
    const priceRes = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${twelveDataKey}`);
    const priceData = await priceRes.json();
    const price = priceData.price ? parseFloat(priceData.price) : null;

    // 2. Candle H4 (30 candle terakhir = ~5 hari)
    let candles = [];
    try {
      const tsRes = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=4h&outputsize=30&apikey=${twelveDataKey}`);
      const tsData = await tsRes.json();
      if (tsData.values && Array.isArray(tsData.values)) {
        candles = tsData.values.map(v => ({
          datetime: v.datetime,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
        }));
      }
    } catch {}

    return { price, candles, source: "twelvedata" };
  } catch {}
  return { price: null, candles: [], source: "none" };
}

export async function fetchGoldPrice(twelveDataKey) {
  const data = await fetchGoldMarketData(twelveDataKey);
  return { price: data.price, source: data.source };
}

const TRADE_PROMPT = `Kamu senior XAU/USD trader. Analisa gold berdasarkan data real di bawah.

HARGA SPOT: {PRICE}
WAKTU: {TIMESTAMP}

DATA CANDLE H4 (30 terakhir, urut dari lama → terbaru):
{CANDLES}

INSTRUKSI ANALISA:
1. Identifikasi trend utama dari 30 candle H4 (BULLISH/BEARISH/SIDEWAYS)
2. Cari support & resistance dari swing high/low
3. Cek momentum (higher highs / lower lows / konsolidasi)
4. Tentukan entry setup yang valid
5. Hitung SL di balik swing / S/R, TP bertingkat

Output WAJIB format EXACT (tanpa markdown **, ##, atau prose):

TREND: BULLISH
ENTRY: BUY
ENTRY_PRICE: 3946.95
STOP_LOSS: 3925.00
TP1: 3970.00
TP2: 4000.00
TP3: 4050.00
CONFIDENCE: 75

ALASAN_TEKNIKAL:
- Support 3925 terbukti hold 3x
- Bullish engulfing H4 close terakhir

RISIKO:
- NFP news 19:30 WIB

INVALIDASI: Close H4 di bawah 3925

ATURAN KERAS:
1. JANGAN pakai markdown
2. Entry: BUY/SELL/WAIT saja
3. Kalau trend tidak jelas atau data tidak cukup, ENTRY: WAIT + Confidence 0
4. Kalau setup valid, Confidence 60-90`;

export function parseTradeAnalysis(text) {
  const cleanKey = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const get = (key) => {
    const ek = cleanKey(key);
    const regex = new RegExp(
      "(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?(?:_\\*|\\*_)?\\s*" + ek + "\\s*(?:_\\*|\\*_)?(?:\\*\\*)?\\s*[:=]\\s*(?:\\*\\*)?(.+?)(?:\\*\\*)?\\s*$",
      "im"
    );
    const m = text.match(regex);
    return m ? m[1].trim() : null;
  };

  const getList = (key) => {
    const ek = cleanKey(key);
    const regex = new RegExp(
      "(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?\\s*" + ek + "\\s*(?:\\*\\*)?\\s*[:=]\\s*\\n((?:\\s*[-*] .+\\n?)+)",
      "im"
    );
    const m = text.match(regex);
    if (!m) return [];
    return m[1]
      .split("\\n")
      .filter(l => /^\s*[-*] /.test(l))
      .map(l => l.replace(/^\s*[-*] /, "").trim());
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
  let candles = [];

  if (!currentPrice || twelveDataKey) {
    const res = await fetchGoldMarketData(twelveDataKey);
    if (!currentPrice) currentPrice = res.price;
    candles = res.candles || [];
    if (res.source !== "none") priceSource = res.source;
  }
  if (!currentPrice) {
    throw new Error("Harga XAU/USD tidak tersedia. Kirim manual: /trade 2745.50 atau set TWELVEDATA_API_KEY");
  }

  // Format candle jadi text untuk LLM
  const candleText = candles.length > 0
    ? candles.map(c => `${c.datetime} | O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)}`).join("\\n")
    : "(data candle tidak tersedia)";

  const prompt = TRADE_PROMPT
    .replace("{PRICE}", currentPrice.toFixed(2))
    .replace("{TIMESTAMP}", timestamp)
    .replace("{CANDLES}", candleText);

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const analysisText = resp.message?.content || "";
  console.log("[trade-analyzer] RAW LLM RESPONSE:\n---\n" + analysisText.slice(0, 1500) + "\n---");
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
