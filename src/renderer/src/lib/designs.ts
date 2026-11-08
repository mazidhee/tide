import { serializeCanvas } from '@shared/canvas'
import type { FileNode } from '@shared/types'

export const DESIGN_FOLDER = 'Designs'

/** Creates an empty design canvas with a free name and returns its path */
export async function createDesign(files: FileNode[], name = 'Untitled design'): Promise<string> {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled design'
  const taken = new Set(files.map((f) => f.path.toLowerCase()))
  let path = `${DESIGN_FOLDER}/${clean}.canvas`
  for (let i = 2; taken.has(path.toLowerCase()); i++) path = `${DESIGN_FOLDER}/${clean} ${i}.canvas`
  await window.tide.vault.write(path, serializeCanvas({ nodes: [], edges: [] }))
  return path
}
