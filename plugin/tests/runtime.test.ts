import type { Args, EventResult, On, ToolCallArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { UltraApi } from '../hooks/core/api'
import { REFUSED, checkTool, maskRow, turnComplete, turnStart, watchTool } from '../hooks/core/runtime'
import type { ModId, ToolResult, UltraMod } from '../hooks/core/mod'
import { createDriver, standIn } from './drive'

const enabled = { enabled: async () => true }
const api = {} as UltraApi

// The kit answers any tool name it is given; this build's declarations hold
// only its own tools, so a probe is cast once here.
const probeCall = (tool: string) => ({ tool }) as unknown as ToolCallArgs
const probe = (tool = 'probe') => ({ tool }) as unknown as Args<'tool.call'>

function setup(on: On) {
  mock.store(on)
  on('session.root', () => ({ value: '/runtime-tests' }))
}

test('checks run in mod order, watchers start in order and see the result in reverse', async () => {
  const order: string[] = []
  const calls = { count: 0 }
  const mods: UltraMod[] = (['guard', 'secrets', 'tests'] as const).map(id => ({
    id,
    check: { run: () => { order.push(`${id}:check`); return null } },
    watch: { run: () => {
      order.push(`${id}:before`)
      return result => { order.push(`${id}:after`); return result }
    } },
  }))
  const { dispatch } = createDriver(mods, enabled)
  const answer = await dispatch(api, 'tool.call', probe(), async () => { calls.count += 1; order.push('call'); return { result: 'finished' } })
  expect(answer).toEqual({ result: 'finished' })
  expect(order).toEqual([
    'guard:check', 'secrets:check', 'tests:check',
    'guard:before', 'secrets:before', 'tests:before', 'call',
    'tests:after', 'secrets:after', 'guard:after',
  ])
  expect(calls.count).toBe(1)
})

test('the first refusal wins and nothing after it runs', async () => {
  const seen: string[] = []
  const calls = { count: 0 }
  const { dispatch } = createDriver([
    { id: 'guard', check: { run: () => { seen.push('guard'); return 'no' } } },
    { id: 'secrets', check: { run: () => { seen.push('secrets'); return null } } },
    { id: 'receipts', watch: { run: () => { seen.push('receipts'); return null } } },
  ], enabled)
  expect(await dispatch(api, 'tool.call', probe(), async () => { calls.count += 1; return { result: 'finished' } })).toEqual({ deny: 'no' })
  expect(seen).toEqual(['guard'])
  expect(calls.count).toBe(0)
})

test('enabled mods are read for every call and disabled checks are skipped', async () => {
  const active = new Set<ModId>(['receipts'])
  const seen: string[] = []
  const { dispatch } = createDriver([
    { id: 'guard', check: { run: () => { seen.push('guard'); return null } } },
    { id: 'receipts', watch: { run: () => { seen.push('receipts'); return null } } },
  ], { enabled: async (_, id) => active.has(id) })
  await dispatch(api, 'tool.call', probe(), async () => ({ result: 'finished' }))
  active.add('guard')
  active.delete('receipts')
  await dispatch(api, 'tool.call', probe(), async () => ({ result: 'finished' }))
  expect(seen).toEqual(['receipts', 'guard'])
})

test('when filters choose the calls a step sees', async () => {
  const seen: string[] = []
  const { dispatch } = createDriver([
    { id: 'guard', check: { when: e => (e.tool as string) === 'probe', run: (_, e) => { seen.push(e.tool); return null } } },
    { id: 'receipts', watch: { run: (_, e) => { seen.push(`receipts:${e.tool}`); return null } } },
  ], enabled)
  await dispatch(api, 'tool.call', probe('other-probe'), async () => ({ result: 'finished' }))
  await dispatch(api, 'tool.call', probe('probe'), async () => ({ result: 'finished' }))
  expect(seen).toEqual(['receipts:other-probe', 'probe', 'receipts:probe'])
})

test('a failing check refuses the call before anything runs', async () => {
  let reachedWatcher = false
  const calls = { count: 0 }
  const { dispatch } = createDriver([
    { id: 'guard', check: { run: () => { throw new Error('guard failed') } } },
    { id: 'receipts', watch: { run: () => { reachedWatcher = true; return null } } },
  ], enabled)
  expect(await dispatch(api, 'tool.call', probe(), async () => { calls.count += 1; return { result: 'finished' } })).toEqual({ deny: REFUSED })
  expect(reachedWatcher).toBe(false)
  expect(calls.count).toBe(0)
})

test('a failing check filter refuses too', async () => {
  const runtime = standIn([{ id: 'guard', check: { when: () => { throw new Error('filter failed') }, run: () => null } }], enabled)
  expect(await checkTool(api, runtime, probe())).toBe(REFUSED)
})

test('a check of a mod whose state cannot be read refuses', async () => {
  const runtime = standIn([{ id: 'guard', check: { run: () => null } }], { enabled: async () => { throw new Error('state down') } })
  expect(await checkTool(api, runtime, probe())).toBe(REFUSED)
})

test('a watcher that fails before the call is skipped and the others go on', async () => {
  const seen: string[] = []
  const { dispatch } = createDriver([
    { id: 'receipts', watch: { run: () => { throw new Error('watcher failed') } } },
    { id: 'loops', watch: { run: () => { seen.push('loops'); return null } } },
  ], enabled)
  expect(await dispatch(api, 'tool.call', probe(), async () => ({ result: 'finished' }))).toEqual({ result: 'finished' })
  expect(seen).toEqual(['loops'])
})

test('a watcher that fails on the result leaves the result it was given', async () => {
  const result = { result: 'finished', text: 'completed output', ref: 17, isReadOnly: true } as unknown as ToolResult
  const runtime = standIn([
    { id: 'secrets', watch: { run: () => out => ({ ...out, context: ['outer'] }) as ToolResult } },
    { id: 'receipts', watch: { run: () => () => { throw new Error('postprocessing failed') } } },
  ], enabled)
  const after = await watchTool(api, runtime, probe())
  expect(await after(result)).toEqual({ deny: undefined, context: ['outer'] })
  const untouched = await watchTool(api, standIn([{ id: 'receipts', watch: { run: () => out => out } }], enabled), probe())
  expect(await untouched(result)).toBeNull()
})

test('a failed HUD start and completion leave the mods running', async () => {
  const seen: string[] = []
  const runtime = standIn([{
    id: 'receipts',
    turnStart: { run: () => { seen.push('start') } },
    turnComplete: { run: () => { seen.push('complete'); return 'receipt survived' } },
  }], enabled)
  runtime.hud.start = async () => { throw new Error('clock failed') }
  runtime.hud.complete = async () => { throw new Error('state failed') }
  await turnStart(api, runtime, { turnId: 'main', text: '' } as Args<'turn.start'>)
  expect(await turnComplete(api, runtime, { turnId: 'main', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as Args<'turn.complete'>)).toBe('receipt survived')
  expect(seen).toEqual(['start', 'complete'])
})

test('a turn line goes after a line a plugin beneath added, never over the answer', async () => {
  const { dispatch } = createDriver([{ id: 'receipts', turnComplete: { run: () => 'receipt' } }], enabled)
  const turn = { turnId: 't', answer: 'the answer', durationMs: 1, isAborted: false, reason: 'answer' } as Args<'turn.complete'>
  expect(await dispatch(api, 'turn.complete', turn, async () => ({ text: '' }))).toMatchObject({ text: 'receipt' })
  expect(await dispatch(api, 'turn.complete', turn, async () => ({ text: 'the answer' }))).toMatchObject({ text: 'receipt' })
  expect(await dispatch(api, 'turn.complete', turn, async () => ({ text: 'beneath' }))).toMatchObject({ text: 'beneath\nreceipt' })
})

test('a failed redaction keeps the original row', async () => {
  const runtime = standIn([{ id: 'secrets', append: { run: () => { throw new Error('redactor failed') } } }], enabled)
  const message: Args<'session.append'>['message'] = { type: 'user', content: [{ type: 'text', text: 'original output' }] }
  const row: Args<'session.append'> = { message, door: 'tool-result', origin: { kind: 'tool', tool: 'probe' }, uuid: 'result-1' }
  expect(await maskRow(api, runtime, row)).toBeNull()
  const calls = { count: 0 }
  const { dispatch } = createDriver(runtime.mods, enabled)
  const answer = await dispatch(api, 'session.append', row, async input => { calls.count += 1; return { message: input.message, uuid: input.uuid } as EventResult<'session.append'> })
  expect(answer).toEqual({ message, uuid: 'result-1' })
  expect(calls.count).toBe(1)
})

// Through the plugin as the engine loads it: the registrations in register.tsx.

test('when the stored set is unreadable, a checked tool is refused and any other tool runs', async ($, on) => {
  setup(on)
  on('state.get', { plugin: 'ultramod', key: 'set' }, () => ({ value: { value: 'not a set', version: 1 } }))
  on('tool.call', () => ({ result: 'ran' }))
  expect(await $.tool.call(probeCall('Bash'))).toEqual({ deny: REFUSED })
  expect(await $.tool.call(probeCall('WebFetch'))).toEqual({ result: 'ran' })
})

test('every tool the checks read reaches them through the registration', async ($, on) => {
  setup(on)
  on('tool.call', () => ({ result: 'ran' }))
  const calls: Record<string, unknown>[] = [
    { tool: 'Read', file_path: '.env' },
    { tool: 'Edit', file_path: '.env', old_string: 'a', new_string: 'b' },
    { tool: 'MultiEdit', file_path: '.env', edits: [] },
    { tool: 'Write', file_path: '.env', content: 'x' },
    { tool: 'NotebookEdit', notebook_path: '.env', new_source: 'x' },
    { tool: 'Grep', pattern: 'token', path: '.env' },
    { tool: 'Glob', pattern: '*', path: '.env' },
    { tool: 'Bash', command: 'cat .env' },
  ]
  for (const call of calls) {
    expect(await $.tool.call(call as unknown as ToolCallArgs)).toMatchObject({ deny: expect.stringContaining('.env') })
  }
})

for (const decision of ['allow', 'ask', 'deny'] as const) {
  test(`Ultra Mod has no permission hook: an engine ${decision} reaches Claude Code unchanged`, async ($, on) => {
    setup(on)
    on('tool.check', () => ({ decision }))
    expect(await $.tool.check({ tool: 'Bash', input: { command: 'git reset --hard' } })).toEqual({ decision })
  })
}

test('Ultra Mod has no prompt hook: a prompt goes on as typed', async ($, on) => {
  setup(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  expect(await $.prompt.submit({ text: 'unchanged prompt', wait: false, origin: { kind: 'composer' } })).toEqual({ text: 'unchanged prompt' })
})
