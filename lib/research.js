import { webFetch } from "./web.js";

// ============================================================================
// RELEVANCE SCORING
// ============================================================================
// Tujuan: jangan pernah lagi memasukkan berita acak (mis. "skin cancer" atau
// "FOSDEM") ke knowledge.db hanya karena kebetulan nangkring di front page HN.
//
// Skor: kata kunci yang muncul di JUDUL bernilai 3, di KONTEN bernilai 1.
// Ambang MIN_RELEVANCE = 2  →  minimal satu kata kunci di judul, ATAU dua kata
// kunci di konten. Di bawah itu item dibuang.

export const MIN_RELEVANCE = 2;

// Kata yang tidak punya daya beda topik. "2026" juga dibuang karena hanya
// mencocokkan tanggal, bukan substansi.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "about",
  "are", "was", "were", "has", "have", "had", "its", "their", "our", "your",
  "you", "can", "will", "would", "should", "could", "may", "might",
  "what", "when", "where", "which", "who", "how", "why",
  "not", "but", "all", "any", "some", "more", "most", "other", "than",
  "then", "there", "these", "those", "them", "they", "she", "him", "her",
  "use", "using", "used", "via", "per", "new", "now", "get", "got",
  "based", "such", "very", "just", "also", "over", "under", "between",
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pecah topik menjadi kata kunci pendek & bermakna. */
export function extractKeywords(topic, max = 5) {
  const words = String(topic || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  // Buang duplikat, pertahankan urutan.
  return [...new Set(words)].slice(0, max);
}

/** Hitung relevansi satu item terhadap daftar kata kunci. */
export function scoreRelevance(item, keywords) {
  const title = String(item?.title || "").toLowerCase();
  const content = String(item?.content || "").toLowerCase();

  let score = 0;
  let hits = 0;
  const matched = [];

  for (const kw of keywords) {
    // Cocokkan whole-word, toleran terhadap bentuk jamak/gerund.
    const re = new RegExp(`\\b${escapeRe(kw)}(?:s|es|ing|ed)?\\b`, "i");
    if (re.test(title)) {
      score += 3;
      hits++;
      matched.push(kw);
    } else if (re.test(content)) {
      score += 1;
      hits++;
      matched.push(kw);
    }
  }

  const maxPossible = keywords.length * 3;
  return {
    score,
    hits,
    matched,
    ratio: maxPossible ? Number((score / maxPossible).toFixed(3)) : 0,
  };
}

/** Saring + urutkan item berdasarkan relevansi. */
function filterRelevant(items, topic, limit) {
  const keywords = extractKeywords(topic);
  const kept = [];
  const dropped = [];

  for (const item of items ?? []) {
    const rel = scoreRelevance(item, keywords);
    const enriched = { ...item, relevance: rel };
    if (rel.score >= MIN_RELEVANCE) kept.push(enriched);
    else dropped.push(enriched);
  }

  kept.sort((a, b) => b.relevance.score - a.relevance.score);
  return { keywords, kept: kept.slice(0, limit), dropped, total: (items ?? []).length };
}

// ============================================================================
// ARXIV
// ============================================================================
// Query panjang ("AI coding agent software engineering capabilities") di-encode
// jadi satu frasa utuh oleh `all:` → hasil nyaris nol. Sekarang: pecah jadi
// kata kunci, gabung dengan AND, dan urutkan berdasarkan relevance.

export function buildArxivQuery(topic) {
  const keywords = extractKeywords(topic, 4);
  if (!keywords.length) return "all:agent";
  return keywords.map((k) => `all:${k}`).join("+AND+");
}

export async function researchArxiv(query, limit = 3) {
  // Kalau `query` sudah berbentuk ekspresi ArXiv (mengandung "all:"), pakai apa
  // adanya. Kalau masih topik bebas, bangun query kata kunci otomatis.
  const arxivQuery = String(query).includes("all:")
    ? query
    : buildArxivQuery(query);

  const url =
    `https://export.arxiv.org/api/query?search_query=${arxivQuery}` +
    `&max_results=${Math.max(limit * 3, 6)}&sortBy=relevance&sortOrder=descending`;

  const xml = await webFetch(url, { maxBytes: 80_000 });

  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRegex.exec(xml)) !== null) {
    const e = m[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").trim().replace(/\s+/g, " ");
    const summary = (e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").trim().replace(/\s+/g, " ");
    const id = (e.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "").trim();
    const published = (e.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? "").trim();
    if (title && summary) entries.push({ title, content: summary.slice(0, 1500), url: id, published });
  }
  return entries;
}

// ============================================================================
// HACKER NEWS — Algolia Search API (terfilter topik)
// ============================================================================
// Sebelumnya memakai /v0/topstories.json yang TIDAK menerima query sama sekali,
// sehingga selalu mengambil 2 berita teratas front page apa pun topiknya.
// Algolia mendukung pencarian kata kunci sungguhan.

export async function researchHackerNews(query, limit = 5) {
  const topic = String(query || "").trim();
  if (!topic) return [];

  // tags=story → hanya cerita, bukan komentar.
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}` +
    `&tags=story&hitsPerPage=${Math.max(limit * 3, 10)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HN Algolia HTTP ${res.status}`);

  const data = await res.json();
  const hits = Array.isArray(data?.hits) ? data.hits : [];

  const items = [];
  for (const h of hits) {
    const title = h.title || h.story_title;
    if (!title) continue;
    const objectID = h.objectID;
    const points = h.points ?? 0;
    const comments = h.num_comments ?? 0;
    const body = (h.story_text || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    items.push({
      title,
      content:
        `By ${h.author || "?"} | ${points} points | ${comments} comments` +
        ` | ${h.created_at || ""}${body ? "\n" + body.slice(0, 500) : ""}`,
      url: h.url || `https://news.ycombinator.com/item?id=${objectID}`,
    });
  }
  return items;
}

// ============================================================================
// GITHUB TRENDING (tidak diubah)
// ============================================================================
export async function researchGitHubTrending(lang = "", limit = 5) {
  const url = `https://github.com/trending/${lang ? encodeURIComponent(lang) : ""}?since=daily`;
  const html = await webFetch(url, { maxBytes: 200_000 });

  const repos = [];
  const articleRegex = /<article[\s\S]*?<\/article>/g;
  let m;
  while ((m = articleRegex.exec(html)) !== null && repos.length < limit) {
    const a = m[0];
    const repoMatch = a.match(/<h2[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!repoMatch) continue;
    const repoPath = repoMatch[1].replace(/^\//, "");
    const desc = (a.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const stars = (a.match(/stargazers[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    if (repoPath && !repos.find((r) => r.url === `https://github.com/${repoPath}`)) {
      repos.push({
        title: repoPath,
        content: `${desc}\n⭐ ${stars}`,
        url: `https://github.com/${repoPath}`,
      });
    }
  }
  return repos;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================
export async function research({ topic, sources = ["arxiv", "hn"], limit = 3 }) {
  const keywords = extractKeywords(topic);
  const results = {
    topic,
    keywords,
    minRelevance: MIN_RELEVANCE,
    sources: {},
    dropped: {},
    stats: {},
    errors: [],
    notes: [],
  };

  const run = async (name, fn) => {
    try {
      const raw = await fn();
      const { kept, dropped, total } = filterRelevant(raw, topic, limit);
      results.sources[name] = kept;
      results.dropped[name] = dropped.map((d) => ({
        title: d.title,
        score: d.relevance.score,
      }));
      results.stats[name] = { total, kept: kept.length, dropped: dropped.length };
      results.notes.push(`${name}: ${kept.length}/${total} lolos filter`);
    } catch (e) {
      results.errors.push(`${name}: ${e.message}`);
    }
  };

  if (sources.includes("arxiv")) await run("arxiv", () => researchArxiv(topic, limit));
  if (sources.includes("hn")) await run("hn", () => researchHackerNews(topic, limit));
  if (sources.includes("github")) await run("github", () => researchGitHubTrending(topic, limit));

  return results;
}
