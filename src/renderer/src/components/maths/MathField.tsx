import { useEffect, useRef, type MutableRefObject } from 'react'
import type { MathfieldElement } from 'mathlive'

/**
 * One MathLive field (MIT; see THIRD_PARTY_NOTICES.md): typed maths that looks like maths. `^`
 * makes a power, `/` a fraction, and words become symbols (sqrt, pi, int, lim, sum, theta, …).
 * MathLive's own keyboard and menu are off: the answer box has its keypad (Keypad.tsx). Its fonts
 * are KaTeX's, which the app already loads.
 */

let loading: Promise<typeof import('mathlive')> | null = null
/** MathLive, loaded the first time a maths field is shown, so other screens never pay for it */
export function loadMathLive() {
  loading ??= import('mathlive').then((m) => {
    m.MathfieldElement.fontsDirectory = null
    m.MathfieldElement.soundsDirectory = null
    m.MathfieldElement.keypressSound = null
    m.MathfieldElement.plonkSound = null
    return m
  })
  return loading
}

/** What the keypad and the answer box do to the field that has the caret */
export interface MathFieldHandle {
  el: MathfieldElement | null
  insert(latex: string): void
  command(cmd: string | [string, ...unknown[]]): void
  focus(): void
  value(): string
  set(latex: string): void
}

/** Typed as you'd say it: more words that become symbols, beside MathLive's own */
const SHORTCUTS: Record<string, string> = {
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  det: '\\det',
  inf: '\\infty',
  oo: '\\infty',
  deg: '^{\\circ}',
  nCr: '\\binom{#?}{#?}',
  abs: '\\left|#?\\right|',
  ddx: '\\frac{\\mathrm{d}}{\\mathrm{d}x}',
  '->': '\\to'
}

export function MathField({
  value,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onMoveOut,
  onFocus,
  placeholder,
  autoFocus,
  handle,
  label,
  className
}: {
  value: string
  onChange(latex: string): void
  /** Return: a new line, or work it out; Shift+Return stays MathLive's */
  onEnter?: () => void
  onBackspaceEmpty?: () => void
  onMoveOut?: (direction: 'forward' | 'backward' | 'upward' | 'downward') => void
  onFocus?: () => void
  placeholder?: string
  autoFocus?: boolean
  handle?: MutableRefObject<MathFieldHandle | null>
  label: string
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const mf = useRef<MathfieldElement | null>(null)
  const latest = useRef({ onChange, onEnter, onBackspaceEmpty, onMoveOut, onFocus })
  latest.current = { onChange, onEnter, onBackspaceEmpty, onMoveOut, onFocus }

  useEffect(() => {
    let gone = false
    void loadMathLive().then(({ MathfieldElement }) => {
      if (gone || !host.current) return
      const el = new MathfieldElement()
      el.mathVirtualKeyboardPolicy = 'manual'
      el.smartFence = true
      el.smartSuperscript = true
      el.popoverPolicy = 'off'
      el.environmentPopoverPolicy = 'off'
      if (placeholder) el.placeholder = placeholder
      el.setAttribute('aria-label', label)
      el.value = value
      el.addEventListener('input', () => latest.current.onChange(el.value))
      el.addEventListener('focus', () => latest.current.onFocus?.())
      el.addEventListener('move-out', (e) => {
        const dir = (e as CustomEvent<{ direction: 'forward' | 'backward' | 'upward' | 'downward' }>).detail?.direction
        if (dir && latest.current.onMoveOut) {
          e.preventDefault()
          latest.current.onMoveOut(dir)
        }
      })
      el.addEventListener(
        'keydown',
        (e) => {
          const k = e as KeyboardEvent
          if (k.key === 'Enter' && !k.shiftKey && !k.metaKey && !k.ctrlKey && !k.altKey && latest.current.onEnter) {
            k.preventDefault()
            k.stopPropagation()
            latest.current.onEnter()
          } else if (k.key === 'Backspace' && !el.value.trim() && latest.current.onBackspaceEmpty) {
            k.preventDefault()
            latest.current.onBackspaceEmpty()
          }
        },
        { capture: true }
      )
      host.current.appendChild(el)
      mf.current = el
      // These two need the field on the page first
      try {
        el.menuItems = []
        el.inlineShortcuts = { ...el.inlineShortcuts, ...SHORTCUTS }
      } catch {
        // MathLive's defaults stand
      }
      if (autoFocus) requestAnimationFrame(() => el.focus())
    })
    return () => {
      gone = true
      mf.current?.remove()
      mf.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A value set from outside (cleared, a history entry recalled)
  useEffect(() => {
    const el = mf.current
    if (el && el.value !== value) el.value = value
  }, [value])

  useEffect(() => {
    if (!handle) return
    handle.current = {
      get el() {
        return mf.current
      },
      insert(latex) {
        const el = mf.current
        if (!el) return
        el.focus()
        el.insert(latex, { format: 'latex', selectionMode: 'placeholder', insertionMode: 'replaceSelection' })
        latest.current.onChange(el.value)
      },
      command(cmd) {
        const el = mf.current
        if (!el) return
        el.focus()
        el.executeCommand(cmd as never)
        latest.current.onChange(el.value)
      },
      focus() {
        mf.current?.focus()
      },
      value() {
        return mf.current?.value ?? ''
      },
      set(latex) {
        const el = mf.current
        if (!el) return
        el.value = latex
        latest.current.onChange(latex)
      }
    }
  })

  return <div ref={host} className={`mf-host${className ? ` ${className}` : ''}`} />
}
