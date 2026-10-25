export function parseError(output) {
  const results = [];
  const seen = new Set();

  // Path absolut bisa didahului spasi, awal baris, atau kurung buka
  // seperti pada stack trace Node: "at run (/app/lib/tools.js:42:13)".
  const nodeRe = /(?:^|[\s(])([\/~][\w\/\.\-]+\.(?:js|mjs|cjs|ts|tsx|jsx)):(\d+)(?::(\d+))?/gm;
  let m;
  while ((m = nodeRe.exec(output)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ file: m[1], line: parseInt(m[2]), col: m[3] ? parseInt(m[3]) : null, lang: "node" });
  }

  const pyRe = /File "([^"]+\.py)", line (\d+)/g;
  while ((m = pyRe.exec(output)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ file: m[1], line: parseInt(m[2]), col: null, lang: "python" });
  }

  const genRe = /([\w\.\-]+\.(?:js|ts|py|rb|go|rs|c|cpp|java|php|sh)):(\d+)/g;
  while ((m = genRe.exec(output)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    // Jangan laporkan dua kali: path absolut yang sudah tertangkap regex di atas
    // juga cocok dengan pola generik (mis. "/p/q.js:3" vs "q.js:3").
    if (results.some((r) => r.file.endsWith(m[1]) && r.line === parseInt(m[2]))) continue;
    seen.add(key);
    results.push({ file: m[1], line: parseInt(m[2]), col: null, lang: "generic" });
  }

  // Nama error biasanya ada di baris pertama ("TypeError: ..."), bukan di
  // baris terakhir (yang umumnya frame "at ..."). Cek dari atas dulu, lalu
  // fallback ke baris terakhir.
  const lines = output.trim().split("\n");
  const errorRe = /^([A-Z][\w]*(?:Error|Exception))\b|^(Error|Exception)\b/;
  let errorType = null;
  for (const line of lines.slice(0, 5)) {
    const m2 = line.trim().match(errorRe);
    if (m2) { errorType = m2[1] ?? m2[2]; break; }
  }
  if (!errorType) {
    const lastLine = lines[lines.length - 1] ?? "";
    const m3 = lastLine.trim().match(errorRe);
    errorType = m3 ? (m3[1] ?? m3[2]) : null;
  }

  return { locations: results.slice(0, 10), errorType, raw: output };
}

export function formatParsed(parsed) {
  if (!parsed.locations.length && !parsed.errorType) return "No locations or error type found.";
  const lines = [];
  if (parsed.errorType) lines.push(`Error type: ${parsed.errorType}`);
  if (parsed.locations.length) {
    lines.push("Locations:");
    for (const loc of parsed.locations)
      lines.push(`  ${loc.file}:${loc.line}${loc.col ? ":" + loc.col : ""} (${loc.lang})`);
  }
  return lines.join("\n");
}
