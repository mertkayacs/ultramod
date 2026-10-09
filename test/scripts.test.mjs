// The notifier runs these files instead of inline programs. They must exist
// and must take their text as arguments, never as source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = name => readFileSync(new URL(`../plugin/scripts/${name}`, import.meta.url), 'utf8');

test('notify.applescript takes title and body from argv', () => {
  const script = read('notify.applescript');
  assert.match(script, /^on run argv$/m);
  assert.match(script, /display notification \(item 2 of argv\) with title \(item 1 of argv\)/);
});

test('notify.ps1 takes the body as base64 data', () => {
  const script = read('notify.ps1');
  assert.match(script, /param\(\s*\[Parameter\(Mandatory = \$true\)\]\[string\]\$BodyBase64\s*\)/);
  assert.match(script, /FromBase64String\(\$BodyBase64\)/);
  assert.match(script, /ShowBalloonTip\(5000, 'Claude Code', \$body, 'Info'\)/);
});
