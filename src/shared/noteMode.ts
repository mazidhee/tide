/**
 * Whether a note opens to write in (the editor, live preview) or to read (the rendered page).
 * Your own notes open to write in; things that are clearly for reading (a course's lessons, saved
 * articles and videos, readings, a past lesson's page) open to read. A note you switched yourself
 * opens the way you left it, and Settings › General can make every note open to read.
 */

export type NoteMode = 'write' | 'read'

export interface NoteModeInput {
  path: string
  /** The note's frontmatter */
  props: Record<string, unknown>
  /** Opened at a heading or passage (a citation, a search result): the reading view finds it */
  anchor?: string
  /** What you last chose for this note with Read / Edit, if anything */
  chosen?: NoteMode
  /** Settings › General › Notes open in (write when not set) */
  setting?: NoteMode
  /** Where saved links, videos and docs go (Settings › General) */
  libraryFolder?: string
}

const has = (v: unknown) => (typeof v === 'string' ? v.trim().length > 0 : v != null && v !== false)

/** Course material, saved sources, readings and lesson pages: written by someone else, to be read */
export function isReadingMaterial(path: string, props: Record<string, unknown>, libraryFolder = 'Library'): boolean {
  const lib = libraryFolder.replace(/^\/+|\/+$/g, '')
  if (lib && (path === lib || path.startsWith(`${lib}/`))) return true
  if (/^Courses\//.test(path)) return true
  // A saved article, video, doc or book page, a course lesson copied in, a past lesson's page
  if (['source', 'source_type', 'course', 'tide_lesson', 'licence', 'original', 'channel'].some((k) => has(props[k]))) return true
  const tags = Array.isArray(props.tags) ? props.tags.map(String) : typeof props.tags === 'string' ? props.tags.replace(/^\[|\]$/g, '').split(',') : []
  return tags.some((t) => /^(reading|course|article|video)$/i.test(t.trim().replace(/^["']|["']$/g, '')))
}

export function noteOpenMode(o: NoteModeInput): NoteMode {
  if (o.anchor) return 'read'
  if (o.chosen) return o.chosen
  if (isReadingMaterial(o.path, o.props, o.libraryFolder)) return 'read'
  return o.setting ?? 'write'
}
