/**
 * A small time-limited cache for slow lookups (web searches, pages, papers). The model often
 * repeats a search or rereads a page within one conversation; serving it from memory saves the
 * round trip and keeps the answer consistent. Failures are never cached.
 */
export function memoize<A extends unknown[], T>(fn: (...args: A) => Promise<T>, opts: { ttlMs: number | ((...args: A) => number); max?: number; key?: (...args: A) => string }) {
  const cache = new Map<string, { at: number; ttl: number; value: Promise<T> }>()
  const max = opts.max ?? 100
  const keyOf = opts.key ?? ((...args: A) => JSON.stringify(args))
  const wrapped = (...args: A): Promise<T> => {
    const key = keyOf(...args)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < hit.ttl) {
      // Refresh its place so the most used entries are the last to go
      cache.delete(key)
      cache.set(key, hit)
      return hit.value
    }
    const ttl = typeof opts.ttlMs === 'function' ? opts.ttlMs(...args) : opts.ttlMs
    const value = fn(...args)
    cache.set(key, { at: Date.now(), ttl, value })
    value.catch(() => cache.get(key)?.value === value && cache.delete(key))
    while (cache.size > max) cache.delete(cache.keys().next().value!)
    return value
  }
  wrapped.clear = () => cache.clear()
  return wrapped
}
