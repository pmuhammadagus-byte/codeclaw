import { setupIPv4Dispatcher } from "./ipv4-lookup.js";
await setupIPv4Dispatcher();

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  const code = err?.cause?.code || err?.code;
  if (code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"].includes(code)) return true;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return true;
  return /fetch failed|socket hang up|other side closed|network|timeout/i.test(String(err?.message || ""));
}

async function fetchWithRetry(url, opts = {}, { retries = 2, timeoutMs = 30_000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === retries) break;
    }
  }
  const code = lastErr?.cause?.code || lastErr?.code;
  throw new Error(`fetch gagal: ${code ? code + ": " : ""}${lastErr?.cause?.message || lastErr?.message || "unknown"}`, { cause: lastErr });
}

export async function webFetch(url, { maxBytes = 100_000 } = {}) {
  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, redirect: "follow" });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") ?? "";

  let body = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    body += decoder.decode(value, { stream: true });
    if (total >= maxBytes) break;
  }

  if (!ct.includes("html")) return body.slice(0, maxBytes);
  return htmlToText(body).slice(0, maxBytes);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function webSearch(query, limit = 8) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA, "Accept": "text/html" } });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    let href = m[1];
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    const title = stripTags(m[2] ?? "").trim();
    const snippet = stripTags(m[3] ?? "").trim();
    if (title && href.startsWith("http")) results.push({ title, url: href, snippet });
  }
  return results;
}

function stripTags(s) { return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
