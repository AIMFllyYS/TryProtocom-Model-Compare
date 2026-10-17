const path = require('node:path');
function normalizeNotification(raw, root) {
  if (!raw || raw.status !== 'awaiting_manual_upload') return null;
  const file = path.resolve(String(raw.file || ''));
  const relative = path.relative(root, file);
  if (!raw.file || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(file).toLowerCase() !== '.zip') return null;
  const task = String(raw.task || '文件上传');
  return { id: `${String(raw.at || '')}|${task}|${file}`, task, file, name: path.basename(file), bytes: Number(raw.bytes) || 0,
    chatUrl: /^https:\/\/claude\.ai\//.test(raw.chat_url || '') ? raw.chat_url : 'https://claude.ai/new' };
}
function nextState(current, notification, stoppedId) {
  if (!notification) return current;
  if (current?.id === notification.id) return current;
  return { ...notification, active: notification.id !== stoppedId };
}
function stopState(current) { return { ...current, active: false }; }
module.exports = { normalizeNotification, nextState, stopState };
