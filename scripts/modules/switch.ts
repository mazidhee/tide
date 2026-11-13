/**
 * Switch a vault to modules, or back, from the command line: the same functions the "Switch to
 * modules" and "Switch back" buttons run (main/modules verifiedSwitch and switchBack).
 *
 *   npx vite-node -c scripts/modules/vite.config.ts scripts/modules/switch.ts -- --vault <vault> --source <dir with Modules, Tracks, Projects, _moves.json>
 *   … -- --vault <vault> --preview      what would move, nothing written
 *   … -- --vault <vault> --back         switch back (restores the backup, keeps what was learnt since)
 *
 * Quit Tide first (or point it at another vault): the knowledge map and the log are files Tide keeps open.
 * Prints the verification summary as JSON; exits 1 when it isn't clean.
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}

export async function switchVault(vaultRoot: string, sourceDir?: string) {
  useVault(vaultRoot)
  const m = await import('../../src/main/modules')
  return m.verifiedSwitch(sourceDir ? { sourceDir: resolve(sourceDir) } : {})
}

export async function switchVaultBack(vaultRoot: string) {
  useVault(vaultRoot)
  const m = await import('../../src/main/modules')
  return m.switchBack()
}

export async function previewVault(vaultRoot: string, sourceDir?: string) {
  useVault(vaultRoot)
  const m = await import('../../src/main/modules')
  if (sourceDir) await m.installModules(resolve(sourceDir))
  return m.switchPreview()
}

function useVault(vault: string) {
  const root = resolve(vault)
  if (!existsSync(root)) throw new Error(`No vault at ${root}`)
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ vaultPath: root }))
}

async function main() {
  const vault = opt('vault')
  if (!vault) {
    console.error('Give the vault: --vault <path>')
    process.exit(2)
  }
  const source = opt('source')
  const out = flag('back') ? await switchVaultBack(vault) : flag('preview') ? await previewVault(vault, source) : await switchVault(vault, source)
  console.log(JSON.stringify(out, null, 2))
  await import('../../src/main/learningLog').then((l) => l.close()).catch(() => {})
  if ('ok' in out && !out.ok) process.exit(1)
}

if (!process.env.VITEST) void main().catch((e) => (console.error((e as Error).message), process.exit(1)))
