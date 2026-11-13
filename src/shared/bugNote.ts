/**
 * Report a bug from anywhere (⌃⌘B, or Help › Report a Bug…): the line it adds to the learner's
 * bug note, in their own style, and where it goes. Pure: main/bugReport reads and writes the files.
 *
 * The note is the vault's `Tide/Tide bugs.md`; each bug is one line under "## Open", newest at
 * the top: `- what they wrote (where they were, 13 Nov)`, with a link to the screenshot when one
 * is attached. Only that one line is added: nothing else in the note is touched.
 */

export interface BugSheetInfo {
  version: string
  /** A small copy of the picture, for the sheet; null when none could be taken */
  thumb: string | null
}

export interface BugReport {
  text: string
  /** Where they were, as the sheet says it ("Lesson: Bayes’ theorem") */
  view: string
  /** Attach the picture taken when the sheet opened */
  shot: boolean
}

export const BUG_NOTE = 'Tide/Tide bugs.md'
export const BUG_SHOTS = 'Tide/Bug shots'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** "13 Nov" */
export const bugDate = (at: number) => {
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** The screenshot's path in the vault: "Tide/Bug shots/2026-11-13 14.05.12.png" */
export function shotPath(at: number): string {
  const d = new Date(at)
  return `${BUG_SHOTS}/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.png`
}

/** One line of what was typed: no line breaks, no list marker of its own, and never empty */
export function cleanBugText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-*+]\s+/, '')
    .slice(0, 600)
}

/** `- what they wrote (where, 13 Nov) [[Tide/Bug shots/….png|screenshot, Tide 0.1.0]]` */
export function bugLine(o: { text: string; view: string; at: number; shot?: string; version?: string }): string {
  const text = cleanBugText(o.text)
  if (!text) throw new Error('Say what went wrong first.')
  const where = o.view.replace(/[()\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  const link = o.shot ? ` [[${o.shot}|screenshot${o.version ? `, Tide ${o.version}` : ''}]]` : ''
  return `- ${text} (${where ? `${where}, ` : ''}${bugDate(o.at)})${link}`
}

const OPEN = /^##\s+open\s*$/i

/**
 * The note with the line added at the top of "## Open", every other line as it was. A note with
 * no Open section gets one before its first other section (or at the end); no note at all starts
 * with a title, Open and Fixed.
 */
export function addBugLine(md: string | null, line: string): string {
  if (md === null || !md.trim()) return `# Tide bugs\n\n## Open\n\n${line}\n\n## Fixed\n`
  const eol = md.includes('\r\n') ? '\r\n' : '\n'
  const lines = md.split(/\r?\n/)
  // The newline that ends the file isn't a blank line of its own
  const trailing = lines.length > 1 && lines[lines.length - 1] === ''
  if (trailing) lines.pop()
  const done = () => lines.join(eol) + (trailing ? eol : '')
  const h = lines.findIndex((l) => OPEN.test(l.trim()))
  if (h >= 0) {
    // After the heading and any blank lines straight after it: the first item's place
    let at = h + 1
    while (at < lines.length && !lines[at].trim()) at++
    const more = at < lines.length
    if (more && !/^#{1,6}\s/.test(lines[at])) lines.splice(at, 0, line)
    // An empty Open section: a blank line before the line (one already there is kept), and one after when something follows
    else if (at > h + 1) lines.splice(at, 0, line, ...(more ? [''] : []))
    else lines.splice(h + 1, 0, '', line, ...(more ? [''] : []))
    return done()
  }
  // No Open section: one before the first second-level section, else at the end
  const first = lines.findIndex((l, i) => i > 0 && /^##\s/.test(l))
  if (first >= 0) lines.splice(first, 0, '## Open', '', line, '')
  else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    lines.push('', '## Open', '', line)
  }
  return lines.join(eol) + eol
}
