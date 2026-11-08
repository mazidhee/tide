import { describe, expect, it } from 'vitest'
import { buildLink, parseLink, scopeFromLink } from '../src/shared/deeplink'

describe('tide:// links', () => {
  it('round-trips every kind of link', () => {
    const links = [
      { to: 'open' as const, path: 'ML/Backprop.md' },
      { to: 'exam' as const, topic: 'Probability problems', scope: 'folder:Quant', difficulty: 'olympiad' as const, style: 'problems' as const, questions: 4, minutes: 90 },
      { to: 'session' as const, mode: 'quiz' as const, topic: 'Attention', scope: 'note:ML/Attention.md' },
      { to: 'drill' as const, kind: 'zetamac' as const },
      { to: 'practice' as const, tab: 'quant' }
    ]
    for (const l of links) expect(parseLink(buildLink(l))).toEqual(l)
  })
  it('refuses paths outside the vault and unknown links', () => {
    expect(parseLink('tide://open?path=../../etc/passwd')).toBeNull()
    expect(parseLink('tide://open?path=/Users/x/secret')).toBeNull()
    expect(parseLink('tide://format-disk')).toBeNull()
    expect(parseLink('https://example.com')).toBeNull()
    expect(scopeFromLink('folder:../x')).toEqual({ kind: 'none' })
    expect(scopeFromLink('folder:Quant')).toEqual({ kind: 'folder', path: 'Quant' })
  })
})
