import { test, expect, describe } from 'claude-code/testing'
import { isDocFile, isAllowedDocPath } from '../hooks/lib/tidy'

describe('isDocFile', () => {
  test('documentation extensions', () => {
    expect(isDocFile('notes.md')).toBe(true)
    expect(isDocFile('NOTES.MD')).toBe(true)
    expect(isDocFile('plan.markdown')).toBe(true)
    expect(isDocFile('scratch.txt')).toBe(true)
  })

  test('everything else', () => {
    expect(isDocFile('src/a.ts')).toBe(false)
    expect(isDocFile('data.json')).toBe(false)
    expect(isDocFile('README')).toBe(false)
  })
})

describe('isAllowedDocPath', () => {
  test('builtin allowlist', () => {
    expect(isAllowedDocPath('README.md')).toBe(true)
    expect(isAllowedDocPath('README.setup.md')).toBe(true)
    expect(isAllowedDocPath('CHANGELOG.md')).toBe(true)
    expect(isAllowedDocPath('CONTRIBUTING.md')).toBe(true)
    expect(isAllowedDocPath('LICENSE.txt')).toBe(true)
    expect(isAllowedDocPath('docs/mods.md')).toBe(true)
    expect(isAllowedDocPath('docs/deep/nested.md')).toBe(true)
    expect(isAllowedDocPath('.claude/pins.md')).toBe(true)
    expect(isAllowedDocPath('.github/ISSUE_TEMPLATE/bug.md')).toBe(true)
    expect(isAllowedDocPath('AGENTS.md')).toBe(true)
    expect(isAllowedDocPath('CLAUDE.md')).toBe(true)
  })

  test('case and prefix normalization', () => {
    expect(isAllowedDocPath('readme.md')).toBe(true)
    expect(isAllowedDocPath('./docs/x.md')).toBe(true)
  })

  test('everything else is refused', () => {
    expect(isAllowedDocPath('NOTES.md')).toBe(false)
    expect(isAllowedDocPath('notes/TODO.md')).toBe(false)
    expect(isAllowedDocPath('docsite.md')).toBe(false)
    expect(isAllowedDocPath('AGENTS-notes.md')).toBe(false)
  })

  test('extraAllow entries work', () => {
    expect(isAllowedDocPath('notes/TODO.md', ['notes/**'])).toBe(true)
    expect(isAllowedDocPath('NOTES.md', ['NOTES*'])).toBe(true)
    expect(isAllowedDocPath('internal/rules.md', ['internal/rules.md'])).toBe(true)
    expect(isAllowedDocPath('other/x.md', ['notes/**'])).toBe(false)
  })
})
