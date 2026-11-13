/**
 * You (shared/profile), for the renderer: read once from main, shared by every avatar and greeting,
 * and updated in place when you change it in Settings › You.
 */
import { useSyncExternalStore } from 'react'
import { EMPTY_PROFILE, mergeProfile, normaliseProfile, type Profile } from '@shared/profile'

let current: Profile = EMPTY_PROFILE
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function load() {
  if (loaded) return
  loaded = true
  const api = typeof window === 'undefined' ? undefined : window.tide?.profile
  api
    ?.get?.()
    ?.then((p) => {
      current = normaliseProfile(p)
      emit()
    })
    .catch(() => {})
}

function subscribe(l: () => void) {
  load()
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useProfile = (): Profile => useSyncExternalStore(subscribe, () => current, () => current)

/** Saves a change; the screen shows it at once and main's checked copy replaces it */
export async function updateProfile(patch: Partial<Profile>): Promise<Profile> {
  current = mergeProfile(current, patch)
  emit()
  current = normaliseProfile(await window.tide.profile.set(patch))
  emit()
  return current
}

/** Takes a profile main has already saved */
export function adoptProfile(p: Profile): void {
  current = normaliseProfile(p)
  emit()
}

/** For tests and screenshots: set what the avatars show without main */
export function setProfileForTest(p: Profile): void {
  current = p
  loaded = true
  emit()
}
