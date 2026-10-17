import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StoreFile } from '../server/store';

function cleanOwnTemp(dir: string) {
  const resolved = path.resolve(dir);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^wb-store-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('transient Windows rename failure publishes a complete new snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-store-'));
  const file = path.join(dir, 'store.json');
  const store = new StoreFile(file);
  store.save();
  const rename = fs.renameSync;
  let attempts = 0;
  try {
    fs.renameSync = ((src, dst) => {
      attempts++;
      if (attempts <= 2) throw Object.assign(new Error('reader temporarily holds file'), { code: 'EPERM' });
      return rename(src, dst);
    }) as typeof fs.renameSync;
    store.data.settings = { marker: 'new snapshot' };
    store.save();
    assert.equal(attempts, 3);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).settings.marker, 'new snapshot');
    assert.deepEqual(fs.readdirSync(dir), ['store.json']);
  } finally {
    fs.renameSync = rename;
    cleanOwnTemp(dir);
  }
});

test('failed publication retains the old snapshot and removes its own temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-store-'));
  const file = path.join(dir, 'store.json');
  const store = new StoreFile(file);
  store.save();
  const before = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  try {
    fs.renameSync = (() => { throw Object.assign(new Error('disk write error'), { code: 'EIO' }); }) as typeof fs.renameSync;
    store.data.settings = { marker: 'unpublished' };
    assert.throws(() => store.save(), /disk write error/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(dir), ['store.json']);
  } finally {
    fs.renameSync = rename;
    cleanOwnTemp(dir);
  }
});
