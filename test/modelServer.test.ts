import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/settings', () => ({ getSettings: () => ({ ai: { baseUrl: 'http://localhost:8080/v1' } }) }))

const { tuneModelServer, PREFIX_CACHE } = await import('../src/main/modelServer')

afterEach(() => vi.unstubAllGlobals())

describe('tuning the local model server', () => {
  it('turns prefix caching on when an mlx-vlm server has it off', async () => {
    const calls: { url: string; method?: string; body?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method, body: init.body as string })
      return new Response(JSON.stringify({ current: { apc_enabled: false, apc_disk_enabled: false, apc_memory_max_gb: 2, apc_checkpoint_entries: 2 } }), { status: 200 })
    })
    expect(await tuneModelServer()).toBe('enabled')
    expect(calls[0].url).toBe('http://localhost:8080/v1/settings')
    expect(calls[1].method).toBe('PATCH')
    expect(JSON.parse(calls[1].body!)).toEqual({ apc_enabled: true, apc_disk_enabled: true, apc_memory_max_gb: 4, apc_checkpoint_entries: 8 })
    expect(PREFIX_CACHE.apc_memory_max_gb).toBe(4)
  })

  it('leaves it alone when caching is already on', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => (n++, new Response(JSON.stringify({ current: { ...PREFIX_CACHE } }))))
    expect(await tuneModelServer()).toBe('already')
    expect(n).toBe(1)
  })

  it('does nothing for servers without these settings', async () => {
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }))
    expect(await tuneModelServer()).toBe('unsupported')
  })
})
