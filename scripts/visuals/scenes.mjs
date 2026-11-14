#!/usr/bin/env node
/**
 * Pre-generates each module part's big picture (a 3D scene) into a vault, as the app would on
 * first use: the visual model (Fable by default) writes it through your `claude -p`, it runs in
 * the real frame in a hidden window (light and dark) and must load, draw, render its canvas and
 * keep its labels apart; a failure goes back once for repair; what passes is kept at
 * <vault>/.tide/visuals/parts/<module>#<part>.html. A part that already has a good one is skipped.
 *
 *   node scripts/visuals/scenes.mjs --vault "<vault>"                       the current stage's modules
 *   node scripts/visuals/scenes.mjs --vault "<vault>" --modules python-core --parts 1,2
 *   ... --force          write them again        ... --model claude-opus-4-8   another model
 *   ... --shots <dir>    save screenshots (viz-part-<module>-<part>-s<step>-<theme>.png)
 *   ... --dry            say what it would do
 *
 * It writes only inside <vault>/.tide/visuals/parts. Nothing else in the vault or app is touched.
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const vault = opt('--vault')
if (!vault || !existsSync(join(vault, 'Roadmaps/Modules'))) {
  console.error('Give --vault: a vault with Roadmaps/Modules.')
  process.exit(2)
}
/** The learner's current stage */
const STAGE = ['computation-foundations', 'numbers-and-proof', 'python-core']

const work = mkdtempSync(join(tmpdir(), 'tide-scenes-build-'))
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  resolve: { alias: { '@shared': join(root, 'src/shared'), '@renderer': join(root, 'src/renderer/src') } },
  build: { outDir: work, emptyOutDir: true, minify: false, lib: { entry: join(root, 'scripts/visuals/harness.ts'), formats: ['cjs'], fileName: () => 'harness.cjs' } }
})

const r = spawnSync(join(root, 'node_modules/.bin/electron'), [join(root, 'scripts/visuals/scenes-main.cjs')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TIDE_SCENES: JSON.stringify({
      bundle: join(work, 'harness.cjs'),
      vault: resolve(vault),
      modules: (opt('--modules') || STAGE.join(',')).split(',').map((s) => s.trim()).filter(Boolean),
      parts: opt('--parts') ? opt('--parts').split(',').map(Number) : null,
      force: argv.includes('--force'),
      dry: argv.includes('--dry'),
      model: opt('--model'),
      shots: opt('--shots') ? resolve(opt('--shots')) : null,
      claude: opt('--claude') || 'claude',
      tracer: join(root, 'src/main/pyTrace.py')
    })
  }
})
process.exit(r.status ?? 1)
