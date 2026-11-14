#!/usr/bin/env node
/**
 * The visual gallery: runs Tide's kit visuals (shared/kitVisuals), or any visual files you name, in
 * the real sandboxed frame in a hidden Electron window, light and dark, audits each the way Tide
 * does (errors, overlapping labels) and saves a screenshot of each.
 *
 *   node scripts/visuals/gallery.mjs --out /tmp/shots                 the kit visuals, at the steps that matter
 *   node scripts/visuals/gallery.mjs --out /tmp/shots --only cpu      those whose name contains cpu
 *   node scripts/visuals/gallery.mjs --out /tmp/shots --file a.html[:step] --name part-x
 *
 * Nothing in the app, your vault or your settings is touched.
 */
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const out = resolve(opt('--out') || join(tmpdir(), 'tide-gallery'))
mkdirSync(out, { recursive: true })

const work = mkdtempSync(join(tmpdir(), 'tide-gallery-build-'))
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  resolve: { alias: { '@shared': join(root, 'src/shared'), '@renderer': join(root, 'src/renderer/src') } },
  build: { outDir: work, emptyOutDir: true, minify: false, lib: { entry: join(root, 'scripts/visuals/harness.ts'), formats: ['cjs'], fileName: () => 'harness.cjs' } }
})
const H = await import(join(work, 'harness.cjs'))
const kit = (H.default ?? H).KIT_VISUALS
const code = (id) => kit.find((v) => v.id === id).code

/** The shots the gallery takes of the kit: the states worth checking by eye */
const KIT_SHOTS = [
  { name: 'binary-bulbs', code: code('binary-place-value') },
  { name: 'twos-complement', code: code('twos-complement'), step: 2 },
  { name: 'hex', code: code('hexadecimal'), step: 3 },
  { name: 'half-adder', code: code('half-adder'), step: 2 },
  { name: 'full-adder', code: code('full-adder'), step: 3 },
  { name: 'ripple-carry-mid', code: code('ripple-carry-adder'), step: 3 },
  { name: 'ripple-carry', code: code('ripple-carry-adder'), step: 20 },
  { name: 'mux', code: code('multiplexer') },
  { name: 'cpu-step1', code: code('fetch-decode-execute'), step: 1 },
  { name: 'cpu-step2', code: code('fetch-decode-execute'), step: 2 },
  { name: 'cpu-step3', code: code('fetch-decode-execute'), step: 3 },
  { name: 'cpu-add', code: code('fetch-decode-execute'), step: 9 },
  { name: 'memory-little-endian', code: code('memory-bytes'), step: 3 },
  { name: 'python-list-alias', code: code('python-names-objects'), step: 4 },
  { name: 'python-factorial', code: code('python-call-frames'), step: 10 },
  { name: 'python-int', code: code('python-int-storage'), step: 3 },
  { name: 'die-overview', code: code('cpu-die-caches'), step: 0, wait: 1800 },
  { name: 'die-cache-miss', code: code('cpu-die-caches'), step: 6, wait: 1800 },
  { name: 'gpu-warp', code: code('gpu-sms-warps'), step: 3, wait: 1800 }
]

let shots = KIT_SHOTS
const files = argv.filter((a, i) => argv[i - 1] === '--file')
if (files.length) {
  const name = opt('--name') || 'file'
  shots = files.flatMap((f) => {
    const [path, steps] = f.split(':')
    const text = readFileSync(path, 'utf8')
    return (steps ? steps.split(',').map(Number) : [0]).map((s) => ({ name: `${name}${steps ? `-s${s}` : ''}`, code: text, step: s, wait: 2200 }))
  })
}
const only = opt('--only')
if (only) shots = shots.filter((s) => s.name.includes(only))

const electron = join(root, 'node_modules/.bin/electron')
const r = spawnSync(electron, [join(root, 'scripts/visuals/gallery-main.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, TIDE_GALLERY: JSON.stringify({ bundle: join(work, 'harness.cjs'), shots, out, tracer: join(root, 'src/main/pyTrace.py'), themes: (opt('--themes') || 'light,dark').split(','), report: join(out, 'gallery-report.json'), width: Number(opt('--width') || 700) }) }
})
process.exit(r.status ?? 1)
