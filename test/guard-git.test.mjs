// Real git: the guard's snapshot and restore code (plugin/hooks/lib/snapshot.ts)
// run against a temporary repository. Nothing about git is mocked.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { SNAPSHOT_REF, findConflicts, restoreSnapshot, saveSnapshot } from '../plugin/hooks/lib/snapshot.ts';

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

// Round 2, item 14: the session cwd can be a subdirectory of the work tree.
test('a snapshot taken from a subdirectory covers the whole work tree', async () => {
  const dir = repo();
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'x.txt'), 'x\n');
  writeFileSync(join(dir, 'top.txt'), 'top\n');
  const reasons = [];
  await saveSnapshot(run, drop, join(dir, 'sub'), 'ultramod snapshot: rm -rf sub', 7_000_000, (why) => reasons.push(why));
  assert.deepEqual(reasons, []);
  const ref = git(dir, 'for-each-ref', '--format=%(refname)', SNAPSHOT_REF);
  assert.match(ref, /^refs\/worktree\/ultramod\/snapshots\//);
  assert.equal(git(dir, 'ls-tree', '-r', '--name-only', ref), 'a.txt\nsub/x.txt\ntop.txt');
  assert.deepEqual(stray(dir), []);
});

// Round 2, item 16: a linked worktree has its own snapshot list.
test('snapshots are per worktree: another worktree neither lists nor restores them', async () => {
  const dir = repo();
  const other = join(root, `wt${n++}`);
  git(dir, 'worktree', 'add', '-q', '-b', `side${n}`, other);
  writeFileSync(join(dir, 'a.txt'), 'main edit\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: main', 8_000_000, fail);
  assert.equal(git(other, 'for-each-ref', '--format=%(refname)', SNAPSHOT_REF), '');
  writeFileSync(join(other, 'a.txt'), 'side edit\n');
  await saveSnapshot(run, drop, other, 'ultramod snapshot: side', 8_000_500, fail);
  const mine = git(other, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF).split('\n');
  assert.equal(mine.length, 1);
  assert.equal(git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF).split('\n').length, 1);
  assert.notEqual(mine[0], git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF));
  assert.equal(git(other, 'show', `${mine[0]}:a.txt`), 'side edit');
  // The temporary index of a linked worktree is removed too.
  assert.deepEqual(readdirSync(git(other, 'rev-parse', '--absolute-git-dir')).filter((name) => name.startsWith('ultramod')), []);
});

// Round 2, item 15: a restore must not delete files created after the snapshot.
test('a file that became a directory aborts the restore and names the directory', async () => {
  const dir = repo();
  writeFileSync(join(dir, 'notes'), 'old notes\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: rm notes', 9_000_000, fail);
  const sha = git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF);
  rmSync(join(dir, 'notes'));
  mkdirSync(join(dir, 'notes'));
  writeFileSync(join(dir, 'notes', 'today.md'), 'new work\n');
  writeFileSync(join(dir, 'a.txt'), 'edited since\n');
  const found = [];
  assert.equal(await restoreSnapshot(run, drop, dir, sha, (paths) => found.push(...paths)), false);
  assert.deepEqual(found, ['notes/']);
  assert.equal(readFileSync(join(dir, 'notes', 'today.md'), 'utf8'), 'new work\n');
  // Nothing was written: the restore is all or nothing.
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'edited since\n');
  assert.deepEqual(stray(dir), []);
});

test('a directory that became a file aborts the restore and names the file', async () => {
  const dir = repo();
  mkdirSync(join(dir, 'cfg'));
  writeFileSync(join(dir, 'cfg', 'app.txt'), 'cfg v1\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: rm -rf cfg', 9_100_000, fail);
  const sha = git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF);
  rmSync(join(dir, 'cfg'), { recursive: true });
  writeFileSync(join(dir, 'cfg'), 'a newer file\n');
  const found = [];
  assert.equal(await restoreSnapshot(run, drop, dir, sha, (paths) => found.push(...paths)), false);
  assert.deepEqual(found, ['cfg']);
  assert.equal(readFileSync(join(dir, 'cfg'), 'utf8'), 'a newer file\n');
  assert.deepEqual(stray(dir), []);
});

test('an ignored directory in the way is a conflict too', async () => {
  const dir = repo();
  writeFileSync(join(dir, '.gitignore'), 'gen/\n');
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-q', '-m', 'ignore');
  writeFileSync(join(dir, 'gen'), 'a plain file\n');
  await saveSnapshot(run, drop, dir, 'ultramod snapshot: rm gen', 9_200_000, fail);
  const sha = git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF);
  rmSync(join(dir, 'gen'));
  mkdirSync(join(dir, 'gen'));
  writeFileSync(join(dir, 'gen', 'out.js'), 'generated\n');
  const found = [];
  assert.equal(await restoreSnapshot(run, drop, dir, sha, (paths) => found.push(...paths)), false);
  assert.deepEqual(found, ['gen/']);
  assert.equal(readFileSync(join(dir, 'gen', 'out.js'), 'utf8'), 'generated\n');
  // Once the person moves it away the restore goes through.
  rmSync(join(dir, 'gen'), { recursive: true });
  assert.equal(await restoreSnapshot(run, drop, dir, sha, fail), true);
  assert.equal(readFileSync(join(dir, 'gen'), 'utf8'), 'a plain file\n');
});

test('findConflicts scans a large tree in linear time', () => {
  const current = [];
  const snapshot = [];
  for (let i = 0; i < 100_000; i++) {
    current.push(`pkg${i % 500}/dir${i % 50}/new${i}.txt`);
    snapshot.push(`pkg${i % 500}/dir${i % 50}/old${i}.txt`);
  }
  const started = Date.now();
  assert.deepEqual(findConflicts(current, snapshot), []);
  assert.deepEqual(findConflicts([...current, 'pkg1/dir1'], snapshot), ['pkg1/dir1']);
  assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started} ms`);
});

// A machine with no git identity (fresh CI image, new laptop) still gets a snapshot.
test('a snapshot is saved when git has no user name or email configured', async () => {
  const dir = repo();
  git(dir, 'config', '--unset', 'user.email');
  git(dir, 'config', '--unset', 'user.name');
  writeFileSync(join(dir, 'a.txt'), 'dirty\n');
  const home = join(root, `home${n++}`);
  mkdirSync(home);
  const bare = { HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', EMAIL: '' };
  const noIdentity = (argv, cwd, env) => run(argv, cwd, { ...bare, ...env });
  await saveSnapshot(noIdentity, drop, dir, 'ultramod snapshot: git reset --hard', 4_000_000, fail);
  assert.match(git(dir, 'for-each-ref', '--format=%(objectname)', SNAPSHOT_REF), /^[0-9a-f]{40}$/);
});
