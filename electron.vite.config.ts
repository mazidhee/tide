import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict CSP for packaged builds. Dev needs inline scripts for React fast refresh, so it's build only.
// 'wasm-unsafe-eval' lets compiled WebAssembly run (Ruff, the Python linter, in the code editor's
// worker). It does not allow JavaScript eval or new Function.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' vault: data: https:; " +
  "font-src 'self' data:; connect-src 'self' vault:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
  "worker-src 'self' blob:; media-src 'self' vault: https:"

const cspPlugin = (): Plugin => ({
  name: 'tide-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), cspPlugin()]
  }
})
