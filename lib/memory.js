export function memorySection(session, chatId) {
  const mems = session.memList(chatId);
  if (!mems.length) return "";
  return `\n\n## USER PREFERENCES\n${mems.map(m => `- ${m.key}: ${m.value}`).join("\n")}`;
}
