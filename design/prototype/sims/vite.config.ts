// Builds the simulation harness into one script and one stylesheet, so index.html opens from disk.
//   npx vite build -c design/prototype/sims/vite.config.ts
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  logLevel: 'warn',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'harness.ts'), formats: ['iife'], name: 'simHarness', fileName: () => 'harness.js', cssFileName: 'harness' },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
