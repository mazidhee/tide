/**
 * What is holding this Mac's memory, for Settings › Speed. The local model answers quickly only
 * while it is in memory: when other apps crowd it out, macOS compresses or swaps it and the next
 * answer waits while it comes back. Read only when the page asks (it takes about a second).
 */
import { execFile } from 'child_process'
import { totalmem } from 'os'
import type { MacMemory } from '@shared/types'

const run = (cmd: string, args: string[]) => new Promise<string>((done) => execFile(cmd, args, { timeout: 8000 }, (_e, out) => done(String(out ?? ''))))

/** "11G", "656M", "8448K" → bytes */
const bytes = (s: string) => {
  const m = /^([\d.]+)([KMG])/.exec(s.trim())
  return m ? Number(m[1]) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2] as 'K' | 'M' | 'G'] : 0
}

/** Helpers and renderers belong to their app; the Linux VM is Docker's */
function appName(command: string): string {
  if (/^com\.apple\.Virtua/.test(command)) return 'Docker (its Linux VM)'
  if (/^(Python|python)/.test(command)) return 'Python'
  return command.replace(/\s+(Helper|Renderer|Web|\().*$/i, '').replace(/\s+Helper$/i, '').trim() || command
}

export async function macMemory(): Promise<MacMemory> {
  const [top, swap, pids] = await Promise.all([run('top', ['-l', '1', '-o', 'mem', '-n', '60', '-stats', 'pid,mem,cmprs,command']), run('sysctl', ['-n', 'vm.swapusage']), run('pgrep', ['-f', 'mlx_vlm|mlx_lm|llama-server'])])
  const model = new Set(pids.split(/\s+/).filter(Boolean))
  const apps = new Map<string, number>()
  let modelBytes = 0
  let modelSqueezed = 0
  for (const line of top.split('\n')) {
    const m = /^(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line.trim())
    if (!m) continue
    const size = bytes(m[2])
    if (model.has(m[1])) {
      modelBytes += size
      modelSqueezed += bytes(m[3])
    } else apps.set(appName(m[4]), (apps.get(appName(m[4])) ?? 0) + size)
  }
  return {
    total: totalmem(),
    swapUsed: bytes((/used = (\S+)/.exec(swap)?.[1] ?? '0M').replace(/\.\d+/, '')),
    model: modelBytes,
    modelSqueezed,
    apps: [...apps.entries()].map(([name, size]) => ({ name, bytes: size })).sort((a, b) => b.bytes - a.bytes).slice(0, 6)
  }
}
