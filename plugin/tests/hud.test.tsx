import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement, RenderInput, RenderPropsOf, SessionUsage, ToolCallArgs } from 'claude-code'
import { createHud } from '../hooks/mods/hud'
import type { ModNext, UltraMod } from '../hooks/core/mod'
import { createSets, resolveSet } from '../hooks/core/sets'
import type { UltraTurn } from '../types/index'

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 5 }, view: {},
}

const usage = (): SessionUsage => ({
  startedAt: 0,
  context: { tokens: 124_000, window: 200_000, percent: 62 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 41, resetsAt: '1970-01-01T02:13:00.000Z' },
    { kind: 'seven_day', percentUsed: 18, resetsAt: '1970-01-04T04:00:00.000Z' },
  ],
  cost: { usd: 1.84 },
})

function world(on: On, readings = usage(), downstream = true) {
  const clock = mock.clock(on)
  const turns: UltraTurn[] = []
  // Secrets runs in another lane; keep HUD tests independent of its gate.
  mock.store(on, { 'project:/work': { overrides: { secrets: false } } })
  on('session.root', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: readings }))
  on('session.model', () => ({ value: 'claude-sonnet-4-6' }))
  on('command.register', () => ({ value: { command: 'ultra' } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  if (downstream) on('ui.render', () => ({ type: 'Text', props: {}, children: ['external band'] }))
  on('state.set', { plugin: 'ultramod', key: 'turn' }, ($, e, next) => {
    turns.push(e.value)
    return next(e)
  })
  return { clock, readings, turns }
}

const command = (args: string) => ({ command: 'ultra', args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 160 } })

test('HUD keeps priority segments within bodyColumns on terminal and desktop', async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'main', text: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [60, 100, 160]) {
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', viewport: { columns: 200, rows: 30 }, props: { ...BAND, bodyColumns, isWorking: true } })
      const tree = await ui.drawn()
      expect(tree.type).toBe('Box')
      if (tree.type !== 'Box') throw new Error('HUD must preserve the downstream tree in a column Box')
      const row = await ui.find({ type: 'Box', text: /124k\/200k/ })
      expect(row).toBeDefined()
      const context = await ui.find({ type: 'Text', text: /62% 124k\/200k/ })
      expect(context?.props.color).toBe('warning')
      expect(await ui.find({ type: 'Text', text: bodyColumns === 160 ? '5h 41% resets 2h13m' : '5h 41%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: bodyColumns === 160 ? '7d 18% resets 3d4h' : '7d 18%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'ctx ██████░░░░ 62% 124k/200k' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: ' · ' }))?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: /external band/ })).toBeDefined()
      const turn = await ui.find({ type: 'Text', text: /^0s$/ })
      const model = await ui.find({ type: 'Text', text: 'Sonnet 4.6' })
      const badge = await ui.find({ type: 'Text', text: 'ultra:essentials' })
      expect(turn).toBeDefined()
      if (bodyColumns === 60) {
        expect(model).toBeUndefined()
        expect(badge).toBeUndefined()
      } else {
        expect(model).toBeDefined()
        expect(badge?.props.dimColor).toBe(true)
      }
      const rowTree = tree.children?.[0]
      expect(rowTree).toMatchObject({ type: 'Box', props: { width: bodyColumns, flexDirection: 'row' } })
      await ui.unmount()
    }
  }
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
})

test('HUD hides empty limits and unavailable context or cost figures', async ($, on) => {
  const readings = usage()
  readings.rateLimits = []
  readings.context = { window: 200_000 }
  delete readings.cost
  world(on, readings)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /ctx / })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /5h|7d|\$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('HUD yields to surveys and unsupported surfaces', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: { ...BAND, hasSurvey: surface === 'terminal' || surface === 'desktop' } })
    expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: ['external band'] })
    await ui.unmount()
  }
})

test('flow draws only context and limits', { options: { set: 'flow' } }, async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'main', text: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /124k\/200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 41%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /edits|cmds|\$|Sonnet|ultra:/ })).toBeUndefined()
    await ui.unmount()
  }
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
})

test('context thresholds follow semantic theme colors', async ($, on) => {
  const { readings } = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [percent, color] of [[59, 'text'], [60, 'warning'], [79, 'warning'], [80, 'error']] as const) {
      readings.context.percent = percent
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ type: 'Text', text: /124k\/200k/ }))?.props.color).toBe(color)
      await ui.unmount()
    }
  }
})

test('limit thresholds use semantic colors on both surfaces', async ($, on) => {
  const { readings } = world(on)
  const limit = readings.rateLimits[0]
  if (!limit) throw new Error('missing five-hour fixture')
  readings.rateLimits = [limit]
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [percentUsed, color] of [[74, 'text'], [75, 'warning'], [89, 'warning'], [90, 'error']] as const) {
      limit.percentUsed = percentUsed
      for (const bodyColumns of [40, 160]) {
        const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
        const text = `5h ${percentUsed}%${bodyColumns === 160 ? ' resets 2h13m' : ''}`
        expect((await ui.find({ type: 'Text', text }))?.props.color).toBe(color)
        await ui.unmount()
      }
    }
  }
})

test('the ten-cell context bar clamps at zero and full usage', async ($, on) => {
  const { readings } = world(on)
  readings.rateLimits = []
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [percent, bar] of [[0, '░░░░░░░░░░'], [100, '██████████']] as const) {
      readings.context.percent = percent
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ type: 'Text', text: `ctx ${bar} ${percent}% 124k/200k` })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('running turn redraws every second, counts successful edits and executed commands, then stops', async ($, on) => {
  const { clock, turns } = world(on)
  on('tool.call', ($, e) => String(e.tool) === 'Bash' || String(e.tool) === 'NotebookEdit' ? { result: 'failed', isError: true, text: 'failed' } : { result: 'ok' })
  const ui = await $.ui.mount({ plugin: 'ultramod', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(2_000)
  expect(turns).toEqual([])
  await $.turn.start({ turnId: 'main', text: '' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/work/b.ts', content: 'b' })
  // MultiEdit left the tool table but the kit still answers the name and the
  // receipt counts the edit.
  const multiEdit = { tool: 'MultiEdit', file_path: '/work/c.ts', edits: [] }
  await $.tool.call(multiEdit as unknown as ToolCallArgs)
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/d.ipynb', new_source: 'd' })
  await $.tool.call({ tool: 'Bash', command: 'test command' })
  await clock.advance(72_000)
  expect(await ui.find({ type: 'Text', text: '1m12s 3 edits 1 cmd' })).toBeDefined()
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 72_000, isAborted: false, reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: '1m12s' })).toBeDefined()
  const count = turns.length
  await clock.advance(5_000)
  expect(turns.length).toBe(count)
  await ui.unmount()
})

test('a fresh running turn draws its timer alone and counts only above zero, singular at one', async ($, on) => {
  const { clock } = world(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await $.ui.mount({ plugin: 'ultramod', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await $.turn.start({ turnId: 'main', text: '' })
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: /^3s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /edits|cmds/ })).toBeUndefined()
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  expect(await ui.find({ type: 'Text', text: /^3s 1 edit$/ })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'echo hi' })
  expect(await ui.find({ type: 'Text', text: /^3s 1 edit 1 cmd$/ })).toBeDefined()
  await $.tool.call({ tool: 'Write', file_path: '/work/b.ts', content: 'b' })
  expect(await ui.find({ type: 'Text', text: /^3s 2 edits 1 cmd$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0 edits|0 cmds/ })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 3_000, isAborted: false, reason: 'answer' })
})

test('no cost segment reads $0.00, not even while a turn runs', async ($, on) => {
  const readings = usage()
  readings.cost = { usd: 0 }
  world(on, readings)
  await $.turn.start({ turnId: 'main', text: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const usd of [0, 0.004]) {
      readings.cost = { usd }
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ type: 'Text', text: /\$0\.00/ })).toBeUndefined()
      await ui.unmount()
    }
    readings.cost = { usd: 1.23 }
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
    await ui.unmount()
  }
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
})

test('subagent completions keep the main timer alive and session end cancels it', async ($, on) => {
  const { clock, turns } = world(on)
  await $.turn.start({ turnId: 'main', text: '' })
  await $.turn.complete({ turnId: 'child', agentId: 'child', answer: '', durationMs: 9_000, isAborted: false, reason: 'answer' })
  await clock.advance(2_000)
  expect(turns.at(-1)).toMatchObject({ id: 'main', now: 2_000 })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session', resume: { id: 'session' } })
  const count = turns.length
  await clock.advance(5_000)
  expect(turns.length).toBe(count)
})

test('switching quiet cancels ticks and enabling HUD during a turn restarts them', async ($, on) => {
  const { clock, turns } = world(on)
  await $.turn.start({ turnId: 'main', text: '' })
  await $.command.run(command('set quiet'))
  const count = turns.length
  await clock.advance(2_000)
  expect(turns.length).toBe(count)
  await $.command.run(command('set essentials'))
  await clock.advance(1_000)
  expect(turns.at(-1)).toMatchObject({ id: 'main', now: 3_000 })
  await $.command.run(command('set quiet'))
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 3_000, isAborted: true, reason: 'aborted' })
  expect(turns.at(-1)).toMatchObject({ id: null, durationMs: 3_000 })
})

test('a failed HUD reading leaves the downstream band visible', async ($, on) => {
  mock.store(on)
  on('session.root', () => ({ value: '/work' }))
  on('session.usage', () => ({ deny: 'usage unavailable' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['external band'] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: ['external band'] })
    await ui.unmount()
  }
})

test('band contributors receive available width and failures preserve later contributions', async ($, on) => {
  const readings = usage()
  world(on, readings, false)
  let remaining = 0
  let disabledCalled = false
  const mods: UltraMod[] = [
    { id: 'receipts', band: () => { throw new Error('contribution failed') } },
    { id: 'compact', band: ctx => {
      remaining = ctx.columns
      expect(ctx.settings.enabled).toBe(true)
      expect(ctx.set.name).toBe('essentials')
      expect(ctx.contextColor).toBe('warning')
      return { node: { type: 'Text', props: {}, children: ['[Compact now]'] }, columns: 13 }
    } },
    { id: 'notify', band: () => ({ node: { type: 'Text', props: {}, children: ['too wide'] }, columns: 200 }) },
    { id: 'tidy', band: () => { disabledCalled = true; return null } },
  ]
  const hud = createHud(createSets(), mods)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const handler = hud.hooks?.['ui.render']?.[0]
    if (!handler) throw new Error('HUD render handler is missing')
    const bottom: RenderElement = { type: 'Text', props: {}, children: ['contributor downstream'] }
    const next = Object.assign(() => Promise.resolve(bottom), { called: false, event: 'ui.render' as const, signal: AbortSignal.abort() }) as ModNext<'ui.render'>
    const api = {
      state: { get: async (ref: { key: string }) => ({ value: ref.key === 'set' ? resolveSet(undefined) : undefined, version: 0 }) },
      session: { usage: async () => readings, model: async () => 'claude-sonnet-4-6' },
      clock: { now: async () => 0 },
      ui: { resolve: (input: RenderInput) => $.ui.resolve(input) },
    } as unknown as EngineInterface
    return handler.run(api, e, next)
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(remaining).toBeGreaterThanOrEqual(13)
    expect(remaining).toBeLessThan(160)
    expect(await ui.find({ type: 'Text', text: '[Compact now]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'too wide' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'contributor downstream' })).toBeDefined()
    expect(disabledCalled).toBe(false)
    await ui.unmount()
  }
})

test('HUD fits whole segments into bodyColumns at every width', async ($, on) => {
  const { readings } = world(on)
  readings.context.percent = 85
  readings.cost = { usd: 12.34 }
  await $.turn.start({ turnId: 'main', text: '' })
  const full = new Set([
    ' · ', 'ctx █████████░ 85% 124k/200k', '5h 41% resets 2h13m', '5h 41%',
    '7d 18% resets 3d4h', '7d 18%', '0s', '$12.34', 'Sonnet 4.6',
    'ultra:essentials', 'ultra:essentials*',
  ])
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [60, 80, 120, 160]) {
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', viewport: { columns: 240, rows: 30 }, props: { ...BAND, bodyColumns, isWorking: true } })
      const tree = await ui.drawn()
      if (tree.type !== 'Box') throw new Error('HUD must preserve the downstream tree in a column Box')
      const row = tree.children?.[0]
      if (typeof row === 'string' || !row || row.type !== 'Box') throw new Error('HUD must draw its own row first')
      let cells = 0
      for (const child of row.children ?? []) {
        if (typeof child === 'string') throw new Error('HUD must draw elements, not bare text')
        if (child.type === 'Text') {
          const text = String(child.children)
          expect(child.props?.wrap).toBeUndefined()
          expect(full.has(text)).toBe(true)
          cells += text.length
        } else if (child.type === 'Button') {
          cells += '[ Compact now ]'.length
        } else {
          throw new Error(`unexpected row element ${String(child.type)}`)
        }
      }
      expect(cells).toBeLessThanOrEqual(bodyColumns)
      await ui.unmount()
    }
  }
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
})

test('HUD shortens both limits before it drops a segment', async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'main', text: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [60, 80, 100, 120, 160]) {
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', viewport: { columns: 240, rows: 30 }, props: { ...BAND, bodyColumns, isWorking: true } })
      const long = Boolean(await ui.find({ type: 'Text', text: '5h 41% resets 2h13m' }))
      const longSeven = Boolean(await ui.find({ type: 'Text', text: '7d 18% resets 3d4h' }))
      const model = await ui.find({ type: 'Text', text: 'Sonnet 4.6' })
      // A dropped segment means the short form was worth it: both limits go short together.
      expect(long).toBe(longSeven)
      if (!model) expect(long).toBe(false)
      if (long) expect(model).toBeDefined()
      await ui.unmount()
    }
  }
  await $.turn.complete({ turnId: 'main', answer: '', durationMs: 0, isAborted: false, reason: 'answer' })
})

test('HUD hides the context before the first response and any zero cost', async ($, on) => {
  const readings = usage()
  readings.context = { window: 200_000 }
  readings.cost = { usd: 0 }
  readings.rateLimits = []
  world(on, readings)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /ctx / })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$0\.00/ })).toBeUndefined()
    await ui.unmount()
  }
  readings.context = { tokens: 5_000, window: 200_000, percent: 3 }
  readings.cost = { usd: 0.25 }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: 'ctx ░░░░░░░░░░ 3% 5k/200k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$0.25' })).toBeDefined()
    await ui.unmount()
  }
})
