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

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const market = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
const commands = readFileSync(new URL('../plugin/hooks/core/commands.ts', import.meta.url), 'utf8');

test('the version is the same in package.json, plugin.json and /ultra doctor', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(commands.includes(`'Version ${pkg.version}'`), '/ultra doctor names another version');
});

test('the listing description is the same everywhere', () => {
  assert.equal(market.description, manifest.description);
  assert.equal(market.plugins[0].description, manifest.description);
  assert.equal(pkg.description, manifest.description);
});
