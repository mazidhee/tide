// Fetches the PDFium library Tide reads PDF text with (macOS, Apple silicon) into native/pdfium:
// a prebuilt release of PDFium, pinned by version and checked against its SHA-256 before anything
// is unpacked. The library itself is not kept in git. Run with `npm run pdfium`.
//
// Builds: https://github.com/bblanchon/pdfium-binaries (MIT; PDFium itself is BSD-3-Clause and
// Apache-2.0, with its bundled libraries' licences in the archive, copied to native/pdfium/licenses).
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const VERSION = 'chromium/8125'
const ASSET = 'pdfium-mac-arm64.tgz'
const SHA256 = '4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d'
const URL = `https://github.com/bblanchon/pdfium-binaries/releases/download/${VERSION}/${ASSET}`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'native', 'pdfium')
const stamp = join(dest, 'VERSION.txt')

if (existsSync(join(dest, 'libpdfium.dylib')) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${VERSION} ${SHA256}`) {
  console.log(`PDFium ${VERSION} is already in native/pdfium`)
  process.exit(0)
}

console.log(`Fetching PDFium ${VERSION}…`)
const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok) throw new Error(`${URL} answered ${res.status}`)
const data = Buffer.from(await res.arrayBuffer())
const sum = createHash('sha256').update(data).digest('hex')
if (sum !== SHA256) throw new Error(`PDFium's checksum is wrong: expected ${SHA256}, got ${sum}. Nothing was unpacked.`)

const work = mkdtempSync(join(tmpdir(), 'tide-pdfium-'))
try {
  writeFileSync(join(work, ASSET), data)
  execFileSync('tar', ['-xzf', join(work, ASSET), '-C', work, 'lib/libpdfium.dylib', 'LICENSE', 'licenses'])
  mkdirSync(dest, { recursive: true })
  rmSync(join(dest, 'licenses'), { recursive: true, force: true })
  cpSync(join(work, 'lib', 'libpdfium.dylib'), join(dest, 'libpdfium.dylib'))
  cpSync(join(work, 'LICENSE'), join(dest, 'LICENSE-pdfium-binaries.txt'))
  cpSync(join(work, 'licenses'), join(dest, 'licenses'), { recursive: true })
  writeFileSync(stamp, `${VERSION} ${SHA256}\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`PDFium ${VERSION} is in native/pdfium (checksum ${SHA256.slice(0, 12)}… verified)`)
