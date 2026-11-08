import { describe, expect, it } from 'vitest'
import { parseLink } from '../src/shared/deeplink'

describe('links in assigned tasks', () => {
  it('a take-home opens as a one-problem paper in Tide', () => {
    const url = 'tide://exam?topic=Expected+Die+Rolls&style=problems&questions=1&minutes=60'
    expect(parseLink(url)).toEqual({ to: 'exam', topic: 'Expected Die Rolls', style: 'problems', questions: 1, minutes: 60 })
  })
})
