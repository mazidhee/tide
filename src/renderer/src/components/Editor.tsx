import { useEffect, useRef, type RefObject } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle, indentOnInput } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { formatMarkdown, type FormatKind } from '@shared/markdownFormat'
import { paragraphAt } from '../lib/paragraph'
import { useApp } from '../state'
import { tideMarkdown } from '../lib/livePreview/syntax'
import { livePreviewPlugin } from '../lib/livePreview/decorations'
import type { LivePreviewEnv } from '../lib/livePreview/widgets'
import { renderMarkdown, renderMath, resolveRelative, vaultUrl } from '../lib/markdown'
import { followLink } from '../lib/followLink'

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
  { tag: t.special(t.string), fontFamily: 'var(--font-code)', fontSize: '0.9em', color: 'var(--ink-soft)' },
  { tag: t.labelName, color: 'var(--accent)' },
  // Code in fenced blocks, coloured from the theme's own tokens so every theme keeps its contrast
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--lp-code-keyword)' },
  { tag: [t.string, t.regexp, t.character, t.special(t.brace)], color: 'var(--lp-code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--lp-code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--lp-code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.variableName)], color: 'var(--lp-code-type)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName), t.attributeName], color: 'var(--lp-code-definition)' },
  { tag: [t.propertyName], color: 'var(--ink-soft)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--ink-muted)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--ink-muted)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--danger)' }
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
  /** Saves a pasted or dropped picture and returns the Markdown that shows it */
  onImage?(file: File): Promise<string | null>
  /** The note being edited (vault path): its links and pictures resolve from here */
  notePath?: string
}

const IDLE_MS = 3500

export { paragraphAt }

/** Puts each picture in at the cursor (or where it was dropped); false when there are none to handle */
function insertImages(view: EditorView, files: File[], at: number | null, save?: (file: File) => Promise<string | null>): boolean {
  const images = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))
  if (!images.length || !save) return false
  const pos = at ?? view.state.selection.main.head
  ;(async () => {
    const lines: string[] = []
    for (const f of images) {
      const md = await save(f).catch(() => null)
      if (md) lines.push(md)
    }
    if (!lines.length) return
    const text = `${pos > 0 && view.state.doc.sliceString(pos - 1, pos) !== '\n' ? '\n' : ''}${lines.join('\n')}\n`
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
  })()
  return true
}

/** Live preview hides Markdown away from the cursor; source mode shows it all. The choice is remembered (settings.editorSource). */
const previewMode = new Compartment()

export function Editor({ value, onChange, onIdle, onProbe, handleRef, onImage, notePath }: Props) {
  const app = useApp()
  const source = app.settings.editorSource === true
  const appRef = useRef(app)
  appRef.current = app
  const notePathRef = useRef(notePath ?? '')
  notePathRef.current = notePath ?? ''
  const envRef = useRef<LivePreviewEnv | null>(null)
  const livePreview = useRef<ReturnType<typeof livePreviewPlugin> | null>(null)
  if (!envRef.current) {
    const renderEnv = () => ({ notePath: notePathRef.current, filesByName: appRef.current.filesByName })
    envRef.current = {
      imageUrl: (target) => (/^(https?|data|vault):/i.test(target) ? target : vaultUrl(resolveRelative(target, renderEnv()))),
      renderMath,
      renderTable: (table) => renderMarkdown(table, renderEnv()),
      openLink: (link) => void followLink(appRef.current, notePathRef.current, link)
    }
    livePreview.current = livePreviewPlugin(envRef.current)
  }
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle
  const onProbeRef = useRef(onProbe)
  onProbeRef.current = onProbe
  const onImageRef = useRef(onImage)
  onImageRef.current = onImage
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
          markdown({ base: markdownLanguage, codeLanguages: languages, extensions: tideMarkdown }),
          syntaxHighlighting(highlight),
          previewMode.of(source ? [] : livePreview.current!),
          keymap.of([
            {
              key: 'Mod-Shift-e',
              run: () => {
                const a = appRef.current
                void a.updateSettings({ editorSource: !(a.settings.editorSource === true) })
                return true
              }
            },
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
          // A screenshot pasted or dragged in is saved beside the note and shown where the cursor is
          EditorView.domEventHandlers({
            paste: (e, v) => insertImages(v, [...(e.clipboardData?.files ?? [])], null, onImageRef.current) && (e.preventDefault(), true),
            drop: (e, v) => insertImages(v, [...(e.dataTransfer?.files ?? [])], v.posAtCoords({ x: e.clientX, y: e.clientY }), onImageRef.current) && (e.preventDefault(), true)
          }),
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

  const shownSource = useRef(source)
  useEffect(() => {
    if (shownSource.current === source) return
    shownSource.current = source
    viewRef.current?.dispatch({ effects: previewMode.reconfigure(source ? [] : livePreview.current!) })
  }, [source])

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

  return <div className={`editor${source ? ' editor-source' : ' editor-live'}`} ref={host} />
}
