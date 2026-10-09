import type { Args } from 'claude-code'
import type { UltraMod } from '../hooks/core/mod'

// Compile-only checks. A mod answers with plain values; the hooks in
// register.tsx write every engine answer, so a mod has no way to hand back an
// allow, a permission verdict or the engine's own next.
export function checkModTypes() {
  const good: UltraMod = {
    id: 'guard',
    check: { when: e => e.tool === 'Bash', run: () => 'refused' },
    watch: { run: () => result => result },
    append: { run: () => null },
    turnComplete: { run: () => 'a line' },
  }
  const bad: UltraMod[] = [
    // @ts-expect-error A check answers with refusal text, not a decision.
    { id: 'guard', check: { run: () => ({ decision: 'allow' }) } },
    // @ts-expect-error A check cannot hand back a tool result in place of the call.
    { id: 'secrets', check: { run: () => ({ result: 'faked' }) } },
    // @ts-expect-error There is no permission step.
    { id: 'tests', permission: { run: () => null } },
    // @ts-expect-error A step gets the facade and the event, no next.
    { id: 'tidy', check: { run: (_api, _e, next: () => void) => { next(); return null } } },
  ]

  // turn.start carries no agentId (a subagent's run raises no turn.start), so
  // the receipts step needs no subagent filter there; an engine that adds one
  // turns this expectation red.
  // @ts-expect-error turn.start has no agentId.
  type SubagentTurnStart = Args<'turn.start'>['agentId']

  return { good, bad }
}
