import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, RenderNode, RenderPropsOf, SessionUsage } from 'claude-code'
import { modIds } from '../hooks/core/sets'
import type { ModId } from '../hooks/core/mod'

const paneProps = (bodyColumns: number): RenderPropsOf['Pane'] => ({
  title: 'Ultra Mod', isFocused: true, bodyColumns, placement: 'inline',
  scroll: { offset: 0, bodyRows: 60 }, view: {},
})

const GUARD_LINE = 'Asks before risky commands run.'
const LOOPS_LINE = 'Stops retry loops with a suggestion.'
// The wording the row must drop, mode column and description column both.
const GONE_LINES = ['Confirm risky commands before they run.', 'asks first', 'warns, then offers', 'only with a pins file']
// One sentence per row in the essentials set: what the mod does now.
const ESSENTIALS_LINES: Record<ModId, string> = {
  guard: GUARD_LINE,
  secrets: 'Blocks secret files and redacts leaks.',
  tests: 'Asks before an edit weakens tests.',
  tidy: 'New documentation files are allowed.',
  loops: LOOPS_LINE,
  receipts: 'A receipt after each turn that used tools.',
  compact: 'Warns at 70% and offers to compact.',
  notify: 'Notices when a turn finishes or waits.',
  pins: 'Adds .claude/pins.md rules to the prompt.',
  hud: 'Shows context, limits, turns and cost.',
}
// The one dim line under the set picker, one per set, each whole at 60 columns.
const SET_NOTES: Record<string, string> = {
  essentials: 'Everyday work. Asks before risky commands, shows receipts.',
  strict: 'Production code. A receipt every turn, env dumps blocked.',
  flow: 'Fewest interruptions. Compact HUD, receipts on issues.',
  marathon: 'Long unattended runs. Refuses risky commands, auto-compacts.',
  quiet: 'Safety only, nothing drawn. Guard, secrets and pins only.',
}
// The rows a set draws beyond the essentials lines: every mode the presets use.
const SET_LINES: Record<string, Partial<Record<ModId, string>>> = {
  strict: {
    secrets: 'Blocks secret files and env dumps.',
    receipts: 'A receipt after every turn.',
    tidy: 'Asks before a new doc file is written.',
  },
  flow: {
    hud: 'One compact line of context and limits.',
    receipts: 'A receipt when a turn had a problem.',
    tests: 'Edits to tests go unchecked.',
    compact: 'Warns when context passes 70%.',
    loops: 'Warns on repeat failures.',
  },
  marathon: {
    guard: 'Refuses risky commands.',
    tests: 'Refuses edits that weaken tests.',
    tidy: 'Refuses new docs outside the allowlist.',
    compact: 'Compacts on its own at 88%.',
  },
  quiet: {
    hud: 'Nothing is drawn above the prompt.',
    receipts: 'No receipts are shown.',
    tests: 'Edits to tests go unchecked.',
    notify: 'No notices are sent.',
    compact: 'Context usage is not watched.',
    loops: 'Repeat failures pass silently.',
  },
}
// Oldest first, as the store hands them to git.
const SNAPSHOT_COMMANDS = ['git checkout main', 'rm -rf node_modules', 'git stash', 'npm ci', 'git clean -f', 'rm -rf src', 'git reset --hard']

function world(on: On) {
  const clock = mock.clock(on)
  mock.env(on, {})
  mock.store(on, { 'project:/work': { overrides: {} } })
  const usage: SessionUsage = {
    startedAt: 0,
    context: { tokens: 124_000, window: 200_000, percent: 62 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41, resetsAt: '1970-01-01T02:13:00.000Z' },
      { kind: 'seven_day', percentUsed: 18, resetsAt: '1970-01-04T04:00:00.000Z' },
    ],
    cost: { usd: 1.84 },
  }
  // Newest first, one snapshot a minute from 60s on, as git would list them.
  const snapshots = SNAPSHOT_COMMANDS
    .map((command, index) => `sha${index + 1}\t${(index + 1) * 60}\tultramod snapshot: ${command}`)
    .reverse()
    .join('\n') + '\n'
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: usage }))
  on('session.model', () => ({ value: 'claude-sonnet-4-6' }))
  on('command.register', () => ({ value: { command: 'ultra' } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', ($, e) => {
    const argv = e.argv as string[]
    const refs = argv[0] === 'git' && argv[1] === 'for-each-ref' && argv.some(arg => String(arg).includes('%(refname)'))
    return { value: { exitCode: 0, stdout: refs ? '' : snapshots, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, usage }
}

const walk = (node: RenderNode, into: RenderElement[]) => {
  if (typeof node === 'string') return
  into.push(node)
  if (node.type !== 'Box' && node.type !== 'Text') return
  for (const child of node.children ?? []) walk(child, into)
}

const label = (node: RenderElement): string => {
  if (node.type !== 'Box' && node.type !== 'Text') return ''
  return (node.children ?? []).map(child => typeof child === 'string' ? child : label(child)).join('')
}

// How wide one element draws: a Box's width when it declares one, else its
// children with the Box's own gaps, a Button its chrome, a Text its letters.
const cells = (node: RenderElement): number => {
  if (node.type === 'Button') {
    const text = String(node.props.label).length
    return node.props.plain ? text + (node.props.hotkey ? String(node.props.hotkey).length + 2 : 0) : text + 4
  }
  if (node.type !== 'Box' && node.type !== 'Text') return 0
  const props = node.props
  if (typeof props?.width === 'number') return props.width
  const kids = node.children ?? []
  const gap = typeof props?.gap === 'number' ? props.gap : 0
  const sum = kids.reduce((used, child) => used + (typeof child === 'string' ? child.length : cells(child)), 0)
  return sum + Math.max(0, kids.length - 1) * gap
}

const box = (nodes: readonly RenderElement[], key: string) => {
  const found = nodes.find(node => node.type === 'Box' && node.props?.key === key)
  if (!found || found.type !== 'Box') throw new Error(`the pane must draw a Box keyed ${key}`)
  return found
}

// The pane's own column: the header first, the footer hint last.
const column = (nodes: readonly RenderElement[]) => {
  const root = nodes[0]
  if (!root || root.type !== 'Box') throw new Error('the pane must draw a root Box')
  return (root.children ?? []).filter(child => typeof child !== 'string')
}

// The set note: the element right after the picker in the pane's own column.
const setNote = (nodes: readonly RenderElement[]) => {
  const children = column(nodes)
  const index = children.findIndex(child => typeof child !== 'string' && child.type === 'Box' && child.props?.key === 'set-picker')
  const note = children[index + 1]
  if (index < 0 || !note || typeof note === 'string' || note.type !== 'Text') {
    throw new Error('the pane must describe the set right under the picker')
  }
  return note
}

// The last line of the column: the hint about the keys the pane answers.
const footer = (nodes: readonly RenderElement[]) => {
  const last = column(nodes).at(-1)
  if (!last || typeof last === 'string' || last.type !== 'Text') throw new Error('the pane must end with a footer hint')
  return last
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const bodyColumns of [60, 80, 120, 160]) {
    test(`${surface} pane at ${bodyColumns} columns fits every row and keeps whole segments`, async ($, on) => {
      const { clock } = world(on)
      // Six receipts a minute apart, so the ages differ and the oldest falls off.
      for (let index = 1; index <= 6; index++) {
        await $.turn.start({ turnId: `t${index}`, text: '' })
        await $.turn.complete({ turnId: `t${index}`, answer: '', durationMs: index * 1_000, isAborted: false, reason: 'answer' })
        await clock.advance(60_000)
      }
      await clock.set(600_000)
      const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'Pane', requestId: 'ultramod', props: paneProps(bodyColumns) })
      const nodes: RenderElement[] = []
      walk(await ui.drawn(), nodes)
      const texts = nodes.filter(node => node.type === 'Text')
      const buttons = nodes.filter(node => node.type === 'Button')
      const words = new Set(texts.map(label))

      // Nothing may be cut mid-word, so no text truncates.
      for (const node of texts) expect(node.props?.wrap).toBeUndefined()

      // One header line; no second line repeating the set.
      expect([...words].filter(text => text.startsWith('Ultra Mod'))).toEqual(['Ultra Mod · essentials'])

      // The footer names the keys the pane really answers: Tab walks the rows,
      // Enter presses the focused button, 1-5 press the picker, Escape closes.
      const hint = footer(nodes)
      expect(label(hint)).toBe('Tab moves · Enter toggles · 1-5 switch set · Esc closes')
      expect(hint.props?.dimColor).toBe(true)
      expect(cells(hint)).toBeLessThanOrEqual(bodyColumns)

      // One dim line under the picker naming the active set, whole at this width.
      const note = setNote(nodes)
      expect(label(note)).toBe(SET_NOTES.essentials)
      expect(note.props?.dimColor).toBe(true)
      expect(cells(note)).toBeLessThanOrEqual(bodyColumns)

      // Five plain digit buttons, the active set marked by full strength.
      expect(cells(box(nodes, 'set-picker'))).toBeLessThanOrEqual(bodyColumns)
      const picks = buttons.filter(button => button.props.key.startsWith('set-'))
      expect(picks.map(button => [button.props.key, button.props.hotkey, button.props.plain])).toEqual([
        ['set-essentials', '1', true], ['set-strict', '2', true], ['set-flow', '3', true],
        ['set-marathon', '4', true], ['set-quiet', '5', true],
      ])
      expect(picks[0]?.props.dimColor).toBeFalsy()
      expect(picks.slice(1).map(button => button.props.dimColor)).toEqual([true, true, true, true])

      // The grid: a ten-cell name, an on or off, then one dim sentence that
      // says what the mod does in this set. A row too narrow for the whole
      // sentence drops it, so every sentence here fits the width.
      expect(buttons.filter(button => button.props.key.startsWith('toggle-')).map(button => button.props.key).sort())
        .toEqual(modIds.map(id => `toggle-${id}`).sort())
      for (const id of modIds) {
        const row = box(nodes, `mod-${id}`)
        expect(cells(row)).toBeLessThanOrEqual(bodyColumns)
        const name = row.children?.find(child => typeof child !== 'string' && child.type === 'Box' && child.props?.key === `name-${id}`)
        if (!name || typeof name === 'string' || name.type !== 'Box') throw new Error(`${id} must have a name cell`)
        expect(name.props?.width).toBe(10)
        expect(label(name)).toBe(id)
        const toggle = buttons.find(button => button.props.key === `toggle-${id}`)
        expect(['on', 'off']).toContain(toggle?.props.label)
        const line = row.children?.find(child => typeof child !== 'string' && child.type === 'Text')
        if (!line || typeof line === 'string' || line.type !== 'Text') throw new Error(`${id} must show one sentence`)
        expect(line.props?.dimColor).toBe(true)
        expect(label(line)).toBe(ESSENTIALS_LINES[id])
      }
      // The mode column and the description column it replaced are gone.
      for (const gone of GONE_LINES) expect(words.has(gone)).toBe(false)

      // The hud row travels with the pane and obeys the same width.
      expect(cells(box(nodes, 'hud-row'))).toBeLessThanOrEqual(bodyColumns)
      expect([...words].some(text => text.startsWith('ctx '))).toBe(true)

      // Sections, when present: five each, newest first, with ages.
      expect(words.has('Last receipts')).toBe(true)
      expect(texts.map(label).filter(text => text.includes(' ago  receipt'))).toEqual([
        '5m ago  receipt · 6s', '6m ago  receipt · 5s', '7m ago  receipt · 4s',
        '8m ago  receipt · 3s', '9m ago  receipt · 2s',
      ])
      expect(words.has('Snapshots')).toBe(true)
      expect(texts.map(label).filter(text => SNAPSHOT_COMMANDS.some(command => text.endsWith(command)))).toEqual([
        '3m ago  git reset --hard', '4m ago  rm -rf src', '5m ago  git clean -f',
        '6m ago  npm ci', '7m ago  git stash',
      ])
      await ui.unmount()
    })
  }
}

// Every set gets its own line under the picker and its own sentences in the
// rows, whole even at the narrow width.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface} pane describes every set under the picker`, async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'Pane', requestId: 'ultramod', props: paneProps(60) })
    for (const [name, note] of Object.entries(SET_NOTES)) {
      await ui.press({ key: `set-${name}` })
      const nodes: RenderElement[] = []
      walk(await ui.drawn(), nodes)
      const drawn = setNote(nodes)
      expect(label(drawn)).toBe(note)
      expect(drawn.props?.dimColor).toBe(true)
      expect(cells(drawn)).toBeLessThanOrEqual(60)
      const expected = { ...ESSENTIALS_LINES, ...SET_LINES[name] }
      for (const id of modIds) {
        const row = box(nodes, `mod-${id}`)
        expect(cells(row)).toBeLessThanOrEqual(60)
        const line = row.children?.find(child => typeof child !== 'string' && child.type === 'Text')
        expect(!line || typeof line === 'string' ? null : label(line)).toBe(expected[id])
      }
    }
    await ui.unmount()
  })
}

// The five set buttons need more cells than a narrow pane has, and a row that
// never wraps clips the last choices, so the picker wraps onto a second line.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface} pane lets the set picker wrap below its natural width`, async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'Pane', requestId: 'ultramod', props: paneProps(40) })
    const nodes: RenderElement[] = []
    walk(await ui.drawn(), nodes)
    const picker = box(nodes, 'set-picker')
    expect(cells(picker)).toBeGreaterThan(40)
    expect(picker.props?.flexWrap).toBe('wrap')
    const labels = (picker.children ?? []).filter(child => typeof child !== 'string' && child.type === 'Button').map(child => typeof child === 'string' || child.type !== 'Button' ? '' : child.props.label)
    expect(labels).toEqual(['essentials', 'strict', 'flow', 'marathon', 'quiet'])
    await ui.unmount()
  })
}
