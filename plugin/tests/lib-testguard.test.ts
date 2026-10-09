import { test, expect, describe } from 'claude-code/testing'
import { isTestPath, addedMarkers, assertionDrop, bashDeletesTests } from '../hooks/lib/testguard'

describe('isTestPath', () => {
  const TESTS: string[] = [
    'src/app.test.ts',
    'src/app.spec.tsx',
    'lib/parser.test.js',
    '__tests__/main.ts',
    'src/__tests__/util.ts',
    'tests/run.ts',
    'test/helper.ts',
    'src/tests/component.ts',
    'test_foo.py',
    'pkg/test_basics.py',
    'foo_test.py',
    'handler_test.go',
    'AppTest.java',
    'com/example/UserTests.java',
    'ServiceTests.cs',
    'user_spec.rb',
    'test.ts',
    'spec.ts',
    'foo_test.rs',
    'bar_test.cpp',
    'baz_test.cc',
    'test_qux.rs',
    'MyTest.kt',
    'MyTest.scala',
    'MyTest.groovy',
    'MyTest.swift',
    'MyTest.php',
  ]

  const NOT_TESTS: string[] = [
    'src/app.ts',
    'src/latest/util.ts',
    'src/contest/run.ts',
    'testing.md',
    'test.txt',
    'Test.java',
    'app.tests.ts',
    'README.md',
    'attest.py',
    'detest.go',
  ]

  test('matches test paths', () => {
    for (const p of TESTS) expect(isTestPath(p), p).toBe(true)
  })

  test('ignores look-alikes', () => {
    for (const p of NOT_TESTS) expect(isTestPath(p), p).toBe(false)
  })
})

describe('addedMarkers', () => {
  test('detects a new .skip(', () => {
    expect(addedMarkers('test("a", () => {})', 'test.skip("a", () => {})')).toEqual(['.skip('])
  })

  test('detects a new .only(', () => {
    expect(addedMarkers('it("a")', 'it.only("a")')).toEqual(['.only('])
  })

  test('detects xit( and xdescribe(', () => {
    expect(addedMarkers('it("a"); describe("b")', 'xit("a"); xdescribe("b")')).toEqual([
      'xit(',
      'xdescribe(',
    ])
  })

  test('detects python markers', () => {
    expect(addedMarkers('def test_a(): pass', '@pytest.mark.skip\ndef test_a(): pass')).toEqual([
      '@pytest.mark.skip',
    ])
    expect(addedMarkers('def test_a(): pass', '@pytest.mark.xfail\ndef test_a(): pass')).toEqual([
      '@pytest.mark.xfail',
    ])
    // skipif contains @pytest.mark.skip, and @unittest.skip( contains .skip(:
    // the edit is reported once, under the marker that names it.
    expect(addedMarkers('def test_a(): pass', '@pytest.mark.skipif(condition)\ndef test_a(): pass')).toEqual([
      '@pytest.mark.skipif',
    ])
    expect(addedMarkers('import unittest', 'import unittest\n@unittest.skip("x")\nclass T: pass')).toEqual([
      '@unittest.skip',
    ])
    // Both were genuinely added, so both are reported.
    expect(addedMarkers('def test_a(): pass', 'def test_a(): pass\n@unittest.skip("x")\n@unittest.skip("y")')).toEqual([
      '@unittest.skip',
    ])
    // One marker covers both calls, so it is reported once.
    expect(addedMarkers('test("a")', 'test("a"); test.skip("b"); it.skip("c")')).toEqual(['.skip('])
  })

  test('detects go, rust, java and ruby markers', () => {
    expect(addedMarkers('func TestA(t *testing.T) {}', 'func TestA(t *testing.T) { t.Skip("x") }')).toEqual([
      't.Skip(',
    ])
    expect(addedMarkers('#[test]\nfn a() {}', '#[test]\n#[ignore]\nfn a() {}')).toEqual(['#[ignore]'])
    expect(addedMarkers('@Test void a() {}', '@Disabled\n@Test void a() {}')).toEqual(['@Disabled'])
    expect(addedMarkers('@Test void a() {}', '@Ignore\n@Test void a() {}')).toEqual(['@Ignore'])
    expect(addedMarkers('@Test void a() {}', '@skip\n@Test void a() {}')).toEqual(['@skip'])
    expect(addedMarkers('it "a" do end', 'pending("todo")\nit "a" do end')).toEqual(['pending('])
  })

  test('no change gives nothing', () => {
    expect(addedMarkers('test.skip("a")', 'test.skip("a")')).toEqual([])
    expect(addedMarkers('it("a")', 'it("a")')).toEqual([])
  })

  test('removed markers are not added', () => {
    expect(addedMarkers('test.skip("a"); test.skip("b")', 'test.skip("a")')).toEqual([])
  })
})

describe('assertionDrop', () => {
  test('counts dropped expect calls', () => {
    expect(assertionDrop('expect(a).toBe(1)\nexpect(b).toBe(2)', 'expect(a).toBe(1)')).toBe(1)
  })

  test('counts assert and assertEquals', () => {
    expect(assertionDrop('assert(x); assertEquals(y, z)', 'assert(x)')).toBe(1)
  })

  test('counts should and require.', () => {
    expect(assertionDrop('x should equal 3', 'x is 3')).toBe(1)
    expect(assertionDrop('require.Equal(t, a, b)', 'a = b')).toBe(1)
  })

  test('no drop is 0', () => {
    expect(assertionDrop('expect(a)', 'expect(a)')).toBe(0)
    expect(assertionDrop('expect(a)', 'expect(a)\nexpect(b)')).toBe(0)
  })
})

describe('bashDeletesTests', () => {
  test('rm on a test file', () => {
    expect(bashDeletesTests('rm foo.test.ts')).toEqual(['foo.test.ts'])
  })

  test('rm of several, only test paths returned', () => {
    expect(bashDeletesTests('rm -rf src foo.test.ts README.md bar.spec.js')).toEqual([
      'foo.test.ts',
      'bar.spec.js',
    ])
  })

  test('git rm', () => {
    expect(bashDeletesTests('git rm foo.spec.ts')).toEqual(['foo.spec.ts'])
    expect(bashDeletesTests('git rm -f tests/')).toEqual(['tests/'])
  })

  test('unlink', () => {
    expect(bashDeletesTests('unlink pkg/foo_test.py')).toEqual(['pkg/foo_test.py'])
  })

  test('truncate -s 0', () => {
    expect(bashDeletesTests('truncate -s 0 app.test.ts')).toEqual(['app.test.ts'])
    expect(bashDeletesTests('truncate -s 100 app.test.ts')).toEqual([])
  })

  test('redirect that empties a test file', () => {
    expect(bashDeletesTests('echo x > app.test.ts')).toEqual(['app.test.ts'])
    expect(bashDeletesTests(': > app.test.ts')).toEqual(['app.test.ts'])
    expect(bashDeletesTests('echo x >> app.test.ts')).toEqual([])
  })

  test('compound commands are searched', () => {
    expect(bashDeletesTests('rm a.ts && rm b.test.ts')).toEqual(['b.test.ts'])
  })

  test('non-test deletions give nothing', () => {
    expect(bashDeletesTests('rm README.md')).toEqual([])
    expect(bashDeletesTests('rm -rf node_modules')).toEqual([])
  })
})

describe('addedMarkers parameterized modifiers (C56)', () => {
  test('detects .skip.each and .only.each', () => {
    expect(addedMarkers('test.each([1])("a", () => {})', 'test.skip.each([1])("a", () => {})')).toEqual(['.skip.each'])
    expect(addedMarkers('it.each([1])("a", () => {})', 'it.only.each([1])("a", () => {})')).toEqual(['.only.each'])
    expect(addedMarkers('describe.each([1])("a", () => {})', 'describe.skip.each([1])("a", () => {})')).toEqual(['.skip.each'])
  })

  test('detects the tagged template form', () => {
    expect(addedMarkers('test.each`a`("x", () => {})', 'test.skip.each`a`("x", () => {})')).toEqual(['.skip.each'])
  })

  test('an unchanged parameterized skip is not new', () => {
    expect(addedMarkers('test.skip.each([1])("a", f)', 'test.skip.each([1])("a", f)')).toEqual([])
  })
})

describe('bashDeletesTests option parsing (C57)', () => {
  test('operands after -- are paths even when they start with a dash', () => {
    expect(bashDeletesTests('rm -- -suite.test.ts')).toEqual(['-suite.test.ts'])
    expect(bashDeletesTests('rm -f -- a.ts -b.spec.ts')).toEqual(['-b.spec.ts'])
    expect(bashDeletesTests('git rm -- -x.test.ts')).toEqual(['-x.test.ts'])
  })

  test('flags before -- are still flags', () => {
    expect(bashDeletesTests('rm -rf -- foo.test.ts')).toEqual(['foo.test.ts'])
    expect(bashDeletesTests('rm -f README.md')).toEqual([])
  })
})

describe('bashDeletesTests git global options (C58)', () => {
  test('git -C and -c before rm', () => {
    expect(bashDeletesTests('git -C /repo rm tests/unit.test.ts')).toEqual(['tests/unit.test.ts'])
    expect(bashDeletesTests('git -c core.quotepath=off rm tests/unit.test.ts')).toEqual(['tests/unit.test.ts'])
  })

  test('long global options with a value or an equals sign', () => {
    expect(bashDeletesTests('git --git-dir /repo/.git --work-tree /repo rm foo.spec.ts')).toEqual(['foo.spec.ts'])
    expect(bashDeletesTests('git --git-dir=/repo/.git rm foo.spec.ts')).toEqual(['foo.spec.ts'])
    expect(bashDeletesTests('git --no-pager rm foo.spec.ts')).toEqual(['foo.spec.ts'])
  })

  test('other git subcommands are not deletions', () => {
    expect(bashDeletesTests('git -C /repo status tests/unit.test.ts')).toEqual([])
    expect(bashDeletesTests('git -C /repo add tests/unit.test.ts')).toEqual([])
  })
})

describe('bashDeletesTests truncating redirects (C59)', () => {
  test('2> and &> empty their target', () => {
    expect(bashDeletesTests('cmd 2> tests/unit.test.ts')).toEqual(['tests/unit.test.ts'])
    expect(bashDeletesTests('cmd 2>tests/unit.test.ts')).toEqual(['tests/unit.test.ts'])
    expect(bashDeletesTests('cmd &> tests/unit.test.ts')).toEqual(['tests/unit.test.ts'])
    expect(bashDeletesTests('cmd 3> app.test.ts')).toEqual(['app.test.ts'])
  })

  test('appending and fd duplication do not empty anything', () => {
    expect(bashDeletesTests('cmd 2>> app.test.ts')).toEqual([])
    expect(bashDeletesTests('cmd &>> app.test.ts')).toEqual([])
    expect(bashDeletesTests('cmd 2>&1')).toEqual([])
    expect(bashDeletesTests('cmd > out.log 2>&1')).toEqual([])
  })

  test('a redirect after rm is still checked', () => {
    expect(bashDeletesTests('rm a.ts 2> app.test.ts')).toEqual(['app.test.ts'])
  })
})
