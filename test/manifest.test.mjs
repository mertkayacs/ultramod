// The manifest must load on every Claude Code release with mods (2.1.287 and later).
// Older releases reject userConfig keys they do not know, such as "options".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const KNOWN = new Set(['type', 'title', 'description', 'default', 'sensitive', 'required', 'min', 'max']);

test('userConfig entries use only keys that every supported Claude Code accepts', () => {
  for (const [name, entry] of Object.entries(manifest.userConfig ?? {})) {
    for (const key of Object.keys(entry)) assert.ok(KNOWN.has(key), `userConfig.${name}: unsupported key "${key}"`);
  }
});

// The directory validator reports "types" as an unknown field. The contract
// lives in plugin/types and is reached through tsconfig.json instead.
test('the manifest has no "types" field', () => {
  assert.equal('types' in manifest, false);
});
