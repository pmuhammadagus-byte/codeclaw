export function parseError(output) {
  const results = [];
  const seen = new Set();

  const nodeRe = /(?:^|\s)([\/~][\w\/\.\-]+\.(?:js|mjs|cjs|ts|tsx|jsx)):(\d+)(?::(\d+))?/gm;
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
    seen.add(key);
    results.push({ file: m[1], line: parseInt(m[2]), col: null, lang: "generic" });
  }

  const lines = output.trim().split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const errorType = (lastLine.match(/^([A-Z][\w]*(?:Error|Exception))/)?.[1]) ?? null;

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
