// Refreshes the snapshot of the ad, tracker, cookie-banner and newsletter filter lists that ships
// with Tide (resources/adblock/lists.txt.gz), so the web view and the reader block offline from the
// first run (main/adblock fetches them again weekly once Tide is running). Run with `npm run adblock-lists`.
//
// EasyList and EasyPrivacy: GPL-3.0 or CC BY-SA 3.0 (https://easylist.to/pages/licence.html).
// EasyList Cookie List and Fanboy's Newsletter List: CC BY 3.0. See THIRD_PARTY_NOTICES.md.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { gzipSync } from 'zlib'

// Kept in step with FILTER_LISTS in src/main/adblock.ts
const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
  'https://secure.fanboy.co.nz/fanboy-newsletter.txt'
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'adblock', 'lists.txt.gz')
const texts = []
for (const url of LISTS) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  const t = await res.text()
  if (t.length < 10_000 || !/^(\[Adblock[^\]]*\]|!)/.test(t.trimStart())) throw new Error(`${url} isn't a filter list`)
  const version = t.match(/^! Version: (.+)$/m)?.[1] ?? '?'
  console.log(`${url}  ${Math.round(t.length / 1024)} KB  version ${version}`)
  texts.push(t)
}
mkdirSync(dirname(dest), { recursive: true })
const gz = gzipSync(texts.join('\n'), { level: 9 })
writeFileSync(dest, gz)
console.log(`Wrote ${dest} (${Math.round(gz.length / 1024)} KB)`)
