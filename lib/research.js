import { webFetch } from "./web.js";

// === ArXiv (paper terbaru) ===
export async function researchArxiv(query, limit = 3) {
  // ArXiv API: http://export.arxiv.org/api/query?search_query=all:QUERY&max_results=N
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await webFetch(url, { maxBytes: 50_000 });

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

// === Hacker News (top stories) ===
export async function researchHackerNews(limit = 5) {
  const idsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  const ids = (await idsRes.json()).slice(0, limit);

  const items = [];
  for (const id of ids) {
    try {
      const item = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json();
      if (item && item.title) {
        items.push({
          title: item.title,
          content: `By ${item.by} | ${item.score ?? 0} points | ${item.descendants ?? 0} comments${item.text ? "\n" + item.text.slice(0, 500) : ""}`,
          url: item.url || `https://news.ycombinator.com/item?id=${id}`,
        });
      }
    } catch {}
  }
  return items;
}

// === GitHub trending (via HTML scrape) ===
export async function researchGitHubTrending(lang = "", limit = 5) {
  const url = `https://github.com/trending/${lang ? encodeURIComponent(lang) : ""}?since=daily`;
  const html = await webFetch(url, { maxBytes: 200_000 });

  const repos = [];
  // Extract: <h2>...<a href="/user/repo">...</a></h2> + description
  const articleRegex = /<article[\s\S]*?<\/article>/g;
  let m;
  while ((m = articleRegex.exec(html)) !== null && repos.length < limit) {
    const a = m[0];
    const repoMatch = a.match(/<h2[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!repoMatch) continue;
    const repoPath = repoMatch[1].replace(/^\//, "");
    const desc = (a.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const stars = (a.match(/stargazers[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    if (repoPath && !repos.find(r => r.url === `https://github.com/${repoPath}`)) {
      repos.push({
        title: repoPath,
        content: `${desc}\n⭐ ${stars}`,
        url: `https://github.com/${repoPath}`,
      });
    }
  }
  return repos;
}

// === Main orchestrator ===
export async function research({ topic, sources = ["arxiv", "hn"], limit = 3 }) {
  const results = { topic, sources: {}, errors: [] };

  if (sources.includes("arxiv")) {
    try {
      results.sources.arxiv = await researchArxiv(topic, limit);
    } catch (e) { results.errors.push(`arxiv: ${e.message}`); }
  }
  if (sources.includes("hn")) {
    try {
      results.sources.hn = await researchHackerNews(limit);
    } catch (e) { results.errors.push(`hn: ${e.message}`); }
  }
  if (sources.includes("github")) {
    try {
      results.sources.github = await researchGitHubTrending(topic, limit);
    } catch (e) { results.errors.push(`github: ${e.message}`); }
  }

  return results;
}
