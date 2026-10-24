const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export async function webFetch(url, { maxBytes = 100_000, exaApiKey = "" } = {}) {
  if (exaApiKey) {
    try {
      const res = await fetch("https://api.exa.ai/contents", {
        method: "POST",
        headers: { "x-api-key": exaApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [url], text: true })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results?.[0]?.text) return data.results[0].text.slice(0, maxBytes);
      }
    } catch (e) { console.log("[web] Exa fetch error:", e.message); }
  }

  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
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

export async function webSearch(query, limit = 5, exaApiKey = "") {
  if (exaApiKey) {
    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": exaApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query, numResults: limit, contents: { text: { maxCharacters: 1000 } } })
      });
      if (res.ok) {
        const data = await res.json();
        return (data.results || []).map(r => ({
          title: r.title || "No Title",
          url: r.url,
          snippet: r.text || "No snippet"
        }));
      }
    } catch (e) { console.log("[web] Exa search error:", e.message); }
  }

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" } });
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
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s{2,}/g, "\n").trim();
}
function stripTags(s) { return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
