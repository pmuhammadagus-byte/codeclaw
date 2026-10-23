export function diffLines(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length, n = newLines.length;

  if (m * n > 100000) {
    return [
      { type: "info", text: `[diff too large: ${m} → ${n} lines]` },
      ...newLines.slice(0, 200).map(l => ({ type: "add", text: l })),
    ];
  }

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      ops.push({ type: "ctx", text: oldLines[i] }); i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: "add", text: newLines[j] }); j++;
    } else {
      ops.push({ type: "del", text: oldLines[i] }); i++;
    }
  }

  const changed = new Set();
  ops.forEach((op, idx) => {
    if (op.type !== "ctx")
      for (let k = Math.max(0, idx - 2); k <= Math.min(ops.length - 1, idx + 2); k++) changed.add(k);
  });

  const out = [];
  let last = -1;
  for (let idx = 0; idx < ops.length; idx++) {
    if (!changed.has(idx)) continue;
    if (last >= 0 && idx - last > 1) out.push({ type: "info", text: "..." });
    out.push(ops[idx]);
    last = idx;
  }
  return out;
}

export function formatDiff(path, diff) {
  const stats = { add: 0, del: 0 };
  for (const op of diff) {
    if (op.type === "add") stats.add++;
    if (op.type === "del") stats.del++;
  }
  const lines = [`--- ${path} (+${stats.add} -${stats.del}) ---`];
  for (const op of diff) {
    const p = op.type === "add" ? "+" : op.type === "del" ? "-" : op.type === "info" ? "" : " ";
    lines.push(`${p}${op.text}`);
  }
  return lines.join("\n");
}
