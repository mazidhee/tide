import { describe, expect, it } from 'vitest'
import { createLineGuard } from '../src/shared/modelText'

describe('keeping drafts from repeating', () => {
  it('stops the loop that wrote one topic forever', () => {
    const g = createLineGuard()
    let out = g.push('## Part 1\n### Signatures\n- [ ] Elliptic curve keys\n')
    for (let i = 0; i < 40 && !g.stuck; i++) out += g.push('- [ ] Contracting for Multi-Signature Logic\n')
    expect(g.stuck).toBe(true)
    expect(out.match(/Contracting/g)).toHaveLength(1)
    expect(g.lastGood).toBe('- [ ] Contracting for Multi-Signature Logic')
  })
  it('passes a normal outline through whole, in any chunking', () => {
    const draft = '## Phase 1: Basics\n\n### Keys\n- [ ] Hashing\n- [ ] Signatures\n    - _Mastering Bitcoin — Antonopoulos_\n\n---\n\n### Wallets\n- [ ] Seed phrases'
    const g = createLineGuard()
    let out = ''
    for (let i = 0; i < draft.length; i += 7) out += g.push(draft.slice(i, i + 7))
    out += g.end()
    expect(out).toBe(draft)
    expect(g.stuck).toBe(false)
  })
  it('drops a topic written twice without stopping', () => {
    const g = createLineGuard()
    const out = g.push('- [ ] Hashing\n- [ ] Merkle trees\n- [ ] hashing\n- [ ] Blocks\n')
    expect(out).toBe('- [ ] Hashing\n- [ ] Merkle trees\n- [ ] Blocks\n')
    expect(g.stuck).toBe(false)
  })
})

import { normalizeMath } from '../src/shared/modelText'

describe('maths from other models', () => {
  it('turns \\( \\) and \\[ \\] into dollars, but not inside code', () => {
    expect(normalizeMath('so \\(u(x)v(x)\\) gives\n\\[\n\\frac{d}{dx}uv = u\'v + uv\'\n\\]')).toBe("so $u(x)v(x)$ gives\n$$\\frac{d}{dx}uv = u'v + uv'$$")
    expect(normalizeMath('`\\(x\\)` and ```\n\\[y\\]\n```')).toBe('`\\(x\\)` and ```\n\\[y\\]\n```')
    expect(normalizeMath('plain $x$')).toBe('plain $x$')
  })
})
