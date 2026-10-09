import type { Args, EventResult, Frozen } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import type { ModId, ToolResult, UltraMod } from '../hooks/core/mod'
import type { Runtime } from '../hooks/core/runtime'
import { checkTool, composeSections, maskRow, notification, REFUSED, sessionEnd, sessionRestart, sessionStart, turnComplete, turnStart, underAnswer, watchTool } from '../hooks/core/runtime'

// Test seam: runs a list of mods the way the hooks in register.tsx run the
// real ones, with a stand-in for what the engine runs beneath. Each case of
// dispatch mirrors one hook's body there, line for line.

export type DriveEvent = 'tool.call' | 'session.append' | 'prompt.compose' | 'turn.complete' | 'turn.start' | 'session.start' | 'session.end' | 'classic.SessionStart' | 'classic.Notification'
export type Beneath<E extends DriveEvent> = (e: Frozen<Args<E>> | Args<E>) => Promise<EventResult<E>>
type Enabled = { enabled: (api: UltraApi, id: ModId) => Promise<boolean> }

export function standIn(mods: readonly UltraMod[], sets: Enabled): Runtime {
  const hud = { id: 'hud', start: async () => undefined, complete: async () => undefined, sync: async () => undefined, stop: () => undefined }
  return {
    mods,
    sets: { ...sets, ensure: async () => null, hydrate: async () => null },
    hud,
  } as unknown as Runtime
}

export function createDriver(mods: readonly UltraMod[], sets: Enabled) {
  const runtime = standIn(mods, sets)
  async function toolCall(api: UltraApi, e: Frozen<Args<'tool.call'>>, next: Beneath<'tool.call'>): Promise<ToolResult> {
    // checkToolCall, with the .catch that refuses a call it had not let through.
    let refusal: string | null
    try {
      refusal = await checkTool(api, runtime, e)
    } catch {
      return { deny: REFUSED } as ToolResult
    }
    if (refusal !== null) return { deny: refusal } as ToolResult
    // watchToolCall
    const after = await watchTool(api, runtime, e)
    const result = await next(e)
    const change = await after(result)
    if (change === null) return result
    if (change.deny !== undefined) return { deny: change.deny }
    if (result.deny !== undefined) return result
    return { ...result, context: change.context } as ToolResult
  }
  async function dispatch<E extends DriveEvent>(api: UltraApi, event: E, e: Frozen<Args<E>>, next: Beneath<E>): Promise<EventResult<E>> {
    const input = e as never
    const beneath = next as (e: unknown) => Promise<never>
    if (event === 'tool.call') return toolCall(api, input, beneath) as Promise<EventResult<E>>
    if (event === 'session.append') {
      const row = input as Frozen<Args<'session.append'>>
      const content = await maskRow(api, runtime, row)
      if (content === null) return beneath(row)
      return beneath({ ...row, message: { ...row.message, content } })
    }
    if (event === 'prompt.compose') {
      const added = await composeSections(api, runtime, input)
      if (added.length === 0) return beneath(input)
      const composed = await beneath(input) as EventResult<'prompt.compose'>
      return { sections: [...composed.sections, ...added] } as unknown as EventResult<E>
    }
    if (event === 'turn.complete') {
      const turn = input as Frozen<Args<'turn.complete'>>
      const line = await turnComplete(api, runtime, turn)
      if (line === null) return beneath(turn)
      const result = await beneath(turn) as EventResult<'turn.complete'>
      return { ...result, text: underAnswer(result.text, turn.answer, line) } as unknown as EventResult<E>
    }
    if (event === 'turn.start') await turnStart(api, runtime, input)
    else if (event === 'session.start') await sessionStart(api, runtime, input)
    else if (event === 'session.end') await sessionEnd(api, runtime, input)
    else if (event === 'classic.SessionStart') await sessionRestart(api, runtime, input)
    else if (event === 'classic.Notification') await notification(api, runtime, input)
    return beneath(input)
  }
  return { runtime, dispatch }
}
