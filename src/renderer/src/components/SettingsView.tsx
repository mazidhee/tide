import { SIDEBAR_ITEMS } from '@shared/sidebar'
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_VOICE, resetVoiceStatus, Speaker } from '../lib/voice'
import { CHARACTERS } from '@shared/characters'
import { Professor } from './Professor'
import type { AISettings, ThemeId } from '@shared/types'
import { useApp } from '../state'
import { Icon } from './Icon'

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
  { name: 'MLX', baseUrl: 'http://localhost:8080/v1', hint: 'mlx_lm.server or mlx-openai-server' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', hint: 'Ollama on this Mac' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', hint: 'LM Studio local server' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hint: 'Needs an API key' }
]

type Section = 'appearance' | 'ai' | 'notes'

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

/** One optional helper (web search engine, maths checker): what state it's in, and a button to set it up */
/** The tutor's voice: set up the natural one (Kokoro, on this Mac), pick who speaks and how fast */
function VoiceSettings() {
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
      <p className="muted small">Who your tutor is: their face around Tide, their voice, and how they talk when you use Talk.</p>
      <ToolSetup label="Natural voice (Kokoro, runs on this Mac)" check={check} setup={setup} onReady={() => setReady(true)} busyText={step || 'Setting up (about 1 GB the first time)…'} />
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
      <label className="field-inline">
        In the menu bar
        <select value={app.settings.menuBar ?? 'always'} onChange={(e) => app.updateSettings({ menuBar: e.target.value as 'always' | 'studying' | 'off' })}>
          <option value="always">Always, acting out what you’re doing</option>
          <option value="studying">Only while you study</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label className="field-inline">
        <input type="checkbox" checked={prefs.engine === 'system'} onChange={(e) => save({ engine: e.target.checked ? 'system' : 'natural' })} /> Use the Mac’s own voice instead (more robotic)
      </label>
      <label className="field-inline">
        Speed
        <select value={prefs.speed} onChange={(e) => save({ speed: Number(e.target.value) })}>
          {[0.85, 0.95, 1, 1.1, 1.2, 1.35].map((v) => (
            <option key={v} value={v}>
              {v === 1 ? 'Normal' : `${v}×`}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

function ToolSetup({ label, check, setup, onReady, busyText, actionText }: { label: string; check(): Promise<{ ready: boolean; detail: string }>; setup(): Promise<{ ready: boolean; detail: string }>; onReady?(): void; busyText?: string; actionText?: string }) {
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
      setState({ ready: false, detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tool-setup">
      <span className={`tool-dot${state?.ready ? ' ok' : state ? ' off' : ''}`} aria-hidden="true" />
      <div className="tool-setup-text">
        <span>{label}</span>
        <span className="muted small">{busy ? busyText ?? 'Setting up (about 200 MB the first time)…' : state?.detail ?? 'Checking…'}</span>
      </div>
      {!state?.ready && (
        <button className="btn small" onClick={run} disabled={busy || !state}>
          {busy ? 'Setting up…' : actionText ?? 'Set up'}
        </button>
      )}
    </div>
  )
}

export function SettingsView({ section = 'appearance' }: { section?: Section }) {
  const app = useApp()
  const { settings } = app
  const [tab, setTab] = useState<Section>(section)
  const [ai, setAi] = useState<AISettings>(settings.ai)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => setTab(section), [section])

  const saveAi = async (patch: Partial<AISettings>) => {
    const next = { ...ai, ...patch }
    setAi(next)
    await app.updateSettings({ ai: next })
  }

  const test = async () => {
    setTesting(true)
    await app.updateSettings({ ai })
    const res = await window.tide.ai.test()
    setStatus(res)
    setModels(res.ok ? await window.tide.ai.models() : [])
    setTesting(false)
  }

  useEffect(() => {
    if (tab === 'ai') window.tide.ai.models().then(setModels)
  }, [tab])

  return (
    <div className="page">
      <div className="page-inner narrow">
        <h1 className="page-title">Settings</h1>
        <div className="chips settings-tabs" role="tablist">
          {(['appearance', 'ai', 'notes'] as Section[]).map((s) => (
            <button key={s} role="tab" aria-selected={tab === s} className={`chip${tab === s ? ' on' : ''}`} onClick={() => setTab(s)}>
              {s === 'appearance' ? 'Appearance' : s === 'ai' ? 'AI tutor' : 'Notes folder'}
            </button>
          ))}
        </div>

        {tab === 'appearance' && (
          <section className="settings-section">
            <h2 className="section-title">Theme</h2>
            <div className="theme-grid">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-swatch${settings.theme === t.id ? ' on' : ''}`}
                  onClick={() => app.updateSettings({ theme: t.id })}
                  aria-pressed={settings.theme === t.id}
                >
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

            <h2 className="section-title spaced">Accent colour</h2>
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
            <p className="muted small accent-name">{settings.accent ? ACCENTS.find((a) => a.hex === settings.accent)?.name ?? 'Custom' : "The theme's own accent"}</p>

            <h2 className="section-title spaced">Sidebar</h2>
            <p className="muted small sidebar-choice-note">Hidden items stay in the menu bar.</p>
            <div className="sidebar-choices">
              {SIDEBAR_ITEMS.map((item) => {
                const hidden = settings.sidebarHidden ?? []
                const on = !hidden.includes(item.id)
                return (
                  <label key={item.id} className="field-check compact">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => app.updateSettings({ sidebarHidden: e.target.checked ? hidden.filter((h) => h !== item.id) : [...hidden, item.id] })}
                    />
                    <span>{item.label}</span>
                  </label>
                )
              })}
            </div>

            <h2 className="section-title spaced">Study timers</h2>
            <label className="field-check">
              <input type="checkbox" checked={settings.studyTimers !== false} onChange={(e) => app.updateSettings({ studyTimers: e.target.checked })} />
              <span>
                Time your study
                <span className="muted small">Focus timer and per-note timers.</span>
              </span>
            </label>
            <p className="muted small">Tide also tracks your study time by itself (lessons, reading, practice, flashcards), pausing when you go quiet, so you never have to start a timer.</p>
            <label className="field-inline">
              Breaks
              <select value={settings.pomodoro ?? 'auto'} onChange={(e) => app.updateSettings({ pomodoro: e.target.value as 'auto' | 'off' | '25' | '50' })}>
                <option value="auto">Paced by the tutor (25 min lessons, 45 min deep work)</option>
                <option value="25">Every 25 minutes, 5 off</option>
                <option value="50">Every 50 minutes, 10 off</option>
                <option value="off">No break reminders</option>
              </select>
            </label>

            <h2 className="section-title spaced">Reading</h2>
            <div className="field">
              <span>Line width</span>
              <div className="segmented text">
                {(['narrow', 'normal', 'wide'] as const).map((w) => (
                  <button key={w} className={settings.readingWidth === w ? 'on' : ''} onClick={() => app.updateSettings({ readingWidth: w })}>
                    {w[0].toUpperCase() + w.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Reading font</span>
              <div className="segmented text">
                {(
                  [
                    ['sans', 'Sans'],
                    ['serif', 'Serif']
                  ] as const
                ).map(([f, label]) => (
                  <button key={f} className={(settings.readingFont ?? 'sans') === f ? 'on' : ''} onClick={() => app.updateSettings({ readingFont: f })} style={{ fontFamily: f === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Text size</span>
              <div className="row-gap">
                <input
                  type="range"
                  min={14}
                  max={22}
                  step={1}
                  value={settings.fontSize}
                  onChange={(e) => app.updateSettings({ fontSize: Number(e.target.value) })}
                  aria-label="Text size"
                />
                <span className="muted">{settings.fontSize}px</span>
              </div>
            </div>
          </section>
        )}

        {tab === 'ai' && (
          <section className="settings-section">
            <p className="muted">
              <button className="link-btn" onClick={() => app.setView({ kind: 'help', section: 'Getting started' })}>
                Setup guide
              </button>{' '}
              Tide works with any server that speaks the OpenAI API, including models running on your Mac. Your notes
              are only sent to the server you set here.
            </p>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.name} className={`preset${ai.baseUrl === p.baseUrl ? ' on' : ''}`} onClick={() => saveAi({ baseUrl: p.baseUrl })}>
                  <strong>{p.name}</strong>
                  <span className="muted small">{p.hint}</span>
                </button>
              ))}
            </div>
            <label className="field">
              <span>Server address</span>
              <input value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} onBlur={() => saveAi({})} spellCheck={false} />
            </label>
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                value={ai.apiKey}
                placeholder="Not needed for local servers"
                onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                onBlur={() => saveAi({})}
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                list="model-list"
                value={ai.model}
                placeholder={models[0] ? `Server default (${models[0]})` : 'Server default'}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                onBlur={() => saveAi({})}
                spellCheck={false}
              />
              <datalist id="model-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Creativity</span>
              <div className="row-gap">
                <input type="range" min={0} max={1} step={0.1} value={ai.temperature} onChange={(e) => saveAi({ temperature: Number(e.target.value) })} aria-label="Temperature" />
                <span className="muted">{ai.temperature.toFixed(1)}</span>
              </div>
            </label>
            <h2 className="section-title spaced">Tutor tools</h2>
            <label className="field-check">
              <input type="checkbox" checked={ai.agent !== false} onChange={(e) => saveAi({ agent: e.target.checked })} />
              <span>
                Tools: notes, web search, helpers
                <span className="muted small">Turn off for models without tool calling.</span>
              </span>
            </label>
            <label className="field">
              <span>Web search</span>
              <select
                value={ai.webSearch?.provider === 'searxng' && ai.webSearch.url === LOCAL_SEARCH ? 'local' : ai.webSearch?.provider ?? 'wikipedia'}
                onChange={(e) =>
                  saveAi({
                    webSearch:
                      e.target.value === 'local'
                        ? { ...ai.webSearch, provider: 'searxng', url: LOCAL_SEARCH }
                        : { ...ai.webSearch, provider: e.target.value as NonNullable<AISettings['webSearch']>['provider'], url: e.target.value === 'searxng' && ai.webSearch?.url === LOCAL_SEARCH ? '' : ai.webSearch?.url }
                  })
                }
              >
                <option value="local">Private search on this Mac (recommended)</option>
                <option value="wikipedia">Wikipedia only (no setup)</option>
                <option value="brave">Brave Search (free API key)</option>
                <option value="tavily">Tavily (API key)</option>
                <option value="searxng">SearXNG at another address</option>
                <option value="off">Off</option>
              </select>
            </label>
            {(ai.webSearch?.provider === 'brave' || ai.webSearch?.provider === 'tavily') && (
              <label className="field">
                <span>{ai.webSearch.provider === 'brave' ? 'Brave Search' : 'Tavily'} API key</span>
                <input
                  type="password"
                  value={ai.webSearch.apiKey ?? ''}
                  onChange={(e) => setAi({ ...ai, webSearch: { ...ai.webSearch!, apiKey: e.target.value } })}
                  onBlur={() => saveAi({})}
                />
              </label>
            )}
            {ai.webSearch?.provider === 'searxng' && ai.webSearch.url === LOCAL_SEARCH && (
              <ToolSetup
                label="Web search engine"
                check={window.tide.runner.searchStatus}
                setup={window.tide.runner.setupSearch}
                onReady={() => saveAi({ webSearch: { ...ai.webSearch, provider: 'searxng', url: LOCAL_SEARCH } })}
              />
            )}
            <ToolSetup label="Maths checker (Python with SymPy)" check={window.tide.runner.mathStatus} setup={window.tide.runner.setupMath} />
            <ToolSetup label="Data libraries (NumPy, pandas, Matplotlib)" check={window.tide.runner.librariesStatus} setup={window.tide.runner.setupLibraries} />
            <ToolSetup label="Things 4 (tasks and deadlines)" check={window.tide.learn.thingsStatus} setup={window.tide.learn.thingsStatus} busyText="Checking…" actionText="Check again" />
            <ToolSetup label="Model speed-ups (prompt cache, draft model)" check={window.tide.runner.speedStatus} setup={window.tide.runner.applySpeedups} busyText="Reloading the model with speed-ups…" actionText="Turn on" />

            {ai.webSearch?.provider === 'searxng' && ai.webSearch.url !== LOCAL_SEARCH && (
              <label className="field">
                <span>SearXNG address</span>
                <input
                  value={ai.webSearch.url ?? ''}
                  placeholder="http://localhost:8888"
                  onChange={(e) => setAi({ ...ai, webSearch: { ...ai.webSearch!, url: e.target.value } })}
                  onBlur={() => saveAi({})}
                  spellCheck={false}
                />
              </label>
            )}

            <div className="row-gap">
              <button className="btn primary" onClick={test} disabled={testing}>
                {testing ? 'Checking…' : 'Test connection'}
              </button>
              {status && (
                <span className={status.ok ? 'ok-text' : 'error-text'}>
                  {status.ok && <Icon name="check" size={14} />} {status.message}
                </span>
              )}
            </div>

            <h2 className="section-title spaced">Your tutor and voice</h2>
            <VoiceSettings />
          </section>
        )}

        {tab === 'notes' && (
          <section className="settings-section">
            <div className="field">
              <span>Notes folder</span>
              <div className="row-gap">
                <code className="path">{settings.vaultPath ?? 'Not set'}</code>
                <button
                  className="btn"
                  onClick={async () => {
                    const p = await window.tide.vault.choose()
                    if (p) app.updateSettings({ vaultPath: p })
                  }}
                >
                  Change
                </button>
              </div>
              <p className="muted small">
                Tide works on these Markdown files directly, alongside Obsidian.
              </p>
            </div>
            <label className="field">
              <span>Library folder</span>
              <input
                defaultValue={settings.libraryFolder}
                onBlur={(e) => e.target.value.trim() && app.updateSettings({ libraryFolder: e.target.value.trim() })}
              />
              <p className="muted small">Saved links, videos, PDFs and docs go here, inside your notes folder.</p>
            </label>
          </section>
        )}
      </div>
    </div>
  )
}
