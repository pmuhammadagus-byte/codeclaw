export async function getEmbedding(text, exaKey) {
  if (!exaKey) return null;
  try {
    const res = await fetch("https://api.exa.ai/embeddings", {
      method: "POST",
      headers: { "x-api-key": exaKey, "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text] })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embeddings?.[0]?.embedding || null;
  } catch { return null; }
}
