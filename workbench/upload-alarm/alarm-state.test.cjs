const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeNotification, nextState, stopState } = require('./alarm-state.cjs');
const root = path.resolve(__dirname, '..', '..');
const notice = (at = 'one') => normalizeNotification({ at, task: 'T02', status: 'awaiting_manual_upload', file: path.join(root, 'reports', 'test.zip') }, root);
test('new upload starts an alarm and a duplicate does not restart a stopped alarm', () => {
  let state = nextState({ active: false }, notice(), null); assert.equal(state.active, true);
  state = stopState(state); assert.equal(state.active, false);
  assert.equal(nextState(state, notice(), state.id).active, false);
  assert.equal(nextState(state, notice('two'), state.id).active, true);
});
test('acknowledgment survives app restart', () => {
  const n = notice(); assert.equal(nextState({ active: false }, n, n.id).active, false);
});
test('missing notification does not silently stop an active alarm', () => {
  assert.equal(nextState(nextState({}, notice(), null), null, null).active, true);
});
test('only existing-scope ZIP notifications are eligible', () => {
  assert.equal(normalizeNotification({ status: 'awaiting_manual_upload', file: path.resolve(root, '..', 'outside.zip') }, root), null);
  assert.equal(normalizeNotification({ status: 'uploaded', file: path.join(root, 'a.zip') }, root), null);
  assert.equal(normalizeNotification({ status: 'awaiting_manual_upload', file: path.join(root, 'a.exe') }, root), null);
});
