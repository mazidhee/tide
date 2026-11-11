import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('../src/main/metabase', async (orig) => ({ ...(await orig<object>()), metabaseHost: () => 'data.example.org' }))
const { publicUrl } = await import('../src/main/agent')

describe('which pages may go to Firecrawl', () => {
  it('lets an ordinary public page through', () => {
    expect(publicUrl('https://en.wikipedia.org/wiki/Two%27s_complement')).toBe(true)
    expect(publicUrl('https://docs.python.org/3/library/struct.html?highlight=pack')).toBe(true)
  })

  it('keeps your Metabase, this Mac and your network to itself', () => {
    expect(publicUrl('https://data.example.org/public/dashboard/abc')).toBe(false)
    expect(publicUrl('https://eu.data.example.org/question/4')).toBe(false)
    expect(publicUrl('http://localhost:3000/notes')).toBe(false)
    expect(publicUrl('http://127.0.0.1:8080/v1')).toBe(false)
    expect(publicUrl('http://192.168.1.20/wiki')).toBe(false)
    expect(publicUrl('http://172.20.0.4/')).toBe(false)
    expect(publicUrl('http://wiki.corp/page')).toBe(false)
    expect(publicUrl('http://printer.local/')).toBe(false)
    expect(publicUrl('http://[::1]:5173/')).toBe(false)
  })

  it('never sends a login or a signed link', () => {
    expect(publicUrl('https://user:pass@example.com/page')).toBe(false)
    expect(publicUrl('https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=abc')).toBe(false)
    expect(publicUrl('https://example.com/embed?token=abc')).toBe(false)
    expect(publicUrl('not a link')).toBe(false)
  })
})
