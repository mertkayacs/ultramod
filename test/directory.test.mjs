// Source rules the Claude plugin directory checks, read from the files the
// engine loads. They keep the hooks module readable by its analyzer.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../plugin/hooks/', import.meta.url);
const register = readFileSync(new URL('register.tsx', root), 'utf8');
const sources = ['core', 'mods', 'lib'].flatMap(dir =>
  readdirSync(new URL(`${dir}/`, root)).filter(name => /\.tsx?$/.test(name)).map(name => ({ name: `${dir}/${name}`, text: readFileSync(new URL(`${dir}/${name}`, root), 'utf8') })),
).concat([{ name: 'register.tsx', text: register }]);

const body = register.slice(register.indexOf('export const register: Register'));
const registrations = body.split('\n').filter(line => line.includes('on('));

test('every registration is one unconditional on(...) line with a named hook', () => {
  assert.ok(registrations.length > 0);
  for (const line of registrations) {
    assert.match(line, /^ {2}on\('[a-zA-Z.]+', (\{[^}]*\}, )?[a-zA-Z]+\)(\.catch\([a-zA-Z]+\))?$/, line);
  }
});

test('each registered hook is a const declared at the top level of register.tsx', () => {
  for (const line of registrations) {
    for (const name of line.match(/[a-zA-Z]+(?=\)(\.catch|$))|(?<=\.catch\()[a-zA-Z]+/g) ?? []) {
      assert.match(register, new RegExp(`^const ${name}: `, 'm'), name);
    }
  }
});

test('there is no permission hook and no prompt hook', () => {
  assert.doesNotMatch(register, /on\('tool\.check'/);
  assert.doesNotMatch(register, /on\('prompt\.submit'/);
  for (const { name, text } of sources) assert.doesNotMatch(text, /decision: 'allow'|decision: "allow"/, name);
});

test('the engine $ and next stay in register.tsx', () => {
  for (const { name, text } of sources) {
    if (name === 'register.tsx') continue;
    assert.doesNotMatch(text, /\(\$[,)]|\$\.[a-z]+\.[a-zA-Z]+\(/, `${name} uses $`);
    assert.doesNotMatch(text, /\bnext\(e\)|next\.called/, `${name} uses next`);
  }
  // Inside register.tsx, $ only goes whole to createApi, and $.ui.resolve(e) draws the band.
  const calls = body.match(/\(\$[,)]/g) ?? [];
  assert.equal(calls.length, 0, 'a hook passes $ along');
  for (const use of body.match(/createApi\([^)]*\)|\$\.[a-z]+\.[a-zA-Z]+\(/g) ?? []) assert.match(use, /^createApi\(\$\)$|^\$\.ui\.resolve\($/, use);
});

test('no accessor, Proxy or then method in the hooks code', () => {
  for (const { name, text } of sources) {
    assert.doesNotMatch(text, /\bget [a-zA-Z]+\(\)\s*\{|Object\.defineProperty|new Proxy|\bthen\s*[:(]\s*(async\s*)?\(|\.then\(/, name);
  }
});

test('no inline shell or interpreter program', () => {
  for (const { name, text } of sources) {
    assert.doesNotMatch(text, /'cmd', '\/c'|'-Command'|'osascript', '-e'|'sh', '-c'|'bash', '-c'/, name);
  }
});
