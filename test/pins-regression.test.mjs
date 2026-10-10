import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pins, resetPinsCache } from '../plugin/hooks/mods/pins.ts';

const PROMPT = 'Pinned rules from the user. Follow them in every reply:';

function api(root, path) {
  return {
    state: { get: async () => ({ value: null, version: 1 }), set: async () => ({ isSet: true, version: 2 }) },
    ui: { ask: async () => 'Allow', toast: () => undefined, status: () => undefined, log: () => undefined, invalidate: () => undefined, open: async () => undefined, close: async () => undefined, resolve: () => undefined },
    session: { root: async () => root },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) },
    fs: {
      read: async file => {
        if (file !== path) throw new Error('missing file');
        return readFile(file, 'utf8');
      },
      writePins: async () => undefined,
      stat: async file => {
        if (file !== path) throw new Error('missing file');
        const current = await stat(file);
        return { kind: 'file', size: current.size, mtimeMs: current.mtimeMs, isLink: false };
      },
      exists: async file => file === path,
    },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    clock: { now: async () => 0, every: () => ({ cancel: () => undefined }), after: () => ({ cancel: () => undefined }) },
    audio: { play: async () => undefined },
    command: { register: async () => ({ value: { command: 'ultramod' } }) },
    env: { get: async () => undefined },
  };
}

test('project pin approval does not survive a same-mtime file edit', async () => {
  resetPinsCache();
  const root = await mkdtemp(join(tmpdir(), 'ultramod-pins-'));
  try {
    const pinsDir = join(root, '.claude');
    const path = join(pinsDir, 'pins.md');
    const approvedTime = new Date('2024-01-01T00:00:00.000Z');
    await mkdir(pinsDir);
    await writeFile(path, '- project rule\n');
    await utimes(path, approvedTime, approvedTime);
    const $ = api(root, path);

    const approved = await pins.commands.pins($, 'approve');
    assert.match(approved.text, /Approved 1 project pin/);
    assert.equal((await pins.compose.run($)).text, `${PROMPT}\n- project rule`);

    await writeFile(path, '- changed rule\n');
    await utimes(path, approvedTime, approvedTime);

    assert.equal(await pins.compose.run($), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
