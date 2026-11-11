/** Runs `fn` once `ms` after the last call; `cancel` drops a pending run, `flush` runs it now */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last: A | null = null
  const call = (...args: A) => {
    last = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = last!
      last = null
      fn(...a)
    }, ms)
  }
  call.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    last = null
  }
  call.flush = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    const a = last!
    last = null
    fn(...a)
  }
  return call
}
