const DANGEROUS = [
  /\brm\s+-rf?\s+[\/~]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{.*\}/,
  /\bsudo\b/i,
  /\bchmod\s+-R\s+777\s+\//i,
  />\s*\/dev\/sd[a-z]/i,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
];

export function isDangerous(cmd) { return DANGEROUS.some(p => p.test(cmd)); }
export function needsApproval(cmd, mode = "dangerous-only") {
  if (mode === "all") return true;
  if (mode === "none") return false;
  return isDangerous(cmd);
}
