// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderChapter } from '../src/shared/readingRoom'

/**
 * The book player with the professor's voice, the voice faked: what it asks main to make, how it
 * plays it, where it keeps your place, and Kokoro standing in when the professor doesn't answer.
 */
const played: { rate: number; pitch: boolean }[] = []
class FakeAudio {
  playbackRate = 1
  preservesPitch = false
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public src: string) {}
  play() {
    played.push({ rate: this.playbackRate, pitch: this.preservesPitch })
    setTimeout(() => this.onended?.(), 5)
    return Promise.resolve()
  }
  pause() {}
}
;(globalThis as unknown as { Audio: unknown }).Audio = FakeAudio
URL.createObjectURL = () => 'blob:x'
URL.revokeObjectURL = () => undefined

let professorFails = false
const synth = vi.fn(async (engine: string) => {
  if (engine === 'professor' && professorFails) throw new Error('timed out')
  return new Uint8Array(64)
})
const progress = vi.fn(async () => undefined)
;(window as unknown as { tide: unknown }).tide = {
  tts: {
    engines: async () => [
      { id: 'professor', label: 'The professor', local: true, ready: true, detail: '', voices: [{ id: 'professor', label: 'The professor' }], multiVoice: false, speedInPlayer: true, slow: true },
      { id: 'kokoro', label: 'Kokoro', local: true, ready: true, detail: '', voices: [{ id: 'bm_george', label: 'George' }], multiVoice: true }
    ],
    synth,
    prerender: async () => ({ queued: true })
  },
  room: { progress }
}

const ra = await import('../src/renderer/src/lib/readAloud')

const loc = (n: number) => ({ kind: 'para', n }) as unknown as ReaderChapter['units'][number]['loc']
const chapters: ReaderChapter[] = [
  {
    n: 1,
    title: 'Chapter 1',
    units: [
      { loc: loc(0), text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.' },
      { loc: loc(1), text: 'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed. He is considered the rightful property of some one or other of their daughters.' }
    ]
  }
]
const PATH = 'Library/Books/Pride and Prejudice.md'
const professor = { engine: 'professor', narrator: 'professor', characters: false, speed: 1.2 }
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(ok()).toBe(true)
}

beforeEach(() => {
  ra.stop()
  played.length = 0
  synth.mockClear()
  progress.mockClear()
  professorFails = false
  localStorage.clear()
})

describe('reading a book in the professor’s voice', () => {
  it('makes it once at its own speed and plays it faster with the pitch kept', async () => {
    await ra.startReading({ path: PATH, title: 'Pride and Prejudice', chapters, chapter: 0, unit: 0, voice: professor })
    await until(() => played.length >= 2)
    expect(synth.mock.calls.every((c) => c[0] === 'professor' && c[3] === 1)).toBe(true)
    expect(played[0]).toEqual({ rate: 1.2, pitch: true })
  })

  it('keeps your place to the sentence on pause, and picks up there', async () => {
    await ra.startReading({ path: PATH, title: 'Pride and Prejudice', chapters, chapter: 0, unit: 0, voice: professor })
    await until(() => (ra.playerState()?.plan[ra.playerState()!.index]?.unit ?? 0) === 1 && (ra.playerState()?.index ?? 0) >= 2)
    ra.pause()
    const kept = ra.listenPlace(PATH)!
    expect(kept.unit).toBe(1)
    expect(kept.offset).toBeGreaterThan(0)
    expect(progress).toHaveBeenLastCalledWith(PATH, expect.objectContaining({ loc: loc(1), progress: expect.any(Number) }))
    // Closed and opened again at that paragraph: on from the same sentence
    ra.stop()
    await ra.startReading({ path: PATH, title: 'Pride and Prejudice', chapters, chapter: 0, unit: 1, voice: professor })
    expect(ra.playerState()!.plan[0].start).toBe(kept.offset)
    ra.pause()
    expect(ra.playerState()!.playing).toBe(false)
    ra.resume()
    expect(ra.playerState()!.playing).toBe(true)
  })

  it('hands the rest to George when the professor doesn’t answer', async () => {
    professorFails = true
    await ra.startReading({ path: PATH, title: 'Pride and Prejudice', chapters, chapter: 0, unit: 0, voice: professor })
    await until(() => played.length >= 1)
    const s = ra.playerState()!
    expect(s.voice.engine).toBe('kokoro')
    expect(s.note).toMatch(/George is reading/)
    expect(s.system).toBe(false)
    expect(played[0].rate).toBe(1)
  })
})
