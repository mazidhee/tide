/**
 * Language servers for the IDE, beyond Python's (main/pythonLanguageServer): TypeScript and
 * JavaScript (typescript-language-server, shipped with Tide), and rust-analyzer, clangd and gopls
 * when they're installed on this Mac. One server per language and workspace, started when the
 * first file of its language opens and stopped a few minutes after the last closes, so the IDE
 * opens as fast as before and only pays for the languages in use. The protocol work is
 * main/lspHost's; this file finds the servers and carries messages to and from the window.
 */
import { ipcMain, type WebContents } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, sep } from 'path'
import { pathToFileURL } from 'url'
import type { LspServerId, LspServerInfo } from '@shared/ide'
import { LanguageServerHost, type Message } from '../lspHost'
import { initializeParams as pythonInitParams } from '../pythonLanguageServer'
import { allowed } from './workspace'

const IDLE_MS = 5 * 60_000

interface Found {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  initializationOptions?: Record<string, unknown>
}

interface ServerDef {
  id: LspServerId
  name: string
  languages: string[]
  install: string
  find(): Promise<Found | null>
}

const unpacked = (p: string) => p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
const home = homedir()

/** Runs `cmd --version`; true when it answers (rustup's stand-in for a missing component doesn't) */
function answers(cmd: string, args = ['--version']): Promise<boolean> {
  return new Promise((res) => {
    if (!existsSync(cmd)) return res(false)
    execFile(cmd, args, { timeout: 4000 }, (err) => res(!err))
  })
}

async function firstWorking(paths: string[]): Promise<string | null> {
  for (const p of paths) if (await answers(p)) return p
  return null
}

function xcrun(tool: string): Promise<string | null> {
  return new Promise((res) => execFile('/usr/bin/xcrun', ['-f', tool], { timeout: 4000 }, (err, out) => res(err ? null : out.trim() || null)))
}

export const SERVERS: ServerDef[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    languages: ['typescript', 'javascript'],
    install: 'Ships with Tide.',
    async find() {
      try {
        const cli = unpacked(require.resolve('typescript-language-server/lib/cli.mjs'))
        const tsserver = unpacked(require.resolve('typescript/lib/tsserver.js'))
        return {
          command: process.execPath,
          args: ['--max-old-space-size=2048', cli, '--stdio'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
          initializationOptions: {
            hostInfo: 'tide',
            tsserver: { path: tsserver },
            preferences: { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true, importModuleSpecifierPreference: 'shortest', quotePreference: 'auto' }
          }
        }
      } catch {
        return null
      }
    }
  },
  {
    id: 'rust',
    name: 'rust-analyzer',
    languages: ['rust'],
    install: 'Install it with: rustup component add rust-analyzer',
    async find() {
      const p = await firstWorking([join(home, '.cargo/bin/rust-analyzer'), '/opt/homebrew/bin/rust-analyzer', '/usr/local/bin/rust-analyzer'])
      return p ? { command: p, args: [], env: { PATH: `${join(home, '.cargo/bin')}:/opt/homebrew/bin:/usr/bin:/bin` } } : null
    }
  },
  {
    id: 'clangd',
    name: 'clangd',
    languages: ['c', 'cpp'],
    install: 'Comes with Xcode’s command line tools: xcode-select --install',
    async find() {
      const p = (await firstWorking(['/opt/homebrew/opt/llvm/bin/clangd', '/opt/homebrew/bin/clangd', '/usr/local/bin/clangd'])) ?? (await xcrun('clangd'))
      return p ? { command: p, args: ['--background-index=false', '--header-insertion=never', '--log=error'] } : null
    }
  },
  {
    // Foundry's own language server (built on Solar): diagnostics, completion, hover and go-to-definition for Solidity
    id: 'solidity',
    name: 'Solidity (forge lsp)',
    languages: ['sol'],
    install: 'Install the Foundry pack in Settings › Tools.',
    async find() {
      const { foundryBin, forgeStd } = await import('../packs/paths')
      const forge = foundryBin('forge')
      if (!(await answers(forge))) return null
      // forge-std comes from Tide's tools folder unless the project has its own lib/forge-std
      return { command: forge, args: ['lsp', '--stdio'], env: { FOUNDRY_OFFLINE: 'true', FOUNDRY_SOLC: foundryBin('solc'), FOUNDRY_REMAPPINGS: `forge-std/=${forgeStd()}/`, NO_COLOR: '1' } }
    }
  },
  {
    id: 'go',
    name: 'gopls',
    languages: ['go'],
    install: 'Install it with: go install golang.org/x/tools/gopls@latest',
    async find() {
      const p = await firstWorking([join(home, 'go/bin/gopls'), '/opt/homebrew/bin/gopls', '/usr/local/bin/gopls', '/usr/local/go/bin/gopls'])
      return p ? { command: p, args: ['serve'], env: { PATH: `${join(home, 'go/bin')}:/opt/homebrew/bin:/usr/local/go/bin:/usr/bin:/bin` } } : null
    }
  }
]

const found = new Map<LspServerId, Promise<Found | null>>()
const findServer = (d: ServerDef) => {
  let f = found.get(d.id)
  if (!f) {
    found.set(d.id, (f = d.find()))
    // One that wasn't there is looked for again next time: a pack may have been installed since
    void f.then((x) => !x && found.get(d.id) === f && found.delete(d.id))
  }
  return f
}

/** After a pack is installed: every server is looked for again */
export const forgetServers = () => found.clear()

export async function serverInfo(): Promise<LspServerInfo[]> {
  return Promise.all(
    SERVERS.map(async (d) => {
      const f = await findServer(d)
      return { id: d.id, name: d.name, languages: d.languages, available: !!f, ...(f ? { command: f.command === process.execPath ? 'bundled' : f.command } : { install: d.install }) }
    })
  )
}

/** What the client can do: Python's set, and formatting, which the IDE uses on save */
export function initializeParams(root: string, options?: Record<string, unknown>) {
  const p = pythonInitParams(root)
  const uri = pathToFileURL(root).toString()
  const name = root.split('/').pop() || 'project'
  return {
    ...p,
    clientInfo: { name: 'Tide' },
    rootUri: uri,
    rootPath: root,
    workspaceFolders: [{ uri, name }],
    initializationOptions: options ?? {},
    capabilities: {
      ...p.capabilities,
      textDocument: {
        ...p.capabilities.textDocument,
        formatting: {},
        rangeFormatting: {},
        codeAction: { ...p.capabilities.textDocument.codeAction, resolveSupport: { properties: ['edit'] }, dataSupport: true }
      }
    }
  }
}

interface Live {
  host: LanguageServerHost
  owner: WebContents | null
}

const hosts = new Map<string, Live>()

/** "typescript|/path/to/project" */
export function parseKey(key: string): { id: LspServerId; root: string } | null {
  const i = String(key ?? '').indexOf('|')
  if (i < 0) return null
  const id = key.slice(0, i) as LspServerId
  if (!SERVERS.some((s) => s.id === id)) return null
  return { id, root: key.slice(i + 1) }
}

async function hostFor(key: string): Promise<Live | null> {
  const live = hosts.get(key)
  if (live) return live
  const k = parseKey(key)
  if (!k) return null
  const root = allowed(k.root)
  const def = SERVERS.find((s) => s.id === k.id)!
  const f = await findServer(def)
  if (!f) return null
  if (hosts.has(key)) return hosts.get(key)!
  const entry: Live = { host: null as unknown as LanguageServerHost, owner: null }
  entry.host = new LanguageServerHost({
    idleMs: IDLE_MS,
    spawn: () => spawn(f.command, f.args, { cwd: root, env: { ...process.env, ...f.env }, stdio: ['pipe', 'pipe', 'ignore'] }),
    initializeParams: () => initializeParams(root, f.initializationOptions),
    configuration: (items) => items.map(() => null),
    onMessage: (msg) => {
      if (entry.owner && !entry.owner.isDestroyed()) entry.owner.send('ide:lsp:message', { key, msg })
    },
    log: (line) => console.warn(`[${def.id}-lsp]`, line)
  })
  hosts.set(key, entry)
  return entry
}

export function registerLanguageServers(): void {
  ipcMain.on('ide:lsp:send', (e, key: string, msg: Message) => {
    void hostFor(key)
      .then((live) => {
        if (!live) {
          // No server: the window's request gets an answer at once instead of a timeout
          if (msg.id !== undefined && msg.id !== null && msg.method && !e.sender.isDestroyed()) e.sender.send('ide:lsp:message', { key, msg: { jsonrpc: '2.0', id: msg.id, error: { code: -32097, message: 'No language server' } } })
          return
        }
        if (live.owner !== e.sender) {
          if (live.owner) live.host.closeAll()
          live.owner = e.sender
          e.sender.once('destroyed', () => {
            if (live.owner === e.sender) {
              live.owner = null
              live.host.closeAll()
            }
          })
        }
        live.host.send(msg)
      })
      .catch((err) => console.warn('[ide-lsp]', (err as Error).message))
  })
  ipcMain.handle('ide:lsp:servers', () => serverInfo())
  ipcMain.handle('ide:lsp:status', () => [...hosts].map(([key, l]) => ({ key, state: l.host.state })))
}

export async function stopLanguageServers(): Promise<void> {
  await Promise.all([...hosts.values()].map((l) => l.host.stop(1000)))
  hosts.clear()
}
