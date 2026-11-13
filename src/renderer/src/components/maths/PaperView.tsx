import { useRef, useState } from 'react'
import { boxStyle, type Marked, type PaperLine } from '@shared/mathsAnswer'
import { vaultUrl } from '../../lib/markdown'
import { Icon } from '../Icon'
import { MathText, Tex } from './Calculator'
import { MathField } from './MathField'

const VERDICT_WORD = { correct: 'Correct.', partial: 'Nearly.', wrong: 'Not yet.' } as const

/**
 * Your page beside Claude's reading of it. Each line of working is boxed on the photo where you
 * wrote it; once marked, the right ones are quiet and the wrong ones stand out. Tapping a line in
 * the reading lights it up on the page, and tapping a box on the page finds its line. Before
 * marking, any line Claude misread can be put right (or taken out) in place.
 */
export function PaperView({
  pages,
  lines,
  marks,
  onEdit,
  onDrop,
  compact
}: {
  pages: string[]
  lines: PaperLine[]
  marks?: Marked | null
  onEdit?: (index: number, latex: string) => void
  onDrop?: (index: number) => void
  compact?: boolean
}) {
  const [active, setActive] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const boxes = useRef(new Map<number, HTMLDivElement>())
  const items = useRef(new Map<number, HTMLLIElement>())
  const stateOf = (i: number) => {
    const m = marks?.lines[i]
    if (!m) return lines[i]?.unsure ? 'unsure' : 'read'
    return m.ok === true ? 'ok' : m.ok === false ? 'bad' : 'none'
  }
  const firstBad = marks ? marks.lines.findIndex((m) => m.ok === false) : -1
  const pick = (i: number, from: 'page' | 'list') => {
    setActive((a) => (a === i ? null : i))
    const el = from === 'list' ? boxes.current.get(i) : items.current.get(i)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const save = () => {
    if (editing !== null && onEdit) onEdit(editing, draft)
    setEditing(null)
  }

  return (
    <div className={`wp${compact ? ' compact' : ''}${active !== null ? ' focusing' : ''}`}>
      <div className="wp-pages">
        {pages.map((p, pi) => (
          <figure key={p} className="wp-page">
            <img src={vaultUrl(p)} alt={`Page ${pi + 1} of your working`} draggable={false} />
            {lines.map((l, i) =>
              l.page === pi && l.box ? (
                <div
                  key={i}
                  ref={(el) => {
                    if (el) boxes.current.set(i, el)
                    else boxes.current.delete(i)
                  }}
                  className={`wp-box ${stateOf(i)}${active === i ? ' active' : ''}${l.box[2] > 0.9 ? ' edge' : ''}`}
                  style={boxStyle(l.box)}
                  onClick={() => pick(i, 'page')}
                  role="button"
                  tabIndex={-1}
                  aria-label={`Line ${i + 1}`}
                >
                  <span className="wp-badge">{stateOf(i) === 'ok' ? '✓' : stateOf(i) === 'bad' ? `✗ ${i + 1}` : i + 1}</span>
                </div>
              ) : null
            )}
            {pages.length > 1 && <figcaption>Page {pi + 1}</figcaption>}
          </figure>
        ))}
      </div>
      <div className="wp-reading">
        <h4>{marks ? 'Claude’s marking of your working' : 'Claude’s reading of your working'}</h4>
        <p className="wp-sub">{marks ? 'Each line as you wrote it, and whether it holds. Tap a line to see it on your page.' : onEdit ? 'Check each line reads as you wrote it. Fix any Claude misread before it’s marked.' : 'Each line as you wrote it.'}</p>
        <ol className="wp-lines">
          {lines.map((l, i) => {
            const m = marks?.lines[i]
            const st = stateOf(i)
            return (
              <li
                key={i}
                ref={(el) => {
                  if (el) items.current.set(i, el)
                  else items.current.delete(i)
                }}
                className={`wp-line ${st}${active === i ? ' active' : ''}${i === firstBad ? ' first-bad' : ''}`}
                onClick={() => editing === null && pick(i, 'list')}
              >
                <span className="wp-n">{st === 'ok' ? <Icon name="check" size={13} /> : st === 'bad' ? <Icon name="x" size={13} /> : i + 1}</span>
                <div className="wp-main">
                  {editing === i ? (
                    <div className="wp-edit" onClick={(e) => e.stopPropagation()}>
                      <MathField value={draft} onChange={setDraft} onEnter={save} label={`Line ${i + 1}`} autoFocus />
                      <div className="row-gap">
                        <button className="btn small primary" onClick={save}>
                          Save <kbd>↩</kbd>
                        </button>
                        <button className="tool-btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Tex latex={l.latex} className="wp-tex" />
                  )}
                  {m?.note && <p className="wp-note"><MathText text={m.note} /></p>}
                  {!marks && l.unsure && editing !== i && <p className="wp-note warn">Claude wasn’t sure of this line: check it.</p>}
                  {!marks && l.edited && editing !== i && <p className="wp-note">You corrected this line.</p>}
                </div>
                {onEdit && editing !== i && (
                  <span className="wp-tools">
                    <button className="icon-btn" title="Fix this line" aria-label={`Fix line ${i + 1}`} onClick={(e) => (e.stopPropagation(), setDraft(l.latex), setEditing(i))}>
                      <Icon name="edit" size={13} />
                    </button>
                    {onDrop && (
                      <button className="icon-btn" title="Not part of my working" aria-label={`Remove line ${i + 1}`} onClick={(e) => (e.stopPropagation(), onDrop(i))}>
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        {marks && (marks.summary || marks.verdict) && (
          <div className={`wp-verdict ${marks.verdict ?? 'open'}`}>
            {marks.verdict && <b>{VERDICT_WORD[marks.verdict]}</b>} <MathText text={marks.summary} />
            {marks.by === 'sympy' && <span className="wp-by"> Checked by SymPy; your tutor gives the verdict.</span>}
          </div>
        )}
      </div>
    </div>
  )
}
