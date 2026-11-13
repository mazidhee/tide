// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EMPTY_PROFILE } from '@shared/profile'
import { pixelise } from '@shared/pixelise'
import { portrait } from './helpers/portrait'
import { setProfileForTest } from '../src/renderer/src/lib/profile'
import { YouAvatar } from '../src/renderer/src/components/LessonThreads'

describe('you, on a lesson thread', () => {
  it('shows your picture on the chip in place of the old "Y"', () => {
    const sprite = pixelise(portrait(96), { size: 24, colours: 8, background: false })
    setProfileForTest({ ...EMPTY_PROFILE, name: 'Ada Lovelace', pixel: sprite, picture: 'pixel' })
    const out = renderToStaticMarkup(createElement(YouAvatar, { size: 18 }))
    expect(out).toContain('lt-av lt-me')
    expect(out).toContain('data-avatar="pixel"')
    expect(out).toContain('width:18px')
  })

  it('falls back to initials, then to a plain circle, never a guessed letter', () => {
    setProfileForTest({ ...EMPTY_PROFILE, name: 'Ada Lovelace' })
    expect(renderToStaticMarkup(createElement(YouAvatar))).toContain('>AL<')
    setProfileForTest(EMPTY_PROFILE)
    const out = renderToStaticMarkup(createElement(YouAvatar))
    expect(out).toContain('data-avatar="empty"')
    expect(out).not.toContain('>Y<')
  })
})
