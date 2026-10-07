import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Args, On, RenderPropsOf, SessionUsage, TurnCompleteResult, TurnUsage } from 'claude-code'
import type { UltraReceipt } from '../types/index'

const PANE: RenderPropsOf['Pane'] = { title: 'Ultra Mod', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} }

// Every mod but receipts is off, so nothing else can gate these calls.
const OFF = { guard: false, secrets: false, tests: false, tidy: false, loops: false, notify: false, pins: false, hud: false, compact: false }

function world(on: On) {
  mock.clock(on)
  mock.store(on, { 'project:/work': { overrides: OFF } })
  const usage: SessionUsage = { startedAt: 0, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits: [], cost: { usd: 0.1 } }
  const stored: UltraReceipt[][] = []
  const results: { isError: true; text?: string }[] = []
  const base: TurnCompleteResult = { text: '' }
  on('session.root', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: usage }))
  on('command.register', () => ({ value: { command: 'ultra' } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => base)
  on('state.set', { plugin: 'ultramod', key: 'receipts' }, ($, e, next) => { stored.push(e.value); return next(e) })
  on('tool.call', () => ({ result: 'ok', ...(results.shift() ?? {}) }))
  return { usage, stored, results, base }
}

const edit = (path: string) => ({ tool: 'Edit' as const, file_path: path, old_string: 'a', new_string: 'b' })
const bash = (command: string) => ({ tool: 'Bash' as const, command })
const read = (path: string) => ({ tool: 'Read' as const, file_path: path })
const start = ($: Engine, id: string) => $.turn.start({ turnId: id, text: '' })
const finish = ($: Engine, id: string, answer: string, extra: Partial<Args<'turn.complete'>> = {}) =>
  $.turn.complete({ turnId: id, answer, durationMs: 1_000, isAborted: false, reason: 'answer', ...extra } as Args<'turn.complete'>)

test('a turn counts files, commands, failures, duration and cost delta', async ($, on) => {
  const { usage, stored, results, base } = world(on)
  const engineUsage: TurnUsage = { model: 'claude-test', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  base.usage = engineUsage
  await start($, 't1')
  await $.tool.call(edit('/work/a.ts'))
  await $.tool.call({ tool: 'Write', file_path: '/work/b.ts', content: 'b' })
  results.push({ isError: true, text: 'npm ERR! exiting with code 1\nstack line' })
  await $.tool.call(bash('npm run build'))
  await $.tool.call(bash('npm test'))
  usage.cost!.usd = 0.52
  const result = await finish($, 't1', 'All tests pass.', { durationMs: 134_000 })
  expect(result.text).toBe('receipt · 2 files · 2 cmds (1 failed) · tests passed · build failed · 2m14s · +$0.42')
  expect(result.usage).toEqual(engineUsage)
  expect(stored).toHaveLength(1)
  const receipt = stored[0]?.[0]
  expect(receipt).toMatchObject({
    turnId: 't1',
    files: ['/work/a.ts', '/work/b.ts'],
    subagents: 0,
    durationMs: 134_000,
    unverified: [],
  })
  // 0.52 - 0.1 keeps its float noise; the stored delta is checked to the cent.
  expect(Math.round((receipt?.costUsd ?? 0) * 100) / 100).toBe(0.42)
  expect(receipt?.commands.map(run => [run.command, run.kind, run.passed, run.error ?? null])).toEqual([
    ['npm run build', 'build', false, 'npm ERR! exiting with code 1'],
    ['npm test', 'test', true, null],
  ])
})

test('subagent turns and subagent tool calls stay out of the receipt', async ($, on) => {
  const { stored } = world(on)
  await start($, 't1')
  await $.tool.call({ tool: 'Agent', description: 'explore', prompt: 'look around' })
  await $.tool.call(edit('/work/child.ts'))
  // Named for agentId, which the declarations leave out of the call's type.
  const childEdit = { tool: 'Edit' as const, file_path: '/work/child.ts', old_string: 'a', new_string: 'b', agentId: 'child' }
  await $.tool.call(childEdit)
  await $.tool.call(bash('git status'))
  await finish($, 'child', 'done', { agentId: 'child' })
  const result = await finish($, 't1', 'done')
  expect(result.text).toBe('receipt · 1 file · 1 cmd · 1s')
  expect(stored).toHaveLength(1)
  expect(stored[0]?.[0]).toMatchObject({ files: ['/work/child.ts'], subagents: 1 })
  expect(stored[0]?.[0]?.commands).toHaveLength(1)
})

test('an aborted turn keeps no receipt', async ($, on) => {
  const { stored } = world(on)
  await start($, 't1')
  await $.tool.call(edit('/work/a.ts'))
  const result = await finish($, 't1', '', { isAborted: true, reason: 'aborted' })
  expect(result.text).toBe('')
  expect(stored).toEqual([])
})

test('the engine usage survives a receipt that prints its own text', async ($, on) => {
  const { base } = world(on)
  await start($, 't1')
  await $.tool.call(read('/work/a.ts'))
  base.text = 'engine text'
  const result = await finish($, 't1', 'done')
  expect(result.text).toBe('engine text\nreceipt · 1s')
})

test('mode tools only shows a receipt when the turn used a tool', async ($, on) => {
  const { stored } = world(on)
  await start($, 't1')
  expect((await finish($, 't1', 'done')).text).toBe('')
  await start($, 't2')
  await $.tool.call(read('/work/a.ts'))
  expect((await finish($, 't2', 'done')).text).toBe('receipt · 1s')
  expect(stored).toHaveLength(2)
})

test('mode always shows a receipt even without tools', { options: { set: 'strict' } }, async ($, on) => {
  world(on)
  await start($, 't1')
  expect((await finish($, 't1', 'done')).text).toBe('receipt · 1s')
})

test('mode issues shows only turns with a failure or an unverified claim', { options: { set: 'flow' } }, async ($, on) => {
  const { results } = world(on)
  await start($, 't1')
  await $.tool.call(read('/work/a.ts'))
  expect((await finish($, 't1', 'done')).text).toBe('')
  await start($, 't2')
  results.push({ isError: true, text: 'boom' })
  await $.tool.call(bash('git status'))
  expect((await finish($, 't2', 'done')).text).toBe('receipt · 1 cmd (1 failed) · 1s')
  await start($, 't3')
  await $.tool.call(read('/work/a.ts'))
  expect((await finish($, 't3', 'All tests pass.')).text).toBe('receipt · 1s · unverified: says tests pass, no passing test run after the last edit')
})

test('mode off stores nothing and prints nothing', { options: { set: 'quiet' } }, async ($, on) => {
  const { stored } = world(on)
  await start($, 't1')
  await $.tool.call(edit('/work/a.ts'))
  expect((await finish($, 't1', 'All tests pass.')).text).toBe('')
  expect(stored).toEqual([])
})

test('each claimed kind without a fresh passing run is flagged', async ($, on) => {
  world(on)
  const cases: [string, string][] = [
    ['All tests pass.', 'unverified: says tests pass, no passing test run after the last edit'],
    ['The build succeeds.', 'unverified: says build passes, no passing build run after the last edit'],
    ['Type check passes.', 'unverified: says type check passes, no passing typecheck run after the last edit'],
    ['Lint passes.', 'unverified: says lint passes, no passing lint run after the last edit'],
  ]
  for (const [answer, issue] of cases) {
    await start($, 'claim')
    await $.tool.call(read('/work/a.ts'))
    expect((await finish($, 'claim', answer)).text).toBe(`receipt · 1s · ${issue}`)
  }
})

test('freshness follows the last edit, in both directions', async ($, on) => {
  world(on)
  // A passing run that happened before the edit cannot vouch for it.
  await start($, 't1')
  await $.tool.call(bash('npm test'))
  await $.tool.call(edit('/work/a.ts'))
  expect((await finish($, 't1', 'All tests pass.')).text)
    .toBe('receipt · 1 file · 1 cmd · tests passed · 1s · unverified: says tests pass, no passing test run after the last edit')
  // A passing run after the edit clears the claim.
  await start($, 't2')
  await $.tool.call(edit('/work/b.ts'))
  await $.tool.call(bash('npm test'))
  expect((await finish($, 't2', 'All tests pass.')).text)
    .toBe('receipt · 1 file · 1 cmd · tests passed · 1s')
})

test('a failed run of the claimed kind is still a run, but never passes', async ($, on) => {
  const { results } = world(on)
  await start($, 't1')
  await $.tool.call(edit('/work/a.ts'))
  results.push({ isError: true, text: 'boom' })
  await $.tool.call(bash('npm test'))
  expect((await finish($, 't1', 'All tests pass.')).text)
    .toBe('receipt · 1 file · 1 cmd (1 failed) · tests failed · 1s · unverified: says tests pass, no passing test run after the last edit')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface} pane shows the last five receipts`, { options: { set: 'strict' } }, async ($, on) => {
    world(on)
    for (let index = 1; index <= 6; index++) {
      await start($, `t${index}`)
      await $.turn.complete({ turnId: `t${index}`, answer: '', durationMs: index * 1_000, isAborted: false, reason: 'answer' })
    }
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'Pane', requestId: 'ultramod', props: PANE })
    expect(await ui.findAll({ type: 'Text', text: /ago  receipt/ })).toHaveLength(5)
    for (let index = 2; index <= 6; index++) {
      expect(await ui.find({ type: 'Text', text: `receipt · ${index}s` })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'receipt · 1s' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Last receipts' })).toBeDefined()
    await ui.unmount()
  })
}
