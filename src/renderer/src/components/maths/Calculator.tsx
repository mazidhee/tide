import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import katex from 'katex'
import { CalcError, evalNumeric, formatNumber, parseLatex, previewOf, type Angle } from '@shared/calc'
import { addEntry, asWorking, lastAnswer, parseHistory, resultOf, type CalcEntry } from '@shared/calcHistory'
import { decimalAdds, shortDecimal } from '@shared/mathsAnswer'
import { MathField, type MathFieldHandle } from './MathField'

const STORE = 'tide.calc.history'

export function Tex({ latex, display, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => katex.renderToString(latex, { throwOnError: false, strict: 'ignore', displayMode: !!display, output: 'html' }), [latex, display])
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

/** "≈ 0.5", unless the decimal says ≈ itself (the solutions of an equation) */
const approx = (n: string) => (n.includes('\\approx') ? n : `\\approx ${n}`)

/** What joins a calculation to its answer: = for a value, ⇒ for an equation solved, ≈ for a decimal only */
const joinOf = (e: CalcEntry) => {
  if (!e.exact) return '≈'
  try {
    return parseLatex(e.input).t === 'rel' ? '⇒' : '='
  } catch {
    return '='
  }
}

const uid = () => Math.random().toString(36).slice(2, 10)

function loadHistory(): CalcEntry[] {
  try {
    return parseHistory(localStorage.getItem(STORE))
  } catch {
    return []
  }
}

/**
 * The scientific calculator beside your answer: type with the keyboard or the keypad, Return works
 * it out exactly (SymPy, in Tide's sandbox) with the decimal beside it, and a running tape keeps
 * every calculation. Anything on the tape goes into your answer in one click. No model: it works
 * offline and without Claude.
 */
export function Calculator({ angle, onAngle, onInsert, handle, onFocus }: { angle: Angle; onAngle(a: Angle): void; onInsert(latex: string): void; handle: MutableRefObject<MathFieldHandle | null>; onFocus(): void }) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<CalcEntry[]>(loadHistory)
  const [result, setResult] = useState<CalcEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tape = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(history))
    } catch {
      // only a convenience
    }
    tape.current?.scrollTo({ top: tape.current.scrollHeight })
  }, [history])

  const preview = useMemo(() => (input.trim() ? previewOf(input, angle) : null), [input, angle])
  const fresh = result && result.input === input && result.angle === angle

  const evaluate = async () => {
    // The field itself, not the last render's copy: a key and Return can come together
    const src = (handle.current?.value() ?? input).trim()
    if (!src || busy) return
    setError(null)
    // "ans" on the keypad: the last answer
    const ans = lastAnswer(history)
    const text = ans ? src.replace(/\\mathrm\{ans\}|\\text\{ans\}/g, `\\left(${ans}\\right)`) : src
    try {
      parseLatex(text)
    } catch (e) {
      setError(e instanceof CalcError ? e.message : 'Tide couldn’t read that')
      return
    }
    setBusy(true)
    const r = await window.tide.mathsAnswer.evaluate(text, angle).catch((e: Error) => ({ ok: false, error: e.message }) as const)
    setBusy(false)
    let entry: CalcEntry
    if (r.ok) entry = { id: uid(), input: src, exact: r.unchanged && r.numeric ? null : (r.exact ?? null), numeric: shortDecimal(r.numeric), angle, at: Date.now() }
    else {
      // SymPy isn't there or gave up: the decimal from here, said plainly
      let v: number | null = null
      try {
        v = evalNumeric(parseLatex(text), angle)
      } catch {
        v = null
      }
      if (v === null) {
        setError(r.error ?? 'That couldn’t be worked out')
        return
      }
      entry = { id: uid(), input: src, exact: null, numeric: formatNumber(v), angle, at: Date.now(), approx: true }
      setError(r.error ? `${r.error} The decimal is worked out without it.` : null)
    }
    if (src !== input.trim()) setInput(src)
    setResult(entry)
    setHistory((h) => addEntry(h, entry))
  }

  const insertResult = (e: CalcEntry | null, whole = false) => {
    if (!e) return
    const v = whole ? asWorking(e) : resultOf(e)
    if (v) onInsert(v)
  }

  return (
    <div
      className="calc"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && input) {
          e.preventDefault()
          e.stopPropagation()
          handle.current?.set('')
          setResult(null)
          setError(null)
        } else if (e.key === 'Enter' && e.altKey && !e.metaKey) {
          e.preventDefault()
          insertResult(fresh ? result : history[history.length - 1] ?? null, e.shiftKey)
        }
      }}
    >
      <div className="calc-tape" ref={tape} aria-label="Your calculations" role="list">
        {history.length > 0 && (
          <button className="calc-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => (setHistory([]), setResult(null))} title="Clear the tape">
            Clear
          </button>
        )}
        {history.length === 0 ? (
          <p className="calc-empty">Return works it out exactly. Your calculations collect here.</p>
        ) : (
          history.map((h) => (
            <div key={h.id} role="listitem" className={`calc-row${result?.id === h.id ? ' latest' : ''}`}>
              <button className="calc-row-main" title="Use this again" onMouseDown={(e) => e.preventDefault()} onClick={() => (handle.current?.set(h.input), handle.current?.focus(), setResult(h))}>
                <Tex latex={h.input} className="calc-in" />
                <span className="calc-eq">{joinOf(h)}</span>
                <Tex latex={h.exact ?? h.numeric ?? ''} className="calc-out" />
                {h.exact && decimalAdds(h.exact, h.numeric) && <Tex latex={approx(h.numeric!)} className="calc-dec" />}
                {h.angle === 'deg' && <span className="calc-tag">deg</span>}
              </button>
              <button className="calc-row-insert" title="Insert this answer into your working" onMouseDown={(e) => e.preventDefault()} onClick={() => insertResult(h)}>
                Insert
              </button>
            </div>
          ))
        )}
      </div>
      <div className={`calc-display${error ? ' has-error' : ''}`}>
        <div className="calc-angle" role="radiogroup" aria-label="Angles in">
          {(['rad', 'deg'] as const).map((a) => (
            <button key={a} role="radio" aria-checked={angle === a} className={angle === a ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onAngle(a)} title={a === 'rad' ? 'Angles in radians' : 'Angles in degrees'}>
              {a}
            </button>
          ))}
        </div>
        <MathField
          value={input}
          onChange={(v) => (setInput(v), setError(null))}
          onEnter={() => void evaluate()}
          onFocus={onFocus}
          handle={handle}
          label="Calculator"
          placeholder="\text{Calculate…}"
          className="calc-field"
        />
        <div className="calc-lcd" aria-live="polite">
          {busy ? (
            <span className="calc-busy">Working it out…</span>
          ) : fresh && result ? (
            <>
              <span className="calc-big">
                <span className="calc-eq">{joinOf(result)}</span>
                <Tex latex={result.exact ?? result.numeric ?? ''} />
              </span>
              {result.exact && decimalAdds(result.exact, result.numeric) && <Tex latex={approx(result.numeric!)} className="calc-dec" />}
            </>
          ) : error ? (
            <span className="calc-error">{error}</span>
          ) : preview !== null ? (
            <span className="calc-preview">
              <Tex latex={`\\approx ${preview}`} />
            </span>
          ) : (
            <span className="calc-hint" />
          )}
        </div>
      </div>
      {fresh && result && (
        <div className="calc-foot">
          <button className="calc-insert" onMouseDown={(e) => e.preventDefault()} onClick={() => insertResult(result)} title="Put the answer where your caret is in your working (⌥↩; ⇧⌥↩ inserts the whole calculation as a line)">
            Insert into my answer <kbd>⌥↩</kbd>
          </button>
        </div>
      )}
    </div>
  )
}

/** Words with maths in them: $…$ is rendered, the rest is text */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\$[^$]+\$)/g).filter(Boolean)
  return (
    <span className={className}>
      {parts.map((p, i) => (/^\$[^$]+\$$/.test(p) ? <Tex key={i} latex={p.slice(1, -1)} /> : <span key={i}>{p}</span>))}
    </span>
  )
}
