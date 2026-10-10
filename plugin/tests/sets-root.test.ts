import { expect, test } from 'claude-code/testing'
import { createSets, projectKey } from '../hooks/core/sets'
import type { UltraApi } from '../hooks/core/api'

// An API double that holds the published set and can refuse the write.
function fakeApi(saved: Record<string, unknown>) {
  const held: { current: { value: unknown; version: number } | undefined } = { current: undefined }
  const control = { root: '/a', failWrites: false }
  const api = {
    session: { root: async () => control.root },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { saved[key] = value } },
    state: {
      get: async () => held.current ?? { value: undefined, version: 0 },
      set: async (_ref: unknown, value: unknown) => {
        if (control.failWrites) throw new Error('state write failed')
        held.current = { value, version: (held.current?.version ?? 0) + 1 }
        return { isSet: true, version: held.current.version }
      },
    },
  } as unknown as UltraApi
  return { api, control, published: () => (held.current?.value as { name?: string } | undefined)?.name }
}

test('a failed publish after a root change is retried on the next call', async () => {
  const { api, control, published } = fakeApi({ [projectKey('/a')]: { set: 'flow' }, [projectKey('/b')]: { set: 'marathon' } })
  const sets = createSets()
  await sets.ensure(api)
  expect(published()).toBe('flow')
  control.root = '/b'
  control.failWrites = true
  await sets.ensure(api).catch(() => undefined)
  expect(published()).toBe('flow')
  control.failWrites = false
  await sets.ensure(api)
  expect(published()).toBe('marathon')
})
