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

  // The receipts and HUD main-loop filters rely on turn.start identifying a
  // subagent by an optional string. Older supported engines have no field, so
  // their fallback is the same type. If an assertion fails on a current
  // engine, re-check those filters against its new turn.start contract. An
  // engine that drops the field also takes the fallback, so a removal goes
  // unnoticed here.
  type AgentIdOf<T> = T extends { agentId?: unknown } ? T['agentId'] : string | undefined
  type TurnStartAgentId = AgentIdOf<Args<'turn.start'>>
  const agentId: string | undefined = undefined as TurnStartAgentId
  const optionalAgentId: TurnStartAgentId = undefined
  const stringAgentId: TurnStartAgentId = 'agent'
  // @ts-expect-error agentId is a string, never a number.
  const numberAgentId: TurnStartAgentId = 0

  return { good, bad, agentId, optionalAgentId, stringAgentId, numberAgentId }
}
