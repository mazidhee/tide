// Builds the simulation harness into one script and one stylesheet, so index.html opens from disk.
//   npx vite build -c design/prototype/sims/vite.config.ts
// SIM_DIST=dist-raft builds into another folder; open index.html?dist=dist-raft to use it.
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@shared': resolve(__dirname, '../../../src/shared') } },
  logLevel: 'warn',
  build: {
    outDir: resolve(__dirname, process.env.SIM_DIST ?? 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'harness.ts'), formats: ['iife'], name: 'simHarness', fileName: () => 'harness.js', cssFileName: 'harness' },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
