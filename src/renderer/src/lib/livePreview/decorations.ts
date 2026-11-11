import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { BulletWidget, CheckboxWidget, ImageWidget, LabelWidget, MathWidget, TableWidget, type LivePreviewEnv } from './widgets'

/*
 * Live preview: Markdown that reads like the note it will be. The syntax of each line is hidden and
 * drawn (headings sized, links as links, maths typeset, tables as tables, tasks as checkboxes) except
 * on the lines the cursor or selection is on, which show their plain Markdown for editing. The
 * document itself is never changed: the note stays plain Markdown.
 *
 * Adapted from SilverBullet's CodeMirror extensions (client/codemirror, MIT; its mark hiding is
 * itself forked from ixora, Apache-2.0), see THIRD_PARTY_NOTICES.md: the marks that are hidden, the
 * cursor-overlap test, hiding a block's source line by line with a widget on its first line (which
 * keeps the decorations inside a view plugin), and the table widget that places the cursor on click.
 * Unlike those, which walk the whole syntax tree on every transaction, decorations here are built
 * only for the visible part of the note and only when the document, the viewport or the cursor's
 * lines change, so long notes stay fast.
 */

// Hidden syntax is a mark drawn as nothing rather than a replaced range: a replaced range brings
// CodeMirror's widget buffers (inline images), and the line could then wrap where the syntax was
const hidden = Decoration.mark({ class: 'cm-lp-hide' })
const lineCache = new Map<string, Decoration>()
const lineDeco = (cls: string) => {
  let d = lineCache.get(cls)
  if (!d) lineCache.set(cls, (d = Decoration.line({ class: cls })))
  return d
}
const markCache = new Map<string, Decoration>()
const markDeco = (cls: string) => {
  let d = markCache.get(cls)
  if (!d) markCache.set(cls, (d = Decoration.mark({ class: cls })))
  return d
}

/** Nodes whose delimiters are hidden away from the cursor (as SilverBullet's hide_mark) */
const WITH_MARKS = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight'])
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'HighlightMark'])

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i

/** The lines the selection is on, as a key: decorations are rebuilt only when it changes */
export function activeLinesKey(state: EditorState): string {
  const doc = state.doc
  return state.selection.ranges.map((r) => `${doc.lineAt(r.from).number}-${doc.lineAt(r.to).number}`).join(',')
}

/** The label Tide's reading view gives a [[target]] without an alias */
export const wikilinkLabel = (target: string) => target.split('#')[0].split('/').pop() || target

/**
 * The live-preview decorations for the parts of the note in `ranges` (the visible ones).
 * Pure apart from the widgets' later drawing, so it is tested without a DOM.
 */
export function buildDecorations(state: EditorState, ranges: readonly { from: number; to: number }[], env: LivePreviewEnv): DecorationSet {
  const doc = state.doc
  const tree = syntaxTree(state)
  const sel = state.selection.ranges
  const out: Range<Decoration>[] = []
  const lineClasses = new Set<string>()
  const seen = new Set<string>()

  /** Whether the selection is on any line from `from` to `to` (these show their Markdown) */
  const revealed = (from: number, to: number) => {
    const lf = doc.lineAt(from).from
    const lt = doc.lineAt(to).to
    return sel.some((r) => r.from <= lt && r.to >= lf)
  }
  const hide = (from: number, to: number) => {
    if (to > from) out.push(hidden.range(from, to))
  }
  const addLine = (pos: number, cls: string) => {
    const from = doc.lineAt(pos).from
    const key = `${from}:${cls}`
    if (lineClasses.has(key)) return
    lineClasses.add(key)
    out.push(lineDeco(cls).range(from))
  }
  const mark = (from: number, to: number, cls: string) => {
    if (to > from) out.push(markDeco(cls).range(from, to))
  }
  const replace = (from: number, to: number, widget: Decoration) => out.push(widget.range(from, to))
  /** Every line of a block, from its first */
  const eachLine = (from: number, to: number, f: (line: { from: number; to: number; number: number }, i: number, last: boolean) => void) => {
    const first = doc.lineAt(from).number
    const lastN = doc.lineAt(to).number
    for (let n = first; n <= lastN; n++) f(doc.line(n), n - first, n === lastN)
  }
  const children = (node: SyntaxNode, name?: string) => {
    const list: SyntaxNode[] = []
    for (let c = node.firstChild; c; c = c.nextSibling) if (!name || c.name === name) list.push(c)
    return list
  }
  /** Hides a block's lines after the first; the first line holds the widget drawn in its place */
  const blockWidget = (from: number, to: number, widget: Decoration) => {
    eachLine(from, to, (line, i) => {
      if (i === 0) {
        replace(line.from, line.to, widget)
        addLine(line.from, 'cm-lp-block-line')
      } else addLine(line.from, 'cm-lp-hidden')
    })
  }
  const skipSpaces = (pos: number, limit: number) => {
    while (pos < limit && /[ \t]/.test(doc.sliceString(pos, pos + 1))) pos++
    return pos
  }

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        const { name, from, to } = ref
        const node = ref.node
        // A block that spans two visible ranges is decorated once
        const key = `${name}:${from}`
        if (seen.has(key)) return false
        seen.add(key)

        switch (name) {
          case 'Frontmatter':
            eachLine(from, to, (line) => addLine(line.from, 'cm-lp-frontmatter'))
            return false

          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            addLine(from, `cm-lp-heading cm-lp-h${name.slice(-1)}`)
            if (revealed(from, to)) return
            const marks = children(node, 'HeaderMark')
            if (marks[0]) hide(marks[0].from, skipSpaces(marks[0].to, to))
            // Closing hashes: "## Title ##"
            if (marks.length > 1) {
              const last = marks[marks.length - 1]
              let start = last.from
              while (start > marks[0].to && /[ \t]/.test(doc.sliceString(start - 1, start))) start--
              hide(start, last.to)
            }
            return
          }

          case 'SetextHeading1':
          case 'SetextHeading2': {
            const marks = children(node, 'HeaderMark')
            const underline = marks[marks.length - 1]
            eachLine(from, underline ? underline.from - 1 : to, (line) => addLine(line.from, `cm-lp-heading cm-lp-h${name.slice(-1)}`))
            if (underline && !revealed(from, to)) {
              const line = doc.lineAt(underline.from)
              hide(line.from, line.to)
              addLine(line.from, 'cm-lp-hidden')
            }
            return
          }

          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough':
          case 'Highlight': {
            if (name === 'Highlight') mark(from, to, 'cm-lp-highlight')
            if (!WITH_MARKS.has(name) || revealed(from, to)) return
            for (const c of children(node)) if (MARKS.has(c.name)) hide(c.from, c.to)
            return
          }

          case 'InlineCode': {
            const marks = children(node, 'CodeMark')
            if (revealed(from, to) || marks.length < 2) {
              mark(from, to, 'cm-lp-code')
              return false
            }
            hide(marks[0].from, marks[0].to)
            mark(marks[0].to, marks[marks.length - 1].from, 'cm-lp-code')
            hide(marks[marks.length - 1].from, marks[marks.length - 1].to)
            return false
          }

          case 'Escape':
            if (!revealed(from, to)) hide(from, from + 1)
            return false

          case 'Hashtag':
            mark(from, to, 'cm-lp-tag')
            return false

          case 'Link': {
            const url = node.getChild('URL')
            const marks = children(node, 'LinkMark')
            if (!url || marks.length < 2 || revealed(from, to)) return
            const href = doc.sliceString(url.from, url.to)
            hide(from, marks[0].to)
            hide(marks[1].from, to)
            if (marks[1].from > marks[0].to)
              out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-lp-href': href, title: href } }).range(marks[0].to, marks[1].from))
            return
          }

          case 'Autolink': {
            const url = node.getChild('URL')
            if (!url || revealed(from, to)) return false
            const href = doc.sliceString(url.from, url.to)
            hide(from, url.from)
            hide(url.to, to)
            out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-lp-href': href } }).range(url.from, url.to))
            return false
          }

          case 'URL': {
            // A bare web address (GFM autolink); those inside links and images are handled there
            const parent = node.parent?.name
            if (parent === 'Link' || parent === 'Image' || parent === 'Autolink' || revealed(from, to)) return false
            const href = doc.sliceString(from, to)
            out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-lp-href': /^www\./.test(href) ? `https://${href}` : href } }).range(from, to))
            return false
          }

          case 'Image': {
            const url = node.getChild('URL')
            const marks = children(node, 'LinkMark')
            if (!url) return false
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
            const widget = new ImageWidget(env.imageUrl(doc.sliceString(url.from, url.to)), alt, null, revealed(from, to))
            if (widget.preview) out.push(Decoration.widget({ widget, side: 1 }).range(to))
            else {
              replace(from, to, Decoration.replace({ widget }))
              const line = doc.lineAt(from)
              if (line.from === from && line.to === to) addLine(from, 'cm-lp-block-line')
            }
            return false
          }

          case 'Wikilink':
          case 'WikiEmbed': {
            if (revealed(from, to)) return false
            const targetNode = node.getChild('WikilinkTarget')
            const aliasNode = node.getChild('WikilinkAlias')
            const target = targetNode ? doc.sliceString(targetNode.from, targetNode.to).trim() : ''
            const alias = aliasNode ? doc.sliceString(aliasNode.from, aliasNode.to).trim() : ''
            if (!target) return false
            if (name === 'WikiEmbed' && IMAGE_EXT.test(target)) {
              const width = /^\d+$/.test(alias) ? Number(alias) : null
              replace(from, to, Decoration.replace({ widget: new ImageWidget(env.imageUrl(target), width ? '' : alias, width) }))
              const line = doc.lineAt(from)
              if (line.from === from && line.to === to) addLine(from, 'cm-lp-block-line')
              return false
            }
            // The name shown is the alias, or the target's note name (as the reading view); the rest is hidden
            let labelFrom: number
            let labelTo: number
            if (aliasNode && alias) {
              labelFrom = aliasNode.from
              labelTo = aliasNode.to
            } else {
              const raw = doc.sliceString(targetNode!.from, targetNode!.to)
              const label = wikilinkLabel(target)
              const at = raw.lastIndexOf(label, raw.includes('#') ? raw.indexOf('#') : raw.length)
              labelFrom = targetNode!.from + Math.max(0, at)
              labelTo = at < 0 ? targetNode!.to : labelFrom + label.length
            }
            hide(from, labelFrom)
            out.push(Decoration.mark({ class: 'cm-lp-wikilink', attributes: { 'data-lp-wikilink': target, title: target } }).range(labelFrom, labelTo))
            hide(labelTo, to)
            return false
          }

          case 'InlineMath': {
            const marks = children(node, 'MathMark')
            if (marks.length < 2) return false
            const source = doc.sliceString(marks[0].to, marks[1].from)
            if (revealed(from, to)) {
              mark(from, to, 'cm-lp-math-source')
              return false
            }
            const display = marks[0].to - marks[0].from === 2
            replace(from, to, Decoration.replace({ widget: new MathWidget(source, display, env) }))
            return false
          }

          case 'MathBlock': {
            const marks = children(node, 'MathMark')
            if (marks.length < 2) return false
            const source = doc.sliceString(marks[0].to, marks[1].from).trim()
            const widget = new MathWidget(source, true, env, revealed(from, to))
            if (widget.preview) {
              eachLine(from, to, (line) => addLine(line.from, 'cm-lp-math-source-line'))
              out.push(Decoration.widget({ widget, side: 1, block: false }).range(to))
            } else if (doc.lineAt(from).from === from) {
              blockWidget(from, to, Decoration.replace({ widget }))
            }
            return false
          }

          case 'Table': {
            // A table inside a list or quote stays as written
            if (doc.lineAt(from).from !== from) return false
            if (revealed(from, to)) {
              eachLine(from, to, (line) => addLine(line.from, 'cm-lp-table-source'))
              return false
            }
            blockWidget(from, to, Decoration.replace({ widget: new TableWidget(doc.sliceString(from, to), env) }))
            return false
          }

          case 'FencedCode': {
            const marks = children(node, 'CodeMark')
            const info = node.getChild('CodeInfo')
            const closed = marks.length > 1 && doc.lineAt(marks[marks.length - 1].from).number > doc.lineAt(from).number
            const show = revealed(from, to)
            eachLine(from, to, (line, i, last) => {
              addLine(line.from, i === 0 ? 'cm-lp-fence cm-lp-fence-open' : last && closed ? 'cm-lp-fence cm-lp-fence-close' : 'cm-lp-fence')
              if (show) return
              if (i === 0) {
                const lang = info ? doc.sliceString(info.from, info.to).split(/\s/)[0] : ''
                replace(line.from, line.to, Decoration.replace({ widget: new LabelWidget(lang, 'cm-lp-fence-lang') }))
              } else if (last && closed) hide(line.from, line.to)
            })
            return false
          }

          case 'Blockquote': {
            const first = doc.lineAt(from)
            const callout = /^\s*(?:>\s*)+\[!(\w+)\]([+-]?)[ \t]*(.*)$/.exec(first.text)
            eachLine(from, to, (line, i, last) => {
              addLine(line.from, callout ? `cm-lp-quote cm-lp-callout cm-lp-callout-${callout[1].toLowerCase()}` : 'cm-lp-quote')
              if (callout && i === 0) addLine(line.from, 'cm-lp-callout-first')
              if (callout && last) addLine(line.from, 'cm-lp-callout-last')
            })
            if (callout) {
              addLine(first.from, 'cm-lp-callout-title')
              if (!revealed(first.from, first.to)) {
                const open = first.text.indexOf('[!')
                const close = first.text.indexOf(']', open) + 1 + callout[2].length
                const titleAt = skipSpaces(first.from + close, first.to)
                const kind = callout[1][0].toUpperCase() + callout[1].slice(1).toLowerCase()
                if (callout[3]) hide(first.from + open, titleAt)
                else replace(first.from + open, first.to, Decoration.replace({ widget: new LabelWidget(kind, 'cm-lp-callout-kind') }))
              }
            }
            return
          }

          case 'QuoteMark': {
            if (!revealed(from, to)) hide(from, skipSpaces(to, Math.min(to + 1, doc.lineAt(to).to)))
            return false
          }

          case 'HorizontalRule': {
            addLine(from, 'cm-lp-hr-line')
            if (!revealed(from, to)) {
              addLine(from, 'cm-lp-hr')
              hide(from, to)
            }
            return false
          }

          case 'ListMark': {
            const item = node.parent
            const list = item?.parent?.name
            const task = node.nextSibling?.name === 'Task' ? node.nextSibling : null
            if (task) {
              const marker = task.getChild('TaskMarker')
              if (!marker) return false
              const checked = /x/i.test(doc.sliceString(marker.from, marker.to))
              if (checked) mark(skipSpaces(marker.to, doc.lineAt(marker.to).to), doc.lineAt(marker.to).to, 'cm-lp-task-done')
              if (!revealed(from, marker.to)) replace(from, marker.to, Decoration.replace({ widget: new CheckboxWidget(checked) }))
              return false
            }
            if (list === 'BulletList') {
              if (!revealed(from, to)) replace(from, to, Decoration.replace({ widget: new BulletWidget() }))
            } else mark(from, to, 'cm-lp-list-number')
            return false
          }

          // Code inside blocks and the parts of tables need nothing from here
          case 'CodeText':
          case 'HTMLBlock':
          case 'CommentBlock':
            return false
        }
        return
      }
    })
  }
  return Decoration.set(out, true)
}

/** The live preview: decorations for the visible lines, and clicks on drawn links */
export function livePreviewPlugin(env: LivePreviewEnv) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      key: string
      constructor(view: EditorView) {
        this.key = activeLinesKey(view.state)
        this.decorations = buildDecorations(view.state, view.visibleRanges, env)
      }
      update(u: ViewUpdate) {
        const key = u.selectionSet ? activeLinesKey(u.state) : this.key
        if (u.docChanged || u.viewportChanged || key !== this.key || syntaxTree(u.state) !== syntaxTree(u.startState)) {
          this.key = key
          this.decorations = buildDecorations(u.state, u.view.visibleRanges, env)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )

  const clicks = EditorView.domEventHandlers({
    mousedown(e) {
      if (e.button !== 0 || e.shiftKey) return false
      const link = (e.target as HTMLElement).closest<HTMLElement>('[data-lp-href], [data-lp-wikilink]')
      if (!link) return false
      e.preventDefault()
      if (link.dataset.lpWikilink) env.openLink({ wikilink: link.dataset.lpWikilink })
      else env.openLink({ href: link.dataset.lpHref! })
      return true
    }
  })

  return [plugin, clicks, EditorView.editorAttributes.of({ class: 'cm-live-preview' })]
}
