export function todoSection(session, chatId) {
  const todos = session.todoList(chatId);
  if (!todos.length) return "";
  const icons = { pending: "☐", in_progress: "◐", completed: "☑", failed: "☒" };
  const lines = todos.map(t => `${icons[t.status] || "☐"} [${t.id}] ${t.task} (${t.status})`);
  const active = todos.filter(t => t.status === "in_progress");
  const header = active.length ? `\n\n## TODOS (aktif: ${active.length})\n` : `\n\n## TODOS\n`;
  return header + lines.join("\n");
}
