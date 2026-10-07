import { test, expect, describe } from 'claude-code/testing'
import * as lib from '../hooks/lib/index'
import {
  splitCommand,
  tokens,
  normalize,
  classifyCommand,
  isSecretPath,
  bashReadsSecret,
  isEnvDump,
  redactSecrets,
  isTestPath,
  addedMarkers,
  assertionDrop,
  bashDeletesTests,
  commandKind,
  claimsIn,
  isDocFile,
  isAllowedDocPath,
} from '../hooks/lib/index'

describe('index re-exports', () => {
  test('every public function is exported', () => {
    expect(lib.splitCommand).toBe(splitCommand)
    expect(lib.tokens).toBe(tokens)
    expect(lib.normalize).toBe(normalize)
    expect(lib.classifyCommand).toBe(classifyCommand)
    expect(lib.isSecretPath).toBe(isSecretPath)
    expect(lib.bashReadsSecret).toBe(bashReadsSecret)
    expect(lib.isEnvDump).toBe(isEnvDump)
    expect(lib.redactSecrets).toBe(redactSecrets)
    expect(lib.isTestPath).toBe(isTestPath)
    expect(lib.addedMarkers).toBe(addedMarkers)
    expect(lib.assertionDrop).toBe(assertionDrop)
    expect(lib.bashDeletesTests).toBe(bashDeletesTests)
    expect(lib.commandKind).toBe(commandKind)
    expect(lib.claimsIn).toBe(claimsIn)
    expect(lib.isDocFile).toBe(isDocFile)
    expect(lib.isAllowedDocPath).toBe(isAllowedDocPath)
  })

  test('smoke test through the barrel', () => {
    expect(classifyCommand('rm -rf /')?.id).toBe('rm-recursive')
    expect(splitCommand('a && b')).toEqual(['a', 'b'])
    expect(isSecretPath('.env')).toBe(true)
    expect(commandKind('npm test')).toBe('test')
    expect(claimsIn('all tests pass').tests).toBe(true)
  })
})
