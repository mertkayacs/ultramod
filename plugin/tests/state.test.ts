import { expect, test } from 'claude-code/testing'
import { addAllowedPath, addAllowedRisk } from '../hooks/core/state'

test('allowing a path twice keeps one entry and leaves the risks alone', () => {
  const once = addAllowedPath({ risks: ['rm-recursive'], paths: [] }, '/work/.env')
  const twice = addAllowedPath(once, '/work/.env')
  expect(twice).toBe(once)
  expect(twice).toEqual({ risks: ['rm-recursive'], paths: ['/work/.env'] })
})

test('allowing a risk twice keeps one entry and leaves the paths alone', () => {
  const once = addAllowedRisk({ risks: [], paths: ['/work/.env'] }, 'rm-recursive')
  expect(addAllowedRisk(once, 'rm-recursive')).toBe(once)
  expect(once).toEqual({ risks: ['rm-recursive'], paths: ['/work/.env'] })
})
