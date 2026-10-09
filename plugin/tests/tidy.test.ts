import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDriver } from './drive'
import type { Beneath, DriveEvent } from './drive'
import { resolveSet } from '../hooks/core/sets'
import { resetNotifier } from '../hooks/core/notifier'
import { tidy } from '../hooks/mods/tidy'

const enabled = { enabled: async () => true }

interface World {
  $: UltraApi
  asked: { question: string; header?: string }[]
  askAnswer: () => string
  exists: (path: string) => boolean
  argvs: string[][]
}

function world(init: { set?: unknown } = {}): World {
  resetNotifier()
  const w: World = { asked: [], askAnswer: () => 'Allow', exists: () => false, argvs: [], $: null as unknown as UltraApi }
  const state = new Map<string, unknown>([['set', init.set ?? null]])
  w.$ = {
    state: {
      get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: 1 }),
      set: async (ref: { key: string }, value: unknown) => { state.set(ref.key, value); return { isSet: true, version: 2 } },
    },
    ui: {
      ask: async (question: string, options?: { header?: string }) => {
        w.asked.push({ question, header: options?.header })
        return w.askAnswer()
      },
      toast: () => undefined,
      status: () => undefined,
      log: () => undefined,
      invalidate: () => undefined,
      open: async () => undefined,
      close: async () => undefined,
      resolve: () => { throw new Error('not needed') },
    },
    session: { root: async () => '/work/project', cwd: async () => '/work/project', id: async () => 's1', usage: async () => ({ startedAt: 0, context: { tokens: 0, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'claude-haiku-4.5', version: async () => ({ version: '2.1.292', base: '2.1.292', builtAt: '' }), compact: async () => ({}) },
    process: { run: async (argv: readonly string[]) => { w.argvs.push([...argv]); return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } },
    fs: { read: async () => '', write: async () => undefined, stat: async () => ({ kind: 'file', size: 1, mtimeMs: 1, isLink: false }), exists: async (path: string) => w.exists(path) },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    clock: { now: async () => 0, every: () => ({ cancel: () => undefined }), after: () => ({ cancel: () => undefined }) },
    audio: { play: async () => undefined },
    command: { register: async () => ({ value: { command: 'ultra' } }) },
    env: { get: async () => undefined },
  } as unknown as UltraApi
  return w
}

function bottom<E extends DriveEvent>(_event: E, answer: EventResult<E>, calls: { count: number }): Beneath<E> {
  return async () => {
    calls.count += 1
    return answer
  }
}

function call(w: World, file_path: string, content = 'notes'): Promise<EventResult<'tool.call'>> {
  const driver = createDriver([tidy], enabled)
  const calls = { count: 0 }
  return driver.dispatch(w.$, 'tool.call', { tool: 'Write', file_path, content } as unknown as Args<'tool.call'>, bottom('tool.call', { result: 'wrote', text: 'wrote' }, calls))
}

describe('tidy asks about stray documentation files', () => {
  test('a new NOTES.md outside the allowlist asks', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    expect(await call(w, 'NOTES.md')).toMatchObject({ result: 'wrote' })
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('NOTES.md')
    expect(w.asked[0]?.header).toBe('Ultra Mod')
  })

  test('Refuse denies with the SPEC wording', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    w.askAnswer = () => 'Refuse'
    expect(await call(w, 'SUMMARY.md')).toMatchObject({ deny: expect.stringContaining('instead of a new file') })
  })

  test('a dismissed question refuses', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    w.askAnswer = () => { throw new Error('dismissed') }
    expect(await call(w, 'NOTES.md')).toMatchObject({ deny: expect.any(String) })
  })

  test('deny mode refuses without asking', async () => {
    const w = world({ set: resolveSet({ set: 'marathon' }) })
    expect(await call(w, 'NOTES.md')).toMatchObject({ deny: expect.stringContaining('instead of a new file') })
    expect(w.asked).toHaveLength(0)
  })

  test('an absolute path inside the project is made relative', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    expect(await call(w, '/work/project/notes/TODO.md')).toMatchObject({ result: 'wrote' })
    expect(w.asked[0]?.question).toContain('notes/TODO.md')
  })
})

describe('tidy path traversal', () => {
  test('docs/../notes.md is a new stray file, not a docs file', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    await call(w, 'docs/../notes.md')
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('docs/../notes.md')
  })

  test('an absolute path with dot segments is checked after they resolve', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    await call(w, '/work/project/docs/../notes.md')
    expect(w.asked).toHaveLength(1)
  })

  test('deny mode refuses docs/../notes.md without asking', async () => {
    const w = world({ set: resolveSet({ set: 'marathon' }) })
    expect(await call(w, 'docs/../notes.md')).toMatchObject({ deny: expect.stringContaining('new documentation file') })
    expect(w.asked).toHaveLength(0)
  })

  test('a folder that only starts like an allowed name asks', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    await call(w, 'licenses/third-party.md')
    expect(w.asked).toHaveLength(1)
  })
})

describe('tidy tells an away user about its question', () => {
  test('the notification goes out while the question is still open', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    ;(w.$ as unknown as { ui: { ask: () => Promise<string> } }).ui.ask = () => new Promise<string>(() => undefined)
    void call(w, 'NOTES.md')
    for (let i = 0; i < 100; i++) await Promise.resolve()
    expect(w.argvs.filter(argv => argv[0] === 'notify-send')).toEqual([['notify-send', 'Claude Code', 'project needs you: tidy: create NOTES.md?']])
  })

  test('an allowed doc file notifies nobody', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    await call(w, 'README.md')
    for (let i = 0; i < 100; i++) await Promise.resolve()
    expect(w.argvs.filter(argv => argv[0] === 'notify-send')).toEqual([])
  })
})

describe('tidy passes everything else through', () => {
  test('non documentation files pass', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    for (const path of ['src/a.ts', 'data.json', 'styles.css']) {
      expect(await call(w, path)).toMatchObject({ result: 'wrote' })
    }
    expect(w.asked).toHaveLength(0)
  })

  test('allowlisted documentation files pass', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    for (const path of ['README.md', 'CHANGELOG.md', 'docs/mods.md', 'docs/deep/nested.md', 'AGENTS.md', 'CLAUDE.md', '.github/ISSUE_TEMPLATE/bug.md', 'LICENSE.txt']) {
      expect(await call(w, path)).toMatchObject({ result: 'wrote' })
    }
    expect(w.asked).toHaveLength(0)
  })

  test('an existing documentation file passes', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    w.exists = () => true
    expect(await call(w, 'NOTES.md')).toMatchObject({ result: 'wrote' })
    expect(w.asked).toHaveLength(0)
  })

  test('non Write tools are not hooked', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    const driver = createDriver([tidy], enabled)
    const calls = { count: 0 }
    const answer = await driver.dispatch(w.$, 'tool.call', { tool: 'Edit', file_path: 'NOTES.md', old_string: 'a', new_string: 'b' } as unknown as Args<'tool.call'>, bottom('tool.call', { result: 'ran', text: 'ran' }, calls))
    expect(answer).toMatchObject({ result: 'ran' })
  })

  test('essentials keeps tidy off entirely', async () => {
    const w = world()
    const off = createDriver([tidy], { enabled: async () => false })
    const calls = { count: 0 }
    const answer = await off.dispatch(w.$, 'tool.call', { tool: 'Write', file_path: 'NOTES.md', content: 'x' } as unknown as Args<'tool.call'>, bottom('tool.call', { result: 'wrote', text: 'wrote' }, calls))
    expect(answer).toMatchObject({ result: 'wrote' })
    expect(w.asked).toHaveLength(0)
  })

  test('a failed existence check is treated as a new file and asks', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    ;(w.$ as unknown as { fs: { exists: () => Promise<boolean> } }).fs.exists = async () => { throw new Error('stat failed') }
    expect(await call(w, 'NOTES.md')).toMatchObject({ result: 'wrote' })
    expect(w.asked).toHaveLength(1)
  })
})
