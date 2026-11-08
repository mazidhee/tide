import { describe, expect, it } from 'vitest'
import { PALETTE, professorBitmap, professorFrame, SCENES } from '../src/shared/professorArt'

describe('the professor', () => {
  it('draws moods 16 wide and scenes 24 wide, 16 tall, in known colours', () => {
    for (const pose of ['idle', 'thinking', 'reading', 'writing', 'happy', ...SCENES] as const)
      for (let tick = 0; tick < 20; tick++) {
        const g = professorFrame(pose, tick, tick % 7 === 0)
        expect(g).toHaveLength(16)
        for (const row of g) {
          expect(row).toHaveLength(SCENES.includes(pose as never) ? 24 : 16)
          for (const v of row) expect(v === '.' || v in PALETTE).toBe(true)
        }
      }
  })

  it('makes a menu bar bitmap at 2x', () => {
    const b = professorBitmap('tea', 3, 2)
    expect([b.width, b.height]).toEqual([48, 32])
    expect(b.data).toHaveLength(48 * 32 * 4)
  })
})
