/**
 * Tide's Rust module (native/tide-core): the search index, the recall schedule and the data lab. In the app's
 * resources when packaged, next to its crate in development. Null when it can't be loaded, and
 * whatever uses it then goes without (search has a slower fallback; recall simply waits).
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

let loaded: unknown

export function tideCore<T>(): T | null {
  if (loaded !== undefined) return loaded as T | null
  const appDir = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  const candidates = [
    process.resourcesPath && join(process.resourcesPath, 'tide-core.node'),
    appDir && join(appDir, 'native', 'tide-core', 'tide-core.node'),
    join(__dirname, '..', '..', 'native', 'tide-core', 'tide-core.node')
  ].filter((p): p is string => !!p && existsSync(p))
  loaded = null
  for (const p of candidates) {
    try {
      loaded = createRequire(__filename)(p)
      break
    } catch (e) {
      console.warn('[native] tide-core unavailable', p, e)
    }
  }
  return loaded as T | null
}
