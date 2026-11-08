import { flushSync } from 'react-dom'

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Runs a page change as a view transition: the old page fades out as the new one settles in, as
 * in a native Mac app, instead of a hard cut. Only the main area takes part (see app.css); the
 * sidebar and toolbar stay still. Falls straight through where it isn't supported.
 */
export function smoothly(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || reduced() || document.hidden) return change()
  doc.startViewTransition(() => flushSync(change))
}
