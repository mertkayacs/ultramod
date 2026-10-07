import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionUsage } from 'claude-code'
import { compactInstructions } from '../hooks/mods/compact'
import type { UltraCompact, UltraReceipt } from '../types/index'

const BAND: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 160, scroll: { offset: 0, bodyRows: 5 }, view: {} }
const KEEP = 'Keep the current task, the decisions made and the next steps.'

// Compact reads the same world the HUD draws from; the other mods stay out of the way.
function world(on: On, percent = 50) {
  const clock = mock.clock(on)
  mock.store(on, { 'project:/work': { overrides: { guard: false, secrets: false, tests: false, tidy: false, loops: false, notify: false, pins: false } } })
  const usage: SessionUsage = { startedAt: 0, context: { tokens: 124_000, window: 200_000, percent }, rateLimits: [], cost: { usd: 0 } }
  const toasts: string[] = []
  const instructions: (string | undefined)[] = []
  const flags: (UltraCompact | undefined)[] = []
  const failures = { compact: false }
  on('session.root', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: usage }))
  on('session.model', () => ({ value: 'claude-sonnet-4-6' }))
  on('command.register', () => ({ value: { command: 'ultra' } }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['downstream'] }))
  on('state.set', { plugin: 'ultramod', key: 'compact' }, ($, e, next) => { flags.push(e.value); return next(e) })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.compact', ($, e) => {
    if (failures.compact) throw new Error('compaction refused')
    instructions.push(e.instructions)
    return { messages: [{ role: 'assistant', text: 'compacted', toolUses: [] }] }
  })
  return { clock, usage, toasts, instructions, flags, failures }
}

async function turn($: Engine, id: string, usage: SessionUsage, percent: number) {
  usage.context.percent = percent
  await $.turn.start({ turnId: id, text: '' })
  await $.tool.call({ tool: 'Edit', file_path: `/work/${id}.ts`, old_string: 'a', new_string: 'b' })
  return $.turn.complete({ turnId: id, answer: 'done', durationMs: 0, isAborted: false, reason: 'answer' })
}

test('the warn threshold toasts once per session and marks the offer once crossed', async ($, on) => {
  const { usage, toasts, instructions, flags } = world(on, 69)
  await turn($, 't1', usage, 69)
  expect(toasts).toEqual([])
  expect(flags).toEqual([])
  await turn($, 't2', usage, 70)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('70%')
  expect(flags.at(-1)).toEqual({ warned: true, offered: false })
  await turn($, 't3', usage, 88)
  expect(toasts).toHaveLength(1)
  expect(flags.at(-1)).toEqual({ warned: true, offered: true })
  // essentials offers compaction but never takes it.
  expect(instructions).toEqual([])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface} band offers Compact now from the offer threshold`, async ($, on) => {
    const { usage, toasts, instructions, flags } = world(on, 69)
    await turn($, 't1', usage, 69)
    let ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Button', text: 'Compact now' })).toBeUndefined()
    await ui.unmount()

    await turn($, 't2', usage, 85)
    expect(flags.at(-1)).toEqual({ warned: true, offered: true })
    ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    const button = await ui.find({ type: 'Button', text: 'Compact now' })
    expect(button).toMatchObject({ props: { hotkey: 'c', key: 'compact-now' } })
    await ui.press({ key: 'compact-now' })
    expect(instructions).toHaveLength(1)
    expect(instructions[0]).toContain(KEEP)
    // The warn toast is the session's only one; pressing compact adds none.
    expect(toasts).toHaveLength(1)
    await ui.unmount()
  })
}

test('a clear starts a fresh warning cycle', async ($, on) => {
  const { usage, toasts } = world(on, 75)
  await turn($, 't1', usage, 75)
  expect(toasts).toHaveLength(1)
  await $.classic.SessionStart({ source: 'clear' })
  await turn($, 't2', usage, 75)
  expect(toasts).toHaveLength(2)
})

test('marathon auto-compacts after the turn has ended, never during it', { options: { set: 'marathon' } }, async ($, on) => {
  const { clock, usage, instructions } = world(on, 88)
  await $.turn.start({ turnId: 't1', text: '' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/app.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 0, isAborted: false, reason: 'answer' })
  // The turn is still resolving, so session.compact has not been asked yet.
  expect(instructions).toEqual([])
  await clock.settle()
  expect(instructions).toHaveLength(1)
  expect(instructions[0]).toContain('/work/app.ts')
  expect(instructions[0]).toContain(KEEP)
})

test('quiet never warns, offers or auto-compacts', { options: { set: 'quiet' } }, async ($, on) => {
  const { clock, usage, toasts, instructions } = world(on, 95)
  await turn($, 't1', usage, 95)
  await clock.settle()
  expect(toasts).toEqual([])
  expect(instructions).toEqual([])
  const ui = await $.ui.mount({ plugin: 'ultramod', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await ui.find({ type: 'Button', text: 'Compact now' })).toBeUndefined()
  await ui.unmount()
})

test('a compaction that fails leaves the turn result untouched', { options: { set: 'marathon' } }, async ($, on) => {
  const { clock, usage, instructions, failures } = world(on, 90)
  failures.compact = true
  const result = await turn($, 't1', usage, 90)
  expect(result.text).toContain('receipt')
  await clock.settle()
  expect(instructions).toEqual([])
})

test('instructions list files, failures and unverified claims, deduplicated', () => {
  const history: UltraReceipt[] = [
    { turnId: 't1', text: '', files: ['/work/a.ts', '/work/b.ts'], commands: [{ command: 'npm test', kind: 'test', passed: false, sequence: 1, error: 'npm ERR! boom' }], subagents: 0, durationMs: 0, costUsd: null, unverified: ['says tests pass, no passing test run after the last edit'] },
    { turnId: 't2', text: '', files: ['/work/a.ts'], commands: [{ command: 'npm test', kind: 'test', passed: true, sequence: 1 }], subagents: 0, durationMs: 0, costUsd: null, unverified: [] },
  ]
  const text = compactInstructions(history)
  expect(text).toContain('Files changed:\n- /work/a.ts\n- /work/b.ts')
  expect(text).toContain('Commands that failed:\n- npm test: npm ERR! boom')
  expect(text).toContain('Unverified claims:\n- says tests pass, no passing test run after the last edit')
  expect(text.endsWith(KEEP)).toBe(true)
})

test('instructions keep at most 30 files and stay within 2000 characters', () => {
  const history: UltraReceipt[] = Array.from({ length: 40 }, (_, index) => ({
    turnId: `t${index}`,
    text: '',
    files: [`/work/module-${index}.ts`],
    commands: [{ command: `npm run build:target-${index}`, kind: 'build' as const, passed: false, sequence: 1, error: `compile error in module-${index}` }],
    subagents: 0,
    durationMs: 0,
    costUsd: null,
    unverified: [`says build passes for module-${index}, no passing build run after the last edit`],
  }))
  const text = compactInstructions(history)
  expect(text.split('\n').filter(line => line.startsWith('- /work/module-'))).toHaveLength(30)
  expect(text).not.toContain('/work/module-30.ts')
  expect(text.length).toBeLessThanOrEqual(2_000)
  expect(text.endsWith(KEEP)).toBe(true)
})

test('an empty history still asks for the task to be kept', () => {
  expect(compactInstructions([])).toBe(KEEP)
})
