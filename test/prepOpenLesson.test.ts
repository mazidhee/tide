import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
import { sameTopic } from '../src/main/lessonPrep'
import { preparedWhen } from '../src/renderer/src/lib/prep'

describe('prep and a lesson already open', () => {
  it('sees the open lesson and the prepared one as the same topic', () => {
    expect(sameTopic('Teach me: Binary, hexadecimal,  number representations')).toBe(sameTopic('Binary, hexadecimal, number representations'))
  })
  it('says overnight only the morning after, not for a prep made at 23:00 and seen at 23:54', () => {
    const at = new Date(2026, 10, 12, 23, 0).getTime()
    expect(preparedWhen(at, new Date(2026, 10, 12, 23, 54).getTime())).toBe('Prepared 54 min ago')
    expect(preparedWhen(at, new Date(2026, 10, 13, 8, 0).getTime())).toBe('Prepared overnight')
  })
})
