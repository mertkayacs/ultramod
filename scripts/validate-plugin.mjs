// Validates ./plugin with the engine's own validator.
//
// The directory portal rejects a "types" field in plugin.json, so the shipped
// manifest has none. Claude Code's validator only learns the plugin's state
// keys (plugin/types/index.d.ts) from that field, so the check runs on a copy
// whose manifest names the contract. The copy is otherwise identical.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../plugin', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'ultramod-validate-'))
let status = 1
try {
  const copy = join(scratch, 'plugin')
  cpSync(source, copy, { recursive: true })
  const manifestPath = join(copy, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if ('types' in manifest) throw new Error('plugin.json must not declare "types"; this script adds it to the validated copy only.')
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, types: './types/index.d.ts' }, null, 2)}\n`)
  status = spawnSync('claude', ['plugin', 'validate', copy, '--strict'], { stdio: 'inherit' }).status ?? 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(status)
