import type { Args } from 'claude-code'
import type { ModEvent, ModHandler, UltraMod } from '../hooks/core/mod'

// Compile-only checks. The dispatcher fails closed on four events only, so a
// handler flagged gating on any other event would fail open without a word.
export function checkModTypes() {
  const run: ModHandler<'tool.call'>['run'] = (_, e, next) => next(e)
  const gates: UltraMod = {
    id: 'guard',
    hooks: {
      'tool.call': [{ gating: true, run }],
      'tool.check': [{ gating: true, run: (_, e, next) => next(e) }],
      'prompt.submit': [{ gating: true, run: (_, e, next) => next(e) }],
      'session.append': [{ gating: true, run: (_, e, next) => next(e) }],
    },
  }
  const observers: UltraMod = {
    id: 'receipts',
    hooks: {
      'turn.complete': [{ run: (_, e, next) => next(e) }],
      'ui.render': [{ run: (_, e, next) => next(e) }],
    },
  }
  const bad: UltraMod[] = [
    // @ts-expect-error A turn.complete handler cannot gate: the dispatcher forwards after its failure.
    { id: 'receipts', hooks: { 'turn.complete': [{ gating: true, run: (_, e, next) => next(e) }] } },
    // @ts-expect-error No other event gates either.
    { id: 'compact', hooks: { 'classic.SessionStart': [{ gating: true, run: (_, e, next) => next(e) }] } },
    // @ts-expect-error Not even a gating: false on an event that has no gate.
    { id: 'pins', hooks: { 'prompt.compose': [{ gating: false, run: (_, e, next) => next(e) }] } },
  ]
  // The flag stays readable on a handler of any event, so the dispatcher can test it.
  const flagOf = <E extends ModEvent>(handler: ModHandler<E>) => Boolean(handler.gating)

  // turn.start carries no agentId (a subagent's run raises no turn.start), so
  // the receipts hook needs no subagent filter there; an engine that adds one
  // turns this expectation red.
  // @ts-expect-error turn.start has no agentId.
  type SubagentTurnStart = Args<'turn.start'>['agentId']

  return { gates, observers, bad, flagOf }
}
