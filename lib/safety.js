// === COMMAND GUARD: blokir command yang bisa rusak CodeClaw ===

const DANGEROUS = [
  // Destructive filesystem
  /\brm\s+-rf?\s+[\/~]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{.*\}/,
  />\s*\/dev\/sd[a-z]/i,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  
  // System modification
  /\bsudo\b/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bchown\s+-R\s+.*\s+\//i,
  
  // Git destructive
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd/i,
  
  // === BLOCK: edit CodeClaw sendiri ===
  /codeclaw\/config\.json/i,
  /codeclaw\/lib\//i,
  /codeclaw\/index\.js/i,
  /codeclaw\/telegram\.js/i,
  /codeclaw\/cli\.js/i,
  /codeclaw\/panel\.js/i,
  /codeclaw\/system\.md/i,
  /codeclaw\/IDENTITY\.md/i,
  
  // === BLOCK: edit system config ===
  /\/etc\/hosts/i,
  /\/etc\/resolv\.conf/i,
  /\/etc\/nsswitch\.conf/i,
  /\/etc\/gai\.conf/i,
  
  // === BLOCK: edit shell config ===
  /\.bashrc/i,
  /\.profile/i,
  /\.termux\/boot\//i,
  
  // === BLOCK: edit package.json (bisa hapus dependency) ===
  /codeclaw\/package\.json/i,
  /codeclaw\/install\.sh/i,
];

// Command yang BOLEH dijalankan di folder codeclaw (read-only)
const SAFE_IN_CODECLAW = [
  /^cat\s+/,
  /^ls\s+/,
  /^grep\s+/,
  /^find\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^wc\s+/,
  /^node\s+--check/,
  /^git\s+status/,
  /^git\s+log/,
  /^git\s+diff/,
  /^git\s+show/,
  /^pgrep\s+/,
  /^ps\s+/,
  /^ss\s+/,
  /^netstat\s+/,
  /^curl\s+/,
  /^getent\s+/,
];

export function isDangerous(cmd) { 
  return DANGEROUS.some(p => p.test(cmd)); 
}

export function isSafeReadOnly(cmd) {
  return SAFE_IN_CODECLAW.some(p => p.test(cmd.trim()));
}

export function needsApproval(cmd, mode = "dangerous-only") {
  if (mode === "all") return true;
  if (mode === "none") return false;
  return isDangerous(cmd);
}

// Fungsi baru: hard-block untuk command yang jelas merusak
export function isBlocked(cmd) {
  // Command yang edit file di folder codeclaw tanpa read-only
  const touchesCodeclaw = /codeclaw\/(config\.json|lib\/|index\.js|telegram\.js|cli\.js|panel\.js|system\.md|IDENTITY\.md|package\.json|install\.sh)/i.test(cmd);
  
  if (touchesCodeclaw && !isSafeReadOnly(cmd)) {
    // Cek apakah command ini write/edit/delete
    const isWrite = /\b(rm|mv|cp|echo|printf|cat\s*>|tee|sed\s+-i|truncate|chmod|chown|nano|vim|vi|>)\b/i.test(cmd);
    if (isWrite) return true;
  }
  
  // Blokir edit /etc/ hosts, resolv, dll
  const touchesEtc = /\/etc\/(hosts|resolv\.conf|nsswitch\.conf|gai\.conf)/i.test(cmd);
  if (touchesEtc) {
    const isWrite = /\b(rm|mv|cp|echo|printf|cat\s*>|tee|sed\s+-i|truncate|chmod|chown|nano|vim|vi|>)\b/i.test(cmd);
    if (isWrite) return true;
  }
  
  // Blokir edit .bashrc/.profile
  const touchesShell = /(\.bashrc|\.profile|\.termux\/boot)/i.test(cmd);
  if (touchesShell) {
    const isWrite = /\b(rm|mv|cp|echo|printf|cat\s*>|tee|sed\s+-i|truncate|chmod|chown|nano|vim|vi|>)\b/i.test(cmd);
    if (isWrite) return true;
  }
  
  return false;
}
