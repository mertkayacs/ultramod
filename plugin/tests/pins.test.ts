import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDispatcher } from '../hooks/core/dispatcher'
import type { ModEvent, ModNext } from '../hooks/core/mod'
import { pins, resetPinsCache } from '../hooks/mods/pins'

const enabled = { enabled: async () => true }

interface World {
  $: UltraApi
  files: Map<string, string>
  stats: Map<string, { mtimeMs: number }>
  statCalls: string[]
  readCalls: string[]
  writes: { path: string; text: string }[]
  env: Record<string, string | undefined>
}

function world(init: { env?: Record<string, string | undefined> } = {}): World {
  resetPinsCache()
  const w: World = {
    files: new Map(),
    stats: new Map(),
    statCalls: [],
    readCalls: [],
    writes: [],
    env: { HOME: '/home/dev', ...init.env },
    $: null as unknown as UltraApi,
  }
  const state = new Map<string, unknown>([['set', null]])
  w.$ = {
    state: {
      get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: 1 }),
      set: async (ref: { key: string }, value: unknown) => { state.set(ref.key, value); return { isSet: true, version: 2 } },
    },
    ui: {
      ask: async () => 'Allow',
      toast: () => undefined,
      status: () => undefined,
      log: () => undefined,
      invalidate: () => undefined,
      open: async () => undefined,
      close: async () => undefined,
      resolve: () => { throw new Error('not needed') },
    },
    session: { root: async () => '/work/project', cwd: async () => '/work/project', id: async () => 's1', usage: async () => ({ startedAt: 0, context: { tokens: 0, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'claude-haiku-4.5', version: async () => ({ version: '2.1.292', base: '2.1.292', builtAt: '' }), compact: async () => ({}) },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) },
    fs: {
      read: async (path: string) => {
        w.readCalls.push(path)
        if (!w.files.has(path)) throw new Error('missing file')
        return w.files.get(path) ?? ''
      },
      write: async (path: string, text: string) => { w.writes.push({ path, text }) },
      stat: async (path: string) => {
        w.statCalls.push(path)
        const stat = w.stats.get(path)
        if (stat === undefined) throw new Error('missing file')
        return { kind: 'file', size: stat.mtimeMs, mtimeMs: stat.mtimeMs, isLink: false }
      },
      exists: async (path: string) => w.files.has(path),
    },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    clock: { now: async () => 0, every: () => ({ cancel: () => undefined }), after: () => ({ cancel: () => undefined }) },
    audio: { play: async () => undefined },
    command: { register: async () => ({ value: { command: 'ultramod' } }) },
    env: { get: async (name: string) => w.env[name] },
  } as unknown as UltraApi
  return w
}

const ENGINE_SECTIONS: EventResult<'prompt.compose'>['sections'] = [{ id: 'engine:intro', text: 'intro', scope: 'shared' }]

function bottom<E extends ModEvent>(event: E, answer: EventResult<E>, calls: { count: number }): ModNext<E> {
  const next = Object.assign(async (_e: Frozen<Args<E>> | Args<E>) => {
    calls.count += 1
    return answer
  }, { event, signal: undefined })
  Object.defineProperty(next, 'called', { get: () => calls.count > 0 })
  return next as unknown as ModNext<E>
}

function compose(w: World): Promise<EventResult<'prompt.compose'>> {
  const dispatcher = createDispatcher([pins], enabled)
  const calls = { count: 0 }
  return dispatcher.dispatch(w.$, 'prompt.compose', {
    model: 'claude-sonnet-5', promptModel: 'claude-sonnet-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  } as Args<'prompt.compose'>, bottom('prompt.compose', { sections: ENGINE_SECTIONS }, calls))
}

const PROJECT = '/work/project/.claude/pins.md'
const USER = '/home/dev/.claude/pins.md'

describe('pins appends a session section', () => {
  test('bullet lines from the project file are pinned', async () => {
    const w = world()
    w.files.set(PROJECT, '# Rules\n- always run tests\n- keep diffs small\n')
    w.stats.set(PROJECT, { mtimeMs: 1 })
    const answer = await compose(w)
    expect(answer.sections).toEqual([...ENGINE_SECTIONS, {
      id: 'ultramod:pins',
      text: 'Pinned rules from the user. Follow them in every reply:\n- always run tests\n- keep diffs small',
      scope: 'session',
    }])
  })

  test('project and user files merge, project first', async () => {
    const w = world()
    w.files.set(PROJECT, '- project rule\n')
    w.files.set(USER, '- user rule\n')
    w.stats.set(PROJECT, { mtimeMs: 1 })
    w.stats.set(USER, { mtimeMs: 1 })
    const answer = await compose(w)
    const section = answer.sections.at(-1)
    expect(section?.text).toContain('- project rule\n- user rule')
  })

  test('headings, comments and blank lines are skipped, plain lines kept', async () => {
    const w = world()
    w.files.set(PROJECT, '## Heading\n\n<!-- a comment -->\n* star bullet\n+ plus bullet\nplain rule line\n')
    w.stats.set(PROJECT, { mtimeMs: 1 })
    const answer = await compose(w)
    const section = answer.sections.at(-1)
    expect(section?.text).toBe('Pinned rules from the user. Follow them in every reply:\n- star bullet\n- plus bullet\n- plain rule line')
  })

  test('no files means no section', async () => {
    const w = world()
    expect(await compose(w)).toEqual({ sections: ENGINE_SECTIONS })
  })

  test('the section is capped at 30 lines with a note', async () => {
    const w = world()
    w.files.set(PROJECT, Array.from({ length: 40 }, (_, i) => `- rule ${i}`).join('\n'))
    w.stats.set(PROJECT, { mtimeMs: 1 })
    const answer = await compose(w)
    const section = answer.sections.at(-1)
    expect(section?.text).toContain('- rule 29')
    expect(section?.text).not.toContain('- rule 30\n')
    expect(section?.text).toContain('edit pins.md for the rest')
  })

  test('the section text is capped at 3000 characters', async () => {
    const w = world()
    w.files.set(PROJECT, Array.from({ length: 30 }, () => `- ${'x'.repeat(200)}`).join('\n'))
    w.stats.set(PROJECT, { mtimeMs: 1 })
    const answer = await compose(w)
    const section = answer.sections.at(-1)
    expect((section?.text ?? '').length).toBeLessThanOrEqual(3000)
    expect(section?.text).toContain('pinned rules truncated')
  })

  test('a failed read adds no section', async () => {
    const w = world()
    w.stats.set(PROJECT, { mtimeMs: 1 })
    w.files.delete(PROJECT)
    expect(await compose(w)).toEqual({ sections: ENGINE_SECTIONS })
  })
})

describe('pins caches by mtime', () => {
  test('an unchanged mtime does not re-read', async () => {
    const w = world()
    w.files.set(PROJECT, '- rule\n')
    w.stats.set(PROJECT, { mtimeMs: 7 })
    await compose(w)
    await compose(w)
    expect(w.statCalls).toEqual([PROJECT, USER, PROJECT, USER])
    expect(w.readCalls).toEqual([PROJECT])
  })

  test('a changed mtime re-reads', async () => {
    const w = world()
    w.files.set(PROJECT, '- rule one\n')
    w.stats.set(PROJECT, { mtimeMs: 7 })
    await compose(w)
    w.files.set(PROJECT, '- rule one\n- rule two\n')
    w.stats.set(PROJECT, { mtimeMs: 8 })
    const answer = await compose(w)
    expect(w.readCalls).toEqual([PROJECT, PROJECT])
    expect(answer.sections.at(-1)?.text).toContain('- rule two')
  })
})

describe('pins subcommands', () => {
  test('pin appends a bullet to the project file', async () => {
    const w = world()
    w.files.set(PROJECT, '- old rule\n')
    const answer = await pins.commands?.pin?.(w.$, 'new rule')
    expect(answer).toEqual({ text: 'Pinned: new rule' })
    expect(w.writes).toEqual([{ path: PROJECT, text: '- old rule\n- new rule\n' }])
  })

  test('pin creates the file when absent', async () => {
    const w = world()
    await pins.commands?.pin?.(w.$, 'first rule')
    expect(w.writes).toEqual([{ path: PROJECT, text: '- first rule\n' }])
  })

  test('pin without text explains the usage', async () => {
    expect(await pins.commands?.pin?.(world().$, '')).toEqual({ text: 'Usage: /ultra pin <text>' })
  })

  test('pins lists rules with their source', async () => {
    const w = world()
    w.files.set(PROJECT, '- project rule\n')
    w.files.set(USER, '- user rule\n')
    w.stats.set(PROJECT, { mtimeMs: 1 })
    w.stats.set(USER, { mtimeMs: 1 })
    const answer = await pins.commands?.pins?.(w.$, '')
    expect(answer?.text).toContain(`project (${PROJECT}):\n- project rule`)
    expect(answer?.text).toContain(`user (${USER}):\n- user rule`)
  })

  test('pins with no files says so', async () => {
    const answer = await pins.commands?.pins?.(world().$, '')
    expect(answer).toEqual({ text: 'No pinned rules. Add one with /ultra pin <text>.' })
  })

  test('without a home the project file is the only pin file', async () => {
    const w = world({ env: { HOME: undefined, USERPROFILE: undefined } })
    w.files.set(PROJECT, '- project rule\n')
    w.stats.set(PROJECT, { mtimeMs: 1 })
    const answer = await compose(w)
    expect(answer.sections.at(-1)?.text).toBe('Pinned rules from the user. Follow them in every reply:\n- project rule')
    expect(w.readCalls).toEqual([PROJECT])
  })

  test('the same path for project and user pins is used once', async () => {
    const w = world({ env: { HOME: '/work/project' } })
    w.files.set(PROJECT, '- shared rule\n')
    w.stats.set(PROJECT, { mtimeMs: 1 })
    const answer = await compose(w)
    expect(answer.sections.at(-1)?.text).toBe('Pinned rules from the user. Follow them in every reply:\n- shared rule')
    expect(w.statCalls).toEqual([PROJECT])
  })

  test('pin writes into .claude/ and never stats the directory first', async () => {
    const w = world()
    await pins.commands?.pin?.(w.$, 'first rule')
    expect(w.statCalls).toEqual([])
    expect(w.writes.map(entry => entry.path)).toEqual([PROJECT])
  })

  test('USERPROFILE backs the user file when HOME is unset', async () => {
    const w = world({ env: { HOME: undefined, USERPROFILE: 'C:\\Users\\dev' } })
    const userPath = 'C:\\Users\\dev/.claude/pins.md'
    w.files.set(userPath, '- windows rule\n')
    w.stats.set(userPath, { mtimeMs: 1 })
    const answer = await compose(w)
    expect(answer.sections.at(-1)?.text).toContain('- windows rule')
  })
})
