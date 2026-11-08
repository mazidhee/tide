import { useEffect, useRef } from 'react'
import type { PageSettings } from '../lib/pageSettings'
import { PERSONA_LIST, type PersonaId } from '@shared/personas'

function Toggle({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button className="menu-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className={`switch${on ? ' on' : ''}`} />
    </button>
  )
}

export function PageMenu({
  settings,
  update,
  onClose
}: {
  settings: PageSettings
  update(patch: Partial<PageSettings>): void
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])

  return (
    <div className="popover page-menu" ref={ref} role="dialog" aria-label="Page settings">
      <div className="font-choices" role="radiogroup" aria-label="Font">
        {(['serif', 'sans', 'mono'] as const).map((f) => (
          <button key={f} role="radio" aria-checked={settings.font === f} className={settings.font === f ? 'on' : ''} onClick={() => update({ font: f })}>
            <span className={`font-sample font-${f}`}>Ag</span>
            <span>{f === 'serif' ? 'Serif' : f === 'sans' ? 'Sans' : 'Mono'}</span>
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      <div className="menu-row">
        <span>Text size</span>
        <div className="segmented text">
          {(['s', 'm', 'l'] as const).map((s) => (
            <button key={s} className={settings.textSize === s ? 'on' : ''} onClick={() => update({ textSize: s })}>
              {s === 's' ? 'Small' : s === 'm' ? 'Default' : 'Large'}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Full width" on={settings.fullWidth} onChange={(v) => update({ fullWidth: v })} />
      <div className="menu-sep" />
      <div className="menu-row">
        <span>Tutor in this note</span>
        <select value={settings.tutorMode} onChange={(e) => update({ tutorMode: e.target.value as PageSettings['tutorMode'] })} aria-label="Tutor mode">
          <option value="off">Off</option>
          <option value="ask">When I ask</option>
          <option value="readalong">Questions me when I pause</option>
          <option value="strict">Challenges every claim</option>
        </select>
      </div>
      {settings.tutorMode !== 'off' && (
        <>
          <div className="menu-row">
            <span>Reads as</span>
            <select value={settings.persona} onChange={(e) => update({ persona: e.target.value as PersonaId })} aria-label="Tutor persona">
              {PERSONA_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <p className="menu-help">{PERSONA_LIST.find((p) => p.id === settings.persona)?.blurb}</p>
          <div className="menu-field">
            <span className="muted small">Ask the panel</span>
            <div className="persona-chips">
              {PERSONA_LIST.map((p) => {
                const on = settings.panel.includes(p.id)
                return (
                  <button
                    key={p.id}
                    className={`chip-toggle${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() => update({ panel: on ? settings.panel.filter((x) => x !== p.id) : [...settings.panel, p.id].slice(-4) })}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
      {settings.tutorMode !== 'off' && (
        <label className="menu-field">
          <span className="muted small">How should the tutor help here?</span>
          <textarea
            rows={2}
            defaultValue={settings.tutorInstructions}
            placeholder="e.g. Quiz me before Friday. Be strict about proofs."
            onBlur={(e) => update({ tutorInstructions: e.target.value })}
          />
        </label>
      )}
      <Toggle label="Show resolved tutor threads" on={settings.showResolved} onChange={(v) => update({ showResolved: v })} />
    </div>
  )
}
