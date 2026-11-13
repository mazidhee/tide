import { useEffect, useState } from 'react'
import type { FileNode } from '@shared/types'

const CHANGED = 'tide:outlines-changed'

/** Say a notebook's outline changed, so the sidebar and Learn re-read which files are roadmaps */
export const outlinesChanged = () => window.dispatchEvent(new Event(CHANGED))

/** Every notebook outline's vault path, re-read when the tree changes or an outline is set */
export function useOutlines(tree: FileNode | null | undefined): Set<string> {
  const [outlines, setOutlines] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    const load = () =>
      window.tide.learn
        .notebooks()
        .then((nbs) => live && setOutlines(new Set(nbs.flatMap((n) => (n.outline ? [n.outline] : [])))))
        .catch(() => {})
    load()
    window.addEventListener(CHANGED, load)
    return () => {
      live = false
      window.removeEventListener(CHANGED, load)
    }
  }, [tree])
  return outlines
}
