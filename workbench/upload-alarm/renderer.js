const byId = id => document.getElementById(id);
const voice = byId('voice');
let current = { active: false, file: '' };
const preview = !window.uploadAlarm;
const demo = { id: 'preview', task: 'T02', name: 'T02-materials.zip', file: 'D:\\projects\\Model-Compare\\My-BenchMark\\reports\\2026-10-08-haiku-5.5-web\\uploads\\T02-materials.zip', bytes: 27086, active: false };
const api = window.uploadAlarm || {
  get: async () => demo, stop: async () => ({ ...current, active: false }), start: async () => ({ ...current, active: true }),
  copy: async () => { await navigator.clipboard.writeText(current.file); return true; }, folder: async () => {},
  playback: () => {}, subscribe: () => {}, snapshot: () => {},
};
function playback(error = null) { api.playback({ paused: voice.paused, loop: voice.loop, error }); }
async function render(state) {
  const wasActive = current.active; current = state;
  document.body.className = state.active ? 'active' : 'stopped';
  byId('status').textContent = state.active ? '正在重复提醒' : state.file ? '已停止' : '等待任务';
  byId('heading').textContent = state.active ? '需要传文件了' : state.file ? '提醒已停止' : '上传提醒';
  byId('subtitle').textContent = state.active ? '我会一直提醒，直到你点下方按钮。' : state.file ? '准备好后，把这个文件上传到聊天。' : '需要你上传文件时，我会提醒你。';
  byId('task').textContent = state.task === 'ZIP-preflight' ? '上传验证' : state.task || '等待上传任务';
  byId('size').textContent = state.bytes ? (state.bytes >= 1048576 ? (state.bytes / 1048576).toFixed(1) + ' MB' : state.bytes < 1024 ? state.bytes + ' B' : Math.round(state.bytes / 1024) + ' KB') : 'ZIP 文件';
  byId('filename').textContent = state.name || '尚无待上传文件'; byId('path').textContent = state.file || '文件路径会显示在这里';
  byId('copy').disabled = byId('folder').disabled = byId('toggle').disabled = !state.file;
  byId('toggle').textContent = state.active ? '停止提醒' : state.file ? '重新提醒' : '等待任务';
  byId('foot').textContent = preview ? '界面预览 · 停止按钮会立即停止声音' : state.active ? '持续播报：需要传文件了，需要传文件了' : '停止声音不代表文件已上传。';
  if (state.active) {
    if (!wasActive || voice.paused) { try { await voice.play(); playback(); } catch (e) { playback(String(e)); byId('status').textContent = '播放失败'; byId('foot').textContent = '声音播放失败，请点击停止后重新提醒。'; } }
  } else { voice.pause(); voice.currentTime = 0; playback(); }
  setTimeout(() => api.snapshot(), 150);
}
byId('toggle').addEventListener('click', async () => {
  if (current.active) { voice.pause(); voice.currentTime = 0; await render(await api.stop()); }
  else await render(await api.start());
});
byId('copy').addEventListener('click', async () => { try { await api.copy(); byId('copy').textContent = '已复制'; setTimeout(() => byId('copy').textContent = '复制路径', 1300); } catch { byId('copy').textContent = '请选择路径复制'; } });
byId('folder').addEventListener('click', () => api.folder());
voice.addEventListener('error', () => playback(voice.error ? 'audio error ' + voice.error.code : 'audio error'));
voice.addEventListener('playing', () => playback());
voice.addEventListener('pause', () => playback());
window.addEventListener('beforeunload', () => voice.pause());
api.subscribe(render); api.get().then(render);
