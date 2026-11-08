import { useEffect, useRef, type RefObject } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle, indentOnInput } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { formatMarkdown, type FormatKind } from '@shared/markdownFormat'

/** Applies a format to the editor's selection */
function applyFormat(view: EditorView, kind: FormatKind): boolean {
  const { from, to } = view.state.selection.main
  const e = formatMarkdown(view.state.doc.toString(), from, to, kind)
  view.dispatch({ changes: { from: e.from, to: e.to, insert: e.insert }, selection: { anchor: e.anchor, head: e.head }, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
  return true
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '650' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '650' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: [t.monospace], fontFamily: 'var(--font-code)', fontSize: '0.9em' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--ink-muted)' },
  { tag: t.quote, color: 'var(--ink-soft)' },
  { tag: [t.keyword, t.operator], color: 'var(--accent)' },
  { tag: [t.string], color: 'var(--ink-soft)' },
  { tag: [t.comment], color: 'var(--ink-muted)', fontStyle: 'italic' }
])

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--ink)', height: '100%' },
  '.cm-content': {
    fontFamily: 'var(--font-read)',
    fontSize: 'var(--read-size)',
    lineHeight: '1.7',
    caretColor: 'var(--accent)',
    padding: '0 0 40vh'
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft) !important'
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-read)', overflow: 'visible' }
})

export interface EditorHandle {
  /** Top of a 0-based source line, relative to the editor element */
  lineTop(line: number): number | null
  scrollToLine(line: number): void
  /** The paragraph at the cursor (headings above it left out) */
  paragraph(): { text: string; line: number } | null
  /** Bold, a heading, a list…: applied to the selection, or toggled off */
  format(kind: FormatKind): void
}

interface Props {
  value: string
  onChange(value: string): void
  /** Called after the user pauses typing, with the paragraph around the cursor (0-based start line) */
  onIdle?(paragraph: { text: string; line: number }): void
  /** ⌘⇧T: the student asks the tutor to test their thinking on the paragraph at the cursor */
  onProbe?(paragraph: { text: string; line: number }): void
  handleRef?: RefObject<EditorHandle | null>
}

const IDLE_MS = 3500

/** The paragraph around the cursor; on a blank line, the one above. Lines are 0-based. */
export function paragraphAt(state: EditorState): { text: string; line: number } | null {
  const doc = state.doc
  // Headings end a paragraph too: notes often have a heading right above its text, no blank line
  const isText = (n: number) => !!doc.line(n).text.trim() && !/^#{1,6}\s/.test(doc.line(n).text)
  let start = doc.lineAt(state.selection.main.head).number
  if (!isText(start) && start > 1 && isText(start - 1)) start--
  if (!isText(start)) return null
  let end = start
  while (start > 1 && isText(start - 1)) start--
  while (end < doc.lines && isText(end + 1)) end++
  const text = Array.from({ length: end - start + 1 }, (_, i) => doc.line(start + i).text).join('\n').trim()
  return text ? { text, line: start - 1 } : null
}

export function Editor({ value, onChange, onIdle, onProbe, handleRef }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle
  const onProbeRef = useRef(onProbe)
  onProbeRef.current = onProbe
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          keymap.of([
            { key: 'Mod-b', run: (v) => applyFormat(v, 'bold') },
            { key: 'Mod-i', run: (v) => applyFormat(v, 'italic') },
            { key: 'Mod-k', run: (v) => applyFormat(v, 'link') },
            { key: 'Mod-e', run: () => false },
            { key: 'Mod-Shift-x', run: (v) => applyFormat(v, 'strike') },
            {
              key: 'Mod-Shift-t',
              run: (v) => {
                const p = paragraphAt(v.state)
                if (p) onProbeRef.current?.(p)
                return true
              }
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab
          ]),
          theme,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            onChangeRef.current(u.state.doc.toString())
            clearTimeout(idleTimer.current)
            idleTimer.current = setTimeout(() => {
              const p = paragraphAt(u.view.state)
              if (p) onIdleRef.current?.(p)
            }, IDLE_MS)
          })
        ]
      })
    })
    viewRef.current = view
    view.focus()
    if (handleRef) {
      handleRef.current = {
        paragraph: () => paragraphAt(view.state),
        format: (kind) => void applyFormat(view, kind),
        lineTop: (line) => {
          if (line + 1 > view.state.doc.lines) return null
          const block = view.lineBlockAt(view.state.doc.line(line + 1).from)
          return block.top + (view.contentDOM.offsetTop ?? 0)
        },
        scrollToLine: (line) => {
          const pos = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from
          view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
          view.focus()
        }
      }
    }
    return () => {
      clearTimeout(idleTimer.current)
      view.destroy()
    }
    // The editor owns its document, external updates are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    const current = view?.state.doc.toString()
    if (view && current !== undefined && current !== value) {
      // Replace only the part that differs, so the cursor and scroll stay where they were
      let start = 0
      while (start < current.length && start < value.length && current[start] === value[start]) start++
      let endOld = current.length
      let endNew = value.length
      while (endOld > start && endNew > start && current[endOld - 1] === value[endNew - 1]) {
        endOld--
        endNew--
      }
      view.dispatch({ changes: { from: start, to: endOld, insert: value.slice(start, endNew) } })
    }
  }, [value])

  return <div className="editor" ref={host} />
}
