import { resolve } from 'path'
import { defineConfig } from 'vite'

/** For scripts/modules: the main process's modules outside Electron, with `electron` stubbed */
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, '../../src/shared'), electron: resolve(__dirname, 'electron-stub.ts') } }
})
