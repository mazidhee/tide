/**
 * You, in Tide (shared/profile): kept in Tide's app data, never in your notes and never sent
 * anywhere. profile.json holds your name, the framed photo (a small data URL), your pixel sprite
 * and which picture to show; profile-photo.jpg keeps the photo as you chose it, scaled down, so it
 * can be framed again or turned into a sprite later.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { EMPTY_PROFILE, isPhotoUrl, mergeProfile, nameLine, normaliseProfile, type Profile } from '@shared/profile'

const file = () => join(app.getPath('userData'), 'profile.json')
const sourceFile = () => join(app.getPath('userData'), 'profile-photo.jpg')

/** The largest source photo kept (about 1600 px as a JPEG) */
const MAX_SOURCE_BYTES = 4_000_000

let cache: Profile | null = null

function writeAtomic(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

export function getProfile(): Profile {
  if (cache) return cache
  try {
    cache = normaliseProfile(JSON.parse(readFileSync(file(), 'utf8')))
  } catch {
    cache = { ...EMPTY_PROFILE }
  }
  return cache
}

export function setProfile(patch: Partial<Profile>): Profile {
  cache = mergeProfile(getProfile(), patch && typeof patch === 'object' ? patch : {})
  writeAtomic(file(), JSON.stringify(cache))
  return cache
}

/** The photo as you chose it, for framing again; null when there is none */
export function getSourcePhoto(): string | null {
  try {
    if (!existsSync(sourceFile())) return null
    return `data:image/jpeg;base64,${readFileSync(sourceFile()).toString('base64')}`
  } catch {
    return null
  }
}

/** Keeps the photo as you chose it (a JPEG data URL from the renderer, already scaled down) */
export function setSourcePhoto(dataUrl: string): void {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) throw new Error('Not a JPEG photo.')
  const bytes = Buffer.from(m[1], 'base64')
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('That photo is too large.')
  writeAtomic(sourceFile(), bytes)
}

/** Removes the photo, the framed one and the source, and any sprite made from it when asked */
export function clearPhoto(alsoSprite = false): Profile {
  rmSync(sourceFile(), { force: true })
  return setProfile({ photo: null, crop: { zoom: 1, x: 0, y: 0 }, ...(alsoSprite ? { pixel: null } : {}) })
}

/** The tutor's line about your name (first name only, when allowed), or nothing */
export function profileNameLine(): string {
  return nameLine(getProfile())
}

export { isPhotoUrl }

/** For tests: forget what was read */
export function resetProfileCache(): void {
  cache = null
}
