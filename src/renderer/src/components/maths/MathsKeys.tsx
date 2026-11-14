import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Angle } from '@shared/calc'
import { applyPlainKey, latexToPlain, PLAIN_PAGES, type PlainKey } from '@shared/plainKeys'
import { useApp } from '../../state'
import { Calculator } from './Calculator'
import { Keypad } from './Keypad'
import type { MathFieldHandle } from './MathField'
import '../../styles/mathsAnswer.css'

/**
 * The maths keys for a plain text field: the maths answer box's keypad and calculator, typing
 * readable text (1011₂, 2¹⁰, √(2), ≤) into a thread, or the lesson's answer box when the lesson
 * isn't maths. A quiet button beside the field opens them; each kind of field remembers whether
 * they were open.
 */

const STORE = (kind: string) => `tide.mathsKeys.${kind}`

/** Open or shut, as you last left it for this kind of field; `fallback` when you never chose */
export function useMathsKeys(kind: string, fallback = false): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(STORE(kind))
      return v === null ? fallback : v === 'on'
    } catch {
      return fallback
    }
  })
  const toggle = () =>
    setOpen((on) => {
      try {
        localStorage.setItem(STORE(kind), on ? 'off' : 'on')
      } catch {
        // only a convenience
      }
      return !on
    })
  return [open, toggle]
}

/** The ∑ button in the field's tool row */
export function MathsKeysButton({ open, onToggle, className = 'tool-btn' }: { open: boolean; onToggle(): void; className?: string }) {
  return (
    <button type="button" className={`${className} mk-toggle${open ? ' on' : ''}`} aria-pressed={open} title="Maths keys and calculator" aria-label="Maths keys and calculator" onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 5H6l6.5 7L6 19h12" />
      </svg>
    </button>
  )
}

/**
 * The keypad and calculator under a field. Keys type into the field (or into the calculator when
 * that has the caret) and never take the focus; the calculator's answer goes in as text.
 */
export function MathsKeysPanel({ field, value, onChange }: { field: RefObject<HTMLTextAreaElement | null>; value: string; onChange(v: string): void }) {
  const app = useApp()
  const [angle, setAngleState] = useState<Angle>(app.settings.maths?.angle ?? 'rad')
  const setAngle = (a: Angle) => {
    setAngleState(a)
    void app.updateSettings({ maths: { ...app.settings.maths, angle: a } })
  }
  const calc = useRef<MathFieldHandle | null>(null)
  const inCalc = useRef(false)
  const latest = useRef(value)
  latest.current = value
  // The field going back to the text: keys type there again
  useEffect(() => {
    const el = field.current
    if (!el) return
    const back = () => (inCalc.current = false)
    el.addEventListener('focus', back)
    return () => el.removeEventListener('focus', back)
  }, [field])

  const into = (k: { insert?: string; command?: string }) => {
    const el = field.current
    const text = latest.current
    const start = el && document.activeElement === el ? el.selectionStart : (el?.selectionStart ?? text.length)
    const end = el && document.activeElement === el ? el.selectionEnd : (el?.selectionEnd ?? text.length)
    const next = applyPlainKey({ text, start, end }, k)
    if (next.text !== text) onChange(next.text)
    latest.current = next.text
    // After React has the new value in the field: the caret where the key left it
    requestAnimationFrame(() => {
      const f = field.current
      if (!f) return
      f.setSelectionRange(next.start, next.end)
      if (document.activeElement !== f && !inCalc.current) f.focus()
    })
  }

  const onKey = (key: PlainKey) => {
    if (inCalc.current && calc.current) {
      if (key.command) calc.current.command(key.command)
      else if (key.tex) calc.current.insert(key.tex)
      return
    }
    into(key)
  }

  return (
    <div className="mk-panel" role="group" aria-label="Maths keys and calculator">
      <div className="mk-grid">
        <Calculator angle={angle} onAngle={setAngle} handle={calc} onFocus={() => (inCalc.current = true)} onInsert={(latex) => ((inCalc.current = false), into({ insert: latexToPlain(latex) }))} />
        <Keypad onKey={(k) => onKey(k as PlainKey)} pages={PLAIN_PAGES} store="tide.mathsKeys.page" />
      </div>
    </div>
  )
}
