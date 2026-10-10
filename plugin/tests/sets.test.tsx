import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, ToolCallArgs } from 'claude-code'
import type { UltraSet } from '../types/index'
import { createSets, projectKey, resolveSet, setLabel, sets } from '../hooks/core/sets'
import { runCommand } from '../hooks/core/commands'
import type { UltraMod } from '../hooks/core/mod'
import type { UltraApi } from '../hooks/core/api'

const command = (args: string) => ({ command: 'ultra', args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 100 } })
const PANE: RenderPropsOf['Pane'] = { title: 'Ultra Mod', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} }
function world(on: On, entries: Record<string, unknown> = {}, env: Record<string, string> = {}, root: () => string = () => '/work') {
  mock.clock(on)
  mock.env(on, env)
  const saved = new Map(Object.entries(entries))
  const states: (UltraSet | null)[] = []
  const registrations: unknown[] = []
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => { saved.set(e.key, e.value); return { value: undefined } })
  on('session.root', () => ({ value: root() }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The pane draws the hud row, so it reads usage and the model.
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.model', () => ({ value: 'claude-sonnet-4-6' }))
  on('classic.SessionStart', () => ({}))
  on('command.register', ($, e) => { registrations.push(e); return { value: { command: 'ultra' } } })
  on('state.set', { plugin: 'ultramod', key: 'set' }, ($, e, next) => { states.push(e.value); return next(e) })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['downstream'] }))
  return { saved, states, registrations }
}

test('set resolution prefers valid project settings, then userConfig, then essentials', () => {
  expect(resolveSet(undefined).name).toBe('essentials')
  expect(resolveSet(undefined, { set: 'flow' }).name).toBe('flow')
  expect(resolveSet({ set: 'quiet' }, { set: 'strict' }).name).toBe('quiet')
  expect(resolveSet({ set: 'unknown' }, { set: 'strict' }).name).toBe('strict')
  expect(resolveSet({ set: 'unknown' }, { set: 'unknown' }).name).toBe('essentials')
  const customised = resolveSet({ set: 'flow', overrides: { guard: false, tests: true, hud: 'off', unknown: true } })
  expect(customised.mods.guard.enabled).toBe(false)
  expect(customised.mods.tests.enabled).toBe(true)
  expect(customised.overrides).toEqual({ guard: false, tests: true })
  expect(setLabel(customised)).toBe('flow*')
})

test('enabling a default-off mod restores its usable mode without mutating presets', () => {
  const set = resolveSet({ set: 'quiet', overrides: { hud: true, tests: true, tidy: true } })
  expect(set.mods.hud).toMatchObject({ enabled: true, mode: 'full' })
  expect(set.mods.tests).toMatchObject({ enabled: true, mode: 'ask' })
  expect(set.mods.tidy).toMatchObject({ enabled: true, mode: 'ask' })
  expect(sets.quiet.hud).toEqual({ enabled: false, mode: 'off' })
})

test('all five sets carry the specified modes, safety settings and context thresholds', () => {
  expect(sets.essentials.notify).toMatchObject({ mode: 'on', chime: true })
  expect(sets.essentials.compact).toMatchObject({ mode: 'warn+offer', warnAt: 70, offerAt: 85 })
  expect(sets.strict.guard).toMatchObject({ mode: 'ask', strict: true })
  expect(sets.strict.secrets.mode).toBe('strict')
  expect(sets.strict.tidy.mode).toBe('ask')
  expect(sets.flow.hud.mode).toBe('compact')
  expect(sets.flow.tests.enabled).toBe(false)
  expect(sets.flow.loops.mode).toBe('warn')
  expect(sets.flow.compact).toEqual({ enabled: true, mode: 'warn', warnAt: 70 })
  expect(sets.marathon.guard.mode).toBe('deny')
  expect(sets.marathon.tests.mode).toBe('deny')
  expect(sets.marathon.tidy.mode).toBe('deny')
  expect(sets.marathon.compact.autoAt).toBe(88)
  expect(Object.entries(sets.quiet).filter(([, settings]) => settings.enabled).map(([id]) => id)).toEqual(['guard', 'secrets', 'pins'])
})

test('session start hydrates project settings and registers an immediate command', { options: { set: 'strict' } }, async ($, on) => {
  const { states, registrations } = world(on, { [projectKey('/work')]: { set: 'flow', overrides: { receipts: false } } })
  await $.session.start({ cwd: '/work/nested', surface: 'terminal', isInteractive: true })
  expect(states.at(-1)?.name).toBe('flow')
  expect(states.at(-1)?.mods.receipts.enabled).toBe(false)
  expect(registrations).toHaveLength(1)
  expect(registrations[0]).toMatchObject({ name: 'ultra', immediate: true, argumentHint: expect.any(String) })
})

test('the first event publishes user settings before mods run without session.start', { options: { set: 'strict', notifyAfterSeconds: 45, sound: false } }, async ($, on) => {
  const { states } = world(on)
  on('tool.call', () => ({ result: 'ok' }))
  // The kit answers any name; this build's declarations hold only its own.
  const probe = { tool: 'probe', input: {} }
  await $.tool.call(probe as unknown as ToolCallArgs)
  expect(states.at(-1)?.mods.guard).toMatchObject({ strict: true, mode: 'ask' })
  expect(states.at(-1)?.mods.notify).toMatchObject({ notifyAfterSeconds: 45, sound: false })
  await $.command.run(command('set flow'))
  expect(states.at(-1)?.mods.notify).toMatchObject({ notifyAfterSeconds: 45, sound: false })
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`classic SessionStart ${source} rehydrates after reactive state reset`, { options: { set: 'flow' } }, async ($, on) => {
    const { states } = world(on, { [projectKey('/work')]: { set: 'marathon', overrides: { hud: false } } })
    await $.classic.SessionStart({ source })
    expect(states.at(-1)?.name).toBe('marathon')
    expect(states.at(-1)?.mods.hud.enabled).toBe(false)
    const ui = await $.ui.mount({ plugin: 'ultramod', surface: 'terminal', component: 'Pane', requestId: 'ultramod', props: PANE })
    expect(await ui.find({ type: 'Text', text: 'Ultra Mod · marathon*' })).toBeDefined()
    await ui.unmount()
  })
}

test('/ultra set switches live, persists by project root, and rejects unknown names', async ($, on) => {
  const { saved, states } = world(on)
  expect(await $.command.run(command('set strict'))).toMatchObject({ text: 'Set: strict.' })
  expect(saved.get(projectKey('/work'))).toEqual({ set: 'strict', overrides: {} })
  expect(states.at(-1)?.mods.guard.strict).toBe(true)
  const before = states.length
  expect((await $.command.run(command('set missing'))).text).toMatch(/Choose a set/)
  expect(states.length).toBe(before)
  expect((await $.command.run(command('sets'))).text).toBe('essentials\nstrict\nflow\nmarathon\nquiet')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface} controls toggle mods, clear overrides on switch and reset without reload`, async ($, on) => {
    const { saved } = world(on)
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'Pane', requestId: 'ultramod', props: PANE })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(15)
    expect(await ui.find({ key: 'set-picker' })).toMatchObject({ type: 'Box' })
    await ui.press({ key: 'toggle-guard' })
    expect(saved.get(projectKey('/work'))).toEqual({ set: 'essentials', overrides: { guard: false } })
    expect(await ui.find({ type: 'Text', text: 'Ultra Mod · essentials*' })).toBeDefined()
    await ui.press({ key: 'toggle-guard' })
    expect(saved.get(projectKey('/work'))).toEqual({ set: 'essentials', overrides: {} })
    await ui.press({ key: 'toggle-hud' })
    expect((await $.command.run(command('reset'))).text).toBe('Overrides reset: essentials.')
    expect(await ui.find({ key: 'toggle-hud' })).toMatchObject({ props: { label: 'on' } })
    await ui.press({ key: 'toggle-tests' })
    await ui.press({ key: 'set-flow' })
    expect(saved.get(projectKey('/work'))).toEqual({ set: 'flow', overrides: {} })
    expect(await ui.find({ key: 'toggle-tests' })).toMatchObject({ props: { label: 'off' } })
    await ui.unmount()
  })
}

test('the set picker is five plain digit buttons on every surface', async ($, on) => {
  const { saved } = world(on)
  for (const surface of ['mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'ultramod', surface, component: 'Pane', requestId: 'ultramod', props: PANE })
    expect(await ui.find({ key: 'set-quiet' })).toMatchObject({ props: { hotkey: '5', plain: true } })
    await ui.press({ key: 'set-quiet' })
    expect(saved.get(projectKey('/work'))).toEqual({ set: 'quiet', overrides: {} })
    await ui.unmount()
  }
})

test('two presses before redraw preserve both toggle actions', async ($, on) => {
  const { saved } = world(on)
  const ui = await $.ui.mount({ plugin: 'ultramod', surface: 'terminal', component: 'Pane', requestId: 'ultramod', props: PANE })
  await Promise.all([ui.press({ key: 'toggle-guard' }), ui.press({ key: 'toggle-guard' })])
  expect(saved.get(projectKey('/work'))).toEqual({ set: 'essentials', overrides: {} })
  await ui.unmount()
})

test('/ultra opens a focused pane that closes on Escape', async ($, on) => {
  world(on)
  const opens: unknown[] = []
  on('ui.open', ($, e) => { opens.push(e); return { value: { isPlaced: true } } })
  expect((await $.command.run(command(''))).text).toBe('Controls opened.')
  expect(opens).toEqual([{ id: 'ultramod', title: 'Ultra Mod', focus: true, closeOnEscape: true }])
})

test('/ultra doctor reports actual version and executable availability without invoking a notifier', async ($, on) => {
  world(on)
  const commands: string[][] = []
  on('session.version', () => ({ value: { version: '2.1.292', base: '2.1.292', builtAt: 'test' } }))
  on('process.run', ($, e) => {
    commands.push([...e.argv])
    return { value: { exitCode: e.argv[0] === 'git' || e.argv[1] === 'notify-send' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const result = await $.command.run(command('doctor'))
  expect(result.text).toMatch(/Claude Code 2\.1\.292/)
  expect(result.text).toMatch(/Notifier: notify-send/)
  expect(result.text).toMatch(/Git: available/)
  expect(commands).toEqual([['git', '--version'], ['uname', '-s'], ['which', 'notify-send']])
})

// Doctor names the notifier the plugin would really use: the same detector as a send.
async function doctorNotifier($: Engine, on: On, env: Record<string, string>, kernel: string, installed: string[]) {
  world(on, {}, env)
  on('session.version', () => ({ value: { version: '2.1.292', base: '2.1.292', builtAt: 'test' } }))
  on('process.run', ($, e) => {
    const out = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'uname') return out(0, `${kernel}\n`)
    if (e.argv[0] === 'which') return out(installed.includes(String(e.argv[1])) ? 0 : 1)
    return out(0)
  })
  const result = await $.command.run(command('doctor'))
  return /^Notifier: (.*)$/m.exec(result.text ?? '')?.[1]
}

test('/ultra doctor names osascript on macOS even when notify-send is installed', async ($, on) => {
  expect(await doctorNotifier($, on, {}, 'Darwin', ['notify-send', 'osascript'])).toBe('osascript')
})

test('/ultra doctor names powershell under WSL', async ($, on) => {
  expect(await doctorNotifier($, on, { WSL_DISTRO_NAME: 'Ubuntu' }, 'Linux', ['notify-send'])).toBe('powershell')
})

test('/ultra doctor names powershell on Windows', async ($, on) => {
  expect(await doctorNotifier($, on, { OS: 'Windows_NT' }, '', [])).toBe('powershell')
})

test('/ultra doctor falls back to toast when nothing is installed', async ($, on) => {
  expect(await doctorNotifier($, on, {}, 'Linux', [])).toBe('toast')
})

test('/ultra doctor prints each mod live state and mode, never the stale placeholder line', async ($, on) => {
  world(on, { [projectKey('/work')]: { set: 'marathon', overrides: { hud: false } } })
  on('session.version', () => ({ value: { version: '2.1.292', base: '2.1.292', builtAt: 'test' } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const result = await $.command.run(command('doctor'))
  expect(result.text).not.toMatch(/placeholders/)
  expect(result.text).toMatch(/^guard: on \(deny\)$/m)
  expect(result.text).toMatch(/^tests: on \(deny\)$/m)
  expect(result.text).toMatch(/^tidy: on \(deny\)$/m)
  expect(result.text).toMatch(/^notify: on \(on\)$/m)
  // An override can switch a mod off while its mode stays what the set picked.
  expect(result.text).toMatch(/^hud: off \(full\)$/m)
  expect(result.text).toMatch(/^receipts: on \(tools\)$/m)
})

test('mod subcommands route in registry order, defer shared commands and respect toggles', async ($, on) => {
  world(on)
  const seen: string[] = []
  const mods: UltraMod[] = [
    { id: 'guard', commands: { allow: () => { seen.push('guard'); return null } } },
    { id: 'secrets', commands: { allow: (_, args) => ({ text: `allowed ${args}` }) } },
    { id: 'tests', commands: { custom: () => ({ text: 'tests enabled' }) } },
  ]
  const engine = createSets({ set: 'flow' })
  engine.enabled = async (_, id) => id !== 'tests'
  on('command.run', { command: 'routing-probe' }, ($, e) => runCommand($ as unknown as UltraApi, e.args, engine, mods, async () => {}))
  const probe = (args: string) => ({ ...command(args), command: 'routing-probe' })
  expect((await $.command.run(probe('allow example.txt'))).text).toBe('allowed example.txt')
  expect(seen).toEqual(['guard'])
  expect((await $.command.run(probe('custom'))).text).toMatch(/Unknown command/)
  expect((await $.command.run(command('help'))).text).toMatch(/set <name>.*doctor.*help/)
  expect((await $.command.run(command('missing'))).text).toMatch(/Unknown command/)
})

// The engine prints a command result as a transcript row that already names the
// plugin ("ultramod: ..."), so our own text must not lead with that brand again.
test('command output carries no second Ultra Mod prefix', async ($, on) => {
  world(on)
  on('session.version', () => ({ value: { version: '2.1.292', base: '2.1.292', builtAt: 'test' } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  for (const args of ['', 'set strict', 'sets', 'reset', 'help', 'doctor', 'undo', 'allow', 'missing']) {
    const text = (await $.command.run(command(args))).text
    expect(text).toBeDefined()
    for (const line of String(text).split('\n')) expect(line.startsWith('Ultra Mod')).toBe(false)
  }
})

test('moving to another project root loads that project before the next check and saves under it', async ($, on) => {
  let root = '/a'
  const { saved, states } = world(on, { [projectKey('/a')]: { set: 'flow' }, [projectKey('/b')]: { set: 'marathon' } }, {}, () => root)
  on('tool.call', () => ({ result: 'ok' }))
  const probe = { tool: 'probe', input: {} } as unknown as ToolCallArgs
  await $.tool.call(probe)
  expect(states.at(-1)?.name).toBe('flow')
  root = '/b'
  await $.tool.call(probe)
  expect(states.at(-1)?.name).toBe('marathon')
  await $.command.run(command('set quiet'))
  expect(saved.get(projectKey('/b'))).toEqual({ set: 'quiet', overrides: {} })
  expect(saved.get(projectKey('/a'))).toEqual({ set: 'flow' })
})
