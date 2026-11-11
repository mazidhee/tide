import { useCallback, useMemo } from 'react'
import type { FileNode } from '@shared/types'
import { useApp } from '../state'
import { CHAT_IMAGES } from './pastedImages'

/** Folders Tide keeps for itself; they are not areas of study */
const OWN = new Set(['Coach', 'Exams', 'Designs', 'Lessons', 'Code', 'Flashcards', CHAT_IMAGES])
const onlyImages = (n: FileNode): boolean => (n.type === 'file' ? n.kind === 'image' : (n.children ?? []).every(onlyImages))

/** The areas of study, in a fixed order: the notebooks at the top of the notes folder */
export function areasOf(tree: FileNode | null, libraryFolder: string): string[] {
  return (tree?.children ?? [])
    .filter((n) => n.type === 'folder' && n.path !== libraryFolder && !OWN.has(n.path) && !(n.children?.length && onlyImages(n)))
    .map((n) => n.path)
}

/** The class that carries an area's colour (td-c1 to td-c5, in notebook order; td-c0 when it is no notebook) */
export function areaClass(areas: string[], area: string | undefined | null): string {
  if (!area) return 'td-c0'
  const top = area.split('/')[0].toLowerCase()
  const i = areas.findIndex((a) => a.toLowerCase() === top)
  return i < 0 ? 'td-c0' : `td-c${(i % 5) + 1}`
}

/**
 * Each area of study has one of five colours, by its place among the notebooks, and keeps it
 * everywhere: the rail, Home, the library, the map of what you know. A colour is only ever a
 * mark beside the area's name.
 */
export function useAreaClass(): (area: string | undefined | null) => string {
  const { tree, settings } = useApp()
  const areas = useMemo(() => areasOf(tree, settings.libraryFolder), [tree, settings.libraryFolder])
  return useCallback((area) => areaClass(areas, area), [areas])
}
