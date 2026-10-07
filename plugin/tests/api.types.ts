import { atom, read, update } from 'claude-code'
import type { Elements, RenderInput, StateRead } from 'claude-code'
import type { UltraApi } from '../hooks/core/api'
import type { UltraAllow, UltraCompact, UltraReceipt, UltraSet, UltraTurn } from '../types/index'

// Compile-only checks prevent the facade from exposing undeclared capabilities.
export function checkApiTypes(api: UltraApi, terminal: RenderInput<'AbovePrompt', 'terminal'>, desktop: RenderInput<'AbovePrompt', 'desktop'>) {
  const terminalElements: Elements['terminal'] = api.ui.resolve(terminal)
  const desktopElements: Elements['desktop'] = api.ui.resolve(desktop)
  const text: Promise<string> = api.fs.read('README.md')
  const bytes: Promise<{ base64: string }> = api.fs.read('assets/chime.ogg', { as: 'bytes' })
  const set: Promise<StateRead<UltraSet | null>> = api.state.get({ plugin: 'ultramod', key: 'set' })
  const turn: Promise<StateRead<UltraTurn>> = api.state.get({ plugin: 'ultramod', key: 'turn' })
  const receipts: Promise<StateRead<UltraReceipt[]>> = api.state.get({ plugin: 'ultramod', key: 'receipts' })
  const allow: Promise<StateRead<UltraAllow>> = api.state.get({ plugin: 'ultramod', key: 'allow' })
  const compact: Promise<StateRead<UltraCompact>> = api.state.get({ plugin: 'ultramod', key: 'compact' })
  const active = atom({ plugin: 'ultramod', key: 'set' } as const, null)
  const current: Promise<UltraSet | null> = read(api, active)
  const updated: Promise<UltraSet | null> = update(api, active, value => value)

  api.env.get('OS')
  api.env.get('HOME')
  api.env.get('USERPROFILE')
  api.env.get('WSL_DISTRO_NAME')
  api.env.get('TERM_PROGRAM')

  // @ts-expect-error Network access is absent from the facade.
  api.http.fetch('https://example.com')
  // @ts-expect-error Model calls are absent from the facade.
  api.model.complete({ model: 'haiku', prompt: 'unused' })
  // @ts-expect-error Tool calls are absent from the facade.
  api.tool.call({ tool: 'Bash', command: 'pwd' })
  // @ts-expect-error Clipboard writes are absent from the facade.
  api.ui.copy({ text: 'unused' })
  // @ts-expect-error Process streaming is absent from the facade.
  api.process.spawn({ argv: ['pwd'] })
  // @ts-expect-error File listing is absent from the facade.
  api.fs.list('.')
  // @ts-expect-error Session appends are absent from the facade.
  api.session.append({ message: { type: 'user', content: [] } })
  // @ts-expect-error Only the five declared environment names are exposed.
  api.env.get('PATH')
  // @ts-expect-error Environment mutation is absent from the facade.
  api.env.set('HOME', '/tmp')
  // @ts-expect-error State keys must appear in the plugin contract.
  api.state.get({ plugin: 'ultramod', key: 'missing' })
  // @ts-expect-error State writes retain the value type for the declared key.
  api.state.set({ plugin: 'ultramod', key: 'turn' }, 'invalid')
  // @ts-expect-error Values from another state key do not fit the allowlist.
  api.state.set({ plugin: 'ultramod', key: 'allow' }, { warned: false, offered: false })
  // @ts-expect-error Bytes reads return base64 records rather than strings.
  const wrongBytes: Promise<string> = api.fs.read('assets/chime.ogg', { as: 'bytes' })

  return { terminalElements, desktopElements, text, bytes, set, turn, receipts, allow, compact, current, updated, wrongBytes }
}
