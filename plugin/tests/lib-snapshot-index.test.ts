import { expect, test } from 'claude-code/testing'
import { restoreSnapshot, saveSnapshot } from '../hooks/lib/snapshot'

// A git double that answers every call and records the temporary index names.
function fakeGit() {
  const paths: string[] = []
  const dropped: string[] = []
  const run = async (argv: string[]) => {
    const [, a1, a2, a3] = argv
    if (a1 === 'rev-parse' && a2 === '--git-path') { paths.push(a3 ?? ''); return { ok: true, out: `.git/${a3}` } }
    if (a1 === 'rev-parse' && a2 === '--is-inside-work-tree') return { ok: true, out: 'true' }
    if (a1 === 'rev-parse' && a2 === '--show-toplevel') return { ok: true, out: '/work' }
    if (a1 === 'write-tree') return { ok: true, out: 'tree1' }
    if (a1 === 'commit-tree') return { ok: true, out: 'commit1' }
    return { ok: true, out: '' }
  }
  const drop = async (_cwd: string, path: string) => { dropped.push(path) }
  return { run, drop, paths, dropped }
}

test('overlapping snapshots in one work tree each use their own temporary index', async () => {
  const git = fakeGit()
  const fail = () => {}
  await Promise.all([
    saveSnapshot(git.run, git.drop, '/work', 'a', 5_000, fail),
    saveSnapshot(git.run, git.drop, '/work', 'b', 5_000, fail),
  ])
  expect(new Set(git.paths).size).toBe(2)
  expect(git.dropped.sort()).toEqual(git.paths.map(name => `.git/${name}`).sort())
})

test('overlapping restores each use their own temporary index', async () => {
  const git = fakeGit()
  await Promise.all([
    restoreSnapshot(git.run, git.drop, '/work', 'sha1'),
    restoreSnapshot(git.run, git.drop, '/work', 'sha1'),
  ])
  expect(new Set(git.paths).size).toBe(2)
})
