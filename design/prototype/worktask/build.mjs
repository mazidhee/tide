// Bundles the harness with the app's components, their useApp swapped for ./state.tsx
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
await build({
  entryPoints: [join(here, 'harness.tsx')],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  outfile: join(here, 'harness.js'),
  alias: { '@shared': join(root, 'src/shared') },
  // Vite's import.meta (env, glob) as an empty stand-in
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta': 'globalThis.__viteMeta' },
  banner: { js: 'globalThis.__viteMeta = { env: {}, glob: () => ({}), url: location.href };' },
  loader: { '.ttf': 'file', '.woff2': 'file', '.woff': 'file', '.md': 'text', '.txt': 'text' },
  logLevel: 'error',
  plugins: [
    // Vite-only imports (workers, asset URLs) the screens shot here never reach
    { name: 'vite-only', setup: (b) => (b.onResolve({ filter: /\?(worker|url|raw)$/ }, (a) => ({ path: a.path, namespace: 'stub' })), b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: a.path.endsWith('?worker') ? 'export default class {}' : 'export default ""', loader: 'js' }))) },
    { name: 'state', setup: (b) => b.onResolve({ filter: /^\.\.?\/(\.\.\/)*state$/ }, (a) => (a.importer.includes('/src/renderer/') ? { path: join(here, 'state.tsx') } : undefined)) }
  ]
})
