/**
 * The mock Metabase on its own, for a dev copy of Tide (never the real one):
 *   npx vite-node test/helpers/serveMockMetabase.ts -- --port 9371
 */
import { startMockMetabase } from './mockMetabase'

const at = process.argv.indexOf('--port')
const port = at > 0 ? Number(process.argv[at + 1]) : 9371
const m = await startMockMetabase({ port })
console.log(`mock Metabase on ${m.url}, key ${m.key}`)
setInterval(() => {
  if (m.refused.length) console.log('refused:', JSON.stringify(m.refused.splice(0)))
}, 2000)
