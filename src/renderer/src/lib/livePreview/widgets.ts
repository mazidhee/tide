import { WidgetType, type EditorView } from '@codemirror/view'

/** What the live preview needs from the app: rendering and following links. Read when a widget draws or is clicked. */
export interface LivePreviewEnv {
  /** The URL an image written in the note loads from (a vault:// URL for a picture in the vault) */
  imageUrl(target: string): string
  /** KaTeX HTML for a formula */
  renderMath(source: string, display: boolean): string
  /** Sanitised HTML for a Markdown table */
  renderTable(source: string): string
  /** Opens a [[wiki link]] or a Markdown link's href, by Tide's usual rules */
  openLink(link: { wikilink: string } | { href: string }): void
}

/** Where a widget's source starts now (edits above it move it); null once it has left the document */
function startOf(view: EditorView, dom: HTMLElement): number | null {
  try {
    return view.posAtDOM(dom, 0)
  } catch {
    return null
  }
}

/** A formula typeset by KaTeX in place of its source. A click puts the cursor in the source. */
export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
    readonly env: LivePreviewEnv,
    /** Shown under source being edited, rather than in place of it */
    readonly preview = false
  ) {
    super()
  }
  eq(other: MathWidget) {
    return other.source === this.source && other.display === this.display && other.preview === this.preview
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? `cm-lp-math-block${this.preview ? ' cm-lp-math-preview' : ''}` : 'cm-lp-math'
    el.innerHTML = this.env.renderMath(this.source, this.display)
    return el
  }
  get estimatedHeight() {
    return this.display ? 56 : -1
  }
  ignoreEvent() {
    return false
  }
}

/** A picture in place of its Markdown (or beneath it while that line is being edited) */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width: number | null,
    readonly preview = false
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.width === this.width && other.preview === this.preview
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = `cm-lp-image${this.preview ? ' cm-lp-image-preview' : ''}`
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    img.decoding = 'async'
    if (this.width) img.width = this.width
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

/** A task's checkbox. Ticking it rewrites `[ ]` as `[x]` (and back) in the note. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-lp-task'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.tabIndex = -1
    box.setAttribute('aria-label', this.checked ? 'Done' : 'To do')
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    box.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const at = startOf(view, wrap)
      if (at !== null) toggleTaskAt(view, at)
    })
    wrap.appendChild(box)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

/** Flips the `[ ]`/`[x]` marker on the line at `pos` */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos)
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text) ?? /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text)
  if (!m) return false
  const at = line.from + m[1].length + 1
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' })
  return true
}

/** A bullet in place of `-`, `*` or `+` */
export class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-lp-bullet'
    el.textContent = '•'
    return el
  }
  ignoreEvent() {
    return false
  }
}

/** The language of a code block, in the corner of its first line */
export class LabelWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string
  ) {
    super()
  }
  eq(other: LabelWidget) {
    return other.text === this.text && other.className === this.className
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = this.className
    el.textContent = this.text
    return el
  }
  ignoreEvent() {
    return false
  }
}

/**
 * Where in a table's source a click on one of its rendered cells belongs: row `row` (0 is the header,
 * then the body rows) and column `col`. Returns the offset from the table's start.
 */
export function cellOffset(source: string, row: number, col: number): number {
  const lines = source.split('\n')
  const lineIndex = Math.min(row === 0 ? 0 : row + 1, lines.length - 1)
  let offset = 0
  for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1
  const text = lines[lineIndex]
  // The pipes that separate cells (an escaped \| belongs to the cell)
  const pipes: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '|') pipes.push(i)
  }
  const leading = /^\s*\|/.test(text)
  const starts = [leading ? null : 0, ...pipes.map((p) => p + 1)].filter((x): x is number => x !== null)
  const start = starts[Math.min(col, starts.length - 1)] ?? 0
  let at = start
  while (at < text.length && text[at] === ' ') at++
  return offset + Math.min(at, text.length)
}

/** A table drawn as one, in place of its pipes. A click on a cell puts the cursor in that cell's source. */
export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly env: LivePreviewEnv
  ) {
    super()
  }
  eq(other: TableWidget) {
    return other.source === this.source
  }
  get estimatedHeight() {
    return (this.source.split('\n').length - 1) * 38
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'cm-lp-table prose'
    el.innerHTML = this.env.renderTable(this.source)
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('a')) return
      e.preventDefault()
      const at = startOf(view, el)
      if (at === null) return
      const cell = target.closest('td, th') as HTMLTableCellElement | null
      const tr = cell?.parentElement as HTMLTableRowElement | null
      let row = 0
      if (tr) {
        const rows = Array.from(el.querySelectorAll('tr'))
        row = Math.max(0, rows.indexOf(tr))
      }
      const offset = cell ? cellOffset(this.source, row, cell.cellIndex) : 0
      view.dispatch({ selection: { anchor: Math.min(at + offset, view.state.doc.length) } })
      view.focus()
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}
