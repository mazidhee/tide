import { SIDEBAR_ITEMS } from '@shared/sidebar'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_VOICE, resetVoiceStatus, Speaker } from '../lib/voice'
import { CHARACTERS, characterById } from '@shared/characters'
import { CLOUD_TASKS, DEFAULT_CLOUD, PROVIDERS, modelPrice, providerInfo, type CloudSettings, type ModelPrice } from '@shared/providers'
import { Professor } from './Professor'
import { PillSegment } from './PromptBox'
import type { AISettings, Settings, ThemeId } from '@shared/types'
import { useApp } from '../state'
import { Icon, type IconName } from './Icon'

const THEMES: { id: ThemeId; name: string; bg: string; side: string; ink: string; accent: string }[] = [
  { id: 'system', name: 'Match system', bg: 'linear-gradient(90deg, #f7f7f5 50%, #1b1b1b 50%)', side: 'rgba(0, 0, 0, 0.06)', ink: '#8a8d93', accent: '#2f9a88' },
  { id: 'light', name: 'Light', bg: '#f7f7f5', side: '#efefec', ink: '#1d1f23', accent: '#0e7c6b' },
  { id: 'sepia', name: 'Sepia', bg: '#f3ecdf', side: '#ebe2d2', ink: '#3a2f22', accent: '#8a5a1f' },
  { id: 'graphite', name: 'Graphite', bg: '#1b1b1b', side: '#171717', ink: '#e3e3e3', accent: '#4fb8a6' },
  { id: 'dark', name: 'Slate', bg: '#1e2023', side: '#191b1e', ink: '#e6e7e9', accent: '#5cc2ae' },
  { id: 'midnight', name: 'Midnight', bg: '#000000', side: '#070707', ink: '#ededed', accent: '#a99bff' },
  { id: 'ember', name: 'Ember', bg: '#1d1916', side: '#181512', ink: '#eee4d8', accent: '#e8a44a' }
]

const PRESETS: { name: string; baseUrl: string; hint: string }[] = [
  { name: 'MLX', baseUrl: 'http://localhost:8080/v1', hint: 'mlx_vlm.server' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', hint: 'Ollama' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', hint: 'LM Studio' }
]

/** Mid-tone accents that hold contrast on both light and dark themes */
const ACCENTS = [
  { name: 'Tide green', hex: '#14866f' },
  { name: 'Ocean', hex: '#2f7bd8' },
  { name: 'Indigo', hex: '#5b5bd6' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose', hex: '#d6407a' },
  { name: 'Coral', hex: '#e2603f' },
  { name: 'Amber', hex: '#c98a14' },
  { name: 'Moss', hex: '#5f8f2e' },
  { name: 'Slate', hex: '#5b6b82' },
  { name: 'Graphite', hex: '#7a7a7a' }
]

const LOCAL_SEARCH = 'http://127.0.0.1:8888'

export type Section = 'general' | 'appearance' | 'tutor' | 'study' | 'models' | 'tools' | 'usage'

export const SECTIONS: { id: Section; label: string; icon: IconName; group: string; description: string }[] = [
  { id: 'general', label: 'General', icon: 'settings', group: 'App', description: 'Where your notes live.' },
  { id: 'appearance', label: 'Appearance', icon: 'highlight', group: 'App', description: 'Theme, colour, reading and the sidebar.' },
  { id: 'tutor', label: 'Tutor and voice', icon: 'tutor', group: 'Learning', description: 'Who teaches you, and how they sound.' },
  { id: 'study', label: 'Study time', icon: 'timer', group: 'Learning', description: 'Timers and breaks while you study.' },
  { id: 'models', label: 'Models', icon: 'sparkle', group: 'AI', description: 'Gemma on this Mac does the tutoring. A cloud model can help with the hardest parts.' },
  { id: 'tools', label: 'Tools', icon: 'terminal', group: 'AI', description: 'What the tutor can use: search, code and your tasks.' },
  { id: 'usage', label: 'Usage', icon: 'graph', group: 'AI', description: 'What each model was used for this month, and what the cloud cost.' }
]

const LEGACY: Record<string, Section> = { ai: 'models', notes: 'general' }

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------- Building blocks ----------

/** A titled card of settings, like a group in System Settings */
function Group({ title, note, children }: { title?: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h2 className="set-group-title">{title}</h2>}
      <div className="set-card">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </section>
  )
}

/** One setting: what it is on the left, its control on the right */
function Row({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? ' stack' : ''}`}>
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      {children !== undefined && <div className="set-control">{children}</div>}
    </div>
  )
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange(on: boolean): void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} />
}

function Select<T extends string | number>({ value, onChange, options, label }: { value: T; onChange(v: T): void; options: { value: T; label: string }[]; label: string }) {
  return (
    <label className="set-select">
      <select value={String(value)} aria-label={label} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={10} className="set-select-caret" />
    </label>
  )
}

/** One optional helper (web search engine, maths checker): its state, and a button to set it up */
function ToolSetup({ label, hint, check, setup, onReady, busyText, actionText }: { label: string; hint?: string; check(): Promise<{ ready: boolean; detail: string }>; setup(): Promise<{ ready: boolean; detail: string }>; onReady?(): void; busyText?: string; actionText?: string }) {
  const [state, setState] = useState<{ ready: boolean; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    check()
      .then((s) => live && setState(s))
      .catch((e) => live && setState({ ready: false, detail: (e as Error).message }))
    return () => {
      live = false
    }
  }, [check])
  const run = async () => {
    setBusy(true)
    try {
      const s = await setup()
      setState(s)
      if (s.ready) onReady?.()
    } catch (e) {
      setState({ ready: false, detail: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      label={
        <span className="set-status-label">
          <span className={`tool-dot${state?.ready ? ' ok' : state ? ' off' : ''}`} aria-hidden="true" />
          {label}
        </span>
      }
      hint={busy ? busyText ?? 'Setting up (about 200 MB the first time)…' : state?.detail ?? hint ?? 'Checking…'}
    >
      {!state?.ready && (
        <button className="btn small" onClick={run} disabled={busy || !state}>
          {busy ? 'Setting up…' : actionText ?? 'Set up'}
        </button>
      )}
    </Row>
  )
}

/** Your Metabase, read-only, so the tutor can teach you your own dashboards and data */
function MetabaseGroup() {
  const [state, setState] = useState<{ ready: boolean; detail: string; url: string } | null>(null)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    window.tide.metabase
      .status()
      .then((s) => {
        setState(s)
        setUrl(s.url)
      })
      .catch(() => setState({ ready: false, detail: 'Not connected', url: '' }))
  }, [])
  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      setState(await window.tide.metabase.connect(url, key))
      setKey('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    await window.tide.metabase.disconnect()
    setState({ ready: false, detail: 'Not connected', url: '' })
  }
  const connected = !!state?.url && state.detail !== 'Not connected'
  return (
    <Group title="Metabase" note="Read-only: the tutor can look and run SELECT queries, never change anything. Anything about Metabase is answered by Gemma on this Mac, never a cloud model.">
      {connected ? (
        <Row
          label={
            <span className="set-status-label">
              <span className={`tool-dot${state.ready ? ' ok' : ' off'}`} aria-hidden="true" />
              {state.url.replace(/^https?:\/\//, '')}
            </span>
          }
          hint={state.detail}
        >
          <button className="btn small ghost" onClick={disconnect}>
            Disconnect
          </button>
        </Row>
      ) : (
        <>
          <Row label="Address">
            <input className="set-input wide" value={url} placeholder="https://analytics.example.com" onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Metabase address" />
          </Row>
          <Row label="API key" hint={error ? <span className="set-error">{error}</span> : 'Make one in Metabase: Admin › Settings › Authentication › API keys. Kept in your Keychain.'}>
            <span className="set-inline">
              <input className="set-input" type="password" placeholder="mb_…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && key.trim() && connect()} aria-label="Metabase API key" />
              <button className="btn small primary" disabled={!url.trim() || !key.trim() || busy} onClick={connect}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </span>
          </Row>
        </>
      )}
    </Group>
  )
}

// ---------- Sections ----------

function GeneralSection() {
  const app = useApp()
  const { settings } = app
  return (
    <>
      <Group title="Your notes">
        <Row label="Notes folder" hint={<code className="path">{settings.vaultPath ?? 'Not set'}</code>}>
          <button
            className="btn small"
            onClick={async () => {
              const p = await window.tide.vault.choose()
              if (p) app.updateSettings({ vaultPath: p })
            }}
          >
            Change…
          </button>
        </Row>
        <Row label="Library folder" hint="Saved links, videos, PDFs and docs go here, inside your notes folder.">
          <input className="set-input" defaultValue={settings.libraryFolder} aria-label="Library folder" onBlur={(e) => e.target.value.trim() && app.updateSettings({ libraryFolder: e.target.value.trim() })} />
        </Row>
      </Group>
    </>
  )
}

function AppearanceSection() {
  const app = useApp()
  const { settings } = app
  const hidden = settings.sidebarHidden ?? []
  return (
    <>
      <Group title="Theme">
        <div className="set-pad">
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} className={`theme-swatch${settings.theme === t.id ? ' on' : ''}`} onClick={() => app.updateSettings({ theme: t.id })} aria-pressed={settings.theme === t.id}>
                <span className="swatch-preview" style={{ background: t.bg }}>
                  <span className="swatch-side" style={{ background: t.side }} />
                  <span className="swatch-lines">
                    <span style={{ background: t.ink }} />
                    <span style={{ background: t.ink, opacity: 0.5 }} />
                    <span style={{ background: t.accent, width: '40%' }} />
                  </span>
                </span>
                <span className="swatch-name">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
        <Row label="Accent colour" hint={settings.accent ? ACCENTS.find((a) => a.hex === settings.accent)?.name ?? 'Custom' : "The theme's own"}>
          <div className="accent-row" role="radiogroup" aria-label="Accent colour">
            <button role="radio" aria-checked={!settings.accent} className={`accent-swatch theme-default${!settings.accent ? ' on' : ''}`} onClick={() => app.updateSettings({ accent: null })} title="The theme's own">
              <span />
            </button>
            {ACCENTS.map((a) => (
              <button key={a.hex} role="radio" aria-checked={settings.accent === a.hex} className={`accent-swatch${settings.accent === a.hex ? ' on' : ''}`} style={{ ['--sw' as string]: a.hex }} onClick={() => app.updateSettings({ accent: a.hex })} title={a.name}>
                <span />
              </button>
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Reading">
        <Row label="Line width">
          <PillSegment
            label="Line width"
            value={settings.readingWidth}
            onChange={(v) => app.updateSettings({ readingWidth: v as typeof settings.readingWidth })}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'normal', label: 'Normal' },
              { value: 'wide', label: 'Wide' }
            ]}
          />
        </Row>
        <Row label="Reading font">
          <PillSegment
            label="Reading font"
            value={settings.readingFont ?? 'sans'}
            onChange={(v) => app.updateSettings({ readingFont: v as 'sans' | 'serif' })}
            options={[
              { value: 'sans', label: 'Sans' },
              { value: 'serif', label: 'Serif' }
            ]}
          />
        </Row>
        <Row label="Text size" hint={`${settings.fontSize}px`}>
          <input className="set-range" type="range" min={14} max={22} step={1} value={settings.fontSize} onChange={(e) => app.updateSettings({ fontSize: Number(e.target.value) })} aria-label="Text size" />
        </Row>
      </Group>
      <Group title="Sidebar" note="Hidden items stay in the menu bar and the search palette.">
        {SIDEBAR_ITEMS.map((item) => (
          <Row key={item.id} label={item.label}>
            <Toggle label={`Show ${item.label}`} on={!hidden.includes(item.id)} onChange={(on) => app.updateSettings({ sidebarHidden: on ? hidden.filter((h) => h !== item.id) : [...hidden, item.id] })} />
          </Row>
        ))}
      </Group>
    </>
  )
}

function StudySection() {
  const app = useApp()
  const { settings } = app
  return (
    <>
      <Group title="While you study" note="Tide tracks your study time by itself (lessons, reading, practice, flashcards) and pauses when you go quiet, so you never have to start a timer.">
        <Row label="Timers" hint="The Focus timer and the timer buttons on notes and practice.">
          <Toggle label="Timers" on={settings.studyTimers !== false} onChange={(on) => app.updateSettings({ studyTimers: on })} />
        </Row>
        <Row label="Breaks">
          <Select
            label="Breaks"
            value={settings.pomodoro ?? 'auto'}
            onChange={(v) => app.updateSettings({ pomodoro: v })}
            options={[
              { value: 'auto', label: 'Paced by the tutor' },
              { value: '25', label: 'Every 25 minutes, 5 off' },
              { value: '50', label: 'Every 50 minutes, 10 off' },
              { value: 'off', label: 'No reminders' }
            ]}
          />
        </Row>
      </Group>
    </>
  )
}

/** The tutor's character and voice: set up the natural one (Kokoro, on this Mac), pick who speaks and how fast */
function TutorSection() {
  const app = useApp()
  const prefs = app.settings.voice ?? DEFAULT_VOICE
  const [step, setStep] = useState('')
  const [ready, setReady] = useState(false)
  const [preview, setPreview] = useState<Speaker | null>(null)
  useEffect(() => window.tide.voice.onProgress(setStep), [])
  const save = (patch: Partial<typeof prefs>) => app.updateSettings({ voice: { ...prefs, ...patch } })
  const hear = (name: string) => {
    preview?.stop()
    const s = new Speaker({ ...prefs, name })
    s.onIdle = () => setPreview((cur) => (cur === s ? null : cur))
    s.say('Right then. A logarithm asks one question: what power turns the base into this number? Hmm, think of it as counting doublings. Try log base two of eight.')
    setPreview(s)
  }
  const setup = useCallback(async () => {
    const r = await window.tide.voice.setup()
    resetVoiceStatus()
    return r
  }, [])
  const check = useCallback(() => window.tide.voice.status().then((r) => (setReady(r.ready), r)), [])
  return (
    <>
      <Group title="Your tutor" note="Their face around Tide, their voice, and how they talk when you use Talk. The teaching is the same.">
        <div className="set-pad">
          <div className="voice-choices" role="radiogroup" aria-label="Your tutor">
            {CHARACTERS.map((c) => {
              const on = (app.settings.character ?? 'professor') === c.id
              return (
                <div key={c.id} className={`voice-choice character${on ? ' on' : ''}`}>
                  <button role="radio" aria-checked={on} onClick={() => app.updateSettings({ character: c.id })}>
                    <Professor state={on ? 'happy' : 'idle'} size={34} character={c.id} />
                    <span className="character-text">
                      <strong>{c.name}</strong>
                      <span className="muted small">{c.blurb}</span>
                    </span>
                  </button>
                  <button className="icon-btn small" disabled={!ready || prefs.engine === 'system'} title={`Hear ${c.name}`} onClick={() => hear(c.voice)}>
                    <Icon name="speaker" size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <Row label="In the menu bar">
          <Select
            label="In the menu bar"
            value={app.settings.menuBar ?? 'always'}
            onChange={(v) => app.updateSettings({ menuBar: v })}
            options={[
              { value: 'always', label: 'Always, acting out what you’re doing' },
              { value: 'studying', label: 'Only while you study' },
              { value: 'off', label: 'Off' }
            ]}
          />
        </Row>
      </Group>
      <Group title="Voice">
        <ToolSetup label="Natural voice" hint="Kokoro and Parakeet, running on this Mac" check={check} setup={setup} onReady={() => setReady(true)} busyText={step || 'Setting up (about 1 GB the first time)…'} />
        <Row label="Use the Mac’s own voice" hint="More robotic, nothing to set up.">
          <Toggle label="Use the Mac’s own voice" on={prefs.engine === 'system'} onChange={(on) => save({ engine: on ? 'system' : 'natural' })} />
        </Row>
        <VoicePicker prefs={prefs} own={characterById(app.settings.character).voice} ready={ready && prefs.engine !== 'system'} save={save} hear={hear} />
        <Row label="Dictation" hint={prefs.dictation === 'handy' ? 'Speak puts the cursor in the box; press your Handy shortcut and Handy types what you say. Hands-free talk still uses Tide’s model.' : 'Speak records you and Tide writes it out on this Mac (Parakeet).'}>
          <Select label="Dictation" value={prefs.dictation ?? 'tide'} onChange={(v) => save({ dictation: v as 'tide' | 'handy' })} options={[{ value: 'tide', label: 'Tide (Parakeet)' }, { value: 'handy', label: 'Handy' }]} />
        </Row>
        <Row label="Speed">
          <Select label="Speed" value={prefs.speed} onChange={(v) => save({ speed: v })} options={[0.85, 0.95, 1, 1.1, 1.2, 1.35].map((v) => ({ value: v, label: v === 1 ? 'Normal' : `${v}×` }))} />
        </Row>
      </Group>
    </>
  )
}

const KOKORO_VOICES = [
  { value: 'bm_lewis', label: 'Lewis: deeper, British' },
  { value: 'bm_fable', label: 'Fable: British' },
  { value: 'bm_daniel', label: 'Daniel: British' },
  { value: 'bm_george', label: 'George: British (the Professor)' }
]

/** Which voice the tutor speaks in: the character's own, or one of the natural British voices */
function VoicePicker({ prefs, own, ready, save, hear }: { prefs: NonNullable<Settings['voice']>; own: string; ready: boolean; save(p: Partial<NonNullable<Settings['voice']>>): void; hear(name: string): void }) {
  const custom = prefs.custom ?? ''
  return (
    <Row label="Voice" hint="Replaces the character’s voice everywhere.">
      <span className="set-inline">
        <Select label="Voice" value={custom} onChange={(v) => save({ custom: v || undefined })} options={[{ value: '', label: "The tutor's own" }, ...KOKORO_VOICES]} />
        <button className="icon-btn small" disabled={!ready} title="Hear it" onClick={() => hear(custom || own)}>
          <Icon name="speaker" size={13} />
        </button>
      </span>
    </Row>
  )
}

/** The local server's details: rarely changed once it works */
function LocalModel({ onStatus }: { onStatus(s: { ok: boolean; model: string }): void }) {
  const app = useApp()
  const [ai, setAi] = useState<AISettings>(app.settings.ai)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const saveAi = async (patch: Partial<AISettings>) => {
    const next = { ...ai, ...patch }
    setAi(next)
    await app.updateSettings({ ai: next })
  }
  const test = useCallback(async () => {
    setTesting(true)
    const res = await window.tide.ai.test()
    const list = res.ok ? await window.tide.ai.models() : []
    setStatus(res)
    setModels(list)
    onStatus({ ok: res.ok, model: app.settings.ai.model || list[0] || '' })
    setTesting(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    test()
  }, [test])
  return (
    <Group title="On this Mac">
      <Row label="Server" hint={PRESETS.find((p) => p.baseUrl === ai.baseUrl)?.hint ?? 'Any OpenAI-compatible server'}>
        <input className="set-input wide" value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} onBlur={() => saveAi({})} spellCheck={false} aria-label="Server address" />
      </Row>
      <Row label="Model">
        <input className="set-input wide" list="model-list" value={ai.model} placeholder={models[0] ? `Default: ${models[0].split('/').pop()}` : 'Server default'} onChange={(e) => setAi({ ...ai, model: e.target.value })} onBlur={() => saveAi({})} spellCheck={false} aria-label="Model" />
        <datalist id="model-list">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Row>
      <Row label="Creativity" hint={ai.temperature <= 0.3 ? 'Precise' : ai.temperature >= 0.8 ? 'Playful' : 'Balanced'}>
        <input className="set-range" type="range" min={0} max={1} step={0.1} value={ai.temperature} onChange={(e) => saveAi({ temperature: Number(e.target.value) })} aria-label="Creativity" />
      </Row>
      <ToolSetup label="Speed-ups" hint="Prompt cache and draft model" check={window.tide.runner.speedStatus} setup={window.tide.runner.applySpeedups} busyText="Reloading the model with speed-ups…" actionText="Turn on" />
      <Row label="Connection" hint={status ? <span className={status.ok ? '' : 'error-text'}>{status.message}</span> : 'Checking…'}>
        <button className="btn small" onClick={test} disabled={testing}>
          {testing ? 'Checking…' : 'Check again'}
        </button>
      </Row>
    </Group>
  )
}

const money = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`)
const priceText = (p?: ModelPrice) => (p ? `$${p.input} in, $${p.output} out per million tokens` : 'Price not set')

const cloudOf = (c?: CloudSettings): CloudSettings => ({ ...DEFAULT_CLOUD, ...c, tasks: { ...DEFAULT_CLOUD.tasks, ...(c?.tasks ?? {}) }, providers: { ...DEFAULT_CLOUD.providers, ...(c?.providers ?? {}) } })

/** A section that opens on demand, for settings most people never touch */
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`set-disclosure${open ? ' open' : ''}`}>
      <button className="set-disclosure-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={11} />
        {title}
      </button>
      {open && <div className="set-disclosure-body">{children}</div>}
    </div>
  )
}

function ModelsSection() {
  const app = useApp()
  const cloud = cloudOf(app.settings.cloud)
  const save = (patch: Partial<CloudSettings>) => app.updateSettings({ cloud: { ...cloud, ...patch } })
  const [local, setLocal] = useState<{ ok: boolean; model: string } | null>(null)
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [keyDraft, setKeyDraft] = useState('')
  const [live, setLive] = useState<string[]>([])
  const [test, setTest] = useState<{ ok: boolean; message: string; limits?: Record<string, string> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [custom, setCustom] = useState({ name: '', baseUrl: '', model: '' })
  const info = providerInfo(cloud.provider, cloud)
  const known = PROVIDERS.find((p) => p.id === cloud.provider)
  const providers = [...PROVIDERS.map((p) => p.id), ...Object.keys(cloud.providers).filter((id) => !PROVIDERS.some((p) => p.id === id))]

  useEffect(() => {
    window.tide.cloud.keys().then(setKeys)
    // What's answering on this Mac, for the summary
    window.tide.ai
      .test()
      .then(async (r) => setLocal({ ok: r.ok, model: app.settings.ai.model || (r.ok ? (await window.tide.ai.models())[0] ?? '' : '') }))
      .catch(() => setLocal({ ok: false, model: '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    setTest(null)
    setKeyDraft('')
    setLive([])
    if (keys[cloud.provider]) window.tide.cloud.models(cloud.provider).then(setLive)
  }, [cloud.provider, keys])

  const pick = (provider: string) => {
    if (provider === '__add') return setAdding(true)
    save({ provider, model: providerInfo(provider, cloud).models[0]?.id ?? '' })
  }
  const saveKey = async (key: string | null) => {
    setBusy(true)
    try {
      await window.tide.cloud.setKey(cloud.provider, key)
      setKeys(await window.tide.cloud.keys())
      setKeyDraft('')
      setTest(key ? await window.tide.cloud.test(cloud.provider, cloud.model) : null)
    } catch (e) {
      setTest({ ok: false, message: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const runTest = async () => {
    setBusy(true)
    setTest(await window.tide.cloud.test(cloud.provider, cloud.model))
    setBusy(false)
  }
  const setPrice = (field: keyof ModelPrice, v: string) => {
    const current = modelPrice(cloud.provider, cloud.model, cloud) ?? { input: 0, output: 0 }
    const prov = cloud.providers[cloud.provider] ?? {}
    save({ providers: { ...cloud.providers, [cloud.provider]: { ...prov, prices: { ...(prov.prices ?? {}), [cloud.model]: { ...current, [field]: Math.max(0, Number(v) || 0) } } } } })
  }
  const addCustom = () => {
    const id = custom.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom'
    save({ provider: id, model: custom.model.trim(), providers: { ...cloud.providers, [id]: { name: custom.name.trim(), baseUrl: custom.baseUrl.trim(), models: custom.model.trim() ? [custom.model.trim()] : [], plan: 'paid' } } })
    setAdding(false)
    setCustom({ name: '', baseUrl: '', model: '' })
  }

  const modelIds = [...new Set([...info.models.map((m) => m.id), ...live.filter((id) => !/whisper|guard|orpheus|tts|embed|allam/i.test(id))])]
  const modelLabel = (id: string) => info.models.find((m) => m.id === id)?.label ?? id
  const price = modelPrice(cloud.provider, cloud.model, cloud)
  const plan = cloud.providers[cloud.provider]?.plan ?? 'paid'
  const ready = cloud.mode !== 'off' && keys[cloud.provider]
  const modeText = { off: 'Off', manual: 'When you ask', auto: 'Automatic' }[cloud.mode]

  return (
    <>
      <div className="model-summary">
        <div className="model-card">
          <span className="model-card-kicker">
            <span className={`tool-dot${local?.ok ? ' ok' : local ? ' off' : ''}`} aria-hidden="true" />
            On this Mac
          </span>
          <strong>{local?.model ? local.model.split('/').pop() : local ? 'Not connected' : 'Checking…'}</strong>
          <span className="model-card-detail">Lessons, chat and voice. Private.</span>
        </div>
        <div className={`model-card${ready ? '' : ' muted-card'}`}>
          <span className="model-card-kicker">
            <span className={`tool-dot${ready ? ' ok' : ''}`} aria-hidden="true" />
            Cloud helper
          </span>
          <strong>{cloud.mode === 'off' ? 'Off' : `${modelLabel(cloud.model)}`}</strong>
          <span className="model-card-detail">{cloud.mode === 'off' ? 'For the hardest maths, mistakes, marking and plans' : `${info.name}, ${modeText.toLowerCase()}${keys[cloud.provider] ? '' : ', needs a key'}`}</span>
        </div>
      </div>

      <Group title="Cloud helper">
        <Row label="Use a cloud model" hint={cloud.mode === 'auto' ? 'For the jobs below, and whenever you pick it' : cloud.mode === 'manual' ? 'Only when you pick it in a chat or lesson' : undefined}>
          <Select
            label="Use a cloud model"
            value={cloud.mode}
            onChange={(v) => save({ mode: v })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'manual', label: 'When I ask' },
              { value: 'auto', label: 'Automatically' }
            ]}
          />
        </Row>
        {cloud.mode !== 'off' && (
          <>
            <Row label="Provider" hint={info.summary ?? (known ? undefined : info.baseUrl)}>
              <Select label="Provider" value={cloud.provider} onChange={pick} options={[...providers.map((id) => ({ value: id, label: providerInfo(id, cloud).name })), { value: '__add', label: 'Add another…' }]} />
            </Row>
            {adding && (
              <div className="set-pad provider-add">
                <input className="set-input" placeholder="Name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} aria-label="Provider name" autoFocus />
                <input className="set-input wide" placeholder="https://api.example.com/v1" value={custom.baseUrl} onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })} spellCheck={false} aria-label="Address" />
                <input className="set-input" placeholder="Model id" value={custom.model} onChange={(e) => setCustom({ ...custom, model: e.target.value })} spellCheck={false} aria-label="Model id" />
                <span className="set-inline">
                  <button className="btn small ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                  <button className="btn small primary" disabled={!custom.name.trim() || !/^https?:\/\//.test(custom.baseUrl.trim())} onClick={addCustom}>
                    Add provider
                  </button>
                </span>
              </div>
            )}
            <Row
              label="API key"
              hint={
                keys[cloud.provider] ? (
                  'Saved in your Keychain'
                ) : known?.keyUrl ? (
                  <a href={known.keyUrl} target="_blank" rel="noreferrer">
                    Get a key
                  </a>
                ) : undefined
              }
            >
              {keys[cloud.provider] ? (
                <span className="set-inline">
                  <span className="key-mask" aria-hidden="true">
                    ••••••••
                  </span>
                  <button className="btn small ghost" disabled={busy} onClick={() => saveKey(null)}>
                    Remove
                  </button>
                </span>
              ) : (
                <span className="set-inline">
                  <input className="set-input" type="password" placeholder="Paste your key" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && keyDraft.trim() && saveKey(keyDraft)} aria-label="API key" />
                  <button className="btn small primary" disabled={!keyDraft.trim() || busy} onClick={() => saveKey(keyDraft)}>
                    Save
                  </button>
                </span>
              )}
            </Row>
            <Row label="Model" hint={info.models.find((m) => m.id === cloud.model)?.note}>
              <Select label="Model" value={cloud.model} onChange={(v) => save({ model: v })} options={(modelIds.includes(cloud.model) ? modelIds : [cloud.model, ...modelIds]).filter(Boolean).map((id) => ({ value: id, label: modelLabel(id) }))} />
            </Row>
            <Row label="Billing" hint={plan === 'free' ? 'Counted at $0. Usage shows what it would have cost.' : priceText(price)}>
              <Select
                label="Billing"
                value={plan}
                onChange={(v) => save({ providers: { ...cloud.providers, [cloud.provider]: { ...(cloud.providers[cloud.provider] ?? {}), plan: v } } })}
                options={[
                  { value: 'free', label: 'Free tier' },
                  { value: 'paid', label: 'Paid' }
                ]}
              />
            </Row>
            <Row label="Connection" hint={test ? <span className={test.ok ? '' : 'error-text'}>{test.message}{test.limits ? `. Limits: ${Object.entries(test.limits).map(([k, v]) => `${Number(v).toLocaleString()} ${k}`).join(', ')}` : ''}</span> : keys[cloud.provider] ? 'Not checked yet' : 'Add a key first'}>
              <button className="btn small" onClick={runTest} disabled={busy || !keys[cloud.provider]}>
                {busy ? 'Checking…' : 'Test'}
              </button>
            </Row>
          </>
        )}
      </Group>

      {cloud.mode === 'auto' && (
        <Group title="Send these to the cloud model">
          {CLOUD_TASKS.map((t) => (
            <Row key={t.id} label={t.label} hint={t.detail}>
              <Toggle label={t.label} on={cloud.tasks[t.id]} onChange={(on) => save({ tasks: { ...cloud.tasks, [t.id]: on } })} />
            </Row>
          ))}
        </Group>
      )}

      <Disclosure title="Advanced">
        {cloud.mode !== 'off' && (
          <Group title="Cloud model">
            <Row label="Reasoning effort" hint="Higher is slower and better for proofs">
              <Select
                label="Reasoning effort"
                value={cloud.reasoning ?? 'medium'}
                onChange={(v) => save({ reasoning: v })}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' }
                ]}
              />
            </Row>
            <Row label="Monthly budget" hint="Automatic use stops at this paid spend. 0 for no limit">
              <span className="set-inline">
                <span className="muted">$</span>
                <input className="set-input tiny" type="number" min={0} step={1} defaultValue={cloud.monthlyBudget ?? 0} aria-label="Monthly budget in US dollars" onBlur={(e) => save({ monthlyBudget: Math.max(0, Number(e.target.value) || 0) })} />
              </span>
            </Row>
            <Row label="Price per million tokens" hint={price ? priceText(price) : 'Not known for this model: set it from the provider’s pricing page'}>
              <span className="set-inline">
                <input className="set-input tiny" type="number" min={0} step="0.01" placeholder="In" defaultValue={price?.input} key={`in-${cloud.model}`} aria-label="Input price" onBlur={(e) => e.target.value && setPrice('input', e.target.value)} />
                <input className="set-input tiny" type="number" min={0} step="0.01" placeholder="Out" defaultValue={price?.output} key={`out-${cloud.model}`} aria-label="Output price" onBlur={(e) => e.target.value && setPrice('output', e.target.value)} />
              </span>
            </Row>
          </Group>
        )}
        <LocalModel onStatus={setLocal} />
      </Disclosure>
    </>
  )
}

function ToolsSection() {
  const app = useApp()
  const [ai, setAi] = useState<AISettings>(app.settings.ai)
  const saveAi = async (patch: Partial<AISettings>) => {
    const next = { ...ai, ...patch }
    setAi(next)
    await app.updateSettings({ ai: next })
  }
  const provider = ai.webSearch?.provider === 'searxng' && ai.webSearch.url === LOCAL_SEARCH ? 'local' : ai.webSearch?.provider ?? 'wikipedia'
  return (
    <>
      <Group title="Tutor tools">
        <Row label="Tools" hint="Note search, web search, code and helpers. Turn off for models without tool calling.">
          <Toggle label="Tools" on={ai.agent !== false} onChange={(on) => saveAi({ agent: on })} />
        </Row>
        <Row label="Web search">
          <Select
            label="Web search"
            value={provider}
            onChange={(v) =>
              saveAi({
                webSearch:
                  v === 'local'
                    ? { ...ai.webSearch, provider: 'searxng', url: LOCAL_SEARCH }
                    : { ...ai.webSearch, provider: v as NonNullable<AISettings['webSearch']>['provider'], url: v === 'searxng' && ai.webSearch?.url === LOCAL_SEARCH ? '' : ai.webSearch?.url }
              })
            }
            options={[
              { value: 'local', label: 'Private, on this Mac' },
              { value: 'wikipedia', label: 'Wikipedia only' },
              { value: 'brave', label: 'Brave Search' },
              { value: 'tavily', label: 'Tavily' },
              { value: 'searxng', label: 'SearXNG elsewhere' },
              { value: 'off', label: 'Off' }
            ]}
          />
        </Row>
        {(ai.webSearch?.provider === 'brave' || ai.webSearch?.provider === 'tavily') && (
          <Row label={`${ai.webSearch.provider === 'brave' ? 'Brave Search' : 'Tavily'} key`}>
            <input className="set-input" type="password" value={ai.webSearch.apiKey ?? ''} onChange={(e) => setAi({ ...ai, webSearch: { ...ai.webSearch!, apiKey: e.target.value } })} onBlur={() => saveAi({})} aria-label="Search API key" />
          </Row>
        )}
        {ai.webSearch?.provider === 'searxng' && ai.webSearch.url !== LOCAL_SEARCH && (
          <Row label="SearXNG address">
            <input className="set-input wide" value={ai.webSearch.url ?? ''} placeholder="http://localhost:8888" onChange={(e) => setAi({ ...ai, webSearch: { ...ai.webSearch!, url: e.target.value } })} onBlur={() => saveAi({})} spellCheck={false} aria-label="SearXNG address" />
          </Row>
        )}
      </Group>
      <Group title="Helpers on this Mac">
        {provider === 'local' && (
          <ToolSetup label="Web search engine" check={window.tide.runner.searchStatus} setup={window.tide.runner.setupSearch} onReady={() => saveAi({ webSearch: { ...ai.webSearch, provider: 'searxng', url: LOCAL_SEARCH } })} />
        )}
        <ToolSetup label="Maths checker" hint="Python with SymPy" check={window.tide.runner.mathStatus} setup={window.tide.runner.setupMath} />
        <ToolSetup label="Data libraries" hint="NumPy, pandas, Matplotlib" check={window.tide.runner.librariesStatus} setup={window.tide.runner.setupLibraries} />
        <ToolSetup label="Things 4" hint="Tasks and deadlines" check={window.tide.learn.thingsStatus} setup={window.tide.learn.thingsStatus} busyText="Checking…" actionText="Check again" />
      </Group>
      <MetabaseGroup />
    </>
  )
}

type Usage = Awaited<ReturnType<typeof window.tide.cloud.usage>>

const TASK_LABEL: Record<string, string> = { maths: 'Hard maths', errors: 'Finding mistakes', marking: 'Marking', planning: 'Planning', tutor: 'Lessons', chat: 'Chat', background: 'Background', other: 'Other' }

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

function UsageSection() {
  const [offset, setOffset] = useState(0)
  const [u, setU] = useState<Usage | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    window.tide.cloud.usage(offset).then(setU)
  }, [offset])
  const max = useMemo(() => Math.max(1, ...(u?.days ?? []).map((d) => d.cloud)), [u])
  if (!u) return <p className="muted">Loading…</p>
  const budgetShare = u.budget ? Math.min(1, u.cloud.cost / u.budget) : 0
  const day = hover !== null ? u.days[hover] : null
  return (
    <>
      <div className="usage-head">
        <PillSegment
          label="Month"
          value={String(offset)}
          onChange={(v) => setOffset(Number(v))}
          options={[
            { value: '0', label: 'This month' },
            { value: '1', label: 'Last month' }
          ]}
        />
        <span className="muted">{u.month}</span>
      </div>
      <div className="usage-tiles">
        <div className="usage-tile">
          <span className="usage-value">{money(u.cloud.cost)}</span>
          <span className="usage-label">Cloud spend{u.budget ? ` of $${u.budget}` : ''}</span>
          {u.budget > 0 && (
            <span className="usage-meter" aria-hidden="true">
              <span style={{ width: `${budgetShare * 100}%` }} />
            </span>
          )}
        </div>
        <div className="usage-tile">
          <span className="usage-value">{u.cloud.requests}</span>
          <span className="usage-label">Cloud requests, {tokens(u.cloud.input + u.cloud.output)} tokens</span>
        </div>
        <div className="usage-tile">
          <span className="usage-value">{u.local.requests}</span>
          <span className="usage-label">On this Mac, {tokens(u.local.input + u.local.output)} tokens, free</span>
        </div>
      </div>
      {(u.cloud.freeValue > 0 || u.cloud.unpriced > 0) && (
        <p className="set-note">
          {u.cloud.freeValue > 0 && `Free-tier requests would have cost ${money(u.cloud.freeValue)} at list price. `}
          {u.cloud.unpriced > 0 && `${u.cloud.unpriced} request${u.cloud.unpriced === 1 ? '' : 's'} used a model with no price set, so they’re not in the total.`}
        </p>
      )}
      <Group title="Cloud tokens by day">
        <div className="set-pad">
          <div className="usage-chart" role="img" aria-label={`Cloud tokens per day in ${u.month}`} onMouseLeave={() => setHover(null)}>
            {u.days.map((d, i) => (
              <span key={d.date} className={`usage-bar${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)}>
                <span style={{ height: d.cloud ? `${Math.max(4, (d.cloud / max) * 100)}%` : 0 }} />
              </span>
            ))}
            {day && (
              <span className="usage-tip" style={{ left: `${((hover! + 0.5) / u.days.length) * 100}%` }}>
                <strong>{new Date(day.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                <span>{tokens(day.cloud)} cloud tokens</span>
                <span>{tokens(day.local)} on this Mac</span>
                <span>{money(day.cost)}</span>
              </span>
            )}
          </div>
          <div className="usage-axis">
            <span>{u.days[0]?.date.slice(8)}</span>
            <span>{u.days[u.days.length - 1]?.date.slice(8)}</span>
          </div>
        </div>
      </Group>
      {u.byModel.length > 0 && (
        <Group title="By model">
          {u.byModel.map((m) => (
            <Row key={m.provider + m.model} label={`${providerInfo(m.provider).name} · ${providerInfo(m.provider).models.find((x) => x.id === m.model)?.label ?? m.model}`} hint={`${m.requests} requests, ${tokens(m.input)} in, ${tokens(m.output)} out${m.plan === 'free' ? ', free tier' : ''}`}>
              <span className="usage-num">{m.unpriced ? '—' : money(m.cost)}</span>
            </Row>
          ))}
        </Group>
      )}
      <Group title="By job">
        {u.byTask.length ? (
          u.byTask.map((t) => (
            <Row key={t.task} label={TASK_LABEL[t.task] ?? t.task} hint={`${t.cloud} in the cloud, ${t.local} on this Mac`}>
              <span className="usage-num">{money(t.cost)}</span>
            </Row>
          ))
        ) : (
          <Row label="Nothing yet this month" />
        )}
      </Group>
    </>
  )
}

export function SettingsView({ section = 'general' }: { section?: Section | 'ai' | 'notes' }) {
  const tab: Section = LEGACY[section] ?? (section as Section)
  const meta = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0]
  return (
    <div className="page settings-page">
      <div className="settings-body" key={tab}>
        <header className="settings-head">
          <h1 className="settings-section-title">{meta.label}</h1>
          <p className="settings-section-desc">{meta.description}</p>
        </header>
        {tab === 'general' && <GeneralSection />}
        {tab === 'appearance' && <AppearanceSection />}
        {tab === 'tutor' && <TutorSection />}
        {tab === 'study' && <StudySection />}
        {tab === 'models' && <ModelsSection />}
        {tab === 'tools' && <ToolsSection />}
        {tab === 'usage' && <UsageSection />}
      </div>
    </div>
  )
}
