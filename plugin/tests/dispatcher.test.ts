import type { Args, EventResult, Frozen, On, ToolCallArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createDispatcher, engineNext } from '../hooks/core/dispatcher'
import { dispatch as dispatchEvent } from '../hooks/register'
import { createSets, resolveSet } from '../hooks/core/sets'
import { createMods } from '../hooks/mods/index'
import type { ModEvent, ModId, ModNext, UltraMod } from '../hooks/core/mod'

const enabled = { enabled: async () => true }

// The kit answers any tool name it is given; this build's declarations hold
// only its own tools, so a probe is cast once here.
const probeCall = (tool: string) => ({ tool }) as unknown as ToolCallArgs

function setup(on: On) {
  mock.store(on)
  on('session.root', () => ({ value: '/dispatcher-tests' }))
}

function bottom<E extends ModEvent>(event: E, signal: ModNext<E>['signal'], answer: EventResult<E>, calls: { count: number }): ModNext<E> {
  const next = Object.assign(async (_e: Frozen<Args<E>> | Args<E>) => {
    calls.count += 1
    return answer
  }, { event, signal })
  Object.defineProperty(next, 'called', { get: () => calls.count > 0 })
  return next as ModNext<E>
}

test('dispatcher runs mods and their handlers in order and unwinds once', async ($, on) => {
  setup(on)
  const order: string[] = []
  const calls = { count: 0 }
  const mods: UltraMod[] = (['guard', 'secrets', 'tests'] as const).map(id => ({
    id,
    hooks: {
      'tool.call': [{
        run: async (_, e, next) => {
          order.push(`${id}:before`)
          expect(next.event).toBe('tool.call')
          expect(next.called).toBe(false)
          const result = await next(e)
          expect(next.called).toBe(true)
          order.push(`${id}:after`)
          return result
        },
      }],
    },
  }))
  mods[0]?.hooks?.['tool.call']?.push({ run: (_, e, next) => {
    order.push('guard:second')
    return next(e)
  } })
  const dispatcher = createDispatcher(mods, enabled)
  on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, { result: 'finished' }, calls)))

  expect(await $.tool.call(probeCall('probe'))).toEqual({ result: 'finished' })
  expect(order).toEqual(['guard:before', 'guard:second', 'secrets:before', 'tests:before', 'tests:after', 'secrets:after', 'guard:after'])
  expect(calls.count).toBe(1)
})

test('dispatcher reads enabled mods for every dispatch and skips disabled gates', async ($, on) => {
  setup(on)
  const active = new Set<ModId>(['receipts'])
  const seen: string[] = []
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'tool.call': [{ gating: true, run: (_, e, next) => {
      seen.push('guard')
      return next(e)
    } }] } },
    { id: 'receipts', hooks: { 'tool.call': [{ run: (_, e, next) => {
      seen.push('receipts')
      return next(e)
    } }] } },
  ], { enabled: async (_, id) => active.has(id) })
  on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, { result: 'finished' }, calls)))

  await $.tool.call(probeCall('probe'))
  active.add('guard')
  active.delete('receipts')
  await $.tool.call(probeCall('probe'))
  expect(seen).toEqual(['receipts', 'guard'])
  expect(calls.count).toBe(2)
})

test('catch fallback sees only live enabled gates', async ($, on) => {
  setup(on)
  let active = false
  const dispatcher = createDispatcher([{ id: 'guard', hooks: { 'tool.call': [{ gating: true, run: (_, e, next) => next(e) }] } }], { enabled: async () => active })
  on('tool.call', async $ => {
    expect(await dispatcher.hasGate($, 'tool.call')).toBe(false)
    active = true
    expect(await dispatcher.hasGate($, 'tool.call')).toBe(true)
    expect(await dispatcher.hasGate($, 'prompt.submit')).toBe(false)
    return { result: 'checked' }
  })
  expect(await $.tool.call(probeCall('probe'))).toEqual({ result: 'checked' })
})

test('command middleware preserves the core answer without running the engine command', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const order: string[] = []
  const dispatcher = createDispatcher([{ id: 'guard', hooks: { 'command.run': [{ run: async (_, e, next) => {
    order.push('before')
    const answer = await next(e)
    order.push('after')
    return answer
  } }] } }], enabled)
  on('command.run', { command: 'middleware-probe' }, ($, e, next) => dispatcher.dispatch($, 'command.run', e, bottom('command.run', next.signal, { text: 'engine' }, calls), async () => {
    order.push('core')
    return { text: 'core answer' }
  }))
  expect(await $.command.run({ command: 'middleware-probe', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).toEqual({ text: 'core answer' })
  expect(order).toEqual(['before', 'core', 'after'])
  expect(calls.count).toBe(0)
})

test('dispatcher applies when filters inside the chain', async ($, on) => {
  setup(on)
  const seen: string[] = []
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'tool.call': [{ when: e => (e.tool as string) === 'probe', run: (_, e, next) => {
      seen.push(e.tool)
      return next(e)
    } }] } },
    { id: 'receipts', hooks: { 'tool.call': [{ run: (_, e, next) => {
      seen.push(`receipts:${e.tool}`)
      return next(e)
    } }] } },
  ], enabled)
  on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, { result: 'finished' }, calls)))

  await $.tool.call(probeCall('other-probe'))
  await $.tool.call(probeCall('probe'))
  expect(seen).toEqual(['receipts:other-probe', 'probe', 'receipts:probe'])
  expect(calls.count).toBe(2)
})

test('a gating failure before next refuses the tool without downstream work', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  let reachedObserver = false
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'tool.call': [{ gating: true, run: () => { throw new Error('guard failed') } }] } },
    { id: 'receipts', hooks: { 'tool.call': [{ run: (_, e, next) => {
      reachedObserver = true
      return next(e)
    } }] } },
  ], enabled)
  on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, { result: 'finished' }, calls)))

  expect(await $.tool.call(probeCall('probe'))).toMatchObject({ deny: expect.any(String) })
  expect(reachedObserver).toBe(false)
  expect(calls.count).toBe(0)
})

test('a failed gating filter refuses before next', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'tool.call': [{ gating: true, when: () => { throw new Error('filter failed') }, run: (_, e, next) => next(e) }] } },
  ], enabled)
  on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, { result: 'finished' }, calls)))

  expect(await $.tool.call(probeCall('probe'))).toMatchObject({ deny: expect.any(String) })
  expect(calls.count).toBe(0)
})

test('an observer failure before next continues through later mods', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const seen: string[] = []
  const dispatcher = createDispatcher([
    { id: 'receipts', hooks: { 'tool.call': [{ run: () => { throw new Error('observer failed') } }] } },
    { id: 'loops', hooks: { 'tool.call': [{ run: (_, e, next) => {
      seen.push('loops')
      return next(e)
    } }] } },
  ], enabled)
  on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, { result: 'finished' }, calls)))

  expect(await $.tool.call(probeCall('probe'))).toEqual({ result: 'finished' })
  expect(seen).toEqual(['loops'])
  expect(calls.count).toBe(1)
})

for (const gating of [false, true]) {
  test(`${gating ? 'a gate' : 'an observer'} failing after next retains the completed tool result`, async ($, on) => {
    setup(on)
    const calls = { count: 0 }
    const result = { result: 'finished', text: 'completed output', ref: 17, isReadOnly: true } as const
    const dispatcher = createDispatcher([
      { id: gating ? 'guard' : 'receipts', hooks: { 'tool.call': [{ gating, run: async (_, e, next) => {
        await next(e)
        throw new Error('postprocessing failed')
      } }] } },
    ], enabled)
    on('tool.call', ($, e, next) => dispatcher.dispatch($, 'tool.call', e, bottom('tool.call', next.signal, result, calls)))

    expect(await $.tool.call(probeCall('probe'))).toEqual(result)
    expect(calls.count).toBe(1)
  })
}

test('calling next again reuses the same downstream result and abort signal', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  let expectedSignal: ModNext<'tool.call'>['signal'] | undefined
  let sameSignal = false
  let sameResult = false
  const dispatcher = createDispatcher([
    { id: 'receipts', hooks: { 'tool.call': [{ run: async (_, e, next) => {
      sameSignal = next.signal === expectedSignal
      const first = await next(e)
      sameResult = await next(e) === first
      return first
    } }] } },
  ], enabled)
  on('tool.call', ($, e, next) => {
    expectedSignal = next.signal
    const last = bottom('tool.call', next.signal, { result: 'finished' }, calls)
    const adapted = engineNext('tool.call', next)
    expect(adapted.event).toBe('tool.call')
    expect(adapted.signal).toBe(next.signal)
    expect(adapted.called).toBe(false)
    return dispatcher.dispatch($, 'tool.call', e, last)
  })

  expect(await $.tool.call(probeCall('probe'))).toEqual({ result: 'finished' })
  expect(sameSignal).toBe(true)
  expect(sameResult).toBe(true)
  expect(calls.count).toBe(1)
})

test('a failed tool.check gate returns a deny verdict', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'tool.check': [{ gating: true, run: () => { throw new Error('check failed') } }] } },
  ], enabled)
  on('tool.check', ($, e, next) => dispatcher.dispatch($, 'tool.check', e, bottom('tool.check', next.signal, { decision: 'allow' }, calls)))

  expect(await $.tool.check({ tool: 'probe', input: {} })).toMatchObject({ decision: 'deny', reason: expect.any(String) })
  expect(calls.count).toBe(0)
})

test('a failed tool.check gate denies even after reading an allow verdict', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const dispatcher = createDispatcher([{ id: 'guard', hooks: { 'tool.check': [{ gating: true, run: async (_, e, next) => {
    await next(e)
    throw new Error('permission verdict processing failed')
  } }] } }], enabled)
  on('tool.check', ($, e, next) => dispatcher.dispatch($, 'tool.check', e, bottom('tool.check', next.signal, { decision: 'allow' }, calls)))
  expect(await $.tool.check({ tool: 'probe', input: {} })).toMatchObject({ decision: 'deny' })
  expect(calls.count).toBe(1)
})

test('failed HUD start and completion leave later mod lifecycle handlers running', async ($, on) => {
  setup(on)
  mock.clock(on)
  const seen: string[] = []
  const sets = createSets()
  sets.ensure = async () => resolveSet(undefined)
  const { hud } = createMods(sets)
  hud.start = async () => { throw new Error('clock failed') }
  hud.complete = async () => { throw new Error('state failed') }
  const mods: UltraMod[] = [{ id: 'receipts', hooks: {
    'turn.start': [{ run: (_, e) => { seen.push('start'); return { turnId: e.turnId } } }],
    'turn.complete': [{ run: () => { seen.push('complete'); return { text: 'receipt survived' } } }],
  } }]
  const runtime = { hud, mods, sets, dispatcher: createDispatcher(mods, enabled) }
  on('turn.start', ($, e, next) => dispatchEvent($, 'turn.start', e, next, runtime))
  on('turn.complete', ($, e, next) => dispatchEvent($, 'turn.complete', e, next, runtime))
  expect(await $.turn.start({ turnId: 'main', text: '' })).toEqual({ turnId: 'main' })
  expect(await $.turn.complete({ turnId: 'main', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })).toMatchObject({ text: 'receipt survived' })
  expect(seen).toEqual(['start', 'complete'])
})

test('a failed prompt.submit gate drops the prompt', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'prompt.submit': [{ gating: true, run: () => { throw new Error('prompt failed') } }] } },
  ], enabled)
  on('prompt.submit', ($, e, next) => dispatcher.dispatch($, 'prompt.submit', e, bottom('prompt.submit', next.signal, { text: e.text }, calls)))

  expect(await $.prompt.submit({ text: 'test prompt', wait: false, origin: { kind: 'composer' } })).toMatchObject({ drop: expect.any(String) })
  expect(calls.count).toBe(0)
})

test('a failed session.append gate refuses a plugin note', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'guard', hooks: { 'session.append': [{ gating: true, run: () => { throw new Error('append failed') } }] } },
  ], enabled)
  on('session.append', ($, e, next) => dispatcher.dispatch($, 'session.append', e, bottom('session.append', next.signal, { message: e.message, uuid: e.uuid }, calls)))

  expect(await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: 'test note' }] },
    door: 'note', origin: { kind: 'plugin', name: 'test' }, uuid: 'note-1',
  })).toMatchObject({ deny: expect.any(String) })
  expect(calls.count).toBe(0)
})

test('dispatcher preserves the original row when session.append redaction fails', async ($, on) => {
  setup(on)
  const calls = { count: 0 }
  const dispatcher = createDispatcher([
    { id: 'secrets', hooks: { 'session.append': [{ run: () => { throw new Error('redactor failed') } }] } },
  ], enabled)
  const message: Args<'session.append'>['message'] = { type: 'user', content: [{ type: 'text', text: 'original output' }] }
  const input: Args<'session.append'> = { message, door: 'tool-result', origin: { kind: 'tool', tool: 'probe' }, uuid: 'result-1' }
  let answer: EventResult<'session.append'> | undefined
  // Successful append stubs require engine storage; exercise the dispatcher before that boundary.
  on('tool.call', async ($, _, next) => {
    answer = await dispatcher.dispatch($, 'session.append', input, bottom('session.append', next.signal, { message, uuid: input.uuid }, calls))
    return { result: 'finished' }
  })

  await $.tool.call(probeCall('probe'))
  expect(answer).toEqual({ message, uuid: 'result-1' })
  expect(calls.count).toBe(1)
})
