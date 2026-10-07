import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDispatcher } from '../hooks/core/dispatcher'
import type { ModEvent, ModNext } from '../hooks/core/mod'
import { resolveSet } from '../hooks/core/sets'
import { notify, resetNotify } from '../hooks/mods/notify'

const enabled = { enabled: async () => true }

interface World {
  $: UltraApi
  argvs: string[][]
  failures: Set<string>
  toasts: string[]
  played: { asset?: string }[]
  now: { ms: number }
  env: Record<string, string | undefined>
  blocked: boolean
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
    process: {
      run: async (argv: readonly string[]) => {
        const name = argv[0] ?? ''
        w.argvs.push([...argv])
        if (w.failures.has(name)) throw new Error(`${name} unavailable`)
        if (name === 'uname') {
          return { exitCode: 0, stdout: `${w.env.UNAME ?? 'Linux'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        }
        if (name === 'which') {
          const target = argv[1] ?? ''
          const found = (target === 'notify-send' || target === 'osascript') && !w.failures.has(target)
          return { exitCode: found ? 0 : 1, stdout: found ? `/usr/bin/${target}` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        }
        if (name === 'notify-send' && w.blocked) return new Promise<never>(() => undefined)
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
      after: (_ms: number, fn: () => void) => { fn(); return { cancel: () => undefined } },
    },
    audio: { play: async (clip: { asset?: string }) => { w.played.push(clip) } },
    command: { register: async () => ({ value: { command: 'ultramod' } }) },
    env: { get: async (name: string) => w.env[name] },
  } as unknown as UltraApi
  return w
}

function bottom<E extends ModEvent>(event: E, answer: EventResult<E>, calls: { count: number }): ModNext<E> {
  const next = Object.assign(async (_e: Frozen<Args<E>> | Args<E>) => {
    calls.count += 1
    return answer
  }, { event, signal: undefined })
  Object.defineProperty(next, 'called', { get: () => calls.count > 0 })
  return next as unknown as ModNext<E>
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
  const dispatcher = createDispatcher([notify], enabled)
  const calls = { count: 0 }
  const result = await dispatcher.dispatch(w.$, 'turn.complete', {
    turnId: 't1', answer: 'done', durationMs, isAborted: false, reason: 'answer', ...extra,
  } as Args<'turn.complete'>, bottom('turn.complete', { text: '' }, calls))
  await settle()
  return result
}

async function notification(w: World, message: string, notificationType = 'permission'): Promise<EventResult<'classic.Notification'>> {
  const dispatcher = createDispatcher([notify], enabled)
  const calls = { count: 0 }
  const result = await dispatcher.dispatch(w.$, 'classic.Notification', {
    hook_event_name: 'Notification', message, notification_type: notificationType, session_id: 's1', transcript_path: '', cwd: '/work/project',
  } as Args<'classic.Notification'>, bottom('classic.Notification', {} as EventResult<'classic.Notification'>, calls))
  await settle()
  return result
}

const NOTIFIERS = ['notify-send', 'osascript', 'powershell.exe']
const notifierArgv = (w: World) => w.argvs.filter(argv => NOTIFIERS.includes(argv[0] ?? ''))

describe('notify sends platform notifications with exact argv', () => {
  test('linux uses notify-send', async () => {
    const w = world()
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)).toEqual([['notify-send', 'Claude Code', 'project finished in 2m14s']])
  })

  test('macos uses osascript with escaped quotes', async () => {
    const w = world({ env: { OS: 'Linux', UNAME: 'Darwin' } })
    ;(w.$ as unknown as { session: { root: () => Promise<string> } }).session.root = async () => '/work/my "proj"'
    await completeTurn(w, 65_000)
    expect(notifierArgv(w)).toEqual([['osascript', '-e', 'display notification "my \\"proj\\" finished in 1m05s" with title "Claude Code"']])
  })

  test('windows uses powershell with doubled quotes', async () => {
    const w = world({ env: { OS: 'Windows_NT' } })
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)).toEqual([['powershell.exe', '-NoProfile', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, 'Claude Code', 'project finished in 2m14s', 'Info'); Start-Sleep -Seconds 2; $n.Dispose()",
    ]])
  })

  test('the platform comes from uname, not from the OS variable', async () => {
    const w = world({ env: { OS: 'Linux', UNAME: 'Darwin' } })
    await completeTurn(w, 65_000)
    expect(notifierArgv(w)[0]?.[0]).toBe('osascript')
  })

  test('wsl uses powershell even on a linux os string', async () => {
    const w = world({ env: { OS: 'Linux', WSL_DISTRO_NAME: 'Ubuntu' } })
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)[0]?.slice(0, 2)).toEqual(['powershell.exe', '-NoProfile'])
  })

  test('a windows root still names the folder', async () => {
    const w = world({ env: { OS: 'Windows_NT' } })
    ;(w.$ as unknown as { session: { root: () => Promise<string> } }).session.root = async () => 'C:\\work\\project'
    await completeTurn(w, 134_000)
    expect(notifierArgv(w)[0]?.join(' ')).toContain('project finished in 2m14s')
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
    const dispatcher = createDispatcher([notify], enabled)
    const calls = { count: 0 }
    const turn = dispatcher.dispatch(w.$, 'turn.complete', {
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
    expect(w.played).toEqual([{ asset: 'assets/chime.wav' }])
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
