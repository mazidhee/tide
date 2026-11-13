// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnimStatus } from '../src/shared/manim'

const flush = () => new Promise((r) => setTimeout(r, 20))

function stub(o: { status: AnimStatus; prompted?: boolean; install?: { ready: boolean; detail: string } }) {
  const calls = { settings: [] as unknown[], install: 0, requests: 0 }
  const api = {
    request: vi.fn(async () => (calls.requests++, o.status)),
    status: async () => ({ manim: { ready: o.status.state !== 'unavailable', detail: '' }, tex: { ready: false, detail: '' }, settings: { narration: true, quality: 'medium', prompted: !!o.prompted } }),
    settings: async (p: unknown) => (calls.settings.push(p), { narration: true, quality: 'medium', prompted: true }),
    install: async () => (calls.install++, o.install ?? { ready: true, detail: 'Manim 0.22.1' }),
    onInstallProgress: () => () => {},
    onStatus: () => () => {},
    used: async () => true
  }
  ;(window as unknown as { tide: unknown }).tide = { manim: api }
  return calls
}

const caps = [
  { start: 0, end: 4, text: 'Here are 205 things.' },
  { start: 4, end: 9, text: 'Group them instead.' }
]

describe('the animation block in a lesson', async () => {
  const { mountAnimation } = await import('../src/renderer/src/lib/animations')
  const live: { destroy(): void }[] = []
  afterEach(() => live.splice(0).forEach((w) => w.destroy()))
  const mount = () => {
    const pre = document.createElement('pre')
    document.body.append(pre)
    const w = mountAnimation('{"template":"place-value","params":{"number":205}}', pre)
    pre.replaceWith(w.root)
    live.push(w)
    return w
  }

  it('offers the install once, the first time a lesson would use it, with the narration as text meanwhile', async () => {
    const calls = stub({ status: { key: '', state: 'unavailable', progress: 0, label: '', captions: caps } })
    const w = mount()
    await flush()
    const install = [...w.root.querySelectorAll('button')].find((b) => /Install maths animations \(about 135 MB\)/.test(b.textContent ?? ''))
    expect(install).toBeTruthy()
    expect(w.root.querySelectorAll('.anim-steps li').length).toBe(2)
    ;[...w.root.querySelectorAll('button')].find((b) => b.textContent === 'Not now')!.click()
    await flush()
    expect(calls.settings).toEqual([{ prompted: true }])
    expect(w.root.textContent).toMatch(/Settings › Tools/)
    expect(calls.install).toBe(0)
  })

  it('after that, only a quiet note and the steps', async () => {
    stub({ status: { key: '', state: 'unavailable', progress: 0, label: '', captions: caps }, prompted: true })
    const w = mount()
    await flush()
    expect(w.root.querySelector('.anim-offer')).toBeNull()
    expect(w.root.textContent).toMatch(/Install maths animations in Settings › Tools/)
  })

  it('installing from the lesson asks for the animation again', async () => {
    const calls = stub({ status: { key: '', state: 'unavailable', progress: 0, label: '', captions: caps } })
    const w = mount()
    await flush()
    ;[...w.root.querySelectorAll('button')].find((b) => /Install maths/.test(b.textContent ?? ''))!.click()
    await flush()
    expect(calls.install).toBe(1)
    expect(calls.requests).toBe(2)
  })

  it('shows progress while it renders, then the player with captions and a transcript', async () => {
    stub({ status: { key: 'mabc1234', state: 'rendering', progress: 0.4, label: 'Rendering…' } })
    const w = mount()
    await flush()
    expect(w.root.querySelector('.anim-progress')?.getAttribute('aria-valuenow')).toBe('40')
    stub({ status: { key: 'mabc1234', state: 'ready', progress: 1, label: 'Ready', video: 'tide-anim://v/mabc1234.mp4', captions: caps, narrated: true, seconds: 9 } })
    const v = mount()
    await flush()
    expect(v.root.querySelector('video')?.getAttribute('src')).toBe('tide-anim://v/mabc1234.mp4')
    expect(v.root.querySelector('.anim-caption')?.textContent).toBe('Here are 205 things.')
    expect(v.root.querySelectorAll('.anim-transcript li').length).toBe(2)
    expect(v.root.querySelector('.anim-mute')?.hasAttribute('hidden')).toBe(false)
    expect(v.root.querySelector('.anim-status')?.textContent).toMatch(/Narrated animation · 0:09/)
  })
})
