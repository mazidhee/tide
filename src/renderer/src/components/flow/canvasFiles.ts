import { useMemo } from 'react'
import { flowOrder, type Canvas } from '@shared/canvas'
import type { FileNode } from '@shared/types'
import { useApp } from '../../state'

/** The connections in `next` that weren't in `prev`, in the order a request takes them */
export function newEdges(prev: Canvas, next: Canvas): string[] {
  const had = new Set(prev.edges.map((e) => e.id))
  return flowOrder(next)
    .filter((e) => !had.has(e.id))
    .map((e) => e.id)
}

const flatten = (nodes: FileNode[], out: string[] = []): string[] => {
  for (const n of nodes) {
    if (n.type === 'file' && n.kind !== 'canvas' && n.kind !== 'other') out.push(n.path)
    if (n.children) flatten(n.children, out)
  }
  return out
}

/** What a canvas needs from the vault: files to add as cards, opening one, reading a note's start */
export function useCanvasFiles() {
  const { files: tree, openPath } = useApp()
  const files = useMemo(() => flatten(tree), [tree])
  return useMemo(() => ({ files, openFile: (p: string) => openPath(p), readFile: (p: string) => window.tide.vault.read(p) }), [files, openPath])
}
