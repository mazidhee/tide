import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * Where you tell Tide something: one field that grows as you write, with its options as pills in
 * a bar along the bottom and the action at the end, like the chat composer. Enter submits (⌘↵ in
 * long-form boxes, where Enter is a new line).
 */
export function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  tools,
  action = 'arrow',
  busy,
  disabled,
  multiline,
  autoFocus,
  minRows = 1,
  label,
  hint,
  onBlur,
  onFocus,
  allowEmpty,
  ready
}: {
  value: string
  onChange(v: string): void
  onSubmit?(): void
  placeholder?: string
  /** Pills along the bottom: sources, levels, languages… */
  tools?: ReactNode
  /** A round arrow, a labelled button, or none (the box saves as you type) */
  action?: 'arrow' | 'none' | string
  busy?: boolean
  disabled?: boolean
  /** Long-form: Enter is a new line and ⌘↵ submits */
  multiline?: boolean
  autoFocus?: boolean
  minRows?: number
  label?: string
  hint?: ReactNode
  /** Boxes that save as you go: save when you leave the box */
  onBlur?(): void
  onFocus?(): void
  /** The action works with nothing typed (the pills say enough) */
  allowEmpty?: boolean
  /** Whether the action can go, when that depends on more than the text */
  ready?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 320) + 'px'
    el.style.overflowY = el.scrollHeight > 320 ? 'auto' : 'hidden'
  }, [value])
  const can = (ready ?? (allowEmpty || !!value.trim())) && !busy && !disabled
  return (
    <form
      className={`prompt-box${busy ? ' busy' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (can) onSubmit?.()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.focus()
      }}
    >
      <textarea
        ref={ref}
        value={value}
        rows={minRows}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          if (multiline ? e.metaKey || e.ctrlKey : !e.shiftKey) {
            e.preventDefault()
            if (can) onSubmit?.()
          }
        }}
      />
      {(tools || action !== 'none' || hint) && (
        <div className="prompt-bar">
          <div className="prompt-tools">{tools}</div>
          {hint && <span className="prompt-hint">{hint}</span>}
          {action === 'arrow' ? (
            <button type="submit" className="prompt-send" disabled={!can} aria-label="Go" title={multiline ? '⌘↵' : '↵'}>
              {busy ? <span className="spinner" /> : <Icon name="arrowUp" size={15} />}
            </button>
          ) : action !== 'none' ? (
            <button type="submit" className="btn primary small prompt-action" disabled={!can}>
              {busy ? <span className="spinner" /> : null}
              {action}
              <kbd>{multiline ? '⌘↵' : '↵'}</kbd>
            </button>
          ) : null}
        </div>
      )}
    </form>
  )
}

/** A choice as a pill: the current value shows, the list opens on click */
export function PillSelect<T extends string>({ value, onChange, options, icon, label }: { value: T; onChange(v: T): void; options: { value: T; label: string }[]; icon?: Parameters<typeof Icon>[0]['name']; label: string }) {
  return (
    <label className="pill select" title={label}>
      {icon && <Icon name={icon} size={13} />}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={10} className="pill-caret" />
    </label>
  )
}

/** A few levels side by side, one picked */
export function PillSegment<T extends string>({ value, onChange, options, label }: { value: T; onChange(v: T): void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="pill-segment" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A short free-text option as a pill: a role, a date, a note */
export function PillInput({
  value,
  onChange,
  placeholder,
  icon,
  width = 120,
  type = 'text',
  prefix,
  suffix,
  min,
  max
}: {
  value: string
  onChange(v: string): void
  placeholder: string
  icon?: Parameters<typeof Icon>[0]['name']
  width?: number
  type?: 'text' | 'date' | 'number'
  /** Words around the value: "Finish by" [date], [6] "hours a week" */
  prefix?: string
  suffix?: string
  min?: string | number
  max?: string | number
}) {
  return (
    <label className={`pill pill-input${value ? ' filled' : ''}`}>
      {icon && <Icon name={icon} size={13} />}
      {prefix && <span className="pill-word">{prefix}</span>}
      <input type={type} value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={prefix ?? placeholder} style={type === 'number' ? undefined : { width }} />
      {suffix && <span className="pill-word">{suffix}</span>}
    </label>
  )
}

/** An on/off option as a pill */
export function PillToggle({ on, onChange, label, icon, disabled, title }: { on: boolean; onChange(on: boolean): void; label: string; icon?: Parameters<typeof Icon>[0]['name']; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={`pill toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled} title={title} onClick={() => onChange(!on)}>
      {icon && <Icon name={icon} size={13} />}
      {label}
    </button>
  )
}
