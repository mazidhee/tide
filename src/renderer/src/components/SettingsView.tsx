import { SIDEBAR_ITEMS } from '@shared/sidebar'
import { breakSettings, type BreakSettings, type Strictness } from '@shared/breaks'
import { rhythmLine } from '@shared/breakPlanner'
import { prepSettings, type PrepSettings, type PrepStatus } from '@shared/lessonPrep'
import { MANIM_PACK, TEX_PACK } from '@shared/manim'
import { rhythmNow } from '../lib/breaks'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_VOICE, resetVoiceStatus, Speaker } from '../lib/voice'
import { CHARACTERS, characterById } from '@shared/characters'
import { CLOUD_TASKS, DEFAULT_CLOUD, PROVIDERS, modelPrice, providerInfo, type CloudSettings, type ModelPrice } from '@shared/providers'
import { Professor } from './Professor'
import { PillSegment } from './PromptBox'
import type { AISettings, ClaudeModel, ClaudeRole, ClaudeStatusView, GemmaStatusView, Settings, ThemeId } from '@shared/types'
import { CLAUDE_DEFAULTS, CLAUDE_MODELS } from '@shared/claude'
import { useApp } from '../state'
import { DESIGNS, readingFace, resolveDesign, type DesignId } from '@shared/design'
import { Icon, type IconName } from './Icon'
import { SpeedView } from './SpeedView'
import { ProfileSettings } from './ProfileSettings'
import { BackupsSettings } from './BackupsSettings'
import { UsageView } from './UsageView'
import { ConnectionsView } from './ConnectionsView'
import { LAB_PACK, QUANT_PACK } from '@shared/labPack'
import { usePackInstall } from './notebook/PackCard'
import type { EditorChoice, InstalledEditor } from '@shared/editor'

const THEMES: { id: ThemeId; name: string; bg: string; side: string; ink: string; accent: string }[] = [
  { id: 'system', name: 'Match system', bg: 'linear-gradient(90deg, #f7f7f5 50%, #1b1b1b 50%)', side: 'rgba(0, 0, 0, 0.06)', ink: '#8a8d93', accent: '#2f9a88' },
  { id: 'light', name: 'Light', bg: '#f7f7f5', side: '#efefec', ink: '#1d1f23', accent: '#0e7c6b' },
  { id: 'sepia', name: 'Sepia', bg: '#f3ecdf', side: '#ebe2d2', ink: '#3a2f22', accent: '#8a5a1f' },
  { id: 'graphite', name: 'Graphite', bg: '#1b1b1b', side: '#171717', ink: '#e3e3e3', accent: '#4fb8a6' },
  { id: 'dark', name: 'Slate', bg: '#1e2023', side: '#191b1e', ink: '#e6e7e9', accent: '#5cc2ae' },
  { id: 'midnight', name: 'Midnight', bg: '#000000', side: '#070707', ink: '#ededed', accent: '#a99bff' },
  { id: 'ember', name: 'Ember', bg: '#1d1916', side: '#181512', ink: '#eee4d8', accent: '#e8a44a' }
]

/** The same themes as the new design draws them (styles/tide/tokens.css) */
const TIDE_THEMES: typeof THEMES = [
  { id: 'system', name: 'Match system', bg: 'linear-gradient(90deg, #ffffff 50%, #1a1b1e 50%)', side: 'rgba(120, 130, 150, 0.16)', ink: '#8d919a', accent: '#4a86d6' },
  { id: 'light', name: 'Light', bg: '#ffffff', side: '#eff3f8', ink: '#121a26', accent: '#1257b8' },
  { id: 'sepia', name: 'Sepia', bg: '#f6efe2', side: '#ede4d3', ink: '#33291d', accent: '#1d4f9c' },
  { id: 'dark', name: 'Dark', bg: '#141a23', side: '#0f141c', ink: '#e7eaf0', accent: '#7db5f5' },
  { id: 'graphite', name: 'Graphite', bg: '#1a1b1e', side: '#141517', ink: '#e6e7ea', accent: '#7db5f5' },
  { id: 'midnight', name: 'Midnight', bg: '#000000', side: '#050608', ink: '#ededf0', accent: '#8cbcf7' },
  { id: 'ember', name: 'Ember', bg: '#1d1916', side: '#171310', ink: '#eee4d8', accent: '#8fbdf2' }
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

export type Section = 'you' | 'general' | 'backups' | 'appearance' | 'tutor' | 'study' | 'connections' | 'models' | 'tools' | 'usage' | 'speed'

export const SECTIONS: { id: Section; label: string; icon: IconName; group: string; description: string }[] = [
  { id: 'you', label: 'You', icon: 'person', group: 'App', description: 'Your name and picture. Kept on this Mac, never sent anywhere.' },
  { id: 'general', label: 'General', icon: 'settings', group: 'App', description: 'Where your notes live.' },
  { id: 'backups', label: 'Backups', icon: 'archive', group: 'App', description: 'Tide’s own data, kept safe: your lessons, What you know, ratings, profile and settings, backed up each night and restored from here.' },
  { id: 'appearance', label: 'Appearance', icon: 'highlight', group: 'App', description: 'Theme, colour, reading and the sidebar.' },
  { id: 'tutor', label: 'Tutor and voice', icon: 'tutor', group: 'Learning', description: 'Who teaches you, and how they sound.' },
  { id: 'study', label: 'Study time', icon: 'timer', group: 'Learning', description: 'Timers and breaks while you study.' },
  { id: 'connections', label: 'Connections', icon: 'link', group: 'AI', description: 'Every service Tide uses: what it’s for, where it runs, what it used today, and what you could add.' },
  { id: 'models', label: 'Models', icon: 'sparkle', group: 'AI', description: 'Who teaches: Claude on your plan for everything, with Gemma on this Mac when Claude can’t answer or you pick it.' },
  { id: 'tools', label: 'Tools', icon: 'terminal', group: 'AI', description: 'What the tutor can use: search, code and your tasks.' },
  { id: 'usage', label: 'Usage', icon: 'graph', group: 'AI', description: 'Every model call: how full your Claude plan is, tokens by day, model, job and lesson, speed, and Gemma on this Mac.' },
  { id: 'speed', label: 'Speed', icon: 'gauge', group: 'AI', description: 'Where each answer’s time went: Tide, the model reading, the model writing, and tools.' }
]

const LEGACY: Record<string, Section> = { ai: 'models', notes: 'general' }

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------- Building blocks ----------

/** A titled card of settings, like a group in System Settings */
export function Group({ title, note, children }: { title?: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h2 className="set-group-title">{title}</h2>}
      <div className="set-card">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </section>
  )
}

/** One setting: what it is on the left, its control on the right */
export function Row({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
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

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange(on: boolean): void; label: string; disabled?: boolean }) {
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

/** The lab pack: PyTorch, scikit-learn and the rest, installed once, saying what pip is doing as it goes */
function LabPackSetup() {
  const [step, setStep] = useState('')
  useEffect(() => window.tide.runner.onLabProgress(setStep), [])
  return <ToolSetup label="Lab pack" hint={LAB_PACK.contents} check={window.tide.runner.labStatus} setup={window.tide.runner.setupLab} busyText={step || 'Starting…'} actionText={`Install (${LAB_PACK.size})`} />
}

/**
 * The quant pack: the Jupyter kernel for notebooks, and the statistics, data, optimisation and
 * pricing libraries, installed in the background with uv when it's on this Mac; then the size it
 * really took. Yahoo Finance prices are a separate, opt-in switch because of Yahoo's terms.
 */
function QuantPackSetup() {
  const app = useApp()
  const { status, step, busy, install, setStatus } = usePackInstall()
  const internet = !!app.settings.notebook?.internet
  const size = status?.sizeMb ? `${Math.round(status.sizeMb)} MB` : QUANT_PACK.size
  return (
    <>
      <Row
        label={
          <span className="set-status-label">
            <span className={`tool-dot${status?.ready ? ' ok' : status ? ' off' : ''}`} aria-hidden="true" />
            Quant pack
          </span>
        }
        hint={busy ? step || 'Starting…' : status ? `${status.detail}${!status.ready ? ` · installs with ${status.installer}` : ''}` : 'Checking…'}
      >
        {!status?.ready && (
          <button className="btn small" onClick={() => void install()} disabled={busy || !status}>
            {busy ? 'Installing…' : `Install (${size})`}
          </button>
        )}
      </Row>
      {status?.ready && (
        <Row label="Yahoo Finance prices in notebooks" hint="Off by default. yfinance (Apache-2.0) downloads prices from Yahoo, whose terms allow personal use only and may block it; the bundled Treasury, ECB and sample data need no internet. Turning it on lets a notebook’s kernel reach the internet.">
          <Toggle
            label="Yahoo Finance prices in notebooks"
            on={internet && status.yahoo}
            onChange={async (on) => {
              if (on && !status.yahoo) setStatus(await window.tide.notebook.installYahoo())
              await app.updateSettings({ notebook: { ...app.settings.notebook, internet: on } })
            }}
          />
        </Row>
      )}
    </>
  )
}

/** Maths animations: Manim, then TinyTeX for typeset equations, each installed only when pressed; narration in Tide's voice */
function AnimationsSetup() {
  const [step, setStep] = useState('')
  const [texStep, setTexStep] = useState('')
  const [anim, setAnim] = useState<{ narration: boolean; quality: 'low' | 'medium' } | null>(null)
  const [manimReady, setManimReady] = useState(false)
  useEffect(() => window.tide.manim.onInstallProgress(setStep), [])
  useEffect(() => window.tide.manim.onTexProgress(setTexStep), [])
  useEffect(() => {
    window.tide.manim
      .status()
      .then((s) => {
        setAnim(s.settings)
        setManimReady(s.manim.ready)
      })
      .catch(() => {})
  }, [])
  const checkManim = useCallback(() => window.tide.manim.status().then((s) => s.manim), [])
  const checkTex = useCallback(() => window.tide.manim.status().then((s) => s.tex), [])
  const install = useCallback(() => window.tide.manim.install(), [])
  const installTex = useCallback(() => window.tide.manim.installTex(), [])
  const save = (patch: { narration?: boolean; quality?: 'low' | 'medium' }) => window.tide.manim.settings(patch).then(setAnim)
  return (
    <>
      <ToolSetup label="Maths animations" hint={`Manim: narrated animations in maths lessons (${MANIM_PACK.download} to download)`} check={checkManim} setup={install} onReady={() => setManimReady(true)} busyText={step || 'Starting…'} actionText={`Install maths animations (${MANIM_PACK.download})`} />
      {manimReady && <ToolSetup label="Equations in animations" hint="TinyTeX, so equations are typeset; without it they are drawn as plain text" check={checkTex} setup={installTex} busyText={texStep || 'Starting…'} actionText={`Install (${TEX_PACK.download})`} />}
      {manimReady && anim && (
        <>
          <Row label="Narrate animations" hint="In Tide’s voice, each beat as long as its line; captions either way">
            <Toggle label="Narrate animations" on={anim.narration} onChange={(on) => void save({ narration: on })} />
          </Row>
          <Row label="Animation quality" hint="Standard is 720p; quick is 480p and renders about twice as fast">
            <Select label="Animation quality" value={anim.quality} onChange={(v) => void save({ quality: v })} options={[{ value: 'medium', label: 'Standard (720p)' }, { value: 'low', label: 'Quick (480p)' }]} />
          </Row>
        </>
      )}
    </>
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
    <Group title="Metabase" note="Read-only: the tutor (Claude, or Gemma when Claude can’t) can look and run SELECT queries, never change anything.">
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

/** The problem bank: written and checked ahead by the cloud models, for lessons and Daily practice */
function BankRow() {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.tide.bank.status>> | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.tide.bank.status().then(setSt).catch(() => {})
  }, [])
  const when = st?.lastRun ? new Date(st.lastRun).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  return (
    <Row
      label="Problem bank"
      hint={
        busy
          ? 'Writing and checking problems for what’s coming…'
          : st?.note
            ? <span className="set-error">{st.note}</span>
            : st?.lastRun
              ? `Last topped up at ${when}: ${st.added} checked problem${st.added === 1 ? '' : 's'} added for ${st.topics} topic${st.topics === 1 ? '' : 's'}. Every half hour while Tide is open, using what’s left of the free allowance.`
              : 'Every half hour while Tide is open, the cloud model writes and checks problems for your next topics, so lessons have them ready.'
      }
    >
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setSt(await window.tide.bank.prepare().catch(() => st))
          setBusy(false)
        }}
      >
        {busy ? 'Preparing…' : 'Prepare now'}
      </button>
    </Row>
  )
}

/** Your study time for a dashboard or another app (Plain, a widget), read-only, from this Mac */
function StudyApiGroup() {
  const app = useApp()
  const [state, setState] = useState<Awaited<ReturnType<typeof window.tide.studyApi.status>> | null>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    window.tide.studyApi.status().then(setState).catch(() => {})
  }, [])
  const set = async (patch: { enabled?: boolean; lan?: boolean }) => setState(await window.tide.studyApi.set(patch))
  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => app.toast(`${what} copied`))
      .catch(() => {})
  const on = !!state?.enabled
  const example = state ? `curl -H "Authorization: Bearer ${state.token}" ${state.url}/summary?days=30` : ''
  return (
    <Group title="Study data API" note="Lets a dashboard or another app (like Plain) read your study time: sessions, minutes by day, kind and notebook, streaks, flashcards and answers. Read-only; it can’t change anything in Tide.">
      <Row label="Share my study data" hint={state?.problem ? <span className="set-error">{state.problem}</span> : on ? (state?.running ? 'Running while Tide is open.' : 'Starting…') : 'Off. Nothing is shared.'}>
        <Toggle label="Share my study data" on={on} onChange={(v) => set({ enabled: v })} />
      </Row>
      {on && state && (
        <>
          <Row label="Address" hint="Every request but /health needs the token below.">
            <span className="set-inline">
              <code className="path">{state.url}</code>
              <button className="btn small ghost" onClick={() => copy(state.url, 'Address')}>
                Copy
              </button>
            </span>
          </Row>
          <Row label="Token" hint="Send it as “Authorization: Bearer …”. A new token stops the old one working.">
            <span className="set-inline">
              <code className="path">{shown ? state.token : '•'.repeat(16)}</code>
              <button className="btn small ghost" onClick={() => setShown((v) => !v)}>
                {shown ? 'Hide' : 'Show'}
              </button>
              <button className="btn small ghost" onClick={() => copy(state.token, 'Token')}>
                Copy
              </button>
              <button className="btn small ghost" onClick={async () => setState(await window.tide.studyApi.newToken())}>
                New token
              </button>
            </span>
          </Row>
          <Row label="Other devices on my network" hint={state.lan ? (state.lanUrl ? <>Reachable at <code className="path">{state.lanUrl}</code></> : 'No network connection right now.') : 'Off: only apps on this Mac can read it.'}>
            <Toggle label="Other devices on my network" on={state.lan} onChange={(v) => set({ lan: v })} />
          </Row>
          <Row label="Try it" hint="Endpoints: /today, /summary?days=30, /sessions?from=2026-11-01. Help › Study data API has the details." stack>
            <span className="set-inline wide">
              <code className="path set-code">{shown ? example : example.replace(state.token, '<token>')}</code>
              <button className="btn small ghost" onClick={() => copy(example, 'Command')}>
                Copy
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
        <Row label="Notes open in" hint="Courses, readings and saved sources always open to read. A note you switch yourself opens the way you left it.">
          <PillSegment
            label="Notes open in"
            value={settings.noteOpenMode ?? 'write'}
            onChange={(v) => app.updateSettings({ noteOpenMode: v as 'write' | 'read' })}
            options={[
              { value: 'write', label: 'Write' },
              { value: 'read', label: 'Read' }
            ]}
          />
        </Row>
      </Group>
    </>
  )
}

function AppearanceSection() {
  const app = useApp()
  const { settings } = app
  const hidden = settings.sidebarHidden ?? []
  const design = resolveDesign(settings.design)
  const tide = design === 'tide'
  return (
    <>
      <Group title="Design" note="The earlier design is kept in full; you can switch back to it here at any time, and your theme, accent colour and text size carry over.">
        <Row label="Design" hint={DESIGNS.find((d) => d.id === design)?.about}>
          <PillSegment label="Design" value={design} onChange={(v) => app.updateSettings({ design: v as DesignId })} options={DESIGNS.map((d) => ({ value: d.id, label: d.name }))} />
        </Row>
      </Group>
      <Group title="Theme">
        <div className="set-pad">
          <div className="theme-grid">
            {(tide ? TIDE_THEMES : THEMES).map((t) => (
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
            value={readingFace(settings)}
            onChange={(v) => app.updateSettings(tide ? { tideReadingFont: v as 'sans' | 'serif' } : { readingFont: v as 'sans' | 'serif' })}
            options={
              tide
                ? [
                    { value: 'serif', label: 'Serif' },
                    { value: 'sans', label: 'Sans' }
                  ]
                : [
                    { value: 'sans', label: 'Sans' },
                    { value: 'serif', label: 'Serif' }
                  ]
            }
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
      </Group>
      <BreaksGroup />
      <PrepGroup />
    </>
  )
}

/** Lesson prep while you're away (main/lessonPrep): on or off, when, and how much Claude a night */
function PrepGroup() {
  const app = useApp()
  const p = prepSettings(app.settings.prep)
  const put = (patch: Partial<PrepSettings>) => app.updateSettings({ prep: { ...p, ...patch } })
  const [status, setStatus] = useState<PrepStatus | null>(null)
  const [working, setWorking] = useState<'' | 'prep' | 'review'>('')
  useEffect(() => {
    window.tide.prep.status().then(setStatus).catch(() => {})
  }, [app.settings.prep])
  const hours = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))
  const last = status?.last
  const lastLine = status?.ready ? `Ready: ${status.ready.topic}.` : last ? `${last.decision.why} (checked ${new Date(last.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).` : 'Nothing prepared yet.'
  return (
    <Group
      title="Lesson prep while you’re away"
      note="When Tide is open and you’re away from the Mac, or overnight, Tide gets your next lesson ready: what’s due, the best reading, checked exercises, a visual when it helps, a short plan and the warm-up, so it starts at once. Claude is used for every lesson, never when your plan is near its limit, and within the allowance below; without Claude, Tide prepares what needs no model. Once a week it also writes your weekly review."
    >
      <Row label="Prepare lessons ahead" hint={lastLine}>
        <Toggle label="Prepare lessons ahead" on={p.on} onChange={(on) => put({ on })} />
      </Row>
      {p.on && (
        <>
          <Row label="Overnight from" hint="Prep runs in this window while Tide is open.">
            <span className="set-inline">
              <Select label="From" value={p.from} onChange={(v) => put({ from: v })} options={hours} />
              <span className="muted">to</span>
              <Select label="To" value={p.to} onChange={(v) => put({ to: v })} options={hours} />
            </span>
          </Row>
          <Row label="Also when I’m away" hint={`After ${p.idleMinutes} minutes without using the Mac.`}>
            <span className="set-inline">
              <Select label="Idle for" value={p.idleMinutes} onChange={(v) => put({ idleMinutes: v })} options={[10, 20, 30, 60].map((m) => ({ value: m, label: `${m} min` }))} />
              <Toggle label="Also when I’m away" on={p.whenIdle} onChange={(whenIdle) => put({ whenIdle })} />
            </span>
          </Row>
          <Row label="Claude calls a night, at most" hint={`One lesson takes about 3, the weekly review 2. ${status ? `${status.usedTonight} used tonight.` : ''}`}>
            <Select label="Claude calls a night" value={p.maxCalls} onChange={(v) => put({ maxCalls: v })} options={[0, 3, 6, 8, 12, 20].map((n) => ({ value: n, label: n ? String(n) : 'None (prepare without Claude)' }))} />
          </Row>
          <Row label="Now">
            <span className="set-inline">
              <button
                className="btn small"
                disabled={!!working}
                onClick={async () => {
                  setWorking('prep')
                  await window.tide.prep.now().catch(() => null)
                  setStatus(await window.tide.prep.status().catch(() => null))
                  setWorking('')
                }}
              >
                {working === 'prep' ? 'Preparing…' : 'Prepare the next lesson'}
              </button>
              <button
                className="btn small"
                disabled={!!working}
                onClick={async () => {
                  setWorking('review')
                  const r = await window.tide.prep.weeklyReview().catch(() => null)
                  setWorking('')
                  if (r) app.openPath(r.path)
                }}
              >
                {working === 'review' ? 'Writing…' : 'Write this week’s review'}
              </button>
            </span>
          </Row>
        </>
      )}
    </Group>
  )
}

/** Tea breaks: when (planned from the research and your own signals), how long, and how strictly */
function BreaksGroup() {
  const app = useApp()
  const b = breakSettings(app.settings.breaks, app.settings.pomodoro)
  const put = (patch: Partial<BreakSettings>) => app.updateSettings({ breaks: { ...b, ...patch } })
  const rhythm = rhythmLine(rhythmNow())
  return (
    <Group
      title="Breaks"
      note={
        <>
          The Professor plans each tea break from what research supports (attention fades over 25 to 50 minutes of hard work; a short, quiet rest right after learning helps it settle) and from your own signals: answers slowing or slipping against your usual, more hints, drifting. It waits for the end of a question, ideally just after a step, and never lets you go past 90 minutes. {rhythm || 'It learns your rhythm as you study.'}
        </>
      }
    >
      <Row label="Tea breaks">
        <Toggle label="Tea breaks" on={b.on} onChange={(on) => put({ on })} />
      </Row>
      <Row label="Study for" hint="Auto: when your signals and the research say, between about 25 and 50 minutes to start, then your own rhythm.">
        <Select label="Study for" value={String(b.studyMinutes)} onChange={(v) => put({ studyMinutes: v === 'auto' ? 'auto' : Number(v) })} options={[{ value: 'auto', label: 'Auto (learns your rhythm)' }, ...[25, 45, 60, 75, 90].map((m) => ({ value: String(m), label: `${m} minutes` }))]} />
      </Row>
      <Row label="Break length" hint="Auto: about 5 minutes after a short block, 10 to 15 after a long or tiring one.">
        <Select label="Break length" value={String(b.breakMinutes)} onChange={(v) => put({ breakMinutes: v === 'auto' ? 'auto' : (Number(v) as 5 | 10 | 15) })} options={[{ value: 'auto', label: 'Auto' }, ...[5, 10, 15].map((m) => ({ value: String(m), label: `${m} minutes` }))]} />
      </Row>
      <Row label="Strictness" hint={b.strictness === 'gentle' ? 'Offers the break; you can keep going. At 90 minutes the break screen comes, with a skip.' : b.strictness === 'firm' ? 'The break screen comes at the planned moment. "I need Tide right now" gives 10 minutes once a block, for a reason.' : 'The break screen comes at the planned moment. 10 more minutes only once a day.'}>
        <Select label="Strictness" value={b.strictness} onChange={(v) => put({ strictness: v as Strictness })} options={[{ value: 'gentle', label: 'Gentle' }, { value: 'firm', label: 'Firm' }, { value: 'strict', label: 'Strict' }]} />
      </Row>
    </Group>
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
      <Group title="What the tutor knows about you" note="Your learner profile, a note in your vault: goals, pace, what clicks, misconceptions, how sure you tend to be, hints and the preferences you’ve stated. The tutor reads a short digest of it before every lesson and chat.">
        <Row label="Learner profile" hint="Correct or delete anything; Tide keeps your edits.">
          <button className="btn small" onClick={() => app.setView({ kind: 'learner' })}>
            Open
          </button>
        </Row>
      </Group>
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
        <Row label="Explain the why" hint="Why mode: the tutor leads you, question by question, to why each idea is so, from first principles, with history or an analogy where it explains. Longer, deeper lessons. Switch it on or off in any lesson with Why.">
          <Select
            label="Explain the why"
            value={app.settings.whyMode ?? 'foundations'}
            onChange={(v) => app.updateSettings({ whyMode: v as 'off' | 'foundations' | 'always' })}
            options={[
              { value: 'foundations', label: 'For foundations' },
              { value: 'always', label: 'Always' },
              { value: 'off', label: 'Off' }
            ]}
          />
        </Row>
        <Row label="Read back maths answers" hint="In maths lessons, an answer you say or type in words is shown back as maths (“I read this as…”) before it’s marked, so a misreading costs one word to fix. Uses Claude’s quick model.">
          <Toggle label="Read back maths answers" on={app.settings.maths?.readBack !== false} onChange={(on) => app.updateSettings({ maths: { ...app.settings.maths, readBack: on } })} />
        </Row>
      </Group>
      <Group title="Voice">
        <ToolSetup label="Natural voice" hint="Kokoro and Parakeet, running on this Mac" check={check} setup={setup} onReady={() => setReady(true)} busyText={step || 'Setting up (about 1 GB the first time)…'} />
        <Row label="Use the Mac’s own voice" hint="More robotic, nothing to set up.">
          <Toggle label="Use the Mac’s own voice" on={prefs.engine === 'system'} onChange={(on) => save({ engine: on ? 'system' : 'natural' })} />
        </Row>
        <VoicePicker prefs={prefs} own={characterById(app.settings.character).voice} ready={ready && prefs.engine !== 'system'} save={save} hear={hear} />
        <Row label="Dictation" hint={DICTATION_HINT[prefs.dictation ?? 'tide']}>
          <Select label="Dictation" value={prefs.dictation ?? 'tide'} onChange={(v) => save({ dictation: v as 'tide' | 'handy' | 'deepgram' | 'flow' })} options={[{ value: 'flow', label: 'Wispr Flow' }, { value: 'tide', label: 'Tide (Parakeet)' }, { value: 'deepgram', label: 'Deepgram (Nova-3)' }, { value: 'handy', label: 'Handy' }]} />
        </Row>
        {prefs.dictation === 'deepgram' && <DeepgramKey />}
        <Row label="Speed">
          <Select label="Speed" value={prefs.speed} onChange={(v) => save({ speed: v })} options={[0.85, 0.95, 1, 1.1, 1.2, 1.35].map((v) => ({ value: v, label: v === 1 ? 'Normal' : `${v}×` }))} />
        </Row>
      </Group>
    </>
  )
}

const DICTATION_HINT = {
  flow: 'Wispr Flow types what you say into the answer box: hold your Flow key and speak. With Talk and Hands-free on, Tide sends what Flow types as soon as it finishes, and leaves the microphone to Flow. Flow works through its own service, so it isn’t limited to this Mac.',
  tide: 'Speak records you and Tide writes it out on this Mac (Parakeet).',
  deepgram: 'Deepgram writes out what you say, with the lesson’s topic as a hint for its jargon. Parakeet on this Mac takes anything Deepgram can’t.',
  handy: 'Speak puts the cursor in the box; press your Handy shortcut and Handy types what you say. Hands-free talk still uses Tide’s model.'
}

/** The Deepgram key: checked with Deepgram, then kept in the Keychain */
function DeepgramKey() {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    window.tide.voice.hasDeepgram().then(setSaved).catch(() => setSaved(false))
  }, [])
  const store = async (key: string | null) => {
    setBusy(true)
    setError('')
    try {
      await window.tide.voice.saveDeepgram(key)
      setSaved(!!key)
      setDraft('')
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  if (saved === null) return null
  return (
    <Row label="Deepgram key" hint={error ? <span className="set-error">{error}</span> : 'Make one at console.deepgram.com. Kept in your Keychain.'}>
      {saved ? (
        <span className="set-inline">
          <span className="key-mask" aria-hidden="true">
            ••••••••
          </span>
          <button className="btn small ghost" disabled={busy} onClick={() => store(null)}>
            Remove
          </button>
        </span>
      ) : (
        <span className="set-inline">
          <input className="set-input" type="password" placeholder="Paste your key" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && draft.trim() && store(draft)} aria-label="Deepgram key" />
          <button className="btn small primary" disabled={!draft.trim() || busy} onClick={() => store(draft)}>
            {busy ? 'Checking…' : 'Save'}
          </button>
        </span>
      )}
    </Row>
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
      <Row label="Start it with Tide" hint={ai.autoStart === false ? 'Off: start the server yourself before using Tide.' : 'When the server isn’t running (after a restart, or it was closed), Tide starts it, and gets Gemma ready again after your Mac wakes.'}>
        <Toggle label="Start the model server with Tide" on={ai.autoStart !== false} onChange={(on) => saveAi({ autoStart: on })} />
      </Row>
      {ai.autoStart !== false && (
        <Row label="Start command" hint="Leave empty for the usual one: mlx_vlm.server with Gemma 4 12B and its draft model" stack>
          <input className="set-input wide" value={ai.serverCommand ?? ''} placeholder="~/mlx-env312/bin/mlx_vlm.server --model mlx-community/gemma-4-12B-it-4bit --port 8080 --draft-block-size 3" onChange={(e) => setAi({ ...ai, serverCommand: e.target.value })} onBlur={() => saveAi({})} spellCheck={false} aria-label="Start command" />
        </Row>
      )}
      <Row label="Free its memory when idle" hint={(ai.unloadAfterMinutes ?? 15) === 0 ? 'Gemma stays loaded: about 10 GB of this Mac’s memory, whether or not you’re studying.' : 'Gemma holds about 10 GB while loaded. Unloaded, the Mac gets it back. While Claude teaches it loads only when something needs it; otherwise it reloads as you return to Tide, and your first message after a break starts a few seconds later than usual.'}>
        <Select
          label="Free the model’s memory when idle"
          value={String(ai.unloadAfterMinutes ?? 15)}
          onChange={(v) => saveAi({ unloadAfterMinutes: Number(v) })}
          options={[
            { value: '5', label: 'After 5 minutes' },
            { value: '15', label: 'After 15 minutes' },
            { value: '30', label: 'After 30 minutes' },
            { value: '60', label: 'After an hour' },
            { value: '0', label: 'Never' }
          ]}
        />
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

const ROLE_TEXT: Record<ClaudeRole, { label: string; hint: string }> = {
  teach: { label: 'Lessons and chat', hint: 'Ordinary turns' },
  mark: { label: 'Marking', hint: 'Your answers, marked by a separate short call' },
  hard: { label: 'Hard turns', hint: 'Lesson plans, maths and proofs, and when you ask it to go deep' },
  background: { label: 'Background work', hint: 'Roadmap outlines, chat titles and summaries' }
}

/**
 * Gemma on this Mac, loaded on demand while Claude teaches: whether it's loaded and why, a hand
 * on it, and how soon it goes after its last use (main/modelIdle)
 */
function GemmaGroup() {
  const app = useApp()
  const ai = app.settings.ai
  const [st, setSt] = useState<GemmaStatusView | null>(null)
  const [busy, setBusy] = useState<'load' | 'unload' | null>(null)
  const [note, setNote] = useState('')
  const refresh = useCallback(() => {
    window.tide.gemma
      .status()
      .then(setSt)
      .catch(() => setSt(null))
  }, [])
  useEffect(() => {
    refresh()
    // It loads and unloads by itself: keep the line true while Settings is open
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])
  const act = async (what: 'load' | 'unload') => {
    setBusy(what)
    setNote('')
    try {
      const next = what === 'load' ? await window.tide.gemma.load() : await window.tide.gemma.unload()
      setSt(next)
      if ('busy' in next && next.busy) setNote('Not unloaded: Gemma is answering something right now.')
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  const canControl = st?.loaded !== null && st?.loaded !== undefined
  const minutes = ai.unloadAfterMinutes ?? 15
  return (
    <Group
      title="Gemma on this Mac"
      note={
        <>
          About 10 GB of memory while loaded. While Claude teaches, Gemma loads only when Claude can’t answer (not installed, logged out, at its limit, offline, an error) or you pick it.{' '}
          <button type="button" className="link-btn" onClick={() => app.setView({ kind: 'settings', section: 'usage' })}>
            Its calls and time loaded
          </button>
        </>
      }
    >
      <Row
        label={
          <span className="set-status-label">
            <span className={`tool-dot${st?.loaded ? ' ok' : st ? ' off' : ''}`} aria-hidden="true" />
            Gemma
          </span>
        }
        hint={busy === 'load' ? 'Loading Gemma, about 5 s…' : busy === 'unload' ? 'Unloading…' : note || (st?.line ?? 'Checking…')}
      >
        {(canControl || !st?.serverUp) && (
          <button type="button" className="btn ghost small" disabled={!!busy || !st} onClick={() => act(st?.loaded ? 'unload' : 'load')}>
            {st?.loaded ? 'Unload' : 'Load'}
          </button>
        )}
      </Row>
      {minutes !== 0 && (
        <Row label="While Claude teaches" hint={`Gemma is unloaded this long after it was last used (never later than “Free its memory when idle”, now ${minutes} min).`}>
          <Select
            label="Unload Gemma while Claude teaches"
            value={String(ai.gemmaUnloadWithClaudeMinutes ?? 5)}
            onChange={(v) => app.updateSettings({ ai: { ...ai, gemmaUnloadWithClaudeMinutes: Number(v) } }).then(refresh)}
            options={[
              { value: '2', label: 'After 2 minutes' },
              { value: '5', label: 'After 5 minutes' },
              { value: '10', label: 'After 10 minutes' },
              { value: '15', label: 'After 15 minutes' }
            ]}
          />
        </Row>
      )}
    </Group>
  )
}

/** Claude, through your own Claude Code: whether it's set up, who teaches, and which model does what */
function ClaudeGroup() {
  const app = useApp()
  const c = app.settings.ai.claude ?? {}
  const [st, setSt] = useState<ClaudeStatusView | null>(null)
  const [checking, setChecking] = useState(false)
  const [terminal, setTerminal] = useState<{ busy: boolean; message?: string }>({ busy: false })
  const check = (fresh = false) => {
    setChecking(true)
    window.tide.claude
      .status(fresh)
      .then(setSt)
      .catch(() => setSt(null))
      .finally(() => setChecking(false))
  }
  useEffect(() => check(), [])
  const save = (patch: Partial<NonNullable<AISettings['claude']>>) => app.updateSettings({ ai: { ...app.settings.ai, claude: { ...c, ...patch } } })
  const setModel = (role: ClaudeRole, m: ClaudeModel) => save({ models: { ...c.models, [role]: m } })
  const state = !st ? (checking ? 'Checking…' : 'Couldn’t check') : !st.installed ? 'Claude Code isn’t installed' : !st.loggedIn ? (st.error ?? 'Not logged in: run claude in a terminal and log in') : `Set up${st.plan ? `: Claude ${st.plan[0].toUpperCase()}${st.plan.slice(1)}` : ''}${st.version ? `, Claude Code ${st.version}` : ''}`
  return (
    <Group
      title="Claude"
      note="Tide runs your own logged-in Claude Code (no API key: any key in the environment is left out) and never reads your login. Claude takes every lesson and job, Metabase included; Gemma on this Mac steps in when Claude can’t."
    >
      <Row label="Claude Code" hint={state}>
        <button type="button" className="btn ghost small" disabled={checking} onClick={() => check(true)}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </Row>
      <Row label="Who teaches" hint="Each notebook and lesson can choose too">
        <Select
          label="Who teaches"
          value={c.teacher ?? 'claude'}
          onChange={(v) => save({ teacher: v })}
          options={[
            { value: 'claude', label: st?.loggedIn ? 'Claude' : 'Claude, once set up' },
            { value: 'gemma', label: 'Gemma on this Mac' }
          ]}
        />
      </Row>
      {(Object.keys(ROLE_TEXT) as ClaudeRole[]).map((role) => (
        <Row key={role} label={ROLE_TEXT[role].label} hint={ROLE_TEXT[role].hint}>
          <Select label={ROLE_TEXT[role].label} value={c.models?.[role] ?? CLAUDE_DEFAULTS[role]} onChange={(v) => setModel(role, v)} options={CLAUDE_MODELS.map((m) => ({ value: m.id, label: `${m.label}${m.id === CLAUDE_DEFAULTS[role] ? ' (default)' : ''}` }))} />
        </Row>
      ))}
      <Row
        label="Claude Code in your terminal"
        hint={
          terminal.busy
            ? 'Working…'
            : terminal.message ?? (st?.terminalPort ? `Your notes, code runner and progress are Claude Code’s tools as “tide”, at 127.0.0.1:${st.terminalPort}, while Tide is open` : 'Give Claude Code in your terminal Tide’s tools: search your notes, run code, record progress')
        }
      >
        <Toggle
          on={!!st?.terminalPort}
          disabled={!st?.loggedIn || terminal.busy}
          label="Claude Code in your terminal"
          onChange={async (on) => {
            setTerminal({ busy: true })
            try {
              const r = await window.tide.claude.terminal(on)
              setTerminal({ busy: false, message: r.on ? `Added: run claude in any folder and ask it to use Tide (port ${r.port})` : 'Removed from Claude Code' })
            } catch (e) {
              setTerminal({ busy: false, message: errorText(e) })
            }
            check()
          }}
        />
      </Row>
      {st?.loggedIn && (
        <Row
          label="Your plan"
          hint={`${st.limit?.utilization != null ? `${Math.round(st.limit.utilization * 100)}% of the ${st.limit.window === 'five_hour' ? '5-hour' : st.limit.window === 'seven_day' ? 'weekly' : (st.limit.window?.replace(/_/g, ' ') ?? '')} window used` : 'How full its windows are, calls, tokens and API-price equivalents'}${st.limitedUntil ? `; at the limit until ${new Date(st.limitedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        >
          <button className="btn small" onClick={() => app.setView({ kind: 'settings', section: 'usage' })}>
            Usage
          </button>
        </Row>
      )}
    </Group>
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

      <ClaudeGroup />

      <GemmaGroup />

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
            {info.keyless ? (
              <Row label="API key" hint="None needed: an open endpoint. Only short checks go here, never your notes." />
            ) : (
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
            )}
            <Row label="Model" hint={info.models.find((m) => m.id === cloud.model)?.note}>
              <Select label="Model" value={cloud.model} onChange={(v) => save({ model: v })} options={(modelIds.includes(cloud.model) ? modelIds : [cloud.model, ...modelIds]).filter(Boolean).map((id) => ({ value: id, label: modelLabel(id) }))} />
            </Row>
            {info.jobs && (
              <>
                {CLOUD_TASKS.map((t) => (
                  <Row key={t.id} label={t.label} hint={t.id === 'maths' ? 'Spread across models: each has its own limit' : undefined}>
                    <Select
                      label={t.label}
                      value={cloud.taskModels?.[t.id] ?? info.jobs?.[t.id] ?? cloud.model}
                      onChange={(v) => save({ taskModels: { ...(cloud.taskModels ?? {}), [t.id]: v } })}
                      options={[...new Set([cloud.taskModels?.[t.id] ?? info.jobs?.[t.id] ?? cloud.model, ...modelIds])].filter(Boolean).map((id) => ({ value: id, label: modelLabel(id) }))}
                    />
                  </Row>
                ))}
              </>
            )}
            <BankRow />
            <Row
              label="When it’s busy"
              hint={(() => {
                const others = providers.filter((id) => id !== cloud.provider && (keys[id] || providerInfo(id, cloud).keyless)).map((id) => providerInfo(id, cloud).name)
                const siblings = info.models.filter((m) => m.reasoning).length > 1 ? `${info.name}’s other models` : ''
                const line = [siblings, ...others].filter(Boolean)
                return `If a model is busy, slow or down, ${line.length ? `${line.join(', then ')}, then ` : ''}Gemma on this Mac answers.${others.length ? '' : ' Save a key for another provider (pick it above, paste its key, then switch back) and it joins the line.'}`
              })()}
            />
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
              { value: 'auto', label: 'Fastest available' },
              { value: 'local', label: 'Private, on this Mac' },
              { value: 'wikipedia', label: 'Wikipedia only' },
              { value: 'brave', label: 'Brave Search' },
              { value: 'tavily', label: 'Tavily' },
              { value: 'you', label: 'You.com' },
              { value: 'searxng', label: 'SearXNG elsewhere' },
              { value: 'off', label: 'Off' }
            ]}
          />
        </Row>
        {ai.webSearch?.provider === 'auto' && (
          <Row label="How it chooses" hint="Each search goes to the quickest thing that can answer it">
            <p className="set-note">You.com when its key is saved and its credit isn’t spent: one call, about half a second, with passages from each page, and nothing running on this Mac. Otherwise the search engine on this Mac, then Wikipedia.</p>
          </Row>
        )}
        {(ai.webSearch?.provider === 'brave' || ai.webSearch?.provider === 'tavily' || ai.webSearch?.provider === 'you') && (
          <Row label="Key" hint="Kept in your Keychain">
            <button className="btn small" onClick={() => app.setView({ kind: 'settings', section: 'connections' as never })}>
              Add or change it in Connections
            </button>
          </Row>
        )}
        {(ai.webSearch?.provider === 'brave' || ai.webSearch?.provider === 'tavily') && ai.webSearch.apiKey && (
          <Row label="Older key" hint="Typed in before keys moved to the Keychain; one in the Keychain is used first">
            <input className="set-input" type="password" value={ai.webSearch.apiKey ?? ''} onChange={(e) => setAi({ ...ai, webSearch: { ...ai.webSearch!, apiKey: e.target.value } })} onBlur={() => saveAi({})} aria-label="Older search API key" />
          </Row>
        )}
        {ai.webSearch?.provider === 'searxng' && ai.webSearch.url !== LOCAL_SEARCH && (
          <Row label="SearXNG address">
            <input className="set-input wide" value={ai.webSearch.url ?? ''} placeholder="http://localhost:8888" onChange={(e) => setAi({ ...ai, webSearch: { ...ai.webSearch!, url: e.target.value } })} onBlur={() => saveAi({})} spellCheck={false} aria-label="SearXNG address" />
          </Row>
        )}
      </Group>
      <Group title="Helpers on this Mac">
        {(provider === 'local' || provider === 'auto') && (
          <ToolSetup label="Web search engine" hint="Starts when you search, stops when you don’t" check={window.tide.runner.searchStatus} setup={window.tide.runner.setupSearch} onReady={() => provider === 'local' && saveAi({ webSearch: { ...ai.webSearch, provider: 'searxng', url: LOCAL_SEARCH } })} />
        )}
        <ToolSetup label="Maths checker" hint="Python with SymPy" check={window.tide.runner.mathStatus} setup={window.tide.runner.setupMath} />
        <ToolSetup label="Data libraries" hint="NumPy, pandas, Matplotlib" check={window.tide.runner.librariesStatus} setup={window.tide.runner.setupLibraries} />
        <LabPackSetup />
        <QuantPackSetup />
        <AnimationsSetup />
        <ToolSetup label="Market data" hint="US Treasury yields and ECB euro rates for the finance labs" check={window.tide.learn.marketStatus} setup={window.tide.learn.fetchMarketData} busyText="Fetching from the US Treasury and the ECB…" actionText="Fetch newer" />
        <ToolSetup label="Languages" hint="What code in lessons can be written in" check={window.tide.runner.languagesStatus} setup={window.tide.runner.languagesStatus} busyText="Checking…" actionText="Check again" />
        <ToolSetup label="Things 4" hint="Tasks and deadlines" check={window.tide.learn.thingsStatus} setup={window.tide.learn.thingsStatus} busyText="Checking…" actionText="Check again" />
      </Group>
      <EditorGroup />
      <MetabaseGroup />
      <StudyApiGroup />
    </>
  )
}

/** The editor a project's "Open in…" uses (shared/editor.ts); by language unless one is picked */
function EditorGroup() {
  const app = useApp()
  const [found, setFound] = useState<InstalledEditor[] | null>(null)
  useEffect(() => {
    window.tide.editors
      .list()
      .then(setFound)
      .catch(() => setFound([]))
  }, [])
  const choice = app.settings.editor ?? 'auto'
  return (
    <Group title="Your editor">
      <Row label="Projects open in" hint={found && !found.length ? 'No editor Tide knows was found on this Mac' : 'By language: CLion for C and C++, PyCharm for Python, VS Code otherwise, when installed. Tests run again in Tide each time you save.'}>
        {found && found.length > 0 && (
          <Select<string>
            label="Projects open in"
            value={found.some((e) => e.id === choice) ? choice : 'auto'}
            onChange={(v) => app.updateSettings({ editor: v as EditorChoice })}
            options={[{ value: 'auto', label: 'By the project’s language' }, ...found.map((e) => ({ value: e.id, label: e.name }))]}
          />
        )}
      </Row>
    </Group>
  )
}

type Usage = Awaited<ReturnType<typeof window.tide.cloud.usage>>

/** Every model call (components/UsageView), and under it the month's paid cloud spend against its budget */
function UsageSection() {
  const app = useApp()
  const [u, setU] = useState<Usage | null>(null)
  useEffect(() => {
    window.tide.cloud.usage(0).then(setU).catch(() => setU(null))
  }, [])
  return (
    <>
      <UsageView onOpenModels={() => app.setView({ kind: 'settings', section: 'models' })} />
      {u && (u.cloud.requests > 0 || u.budget > 0) && (
        <Group title={`Cloud spend, ${u.month}`} note={u.cloud.unpriced > 0 ? `${u.cloud.unpriced} request${u.cloud.unpriced === 1 ? '' : 's'} used a model with no price set, so they’re not in the total.` : undefined}>
          <Row label={`${money(u.cloud.cost)}${u.budget ? ` of your $${u.budget} budget` : ''}`} hint={`${u.cloud.requests} requests, ${u.cloud.freeValue > 0 ? `free-tier ones worth ${money(u.cloud.freeValue)} at list price` : 'billed by your providers'}`}>
            {u.budget > 0 && (
              <span className="usage-meter" aria-hidden="true" style={{ width: 120 }}>
                <span style={{ width: `${Math.min(1, u.cloud.cost / u.budget) * 100}%` }} />
              </span>
            )}
          </Row>
        </Group>
      )}
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
        {tab === 'you' && <ProfileSettings />}
        {tab === 'general' && <GeneralSection />}
        {tab === 'backups' && <BackupsSettings />}
        {tab === 'appearance' && <AppearanceSection />}
        {tab === 'tutor' && <TutorSection />}
        {tab === 'study' && <StudySection />}
        {tab === 'connections' && <ConnectionsView />}
        {tab === 'models' && <ModelsSection />}
        {tab === 'tools' && <ToolsSection />}
        {tab === 'usage' && <UsageSection />}
        {tab === 'speed' && <SpeedView />}
      </div>
    </div>
  )
}
