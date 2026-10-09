// Real git: the guard's snapshot and restore code (plugin/hooks/lib/snapshot.ts)
// run against a temporary repository. Nothing about git is mocked.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { SNAPSHOT_REF, restoreSnapshot, saveSnapshot } from '../plugin/hooks/lib/snapshot.ts';

const root = mkdtempSync(join(tmpdir(), 'ultramod-guard-git-'));
after(() => rmSync(root, { recursive: true, force: true }));

function git(dir, ...argv) {
  const r = spawnSync('git', argv, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${argv.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// The same contract as the mod's runner: trimmed stdout, never throws.
const run = async (argv, cwd, env) => {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
};
const drop = async (cwd, path) => {
  await run(['rm', '-f', path], cwd);
};

let n = 0;
function repo() {
  const dir = join(root, `r${n++}`);
  git(root, 'init', '-q', dir);
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

const stray = (dir) => readdirSync(join(dir, '.git')).filter((name) => name.startsWith('ultramod'));
const fail = (why) => assert.fail(`snapshot failed: ${why}`);

// K01: restoring a snapshot keeps a tracked file committed after it.
test('undo restores the snapshot files and keeps a tracked file committed after it', async () => {
  const dir = repo();
  writeFileSync(join(dir, 'a.txt'), 'dirty\n');
  writeFileSync(join(dir, 'b.txt'), 'untracked\n');

  await saveSnapshot(run, drop, dir, 'ultramod snapshot: git reset --hard', 1_000_000, fail);
  const sha = git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF);
  assert.match(sha, /^[0-9a-f]{40}$/);

  // The risky command runs for real: the tracked change and the untracked file go.
  git(dir, 'reset', '--hard');
  git(dir, 'clean', '-fdq');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(existsSync(join(dir, 'b.txt')), false);

  // Work after the snapshot: a new tracked file, committed.
  writeFileSync(join(dir, 'newer.txt'), 'newer\n');
  git(dir, 'add', 'newer.txt');
  git(dir, 'commit', '-q', '-m', 'newer');

  assert.equal(await restoreSnapshot(run, drop, dir, sha), true);

  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'dirty\n');
  assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'untracked\n');
  assert.equal(readFileSync(join(dir, 'newer.txt'), 'utf8'), 'newer\n');
  assert.equal(git(dir, 'ls-files'), 'a.txt\nnewer.txt');
  // The real index was not touched and no temporary index is left behind.
  assert.equal(git(dir, 'status', '--porcelain'), 'M a.txt\n?? b.txt');
  assert.deepEqual(stray(dir), []);
});

test('a file removed after the snapshot comes back and the restore also works from a subdirectory', async () => {
  const dir = repo();
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: rm -rf a.txt', 2_000_000, fail);
  const sha = git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF);
  rmSync(join(dir, 'a.txt'));
  writeFileSync(join(dir, 'later.txt'), 'later\n');
  assert.equal(await restoreSnapshot(run, drop, dir, sha), true);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(readFileSync(join(dir, 'later.txt'), 'utf8'), 'later\n');
});

test('two snapshots in the same second keep separate refs', async () => {
  const dir = repo();
  writeFileSync(join(dir, 'a.txt'), 'first state\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: one', 3_000_000, fail);
  writeFileSync(join(dir, 'a.txt'), 'second state\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: two', 3_000_400, fail);
  const refs = git(dir, 'for-each-ref', '--format=%(refname)', SNAPSHOT_REF).split('\n');
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((ref) => git(dir, 'show', `${ref}:a.txt`)).sort(), ['first state', 'second state']);
  assert.deepEqual(stray(dir), []);
});

test('two snapshots in the same millisecond still get separate refs', async () => {
  const dir = repo();
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: one', 4_000_000, fail);
  writeFileSync(join(dir, 'a.txt'), 'y\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: two', 4_000_000, fail);
  assert.equal(git(dir, 'for-each-ref', '--format=%(refname)', SNAPSHOT_REF).split('\n').length, 2);
});

test('a failed snapshot leaves no temporary index in .git', async () => {
  const dir = repo();
  // A runner whose commit-tree fails, after add and write-tree wrote the index.
  const broken = async (argv, cwd, env) => (argv[1] === 'commit-tree' ? { ok: false, out: '' } : run(argv, cwd, env));
  const reasons = [];
  await saveSnapshot(broken, drop, dir, 'ultramod snapshot: x', 5_000_000, (why) => reasons.push(why));
  assert.deepEqual(reasons, ['git commit-tree failed']);
  assert.deepEqual(stray(dir), []);
  assert.equal(git(dir, 'for-each-ref', SNAPSHOT_REF), '');
});

test('outside a repository nothing happens', async () => {
  const dir = mkdtempSync(join(root, 'plain-'));
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: x', 6_000_000, fail);
});
