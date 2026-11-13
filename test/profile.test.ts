import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { portrait } from './helpers/portrait'

const dir = mkdtempSync(join(tmpdir(), 'tide-profile-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd(), on: () => {}, isPackaged: false } }))

const { EMPTY_PROFILE, cleanSprite, greetingLine, greetingName, hasProfile, initials, mergeProfile, nameLine, normaliseProfile, shownPicture, tutorName } = await import('../src/shared/profile')
const { clampCrop, cropRect, dragCrop, offsetLimits, previewBox, zoomCrop } = await import('../src/shared/avatarCrop')
const { blinkPixels, paintPixel, pixelise, resampleSprite, sceneSprite, spriteRects, toggleEye, withColour, withoutBackdrop } = await import('../src/shared/pixelise')
const store = await import('../src/main/profile')

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEB'
const face = portrait(128)

describe('the profile, checked', () => {
  it('starts empty: no name is guessed or filled in', () => {
    const p = normaliseProfile(null)
    expect(p).toEqual(EMPTY_PROFILE)
    expect(p.name).toBe('')
    expect(hasProfile(p)).toBe(false)
  })

  it('trims names, drops what is not a picture, and keeps the crop in range', () => {
    const p = normaliseProfile({ name: '  Ada   Lovelace ', short: ' Ada ', photo: 'https://example.com/me.jpg', crop: { zoom: 9, x: -3, y: 'a' }, picture: 'photo' })
    expect(p.name).toBe('Ada Lovelace')
    expect(p.short).toBe('Ada')
    expect(p.photo).toBeNull()
    expect(p.crop).toEqual({ zoom: 4, x: -1, y: 0 })
    // A photo was chosen but there isn't one: initials
    expect(p.picture).toBe('initials')
  })

  it('falls back to what exists when the chosen picture is gone', () => {
    const sprite = pixelise(face, { size: 24, colours: 8, background: false })
    expect(normaliseProfile({ picture: 'photo', pixel: sprite }).picture).toBe('pixel')
    expect(normaliseProfile({ picture: 'pixel', photo: PHOTO }).picture).toBe('photo')
    expect(shownPicture({ picture: 'pixel', photo: PHOTO, pixel: null })).toBe('initials')
  })

  it('merges a patch and checks the result', () => {
    const p = mergeProfile(EMPTY_PROFILE, { name: 'Grace Hopper' })
    expect(p.name).toBe('Grace Hopper')
    expect(mergeProfile(p, { tutorUsesName: false }).tutorUsesName).toBe(false)
  })

  it('makes initials from the first and last word, and nothing from no name', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('ada')).toBe('A')
    expect(initials('Jean-Paul Sartre')).toBe('JS')
    expect(initials('  Grace  Brewster Hopper ')).toBe('GH')
    expect(initials('Émile Zola')).toBe('ÉZ')
    expect(initials('')).toBe('')
    expect(initials('   ')).toBe('')
  })

  it('greets with the short form, else the first word of the name', () => {
    expect(greetingName({ name: 'Ada Lovelace', short: '' })).toBe('Ada')
    expect(greetingName({ name: 'Augusta Ada King', short: 'Ada' })).toBe('Ada')
    expect(greetingLine('Ada', 8)).toBe('Good morning, Ada.')
    expect(greetingLine('Ada', 14)).toBe('Good afternoon, Ada.')
    expect(greetingLine('', 20)).toBe('Good evening.')
    expect(greetingLine('', 3)).toBe('Working late.')
  })

  it('gives the tutor only a first name, and only when allowed', () => {
    expect(tutorName({ name: 'Ada Lovelace', short: '', tutorUsesName: true })).toBe('Ada')
    expect(tutorName({ name: 'Augusta Ada King', short: 'Ada Byron', tutorUsesName: true })).toBe('Ada')
    expect(tutorName({ name: 'Ada Lovelace', short: '', tutorUsesName: false })).toBe('')
    expect(nameLine({ name: 'Ada Lovelace', short: '', tutorUsesName: true })).toContain('first name is Ada.')
    expect(nameLine({ name: 'Ada Lovelace', short: '', tutorUsesName: true })).not.toContain('Lovelace')
    expect(nameLine({ name: '', short: '', tutorUsesName: true })).toBe('')
  })
})

describe('profile storage, in app data', () => {
  beforeEach(() => store.resetProfileCache())

  it('reads an empty profile when there is no file, and one that is broken', () => {
    expect(store.getProfile()).toEqual(EMPTY_PROFILE)
    writeFileSync(join(dir, 'profile.json'), '{not json')
    store.resetProfileCache()
    expect(store.getProfile()).toEqual(EMPTY_PROFILE)
  })

  it('saves to profile.json and reads it back', () => {
    const sprite = pixelise(face, { size: 24, colours: 8, background: true })
    store.setProfile({ name: 'Ada Lovelace', photo: PHOTO, pixel: sprite, picture: 'pixel' })
    store.resetProfileCache()
    const back = store.getProfile()
    expect(back.name).toBe('Ada Lovelace')
    expect(back.photo).toBe(PHOTO)
    expect(back.pixel).toEqual(sprite)
    expect(back.picture).toBe('pixel')
    expect(JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8')).name).toBe('Ada Lovelace')
    expect(store.profileNameLine()).toContain('Ada')
  })

  it('keeps the source photo as a JPEG and refuses anything else', () => {
    expect(store.getSourcePhoto()).toBeNull()
    store.setSourcePhoto(PHOTO)
    expect(existsSync(join(dir, 'profile-photo.jpg'))).toBe(true)
    expect(store.getSourcePhoto()).toMatch(/^data:image\/jpeg;base64,/)
    expect(() => store.setSourcePhoto('data:image/svg+xml;base64,PHN2Zz4=')).toThrow()
    expect(() => store.setSourcePhoto('file:///etc/passwd')).toThrow()
  })

  it('removes the photo, keeping the pixel self unless asked', () => {
    store.setSourcePhoto(PHOTO)
    const kept = store.clearPhoto(false)
    expect(kept.photo).toBeNull()
    expect(kept.pixel).not.toBeNull()
    expect(store.getSourcePhoto()).toBeNull()
    expect(store.clearPhoto(true).pixel).toBeNull()
  })

  it('leaves the name out of the prompt when the tutor may not use it', () => {
    store.setProfile({ name: 'Ada Lovelace', tutorUsesName: false })
    expect(store.profileNameLine()).toBe('')
  })
})

describe('framing the photo', () => {
  it('shows the whole short side, centred, at zoom 1', () => {
    expect(cropRect(400, 300, { zoom: 1, x: 0, y: 0 })).toEqual({ x: 50, y: 0, size: 300 })
    expect(cropRect(300, 400, { zoom: 1, x: 0, y: 0 })).toEqual({ x: 0, y: 50, size: 300 })
  })

  it('zooms about the centre', () => {
    expect(cropRect(400, 400, { zoom: 2, x: 0, y: 0 })).toEqual({ x: 100, y: 100, size: 200 })
    expect(zoomCrop(400, 400, { zoom: 1, x: 0, y: 0 }, 10).zoom).toBe(4)
    expect(zoomCrop(400, 400, { zoom: 2, x: 0, y: 0 }, 0.2).zoom).toBe(1)
  })

  it('never lets the square leave the photo', () => {
    expect(offsetLimits(400, 300, 1)).toEqual({ x: 50 / 300, y: 0 })
    const c = clampCrop(400, 300, { zoom: 1, x: 5, y: -5 })
    const r = cropRect(400, 300, c)
    expect(r.x + r.size).toBeLessThanOrEqual(400 + 1e-9)
    expect(r.y).toBeGreaterThanOrEqual(0)
    for (const zoom of [1, 1.5, 3])
      for (const [x, y] of [[-1, -1], [1, 1], [0.3, -0.7]]) {
        const q = cropRect(640, 480, { zoom, x, y })
        expect(q.x).toBeGreaterThanOrEqual(-1e-9)
        expect(q.y).toBeGreaterThanOrEqual(-1e-9)
        expect(q.x + q.size).toBeLessThanOrEqual(640 + 1e-9)
        expect(q.y + q.size).toBeLessThanOrEqual(480 + 1e-9)
      }
  })

  it('moves the photo with the pointer', () => {
    // Dragging right shows more of the left: the square moves left
    const c = dragCrop(400, 400, { zoom: 2, x: 0, y: 0 }, 50, 0, 200)
    expect(c.x).toBeCloseTo(-0.25)
    expect(cropRect(400, 400, c).x).toBeCloseTo(50)
  })

  it('places the preview so the framed square fills the circle', () => {
    const b = previewBox(400, 300, { zoom: 1, x: 0, y: 0 }, 200)
    expect(b.height).toBeCloseTo(200)
    expect(b.left).toBeCloseTo(-(50 * 200) / 300)
    expect(b.top).toBeCloseTo(0)
  })
})

describe('the pixel self', () => {
  it('is the same every time for the same photo', () => {
    const a = pixelise(face, { size: 32, colours: 10, background: false })
    const b = pixelise(portrait(128), { size: 32, colours: 10, background: false })
    expect(a).toEqual(b)
  })

  it('has the size asked for, and no more colours than asked', () => {
    for (const size of [16, 24, 32, 40])
      for (const colours of [4, 8, 12, 16])
        for (const background of [false, true]) {
          const s = pixelise(face, { size, colours, background })
          expect(s.size).toBe(size)
          expect(s.pixels).toHaveLength(size * size)
          expect(s.palette.length).toBeLessThanOrEqual(colours)
          expect(s.palette.length).toBeGreaterThanOrEqual(2)
          expect(new Set(s.palette).size).toBe(s.palette.length)
          s.palette.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/))
          s.pixels.forEach((v) => expect(v >= -1 && v < s.palette.length).toBe(true))
          // Every colour in the palette is used
          expect(new Set(s.pixels.filter((v) => v >= 0)).size).toBe(s.palette.length)
        }
  })

  it('clamps sizes and colours to what the editor offers', () => {
    const s = pixelise(face, { size: 200, colours: 99, background: false })
    expect(s.size).toBe(48)
    expect(s.colours).toBe(16)
  })

  it('without a backdrop, the corners are clear and you are not', () => {
    const s = pixelise(face, { size: 32, colours: 10, background: false })
    for (const i of [0, 31, 32 * 4]) expect(s.pixels[i]).toBe(-1)
    // The middle of the face, and the shoulders at the bottom, are drawn
    expect(s.pixels[14 * 32 + 16]).toBeGreaterThanOrEqual(0)
    expect(s.pixels[31 * 32 + 16]).toBeGreaterThanOrEqual(0)
    expect(s.background).toBe(false)
  })

  it('with a backdrop, every pixel is drawn, the corners in one flat colour', () => {
    const s = pixelise(face, { size: 32, colours: 10, background: true })
    expect(s.pixels.every((v) => v >= 0)).toBe(true)
    expect(s.pixels[0]).toBe(s.pixels[31])
    expect(s.background).toBe(true)
  })

  it('outlines you in a colour darker than the rest', () => {
    const s = pixelise(face, { size: 32, colours: 10, background: false })
    // The pixel just above the top of the head is the outline: the darkest colour
    const col = 16
    let y = 0
    while (s.pixels[y * 32 + col] < 0) y++
    expect(s.pixels[y * 32 + col]).toBe(0)
  })

  it('keeps a photo whole when there is no backdrop to find', () => {
    const flat = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)) }
    const s = pixelise(flat, { size: 16, colours: 6, background: false })
    expect(s.pixels).toHaveLength(256)
    expect(s.palette.length).toBeLessThanOrEqual(6)
  })

  it('takes touch-ups: paint, erase, a new colour, eyes that blink', () => {
    let s = pixelise(face, { size: 24, colours: 8, background: false })
    const i = 12 * 24 + 12
    s = paintPixel(s, i, 0)
    expect(s.pixels[i]).toBe(0)
    expect(paintPixel(s, i, -1).pixels[i]).toBe(-1)
    expect(paintPixel(s, i, 99)).toBe(s)
    const added = withColour(s, '#FF0000')
    expect(added.sprite.palette[added.index]).toBe('#ff0000')
    expect(withColour(added.sprite, '#ff0000').index).toBe(added.index)
    s = toggleEye(toggleEye(s, i), i + 3)
    expect(s.eyes).toEqual([i, i + 3])
    expect(toggleEye(s, i).eyes).toEqual([i + 3])
    const shut = blinkPixels(s)
    expect(shut[i]).toBe(s.pixels[i - 24])
    expect(blinkPixels({ ...s, eyes: [] })).toBe(s.pixels)
  })

  it('stands in a scene at the Professor’s size, without its backdrop', () => {
    const s = pixelise(face, { size: 32, colours: 10, background: true })
    const clear = withoutBackdrop(s)
    expect(clear.pixels[0]).toBe(-1)
    expect(clear.pixels[14 * 32 + 16]).toBe(s.pixels[14 * 32 + 16])
    const small = sceneSprite(s)
    expect(small.size).toBe(16)
    expect(small.pixels).toHaveLength(256)
    expect(small.pixels[0]).toBe(-1)
    expect(resampleSprite(s, 32)).toBe(s)
    expect(resampleSprite(s, 8).pixels).toHaveLength(64)
  })

  it('draws as SVG runs, and survives being stored', () => {
    const s = pixelise(face, { size: 24, colours: 8, background: false })
    const svg = spriteRects(s)
    expect(svg).toContain('<rect')
    expect(svg).toContain(s.palette[0])
    expect(cleanSprite(JSON.parse(JSON.stringify(s)))).toEqual(s)
    expect(cleanSprite({ ...s, pixels: s.pixels.slice(1) })).toBeNull()
    expect(cleanSprite({ ...s, palette: ['red'] })).toBeNull()
    expect(cleanSprite({ ...s, pixels: s.pixels.map(() => 40) })).toBeNull()
  })
})

const { Avatar, YouBeside, YouMark } = await import('../src/renderer/src/components/Avatar')
const { setProfileForTest } = await import('../src/renderer/src/lib/profile')

describe('where you appear', () => {
  const sprite = pixelise(face, { size: 24, colours: 8, background: false })
  const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el)

  it('shows initials in a neutral circle when there is a name and no picture', () => {
    const out = html(createElement(Avatar, { profile: { ...EMPTY_PROFILE, name: 'Ada Lovelace' } }))
    expect(out).toContain('data-avatar="initials"')
    expect(out).toContain('>AL<')
  })

  it('shows a small person, not a guessed letter, with no name at all', () => {
    const out = html(createElement(Avatar, { profile: EMPTY_PROFILE }))
    expect(out).toContain('data-avatar="empty"')
    expect(out).not.toContain('>Y<')
  })

  it('shows the photo or the pixel self, as chosen', () => {
    expect(html(createElement(Avatar, { profile: { ...EMPTY_PROFILE, name: 'Ada', photo: PHOTO, picture: 'photo' } }))).toContain(`src="${PHOTO}"`)
    const px = html(createElement(Avatar, { profile: { ...EMPTY_PROFILE, name: 'Ada', pixel: sprite, picture: 'pixel' } }))
    expect(px).toContain('data-avatar="pixel"')
    expect(px).toContain('viewBox="0 0 24 24"')
    // A pixel self chosen but gone: initials
    expect(html(createElement(Avatar, { profile: { ...EMPTY_PROFILE, name: 'Ada', picture: 'pixel' } }))).toContain('>A<')
  })

  it('stays out of chats and lessons until you set yourself up, then sits beside your words', () => {
    setProfileForTest(EMPTY_PROFILE)
    expect(html(createElement(YouMark))).toBe('')
    expect(html(createElement(YouBeside, null, createElement('div', { className: 's-you' }, 'hi')))).toBe('<div class="s-you">hi</div>')
    setProfileForTest({ ...EMPTY_PROFILE, name: 'Ada Lovelace' })
    expect(html(createElement(YouMark))).toContain('>AL<')
    const beside = html(createElement(YouBeside, null, createElement('div', { className: 's-you' }, 'hi')))
    expect(beside).toMatch(/^<div class="you-row"><div class="s-you">hi<\/div><span class="avatar/)
  })
})
