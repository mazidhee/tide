import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
  // KaTeX's stylesheet is read as text by main/visualLibs (?raw): vitest would otherwise hand it over empty
  test: { environment: 'node', css: { include: [/katex\.min\.css/] } }
})
