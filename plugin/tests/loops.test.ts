import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDriver } from './drive'
import { resolveSet } from '../hooks/core/sets'
import { loops, resetLoops } from '../hooks/mods/loops'

const enabled = { enabled: async () => true }

interface World {
  $: UltraApi
  toasts: string[]
}

function world(init: { set?: unknown } = {}): World {
  const w: World = { toasts: [], $: null as unknown as UltraApi }
  const state = new Map<string, unknown>([['set', init.set ?? null]])
  w.$ = {
    state: {
      get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: 1 }),
      set: async (ref: { key: string }, value: unknown) => { state.set(ref.key, value); return { isSet: true, version: 2 } },
    },
    ui: {
      ask: async () => 'Allow',
      toast: (text: string) => { w.toasts.push(text) },
      status: () => undefined,
      log: () => undefined,
      invalidate: () => undefined,
      open: async () => undefined,
      close: async () => undefined,
      resolve: () => { throw new Error('not needed') },
    },
    session: { root: async () => '/work/project', cwd: async () => '/work/project', id: async () => 's1', usage: async () => ({ startedAt: 0, context: { tokens: 0, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'claude-haiku-4.5', version: async () => ({ version: '2.1.292', base: '2.1.292', builtAt: '' }), compact: async () => ({}) },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) },
    fs: { read: async () => '', write: async () => undefined, stat: async () => ({ kind: 'file', size: 1, mtimeMs: 1, isLink: false }), exists: async () => false },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    clock: { now: async () => 0, every: () => ({ cancel: () => undefined }), after: () => ({ cancel: () => undefined }) },
    audio: { play: async () => undefined },
    command: { register: async () => ({ value: { command: 'ultramod' } }) },
    env: { get: async () => undefined },
  } as unknown as UltraApi
  return w
}

interface Drive {
  run: (e: Args<'tool.call'>, result: EventResult<'tool.call'>) => Promise<EventResult<'tool.call'>>
}

function drive(w: World): Drive {
  resetLoops()
  const driver = createDriver([loops], enabled)
  return {
    run: (e, result) => {
      return driver.dispatch(w.$, 'tool.call', e, async () => result)
    },
  }
}

const bash = (command: string) => ({ tool: 'Bash', command }) as unknown as Args<'tool.call'>
const failed = (text: string): EventResult<'tool.call'> => ({ isError: true, result: { code: 1 }, text })
const passed = (): EventResult<'tool.call'> => ({ result: { code: 0 }, text: 'done' })

describe('loops nudges repeated identical bash failures', () => {
  test('the third identical failure adds the SPEC context line and toasts once', async () => {
    const w = world()
    const d = drive(w)
    const first = await d.run(bash('npm test'), failed('Error: something broke'))
    const second = await d.run(bash('npm test'), failed('Error: something broke'))
    expect((first as { context?: string[] }).context).toBeUndefined()
    expect((second as { context?: string[] }).context).toBeUndefined()
    const third = await d.run(bash('npm test'), failed('Error: something broke'))
    expect((third as { context?: string[] }).context).toEqual([
      'This exact command has now failed 3 times with the same error. Stop retrying it. Read the error, check your assumptions, or ask the user.',
    ])
    expect(w.toasts).toEqual(['Bash failed 3 times with the same error'])
    const fourth = await d.run(bash('npm test'), failed('Error: something broke'))
    expect((fourth as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toHaveLength(1)
  })

  test('an exit code header does not merge two different errors', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash('npm test'), failed('Exit code 1\nModule not found: a'))
    await d.run(bash('npm test'), failed('Exit code 1\nModule not found: b'))
    const third = await d.run(bash('npm test'), failed('Exit code 1\nModule not found: a'))
    expect((third as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('the same error still counts when an exit code header sits above it', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash('npm test'), failed('Exit code 1\nModule not found: a'))
    await d.run(bash('npm test'), failed('Exit code 1\nModule not found: a'))
    const third = await d.run(bash('npm test'), failed('Exit code 1\nModule not found: a'))
    expect((third as { context?: string[] }).context).toBeDefined()
    expect(w.toasts).toEqual(['Bash failed 3 times with the same error'])
  })

  test('different first error lines are different signatures', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash('npm test'), failed('Error: one'))
    await d.run(bash('npm test'), failed('Error: two'))
    const third = await d.run(bash('npm test'), failed('Error: three'))
    expect((third as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('whitespace differences do not create a new signature', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash('npm  test'), failed('Error: x'))
    await d.run(bash('npm\ttest'), failed('Error: x'))
    const third = await d.run(bash(' npm test '), failed('Error: x'))
    expect((third as { context?: string[] }).context).toBeDefined()
  })

  test('a success resets the count', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash('npm test'), failed('Error: x'))
    await d.run(bash('npm test'), failed('Error: x'))
    await d.run(bash('npm test'), passed())
    await d.run(bash('npm test'), failed('Error: x'))
    const fifth = await d.run(bash('npm test'), failed('Error: x'))
    expect((fifth as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('successful commands pass through untouched', async () => {
    const w = world()
    const d = drive(w)
    const result = await d.run(bash('ls -la'), passed())
    expect(result).toEqual({ result: { code: 0 }, text: 'done' })
    expect(w.toasts).toEqual([])
  })

  test('non hooked tools are untouched', async () => {
    const w = world()
    const d = drive(w)
    const result = await d.run({ tool: 'Read', file_path: 'x' } as unknown as Args<'tool.call'>, failed('Error: x'))
    expect(result).toEqual(failed('Error: x'))
  })

  test('a failing toast never breaks the result', async () => {
    const w = world()
    ;(w.$ as unknown as { ui: { toast: () => void } }).ui.toast = () => { throw new Error('toast failed') }
    const d = drive(w)
    await d.run(bash('npm test'), failed('Error: x'))
    await d.run(bash('npm test'), failed('Error: x'))
    const third = await d.run(bash('npm test'), failed('Error: x'))
    expect((third as { context?: string[] }).context).toBeDefined()
  })
})

describe('loops warns about repeated missed edits', () => {
  const editMiss = () => ({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'gone', new_string: 'new' }) as unknown as Args<'tool.call'>

  test('the second miss in a row nudges to read again', async () => {
    const w = world()
    const d = drive(w)
    const first = await d.run(editMiss(), failed('old_string was not found in the file'))
    expect((first as { context?: string[] }).context).toBeUndefined()
    const second = await d.run(editMiss(), failed('old_string was not found in the file'))
    expect((second as { context?: string[] }).context).toEqual([
      'old_string was not found twice in a row in this file. Read the file again before editing.',
    ])
    expect(w.toasts).toEqual(['Edit missed old_string twice on one file'])
    const third = await d.run(editMiss(), failed('old_string was not found in the file'))
    expect((third as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toHaveLength(1)
  })

  test('a successful edit resets the file counter', async () => {
    const w = world()
    const d = drive(w)
    await d.run(editMiss(), failed('old_string was not found'))
    await d.run(editMiss(), passed())
    const third = await d.run(editMiss(), failed('old_string was not found'))
    expect((third as { context?: string[] }).context).toBeUndefined()
  })

  test('unrelated edit errors do not count', async () => {
    const w = world()
    const d = drive(w)
    await d.run(editMiss(), failed('permission denied'))
    const second = await d.run(editMiss(), failed('permission denied'))
    expect((second as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('different files are tracked separately', async () => {
    const w = world()
    const d = drive(w)
    const other = () => ({ tool: 'Edit', file_path: '/work/src/other.ts', old_string: 'gone', new_string: 'new' }) as unknown as Args<'tool.call'>
    await d.run(editMiss(), failed('old_string was not found'))
    const secondOther = await d.run(other(), failed('old_string was not found'))
    expect((secondOther as { context?: string[] }).context).toBeUndefined()
  })
})

describe('loops warn mode toasts without context', () => {
  test('flow warns but does not nudge the model', async () => {
    const w = world({ set: resolveSet({ set: 'flow' }) })
    const d = drive(w)
    await d.run(bash('npm test'), failed('Error: x'))
    await d.run(bash('npm test'), failed('Error: x'))
    const third = await d.run(bash('npm test'), failed('Error: x'))
    expect((third as { context?: string[] }).context).toBeUndefined()
    expect(w.toasts).toEqual(['Bash failed 3 times with the same error'])
  })
})

describe('loops edge cases', () => {
  const context = (r: EventResult<'tool.call'>) => (r as { context?: string[] }).context

  test('whitespace inside quotes keeps two commands apart', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash("grep 'a  b' /missing"), failed('grep: /missing: No such file'))
    await d.run(bash("grep 'a b' /missing"), failed('grep: /missing: No such file'))
    const third = await d.run(bash("grep 'a   b' /missing"), failed('grep: /missing: No such file'))
    expect(context(third)).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('spaces around quoted arguments still collapse', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash("grep  'a  b'   /missing"), failed('Error: x'))
    await d.run(bash("grep 'a  b' /missing"), failed('Error: x'))
    const third = await d.run(bash("  grep 'a  b'\t/missing "), failed('Error: x'))
    expect(context(third)).toBeDefined()
  })

  test('failures without any diagnostic line are not counted as the same error', async () => {
    const w = world()
    const d = drive(w)
    for (const text of ['', 'Exit code 1', undefined]) {
      await d.run(bash('make'), { isError: true, result: { code: 1 }, text } as EventResult<'tool.call'>)
    }
    const fourth = await d.run(bash('make'), { isError: true, result: { code: 1 }, text: '' } as EventResult<'tool.call'>)
    expect(context(fourth)).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('a success lets a later failure streak nudge again', async () => {
    const w = world()
    const d = drive(w)
    for (let i = 0; i < 3; i++) await d.run(bash('npm test'), failed('Error: x'))
    expect(w.toasts).toHaveLength(1)
    await d.run(bash('npm test'), passed())
    await d.run(bash('npm test'), failed('Error: x'))
    await d.run(bash('npm test'), failed('Error: x'))
    const third = await d.run(bash('npm test'), failed('Error: x'))
    expect(context(third)).toBeDefined()
    expect(w.toasts).toHaveLength(2)
  })

  test('an edit success lets a later miss streak nudge again', async () => {
    const w = world()
    const d = drive(w)
    const miss = () => ({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'x', new_string: 'y' }) as unknown as Args<'tool.call'>
    await d.run(miss(), failed('old_string was not found'))
    await d.run(miss(), failed('old_string was not found'))
    await d.run(miss(), passed())
    await d.run(miss(), failed('old_string was not found'))
    const second = await d.run(miss(), failed('old_string was not found'))
    expect(context(second)).toBeDefined()
    expect(w.toasts).toHaveLength(2)
  })

  test('an unrelated edit failure breaks the old_string streak', async () => {
    const w = world()
    const d = drive(w)
    const edit = () => ({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'x', new_string: 'y' }) as unknown as Args<'tool.call'>
    await d.run(edit(), failed('old_string was not found'))
    await d.run(edit(), failed('permission denied'))
    const third = await d.run(edit(), failed('old_string was not found'))
    expect(context(third)).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('the failure memory is bounded', async () => {
    const w = world()
    const d = drive(w)
    await d.run(bash('first'), failed('Error: x'))
    await d.run(bash('first'), failed('Error: x'))
    for (let i = 0; i < 300; i++) await d.run(bash(`other-${i}`), failed(`Error: ${i}`))
    const third = await d.run(bash('first'), failed('Error: x'))
    expect(context(third)).toBeUndefined()
  })
})
