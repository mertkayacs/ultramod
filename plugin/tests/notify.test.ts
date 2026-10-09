import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDriver } from './drive'
import type { Beneath, DriveEvent } from './drive'
import { resolveSet } from '../hooks/core/sets'
import { needsYou } from '../hooks/core/notifier'
import { notify, resetNotify } from '../hooks/mods/notify'

const enabled = { enabled: async () => true }

interface World {
  $: UltraApi
  argvs: string[][]
  failures: Set<string>
  toasts: string[]
  played: { asset?: string; base64?: string; mime?: string }[]
  now: { ms: number }
  env: Record<string, string | undefined>
  blocked: boolean
  exits: Record<string, number>
  pluginRoot: string
  // When set, clock.after queues its callback like the engine does until the dispatch has resolved.
  deferred: (() => void)[] | null
}

function world(init: { env?: Record<string, string | undefined>; set?: unknown } = {}): World {
  resetNotify()
  const w: World = {
    argvs: [],
    failures: new Set(),
    toasts: [],
    played: [],
    now: { ms: 1_000_000 },
    env: { OS: 'Linux', ...init.env },
    blocked: false,
    exits: {},
    pluginRoot: '/plugins/ultramod',
    deferred: null,
    $: null as unknown as UltraApi,
  }
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
    plugin: { get root() { return w.pluginRoot } },
    process: {
      run: async (argv: readonly string[]) => {
        const name = argv[0] ?? ''
        w.argvs.push([...argv])
        if (w.failures.has(name)) throw new Error(`${name} unavailable`)
        if (name === 'wslpath' && w.exits.wslpath === undefined) {
          // wslpath -w <linux path> prints the Windows form of it.
          return { exitCode: 0, stdout: `\\\\wsl.localhost\\Ubuntu${(argv[2] ?? '').replace(/\//g, '\\')}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        }
        if (name === 'uname') {
          return { exitCode: 0, stdout: `${w.env.UNAME ?? 'Linux'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        }
        if (name === 'which') {
          const target = argv[1] ?? ''
          const found = (target === 'notify-send' || target === 'osascript') && !w.failures.has(target)
          return { exitCode: found ? 0 : 1, stdout: found ? `/usr/bin/${target}` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        }
        if (name === 'notify-send' && w.blocked) return new Promise<never>(() => undefined)
        if (w.exits[name] !== undefined && name !== 'which') return { exitCode: w.exits[name], stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }
        return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
    fs: { read: async () => '', write: async () => undefined, stat: async () => ({ kind: 'file', size: 1, mtimeMs: 1, isLink: false }), exists: async () => false },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    clock: {
      now: async () => w.now.ms,
      every: () => ({ cancel: () => undefined }),
      // The engine would run the callback off the dispatch; run it now so a
      // scheduled notification still lands before the assertions below.
      after: (_ms: number, fn: () => void) => {
        if (w.deferred) w.deferred.push(fn)
        else fn()
        return { cancel: () => undefined }
      },
    },
    audio: { play: async (clip: { asset?: string; base64?: string; mime?: string }) => { w.played.push(clip) } },
    command: { register: async () => ({ value: { command: 'ultramod' } }) },
    env: { get: async (name: string) => w.env[name] },
  } as unknown as UltraApi
  return w
}

function bottom<E extends DriveEvent>(_event: E, answer: EventResult<E>, calls: { count: number }): Beneath<E> {
  return async () => {
    calls.count += 1
    return answer
  }
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

async function completeTurn(w: World, durationMs: number, extra: Partial<Args<'turn.complete'>> = {}): Promise<EventResult<'turn.complete'>> {
  const driver = createDriver([notify], enabled)
  const calls = { count: 0 }
  const result = await driver.dispatch(w.$, 'turn.complete', {
    turnId: 't1', answer: 'done', durationMs, isAborted: false, reason: 'answer', ...extra,
  } as Args<'turn.complete'>, bottom('turn.complete', { text: '' }, calls))
  await settle()
  return result
}

async function notification(w: World, message: string, notificationType = 'permission_prompt'): Promise<EventResult<'classic.Notification'>> {
  const driver = createDriver([notify], enabled)
  const calls = { count: 0 }
  const result = await driver.dispatch(w.$, 'classic.Notification', {
    hook_event_name: 'Notification', message, notification_type: notificationType, session_id: 's1', transcript_path: '', cwd: '/work/project',
  } as Args<'classic.Notification'>, bottom('classic.Notification', {} as EventResult<'classic.Notification'>, calls))
  await settle()
  return result
}

// The body travels as base64 so no character of it is ever PowerShell source.
function psBody(argv: string[] | undefined): string {
  const encoded = argv?.[argv.indexOf('-BodyBase64') + 1] ?? ''
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0)))
}

const NOTIFIERS = ['notify-send', 'osascript', 'powershell.exe']
const INLINE_FLAGS = ['-e', '-c', '-Command', '-EncodedCommand']
const notifierArgv = (w: World) => w.argvs.filter(argv => NOTIFIERS.includes(argv[0] ?? ''))

describe('notify sends platform notifications with exact argv', () => {
  test('linux uses notify-send', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)).toEqual([['notify-send', 'Claude Code', 'project finished in 2m14s']])
  })

  test('macos runs the shipped script with title and body as argv', async () => {
    const w = world({ env: { OS: 'Linux', UNAME: 'Darwin' } })
    ;(w.$ as unknown as { session: { root: () => Promise<string> } }).session.root = async () => '/work/my "proj"'
    await completeTurn(w, 65_000)
    // Argv carries the body as data, so quotes need no escaping.
    expect(notifierArgv(w)).toEqual([['osascript', '/plugins/ultramod/scripts/notify.applescript', 'Claude Code', 'my "proj" finished in 1m05s']])
  })

  test('windows runs the shipped script with the body as base64 data', async () => {
    const w = world({ env: { OS: 'Windows_NT' } })
    w.pluginRoot = 'C:\\Users\\me\\.claude\\plugins\\ultramod'
    await completeTurn(w, 134_000)
    const argv = notifierArgv(w)[0] ?? []
    expect(argv.slice(0, 6)).toEqual(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\Users\\me\\.claude\\plugins\\ultramod\\scripts\\notify.ps1'])
    expect(argv[6]).toBe('-BodyBase64')
    expect(psBody(argv)).toBe('project finished in 2m14s')
    expect(argv).toHaveLength(8)
  })

  test('a folder name with curly quotes stays data for the powershell script', async () => {
    const w = world({ env: { OS: 'Windows_NT' } })
    const folder = 'x\u2019); Start-Process calc; #'
    ;(w.$ as unknown as { session: { root: () => Promise<string> } }).session.root = async () => `/work/${folder}`
    await completeTurn(w, 134_000)
    const argv = notifierArgv(w)[0] ?? []
    expect(argv.join(' ')).not.toContain('Start-Process')
    expect(argv.join(' ')).not.toContain('\u2019')
    expect(psBody(argv)).toBe(`${folder} finished in 2m14s`)
  })

  test('no notifier gets an inline program', async () => {
    for (const env of [{ OS: 'Linux', UNAME: 'Darwin' }, { OS: 'Windows_NT' }, { OS: 'Linux', WSL_DISTRO_NAME: 'Ubuntu' }]) {
      const w = world({ env })
      await completeTurn(w, 134_000)
      for (const argv of notifierArgv(w)) expect(argv.filter(arg => INLINE_FLAGS.includes(arg))).toEqual([])
    }
  })

  test('the platform comes from uname, not from the OS variable', async () => {
    const w = world({ env: { OS: 'Linux', UNAME: 'Darwin' } })
    await completeTurn(w, 65_000)
    expect(notifierArgv(w)[0]?.[0]).toBe('osascript')
  })

  test('wsl converts the script path with wslpath before powershell reads it', async () => {
    const w = world({ env: { OS: 'Linux', WSL_DISTRO_NAME: 'Ubuntu' } })
    await completeTurn(w, 134_000)
    expect(w.argvs.filter(argv => argv[0] === 'wslpath')).toEqual([['wslpath', '-w', '/plugins/ultramod/scripts/notify.ps1']])
    const argv = notifierArgv(w)[0] ?? []
    expect(argv.slice(0, 5)).toEqual(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
    expect(argv[5]).toBe('\\\\wsl.localhost\\Ubuntu\\plugins\\ultramod\\scripts\\notify.ps1')
    expect(psBody(argv)).toBe('project finished in 2m14s')
  })

  test('wsl falls back to a toast when the path cannot be converted', async () => {
    const w = world({ env: { OS: 'Linux', WSL_DISTRO_NAME: 'Ubuntu' } })
    w.exits.wslpath = 1
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)).toEqual([])
    expect(w.toasts).toEqual(['project finished in 2m14s'])
  })

  test('native windows does not call wslpath', async () => {
    const w = world({ env: { OS: 'Windows_NT' } })
    await completeTurn(w, 134_000)
    expect(w.argvs.filter(argv => argv[0] === 'wslpath')).toEqual([])
  })

  test('a windows root still names the folder', async () => {
    const w = world({ env: { OS: 'Windows_NT' } })
    ;(w.$ as unknown as { session: { root: () => Promise<string> } }).session.root = async () => 'C:\\work\\project'
    await completeTurn(w, 134_000)
    expect(psBody(notifierArgv(w)[0])).toBe('project finished in 2m14s')
  })

  test('classic.Notification says the project needs you', async () => {
    const w = world()
    await notification(w, 'Claude needs permission to use Bash')
    expect(notifierArgv(w)).toEqual([['notify-send', 'Claude Code', 'project needs you: Claude needs permission to use Bash']])
  })
})

describe('notify thresholds and filters', () => {
  test('short turns stay silent', async () => {
    const w = world()
    await completeTurn(w, 29_999)
    expect(notifierArgv(w)).toEqual([])
  })

  test('aborted turns stay silent', async () => {
    const w = world()
    await completeTurn(w, 134_000, { isAborted: true, reason: 'aborted' })
    expect(notifierArgv(w)).toEqual([])
  })

  test('subagent turns stay silent', async () => {
    const w = world()
    await completeTurn(w, 134_000, { agentId: 'agent-1' })
    expect(notifierArgv(w)).toEqual([])
  })

  test('notifyAfterSeconds from settings is honored', async () => {
    const w = world({ set: resolveSet({ set: 'essentials' }, { notifyAfterSeconds: 5 }) })
    await completeTurn(w, 5_000)
    expect(notifierArgv(w)).toHaveLength(1)
  })
})

describe('notify fallbacks and rate limiting', () => {
  test('a missing notifier falls back to a toast', async () => {
    const w = world()
    w.failures.add('notify-send')
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)).toEqual([])
    expect(w.toasts).toEqual(['project finished in 2m14s'])
  })

  test('a failing notifier falls back to a toast and never throws', async () => {
    const w = world()
    w.failures.add('notify-send')
    w.failures.add('which')
    await expect(completeTurn(w, 134_000)).resolves.toMatchObject({ text: '' })
    expect(w.toasts).toEqual(['project finished in 2m14s'])
  })

  test('at most one notification per ten seconds', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    await notification(w, 'needs you')
    expect(notifierArgv(w)).toHaveLength(1)
    w.now.ms += 10_000
    await notification(w, 'needs you again')
    expect(notifierArgv(w)).toHaveLength(2)
  })

  test('the turn returns before the notifier runs', async () => {
    const w = world()
    w.blocked = true
    const driver = createDriver([notify], enabled)
    const calls = { count: 0 }
    const turn = driver.dispatch(w.$, 'turn.complete', {
      turnId: 't1', answer: 'done', durationMs: 134_000, isAborted: false, reason: 'answer',
    } as Args<'turn.complete'>, bottom('turn.complete', { text: '' }, calls))
    const winner = await Promise.race([
      turn.then(() => 'turn'),
      ticks(200).then(() => 'blocked'),
    ])
    expect(winner).toBe('turn')
    w.blocked = false
  })

  test('an idle nudge inside five minutes of a finished turn stays quiet', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    w.now.ms += 60_000
    await notification(w, 'Claude is waiting for your input', 'idle_prompt')
    expect(notifierArgv(w)).toHaveLength(1)
  })

  test('an idle nudge after five minutes goes out', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    w.now.ms += 5 * 60_000
    await notification(w, 'Claude is waiting for your input', 'idle_prompt')
    expect(notifierArgv(w)).toHaveLength(2)
  })

  test('the platform is detected once per session', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    w.now.ms += 20_000
    await completeTurn(w, 134_000)
    const which = w.argvs.filter(argv => argv[0] === 'which')
    expect(which).toEqual([['which', 'notify-send']])
  })
})

describe('notify chime', () => {
  test('essentials plays the bundled chime', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    expect(w.played).toHaveLength(1)
    expect(w.played[0]).toMatchObject({ mime: 'audio/wav' })
    expect(w.played[0]).not.toHaveProperty('asset')
    const bytes = atob(w.played[0]?.base64 ?? '')
    expect(bytes.slice(0, 4)).toBe('RIFF')
    expect(bytes.slice(8, 16)).toBe('WAVEfmt ')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  test('strict stays silent', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    await completeTurn(w, 134_000)
    expect(w.played).toEqual([])
  })

  test('sound off mutes the chime', async () => {
    const w = world({ set: resolveSet({ set: 'essentials' }, { sound: false }) })
    await completeTurn(w, 134_000)
    expect(w.played).toEqual([])
  })

  test('a failing chime never fails the turn', async () => {
    const w = world()
    ;(w.$ as unknown as { audio: { play: () => Promise<void> } }).audio.play = async () => { throw new Error('no audio device') }
    await expect(completeTurn(w, 134_000)).resolves.toMatchObject({ text: '' })
    expect(notifierArgv(w)).toHaveLength(1)
  })
})

describe('notify only alerts for notifications that wait for the user', () => {
  for (const type of ['permission_prompt', 'elicitation_dialog']) {
    test(`${type} notifies`, async () => {
      const w = world()
      await notification(w, 'Claude needs you', type)
      expect(notifierArgv(w)).toHaveLength(1)
    })
  }

  for (const type of ['auth_success', 'elicitation_complete', 'elicitation_response', 'something_new']) {
    test(`${type} stays silent`, async () => {
      const w = world()
      await notification(w, 'FYI', type)
      expect(notifierArgv(w)).toEqual([])
      expect(w.toasts).toEqual([])
    })
  }

  test('the notification send is deferred off the dispatch like the other paths', async () => {
    const w = world()
    w.deferred = []
    await notification(w, 'Claude needs permission', 'permission_prompt')
    expect(notifierArgv(w)).toEqual([])
    expect(w.deferred).toHaveLength(1)
    w.deferred[0]?.()
    await settle()
    expect(notifierArgv(w)).toHaveLength(1)
  })
})

describe('notifier delivery details', () => {
  test('a notifier that exits nonzero falls back to a toast', async () => {
    const w = world()
    w.exits['notify-send'] = 1
    await completeTurn(w, 134_000)
    expect(w.toasts).toEqual(['project finished in 2m14s'])
  })

  test('a newline in the body stays inside one osascript argument', async () => {
    const w = world({ env: { OS: 'Linux', UNAME: 'Darwin' } })
    await notification(w, 'line one\nline two\r\nline three')
    const argv = notifierArgv(w)[0] ?? []
    // No script text is built from the body, so a newline cannot end a string.
    expect(argv).toHaveLength(4)
    expect(argv[3]).toBe('project needs you: line one\nline two\r\nline three')
  })
})

describe('the away notification fires while the dialog is still open', () => {
  test('needsYou delivers without waiting for the dispatch to resolve', async () => {
    const w = world()
    // The engine runs clock.after callbacks only once the current dispatch has resolved.
    w.deferred = []
    needsYou(w.$, 'guard: run `rm -rf build`?')
    await settle()
    expect(notifierArgv(w)).toEqual([['notify-send', 'Claude Code', 'project needs you: guard: run `rm -rf build`?']])
    expect(w.deferred).toEqual([])
  })

  test('a hook that awaits an unanswered dialog has already notified', async () => {
    const w = world()
    w.deferred = []
    let answer: (value: string) => void = () => undefined
    ;(w.$ as unknown as { ui: { ask: () => Promise<string> } }).ui.ask = () => new Promise<string>(resolve => { answer = resolve })
    const dialog = (async () => {
      needsYou(w.$, 'tests: confirm')
      return w.$.ui.ask('Allow?')
    })()
    await settle()
    expect(notifierArgv(w)).toHaveLength(1)
    answer('Allow')
    await dialog
  })

  test('needsYou stays quiet when the notify mod is off', async () => {
    const w = world({ set: resolveSet({ set: 'quiet' }) })
    needsYou(w.$, 'guard: run?')
    await settle()
    expect(notifierArgv(w)).toEqual([])
  })
})
