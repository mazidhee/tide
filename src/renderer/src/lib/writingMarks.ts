/**
 * Writing's comments in the editor (components/writing/WritingPiece): each comment's words marked
 * in the text, mapped through every edit so a comment stays on its words while the learner
 * revises, and the front matter folded into one quiet line (it stays in the file, untouched).
 *
 * The marks carry the comment's id (data-wid), so hovering or clicking one in the text finds its
 * card in the margin, and the card finds its words.
 */
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { frontMatter } from '@shared/writing'

export interface MarkSpec {
  id: string
  from: number
  to: number
  /** Major issues are underlined in the accent; the rest in a neutral rule */
  strong: boolean
}

export const setMarks = StateEffect.define<MarkSpec[]>()
export const setActive = StateEffect.define<string | null>()

interface Marks {
  specs: MarkSpec[]
  active: string | null
  deco: DecorationSet
}

function build(specs: MarkSpec[], active: string | null, len: number): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const sorted = specs.filter((s) => s.to > s.from && s.from >= 0 && s.to <= len).sort((a, b) => a.from - b.from || a.to - b.to)
  for (const s of sorted) b.add(s.from, s.to, Decoration.mark({ class: `wr-mark${s.strong ? ' strong' : ''}${s.id === active ? ' on' : ''}`, attributes: { 'data-wid': s.id } }))
  return b.finish()
}

export const marksField = StateField.define<Marks>({
  create: () => ({ specs: [], active: null, deco: Decoration.none }),
  update(m, tr) {
    let specs = m.specs
    let active = m.active
    let changed = false
    if (tr.docChanged) {
      // A mark keeps its words: it grows with typing inside it and closes up if they're deleted
      specs = specs.map((s) => ({ ...s, from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) }))
      changed = true
    }
    for (const e of tr.effects) {
      if (e.is(setMarks)) {
        specs = e.value
        changed = true
      } else if (e.is(setActive)) {
        active = e.value
        changed = true
      }
    }
    if (!changed) return m
    return { specs, active, deco: build(specs, active, tr.state.doc.length) }
  },
  provide: (f) => EditorView.decorations.from(f, (m) => m.deco)
})

/** Where each comment's words are now: id → every place (the first is its main one) */
export function markRanges(state: EditorState): Map<string, { from: number; to: number }[]> {
  const out = new Map<string, { from: number; to: number }[]>()
  for (const s of state.field(marksField).specs) {
    const list = out.get(s.id) ?? []
    list.push({ from: s.from, to: s.to })
    out.set(s.id, list)
  }
  return out
}

/**
 * The front matter, folded away: the line under the title says what it holds (dates, draft, tags),
 * and tags are edited there. The YAML stays in the file for Obsidian.
 */
class PropsWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'wr-props'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
  ignoreEvent() {
    return false
  }
}

const foldFront = StateField.define<DecorationSet>({
  create: (s) => frontDeco(s),
  update: (d, tr) => (tr.docChanged ? frontDeco(tr.state) : d),
  provide: (f) => EditorView.decorations.from(f)
})

function frontDeco(s: EditorState): DecorationSet {
  const md = s.doc.toString()
  const fm = frontMatter(md)
  if (!fm.end) return Decoration.none
  // The block ends at the closing "---" line's end (the newline after it stays)
  const end = md.slice(0, fm.end).replace(/\r?\n$/, '').length
  return Decoration.set([Decoration.replace({ widget: new PropsWidget(), block: true }).range(0, end)])
}

/** Keeps the caret out of the folded front matter */
const skipFront = EditorView.atomicRanges.of((v) => v.state.field(foldFront))

export const writingMarks = (): Extension => [marksField, foldFront, skipFront]
