/**
 * Pictures go to Claude (main/imagePrep, main/claudeCli, main/ai claudeOr, main/exam): a photo of
 * handwritten working, a screenshot, a note's diagram is scaled down, sent as a stream-json image
 * block, and marked on Claude's marking model; Gemma takes it when Claude can't (its limit,
 * offline) or the work is private. Against a stand-in `claude` and a fake mlx-vlm server, never
 * the real ones.
 */
import { execFileSync } from 'child_process'
import { createServer, type Server } from 'http'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { deflateSync } from 'zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-images-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd(), on: () => {}, isPackaged: false }, net: { isOnline: () => true } }))
const settings = { vaultPath: dir, libraryFolder: 'Library', ai: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma', temperature: 0.3, autoStart: false, unloadAfterMinutes: 15, claude: {} } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/projects', async (orig) => ({ ...(await orig<object>()), privatePath: async (p: string) => p.startsWith('Secret') }))
vi.mock('../src/main/learn', async (orig) => ({ ...(await orig<object>()), getNotebooks: async () => [{ path: 'Secret', name: 'Secret', project: { private: true, docs: [] } }] }))

const policy = await import('../src/shared/gemmaPolicy')
const idle = await import('../src/main/modelIdle')
const ai = await import('../src/main/ai')
const engine = await import('../src/main/claudeEngine')
const cli = await import('../src/main/claudeCli')
const prep = await import('../src/main/imagePrep')
const exam = await import('../src/main/exam')
const { PREFIX_CACHE } = await import('../src/main/modelServer')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude-job.mjs'))

// ---------- Pictures to send ----------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b: Buffer) => {
  let c = ~0
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8)
  return ~c >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
/** A grey PNG of this size (a stripe through it, so it isn't blank) */
function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height, 255)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    if (y % 7 === 0) raw.fill(0, y * (width + 1) + 1, (y + 1) * (width + 1))
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const dataUrl = (b: Buffer, type = 'image/png') => `data:${type};base64,${b.toString('base64')}`
const mac = process.platform === 'darwin'
/** The same picture through sips, as another format */
function asFormat(b: Buffer, format: 'jpeg' | 'heic'): Buffer {
  const d = mkdtempSync(join(tmpdir(), 'tide-img-test-'))
  const src = join(d, 'in.png')
  const out = join(d, `out.${format}`)
  writeFileSync(src, b)
  execFileSync('/usr/bin/sips', ['-s', 'format', format, src, '--out', out], { stdio: 'ignore' })
  return readFileSync(out)
}

describe('stream-json messages with pictures', () => {
  it('builds the user line the CLI takes: image blocks first, then the words', () => {
    const line = cli.userLine(cli.userContent('What number is this?', [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]))
    expect(JSON.parse(line)).toMatchInlineSnapshot(`
      {
        "message": {
          "content": [
            {
              "source": {
                "data": "iVBORw0KGgo=",
                "media_type": "image/png",
                "type": "base64",
              },
              "type": "image",
            },
            {
              "text": "What number is this?",
              "type": "text",
            },
          ],
          "role": "user",
        },
        "type": "user",
      }
    `)
    expect(line.endsWith('}\n')).toBe(true)
  })
  it('keeps a message without pictures as plain words', () => {
    expect(cli.userContent('hello')).toBe('hello')
    expect(cli.userLine(cli.userContent('hello', []))).toBe('{"type":"user","message":{"role":"user","content":"hello"}}\n')
  })
  it('asks for stream-json in and out only when there are pictures, with the same isolation flags', () => {
    const plain = cli.onceArgs('haiku', 'S', false)
    const pics = cli.onceArgs('haiku', 'S', true)
    expect(plain).toEqual(['-p', '--model', 'haiku', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', '--system-prompt', 'S'])
    expect(pics).toEqual(['-p', '--model', 'haiku', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', '--system-prompt', 'S'])
  })
})

describe('making pictures ready', () => {
  it('reads the type and size from the bytes', () => {
    const p = png(300, 200)
    expect(prep.sniffMime(p)).toBe('image/png')
    expect(prep.imageSize(p)).toEqual({ width: 300, height: 200 })
    expect(prep.sniffMime(Buffer.from('not a picture at all'))).toBeNull()
  })
  it('fits the long edge within 1568 px, keeping the shape and never enlarging', () => {
    expect(prep.fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176 })
    expect(prep.fitWithin(1000, 3000)).toEqual({ width: 523, height: 1568 })
    expect(prep.fitWithin(196, 124)).toEqual({ width: 196, height: 124 })
  })
  it('sends a small PNG as it is, from bytes or a data: URL', async () => {
    const p = png(196, 124)
    expect(prep.needsConverting(p)).toBe(false)
    expect(await prep.prepareImage(p)).toEqual({ mediaType: 'image/png', data: p.toString('base64') })
    expect(await prep.prepareImage(dataUrl(p))).toEqual({ mediaType: 'image/png', data: p.toString('base64') })
    expect(await prep.prepareImage('data:text/plain;base64,aGVsbG8gdGhlcmUgaGVsbG8=')).toBeNull()
  })
  it.runIf(mac)('scales a large photo down to a JPEG of at most 1568 px', async () => {
    const big = png(3000, 1500)
    expect(prep.needsConverting(big)).toBe(true)
    const out = (await prep.prepareImage(big))!
    expect(out.mediaType).toBe('image/jpeg')
    expect(prep.imageSize(Buffer.from(out.data, 'base64'))).toEqual({ width: 1568, height: 784 })
  })
  it.runIf(mac)('reads a JPEG’s size and turns an iPhone HEIC into a JPEG, without enlarging it', async () => {
    const jpeg = asFormat(png(640, 480), 'jpeg')
    expect(prep.sniffMime(jpeg)).toBe('image/jpeg')
    expect(prep.imageSize(jpeg)).toEqual({ width: 640, height: 480 })
    const heic = asFormat(png(400, 300), 'heic')
    expect(prep.sniffMime(heic)).toBe('image/heic')
    const out = (await prep.prepareImage(heic))!
    expect(out.mediaType).toBe('image/jpeg')
    expect(prep.imageSize(Buffer.from(out.data, 'base64'))).toEqual({ width: 400, height: 300 })
  })
  it('sends at most a few per message, skipping what isn’t a picture', async () => {
    const p = png(20, 20)
    expect(await prep.prepareImages([p, Buffer.from('nope, not one'), p, p, p, p, p])).toHaveLength(prep.MAX_IMAGES)
    expect(await prep.prepareImages([p, p, p], 2)).toHaveLength(2)
  })
  it('gives up on a picture it can’t make small enough', async () => {
    const was = prep.setImageConverter(async () => Buffer.alloc(prep.MAX_BYTES + 1, 0xff))
    try {
      expect(await prep.prepareImage(png(4000, 10))).toBeNull()
    } finally {
      prep.setImageConverter(was)
    }
  })
})

// ---------- A fake mlx-vlm server, for Gemma's side ----------

const fake = { loaded: false, chats: 0, lastBody: '' }
let server: Server
beforeAll(async () => {
  server = createServer((req, res) => {
    const json = (o: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)))
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const url = req.url ?? ''
      if (url === '/v1/settings' && req.method === 'GET') return json({ current: { ...PREFIX_CACHE } })
      if (url === '/v1/settings') return json({ ok: true })
      if (url === '/v1/models') return json({ data: [{ id: 'gemma' }] })
      if (url === '/health') return json({ loaded_model: fake.loaded ? 'gemma' : null })
      if (url === '/v1/metrics') return json({ summary: { in_flight: 0, last_request_at: 0 } })
      if (url.endsWith('/chat/completions')) {
        fake.chats++
        fake.loaded = true
        fake.lastBody = body
        const pics = (body.match(/"type":"image_url"/g) ?? []).length
        const text = body.includes('Mark scheme') ? JSON.stringify({ awarded: 1, feedback: `gemma saw ${pics}`, missed: 'x' }) : `gemma: ok, saw ${pics}`
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
        return res.end('data: [DONE]\n\n')
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  settings.ai.baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
afterAll(() => server?.close())

const claudeIs = async (s: { main: boolean; why?: import('../src/shared/gemmaPolicy').GemmaReason }) => {
  idle.setClaudeProbe(async () => s)
  await idle.refreshClaude()
}
beforeEach(async () => {
  Object.assign(fake, { loaded: false, chats: 0, lastBody: '' })
  idle.setGemmaWarmer(async () => {})
  await claudeIs({ main: false, why: 'no-claude' })
})

describe('routing pictures', () => {
  it('marks photos of handwriting on Claude’s marking model, unless private, Metabase or Claude can’t', () => {
    expect(policy.JOB_ROUTES.handwriting.role).toBe('mark')
    expect(policy.routeJob('handwriting', { claude: { main: true } })).toEqual({ who: 'claude', role: 'mark' })
    expect(policy.routeJob('handwriting', { claude: { main: true }, private: true })).toEqual({ who: 'gemma', reason: 'private' })
    expect(policy.routeJob('handwriting', { claude: { main: true }, metabase: true })).toEqual({ who: 'gemma', reason: 'metabase' })
    for (const why of ['limit', 'offline', 'logged-out', 'no-claude'] as const) expect(policy.routeJob('handwriting', { claude: { main: false, why } })).toEqual({ who: 'gemma', reason: why })
  })
  it('sends a job’s pictures to Claude as image blocks', async () => {
    await claudeIs({ main: true })
    const p = png(196, 124)
    expect(await ai.completeFor('readAlong', 'What number is this?', 'You read.', { images: [dataUrl(p), dataUrl(p)] })).toBe('claude sonnet: ok, saw 2 pictures (image/png, image/png)')
    expect(fake.chats).toBe(0)
  })
})

describe('exam photos of handwritten working', () => {
  const question = { number: 1, text: 'Differentiate.', parts: [{ label: 'a', text: 'd/dx x^2', marks: 2, scheme: '2x: 2 marks' }] }
  it('are marked by Opus, which sees them', async () => {
    await claudeIs({ main: true })
    const m = await exam.markPart(question as never, 0, '', [dataUrl(png(800, 600))])
    expect(m).toMatchObject({ awarded: 2, marks: 2 })
    expect(m.feedback).toBe('marked by opus, saw 1 picture (image/png)')
    expect(fake.chats).toBe(0)
  })
  it('go to Gemma, pictures and all, when a Claude call hits its limit or finds no network', async () => {
    for (const [word, reason] of [
      ['LIMIT', 'limit'],
      ['OFFLINE', 'offline']
    ] as const) {
      await claudeIs({ main: false, why: 'no-claude' })
      await claudeIs({ main: true })
      const before = fake.chats
      const m = await exam.markPart(question as never, 0, `see photo ${word}`, [dataUrl(png(80, 60))])
      expect(m.feedback).toBe('gemma saw 1')
      expect(fake.chats).toBe(before + 1)
      expect(idle.gemmaDemand()?.reason).toBe(reason)
    }
  })
  it('go to Gemma, as images, when Claude can’t take them', async () => {
    await claudeIs({ main: false, why: 'limit' })
    const m = await exam.markPart(question as never, 0, '', [dataUrl(png(80, 60))])
    expect(m.feedback).toBe('gemma saw 1')
    expect(fake.chats).toBe(1)
  })
  it('stay on the Mac when the question names a private project', async () => {
    await claudeIs({ main: true })
    const m = await exam.markPart({ ...question, text: 'About the Secret project.' } as never, 0, '', [dataUrl(png(80, 60))])
    expect(m.feedback).toBe('gemma saw 1')
    expect(idle.gemmaDemand()?.reason).toBe('private')
  })
})
