function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mdToTelegramHtml(md) {
  let s = String(md ?? "");
  const codeBlocks = [];
  const inlineCodes = [];

  s = s.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(`<pre>${escapeHtml(code.replace(/\n$/, ""))}</pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  s = s.replace(/`([^`\n]+)`/g, (m, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  s = escapeHtml(s);

  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>");
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<i>$2</i>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/^&gt;\s*(.+)$/gm, "<blockquote>$1</blockquote>");
  s = s.replace(/^[\-\*]\s+/gm, "• ");

  s = s.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[+i]);
  s = s.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[+i]);
  return s;
}
