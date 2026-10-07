import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = join(root, 'plugin/.claude-plugin/types/claude-code/index.d.ts')
const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0]
const header = `// Written by Claude Code ${version}.`

if (existsSync(target)) {
  const firstLine = readFileSync(target, 'utf8').split('\n')[0]
  if (firstLine !== header) {
    throw new Error(`Engine declarations do not match Claude Code ${version}. Regenerate plugin/.claude-plugin/types with the installed engine.`)
  }
  process.stdout.write(`Using Claude Code ${version} declarations.\n`)
  process.exit(0)
}

if (typeof zlib.zstdDecompressSync !== 'function') {
  throw new Error('Type generation requires Node 22.15 or later. Existing engine declarations work with older Node versions.')
}

const executable = (process.env.PATH ?? '').split(delimiter).map(directory => join(directory, 'claude')).find(path => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
})
if (!executable) throw new Error('Claude Code was not found on PATH.')

const binary = readFileSync(realpathSync(executable))
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
let declarations

// Validate and test do not lay types, so recover the installed engine's own resource.
for (let offset = binary.indexOf(magic); offset !== -1; offset = binary.indexOf(magic, offset + magic.length)) {
  try {
    const text = zlib.zstdDecompressSync(binary.subarray(offset), { maxOutputLength: 5 * 1024 * 1024 }).toString('utf8')
    if (text.startsWith('// Claude Code function hooks:') && text.includes("declare module 'claude-code/testing'")) {
      declarations = text
      break
    }
  } catch {
    // The frame magic can also occur in unrelated binary data.
  }
}

if (!declarations) {
  throw new Error(`No mods declaration resource found in Claude Code ${version}. Its native packaging changed; regenerate types with an engine load before typechecking.`)
}
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${header}\n${declarations}`)
process.stdout.write(`Generated Claude Code ${version} declarations from the installed engine.\n`)
