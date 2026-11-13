/**
 * What the sidebar's Notebooks list shows. Roadmaps are drawn natively by Tide (a notebook's
 * Outline tab, or Learn for one with no notebook), so their files stay out of the tree; so do
 * folders that only hold screenshots or attachments. Display only: nothing moves on disk.
 */
import type { FileNode } from './types'

/** Tide's own top-level folder: its notes (Tide bugs, Tide roadmap) sit under "Tide's files" */
export const TIDE_FOLDER = 'Tide'

/** The top-level folder new roadmaps are written to (see NewTopicView) */
const ROADMAP_FOLDER = /^roadmaps?$/i

/** A roadmap: some notebook's outline, or a Markdown file directly in the Roadmaps folder */
export function isRoadmapFile(path: string, outlines: ReadonlySet<string>): boolean {
  if (outlines.has(path)) return true
  const parts = path.split('/')
  return parts.length === 2 && ROADMAP_FOLDER.test(parts[0]) && /\.md$/i.test(parts[1])
}

const onlyImages = (n: FileNode): boolean => (n.type === 'file' ? n.kind === 'image' : (n.children ?? []).every(onlyImages))

/**
 * The tree without roadmap files, without folders those leave empty, and without sub-folders of
 * images only ("Tide/Bug shots"). A folder that was empty to begin with (a new notebook) stays.
 */
export function tidyTree(nodes: FileNode[], outlines: ReadonlySet<string>): FileNode[] {
  const out: FileNode[] = []
  for (const n of nodes) {
    if (n.type === 'file') {
      if (!isRoadmapFile(n.path, outlines)) out.push(n)
      continue
    }
    const children = n.children ?? []
    if (children.length && onlyImages(n)) continue
    const kept = tidyTree(children, outlines)
    if (children.length && !kept.length) continue
    out.push(kept.length === children.length ? n : { ...n, children: kept })
  }
  return out
}

/** Roadmaps in the Roadmaps folder that no notebook uses as its outline, for Learn to list */
export function looseRoadmaps(tree: FileNode | null | undefined, outlines: ReadonlySet<string>): FileNode[] {
  const folder = tree?.children?.find((c) => c.type === 'folder' && ROADMAP_FOLDER.test(c.name))
  return (folder?.children ?? []).filter((f) => f.type === 'file' && /\.md$/i.test(f.name) && !outlines.has(f.path))
}
