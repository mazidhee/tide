import { useRef } from 'react'
import type { LineMark } from '@shared/mathsAnswer'
import { MathField, type MathFieldHandle } from './MathField'
import { MathText } from './Calculator'

export interface WorkLine {
  id: string
  latex: string
}

export const newLine = (latex = ''): WorkLine => ({ id: Math.random().toString(36).slice(2, 10), latex })

/**
 * Your working, one step a line, the way you'd write it down: Return starts the next line, ⌫ on
 * an empty line joins it back, ↑ and ↓ move between lines. A line can start with "=" to carry on
 * from the one above. Once marked, each line shows its tick or cross and the note beside it.
 */
export function WorkingLines({
  lines,
  onLines,
  marks,
  onFocusLine,
  handles,
  readOnly
}: {
  lines: WorkLine[]
  onLines(next: WorkLine[]): void
  marks?: LineMark[] | null
  onFocusLine(id: string): void
  handles: React.MutableRefObject<Map<string, MathFieldHandle>>
  readOnly?: boolean
}) {
  const refs = useRef(new Map<string, React.MutableRefObject<MathFieldHandle | null>>())
  const refFor = (id: string) => {
    let r = refs.current.get(id)
    if (!r) {
      r = { current: null }
      refs.current.set(id, r)
    }
    return r
  }
  const focusLine = (id: string | undefined) => id && requestAnimationFrame(() => refs.current.get(id)?.current?.focus())
  // Each line's handle, for the keypad and "insert into my answer"
  for (const l of lines) {
    const h = refs.current.get(l.id)?.current
    if (h) handles.current.set(l.id, h)
  }

  return (
    <ol className={`wl${marks ? ' marked' : ''}`} aria-label="Your working, one step a line">
      {lines.map((l, i) => {
        const m = marks?.[i]
        const state = m ? (m.ok === true ? 'ok' : m.ok === false ? 'bad' : 'none') : null
        return (
          <li key={l.id} className={`wl-line${state ? ` ${state}` : ''}`}>
            <span className="wl-n" aria-hidden>
              {i + 1}
            </span>
            <div className="wl-body">
              <MathField
                value={l.latex}
                label={`Line ${i + 1}`}
                placeholder={i === 0 ? '\\text{Write your answer; Return starts the next step}' : '\\text{Next step}'}
                handle={refFor(l.id)}
                autoFocus={i === lines.length - 1 && i > 0 && !l.latex}
                onFocus={() => {
                  const h = refFor(l.id).current
                  if (h) handles.current.set(l.id, h)
                  onFocusLine(l.id)
                }}
                onChange={(v) => onLines(lines.map((x) => (x.id === l.id ? { ...x, latex: v } : x)))}
                onEnter={
                  readOnly
                    ? undefined
                    : () => {
                        const added = newLine()
                        onLines([...lines.slice(0, i + 1), added, ...lines.slice(i + 1)])
                        focusLine(added.id)
                      }
                }
                onBackspaceEmpty={
                  lines.length > 1
                    ? () => {
                        onLines(lines.filter((x) => x.id !== l.id))
                        handles.current.delete(l.id)
                        focusLine(lines[i - 1]?.id ?? lines[i + 1]?.id)
                      }
                    : undefined
                }
                onMoveOut={(dir) => {
                  if (dir === 'upward' || dir === 'backward') focusLine(lines[i - 1]?.id)
                  else if (dir === 'downward' || dir === 'forward') focusLine(lines[i + 1]?.id)
                }}
              />
              {m && (m.note || m.ok !== null) && (
                <p className="wl-note">
                  <span className="wl-mark" aria-label={m.ok === true ? 'Right' : m.ok === false ? 'Wrong' : 'Not marked'}>
                    {m.ok === true ? '✓' : m.ok === false ? '✗' : '·'}
                  </span>
                  <MathText text={m.note} />
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
