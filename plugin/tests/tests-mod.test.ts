import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDispatcher } from '../hooks/core/dispatcher'
import type { ModEvent, ModNext } from '../hooks/core/mod'
import { resetNotifier } from '../hooks/core/notifier'
import { resolveSet } from '../hooks/core/sets'
import { tests } from '../hooks/mods/tests'

const enabled = { enabled: async () => true }

interface World {
  $: UltraApi
  asked: { question: string; header?: string }[]
  askAnswer: () => string
  files: Map<string, string>
  exists: (path: string) => boolean
  argvs: string[][]
  toasts: string[]
}

function world(init: { set?: unknown } = {}): World {
  resetNotifier()
  const files = new Map<string, string>()
  const w: World = {
    asked: [],
    askAnswer: () => 'Allow',
    files,
    exists: () => false,
    argvs: [],
    toasts: [],
    $: null as unknown as UltraApi,
  }
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
      toast: (text: string) => { w.toasts.push(text) },
      status: () => undefined,
      log: () => undefined,
      invalidate: () => undefined,
      open: async () => undefined,
      close: async () => undefined,
      resolve: () => { throw new Error('not needed') },
    },
    session: { root: async () => '/work/project', cwd: async () => '/work/project', id: async () => 's1', usage: async () => ({ startedAt: 0, context: { tokens: 0, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'claude-haiku-4.5', version: async () => ({ version: '2.1.292', base: '2.1.292', builtAt: '' }), compact: async () => ({}) },
    process: {
      run: async (argv: readonly string[]) => {
        w.argvs.push([...argv])
        return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
    fs: {
      read: async (path: string) => {
        if (!files.has(path)) throw new Error('missing file')
        return files.get(path) ?? ''
      },
      write: async (path: string, text: string) => { files.set(path, text) },
      stat: async () => ({ kind: 'file', size: 1, mtimeMs: 1, isLink: false }),
      exists: async (path: string) => w.exists(path),
    },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    // The engine would run the callback off the dispatch; run it now so a
    // scheduled notification still lands before the assertions below.
    clock: { now: async () => 0, every: () => ({ cancel: () => undefined }), after: (_ms: number, fn: () => void) => { fn(); return { cancel: () => undefined } } },
    audio: { play: async () => undefined },
    command: { register: async () => ({ value: { command: 'ultra' } }) },
    env: { get: async () => undefined },
  } as unknown as UltraApi
  return w
}

// Resolves after `count` microtask turns, no timers needed in this sandbox.
function ticks(count: number): Promise<void> {
  let run = Promise.resolve()
  for (let i = 0; i < count; i++) run = run.then(() => undefined)
  return run
}

// Lets a scheduled notification finish before the caller asserts on it.
async function settle(): Promise<void> {
  await ticks(100)
}

function bottom<E extends ModEvent>(event: E, answer: EventResult<E>, calls: { count: number }): ModNext<E> {
  const next = Object.assign(async (_e: Frozen<Args<E>> | Args<E>) => {
    calls.count += 1
    return answer
  }, { event, signal: undefined })
  Object.defineProperty(next, 'called', { get: () => calls.count > 0 })
  return next as unknown as ModNext<E>
}

function call(w: World, e: Args<'tool.call'>): Promise<EventResult<'tool.call'>> {
  const dispatcher = createDispatcher([tests], enabled)
  const calls = { count: 0 }
  return dispatcher.dispatch(w.$, 'tool.call', e, bottom('tool.call', { result: 'ran', text: 'ran', isReadOnly: true }, calls))
}

const editTest = (oldText: string, newText: string) => ({ tool: 'Edit', file_path: 'src/app.test.ts', old_string: oldText, new_string: newText }) as unknown as Args<'tool.call'>

describe('tests asks on weakening edits in ask mode', () => {
  test('adding .skip( asks, Allow passes the edit', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'test("a", () => { expect(1).toBe(1) })')
    w.askAnswer = () => 'Allow'
    expect(await call(w, editTest('test("a"', 'test.skip("a"'))).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.header).toBe('Ultra Mod')
    expect(w.asked[0]?.question).toContain('.skip(')
  })

  test('Refuse denies with the SPEC wording', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'test("a", () => { expect(1).toBe(1) })')
    w.askAnswer = () => 'Refuse'
    const answer = await call(w, editTest('test("a"', 'test.skip("a"'))
    expect(answer).toMatchObject({ deny: expect.stringContaining('Fix the code under test') })
  })

  test('a dismissed question refuses', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'test("a", () => { expect(1).toBe(1) })')
    w.askAnswer = () => { throw new Error('dismissed') }
    expect(await call(w, editTest('test("a"', 'test.skip("a"'))).toMatchObject({ deny: expect.any(String) })
  })

  test('dropping assertions asks', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'expect(a)\nexpect(b)\nexpect(c)')
    await call(w, editTest('expect(a)\nexpect(b)\nexpect(c)', 'expect(a)'))
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('assertions')
  })

  test('bash deleting a test file asks', async () => {
    const w = world()
    await call(w, { tool: 'Bash', command: 'rm foo.test.ts' } as unknown as Args<'tool.call'>)
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('foo.test.ts')
  })

  test('Write emptying an existing test file asks', async () => {
    const w = world()
    w.files.set('old.test.ts', 'expect(a)')
    w.exists = () => true
    await call(w, { tool: 'Write', file_path: 'old.test.ts', content: '' } as unknown as Args<'tool.call'>)
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('empties')
  })

  test('MultiEdit adding a marker asks', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'it("a")')
    await call(w, { tool: 'MultiEdit', file_path: 'src/app.test.ts', edits: [{ old_string: 'it("a")', new_string: 'xit("a")' }] } as unknown as Args<'tool.call'>)
    expect(w.asked).toHaveLength(1)
  })

  test('NotebookEdit deleting a cell asks', async () => {
    const w = world()
    w.files.set('nb.test.ipynb', '{"cells": []}')
    await call(w, { tool: 'NotebookEdit', notebook_path: 'nb.test.ipynb', new_source: '', edit_mode: 'delete' } as unknown as Args<'tool.call'>)
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('cell')
  })
})

describe('tests asks notify an away user', () => {
  test('an ask sends the needs-you notification', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'test("a", () => { expect(1).toBe(1) })')
    await call(w, editTest('test("a"', 'test.skip("a"'))
    await settle()
    expect(w.argvs.filter(argv => argv[0] === 'notify-send')).toEqual([
      ['notify-send', 'Claude Code', 'project needs you: tests: src/app.test.ts adds .skip('],
    ])
  })

  test('notify off keeps the question silent', async () => {
    const w = world({ set: resolveSet({ set: 'essentials', overrides: { notify: false } }) })
    w.files.set('src/app.test.ts', 'test("a", () => { expect(1).toBe(1) })')
    await call(w, editTest('test("a"', 'test.skip("a"'))
    await settle()
    expect(w.argvs.filter(argv => argv[0] === 'notify-send')).toEqual([])
    expect(w.toasts).toEqual([])
  })
})

describe('tests deny mode refuses without asking', () => {
  test('a skip marker denies immediately', async () => {
    const w = world({ set: resolveSet({ set: 'marathon' }) })
    w.files.set('src/app.test.ts', 'test("a", () => { expect(1).toBe(1) })')
    const answer = await call(w, editTest('test("a"', 'test.skip("a"'))
    expect(answer).toMatchObject({ deny: expect.stringContaining('Fix the code under test') })
    expect(w.asked).toHaveLength(0)
  })
})

describe('tests passes strengthening and neutral edits', () => {
  test('ordinary edits to source files pass without asking', async () => {
    const w = world()
    w.files.set('src/main.ts', 'const a = 1')
    expect(await call(w, { tool: 'Edit', file_path: 'src/main.ts', old_string: '1', new_string: '2' } as unknown as Args<'tool.call'>)).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })

  test('an assertion-adding edit passes', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'expect(a)')
    expect(await call(w, editTest('expect(a)', 'expect(a)\nexpect(b)'))).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })

  test('a neutral edit inside a test file passes', async () => {
    const w = world()
    w.files.set('src/app.test.ts', 'const name = "a"')
    expect(await call(w, editTest('"a"', '"b"'))).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })

  test('bash deleting a non-test file passes', async () => {
    const w = world()
    expect(await call(w, { tool: 'Bash', command: 'rm README.md' } as unknown as Args<'tool.call'>)).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })

  test('Write of a brand new test file passes', async () => {
    const w = world()
    w.exists = () => false
    expect(await call(w, { tool: 'Write', file_path: 'new.test.ts', content: 'test("x", () => {})' } as unknown as Args<'tool.call'>)).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })

  test('a test run command passes', async () => {
    const w = world()
    expect(await call(w, { tool: 'Bash', command: 'npm test' } as unknown as Args<'tool.call'>)).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })

  test('an edit to a missing file passes through untouched', async () => {
    const w = world()
    expect(await call(w, editTest('a', 'b'))).toMatchObject({ result: 'ran' })
    expect(w.asked).toHaveLength(0)
  })
})
