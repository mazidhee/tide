/**
 * You, in Tide: your name, a short form for greetings, and a picture (a photo, a pixel sprite of
 * yourself, or your initials). Kept in Tide's app data (main/profile) and never sent anywhere;
 * only your first name may reach the tutor's prompt, and only when you allow it.
 */
import { MAX_SIZE, MIN_SIZE, type PixelSprite } from './pixelise'

export type PictureChoice = 'photo' | 'pixel' | 'initials'

/** Where the photo is framed: zoom 1 fills the circle, the offset is a fraction of the circle */
export interface Crop {
  zoom: number
  x: number
  y: number
}

export interface Profile {
  name: string
  /** What greetings call you; the first word of your name when empty */
  short: string
  /** The circle-cropped photo, as a small data URL */
  photo: string | null
  crop: Crop
  pixel: PixelSprite | null
  picture: PictureChoice
  /** Whether the tutor may call you by your first name */
  tutorUsesName: boolean
  /** Whether your pixel self blinks now and then */
  blink: boolean
}

export const EMPTY_PROFILE: Profile = { name: '', short: '', photo: null, crop: { zoom: 1, x: 0, y: 0 }, pixel: null, picture: 'initials', tutorUsesName: true, blink: true }

/** The largest data URL kept for the photo (a 256 px JPEG is about 30 KB) */
export const MAX_PHOTO_CHARS = 600_000

const PHOTO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/
export const isPhotoUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && PHOTO.test(v)

const HEX = /^#[0-9a-f]{6}$/i
const clampNum = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

/** A stored sprite, checked: anything malformed is dropped rather than drawn wrong */
export function cleanSprite(raw: unknown): PixelSprite | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const size = s.size
  if (typeof size !== 'number' || !Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) return null
  if (!Array.isArray(s.palette) || !s.palette.length || s.palette.length > 32 || !s.palette.every((c) => typeof c === 'string' && HEX.test(c))) return null
  if (!Array.isArray(s.pixels) || s.pixels.length !== size * size) return null
  const n = s.palette.length
  if (!s.pixels.every((p) => Number.isInteger(p) && p >= -1 && p < n)) return null
  const eyes = Array.isArray(s.eyes) ? s.eyes.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < size * size).slice(0, 8) : []
  return {
    size,
    palette: s.palette as string[],
    pixels: s.pixels as number[],
    colours: clampNum(s.colours, 2, 16, n),
    background: s.background === true,
    eyes
  }
}

/** A stored profile (or a patch from the renderer), checked and filled in */
export function normaliseProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const crop = (r.crop && typeof r.crop === 'object' ? r.crop : {}) as Record<string, unknown>
  const photo = isPhotoUrl(r.photo) ? r.photo : null
  const pixel = cleanSprite(r.pixel)
  const want = r.picture === 'photo' || r.picture === 'pixel' || r.picture === 'initials' ? r.picture : photo ? 'photo' : 'initials'
  // A choice whose picture is gone falls back to what is there
  const picture: PictureChoice = want === 'photo' && !photo ? (pixel ? 'pixel' : 'initials') : want === 'pixel' && !pixel ? (photo ? 'photo' : 'initials') : want
  return {
    name: text(r.name, 80),
    short: text(r.short, 32),
    photo,
    crop: { zoom: clampNum(crop.zoom, 1, 4, 1), x: clampNum(crop.x, -1, 1, 0), y: clampNum(crop.y, -1, 1, 0) },
    pixel,
    picture,
    tutorUsesName: r.tutorUsesName !== false,
    blink: r.blink !== false
  }
}

/** A patch on top of a profile, then checked */
export const mergeProfile = (current: Profile, patch: Partial<Profile>): Profile => normaliseProfile({ ...current, ...patch })

/** Up to two letters: first and last word ("Ada Lovelace" → "AL"); empty when there's no name */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (!words.length) return ''
  const first = [...words[0]][0] ?? ''
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** What greetings call you: the short form, or the first word of your name */
export function greetingName(p: Pick<Profile, 'name' | 'short'>): string {
  return p.short.trim() || p.name.trim().split(/\s+/)[0] || ''
}

/** Your first name for the tutor's prompt, only when you allow it */
export function tutorName(p: Pick<Profile, 'name' | 'short' | 'tutorUsesName'>): string {
  if (!p.tutorUsesName) return ''
  return greetingName(p).split(/\s+/)[0].slice(0, 32)
}

/** The tutor's line about your name, or nothing */
export function nameLine(p: Pick<Profile, 'name' | 'short' | 'tutorUsesName'>): string {
  const n = tutorName(p)
  return n ? `The learner's first name is ${n}. Address them as "you"; use the name only now and then, where it is natural, never to open every reply.` : ''
}

/** What a picture would show: the choice, or initials when the chosen picture isn't there */
export function shownPicture(p: Pick<Profile, 'picture' | 'photo' | 'pixel'>): PictureChoice {
  if (p.picture === 'photo' && p.photo) return 'photo'
  if (p.picture === 'pixel' && p.pixel) return 'pixel'
  return 'initials'
}

/** Whether you have set anything up at all */
export const hasProfile = (p: Profile) => !!(p.name || p.photo || p.pixel)

/** Home's greeting for the hour: "Good morning, Ada." or, with no name, "Good morning." */
export function greetingLine(name: string, hour = new Date().getHours()): string {
  const part = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const n = name.trim()
  return n ? `${part}, ${n}.` : `${part}.`
}
