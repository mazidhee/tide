import { useCallback, useEffect, useState } from 'react'
import { PLACE_LABEL, statusLine, type PracticeStatus } from '@shared/practiceStack'
import { Group, Row } from './SettingsView'
import { useApp } from '../state'

const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The place a Metabase is, said the same way everywhere: practice (yours to break) or the company's (read-only) */
export function PlaceTag({ place }: { place: 'practice' | 'production' }) {
  return <span className={`place-tag ${place}`}>{PLACE_LABEL[place]}</span>
}

/** Settings › Practice data: a MongoDB and Metabase on this Mac, with data made from your spec */
export function PracticeSettings() {
  const app = useApp()
  const [s, setS] = useState<PracticeStatus | null>(null)
  const [doing, setDoing] = useState<'' | 'start' | 'stop' | 'reset' | 'layout'>('')
  const [asking, setAsking] = useState(false)

  const load = useCallback(() => {
    window.tide.practiceData
      .status()
      .then(setS)
      .catch(() => setS(null))
  }, [])
  useEffect(load, [load])
  // While it starts, look again every few seconds
  useEffect(() => {
    if (!doing && s?.metabase !== 'starting' && !s?.busy) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [doing, s?.metabase, s?.busy, load])

  const go = async (what: 'start' | 'stop' | 'reset' | 'layout') => {
    setDoing(what)
    setAsking(false)
    try {
      const next = await window.tide.practiceData[what]()
      setS(next)
      if (next.error) app.toast(next.error, { tone: 'error' })
    } catch (e) {
      app.toast(errorText(e), { tone: 'error' })
    } finally {
      setDoing('')
    }
  }

  const dockerOk = s?.docker === 'ok'
  const ready = !!s?.running && s.metabase === 'ready' && s.setUp
  const line = s ? (doing && !s.busy ? { start: 'Starting…', stop: 'Stopping…', reset: 'Making the data again…', layout: 'Building your layout…' }[doing] : statusLine(s)) : 'Looking…'

  return (
    <>
      <Group
        title="Practice data"
        note={
          <>
            A MongoDB and a Metabase in Docker on this Mac, on ports {s?.ports.mongo ?? 27047} and {s?.ports.metabase ?? 3047}, with data made from your spec. Writes are allowed here: make questions and dashboards, break things, reset. Your company’s Metabase stays read-only and separate.
          </>
        }
      >
        <Row label={<PlaceTag place="practice" />} hint={<span className={`pr-state${s?.error ? ' bad' : ''}`}>{line}</span>}>
          <span className="set-inline">
            {/* Half up (Metabase stopped or never set up): Start finishes the job */}
            {s?.running && s.metabase !== 'down' && s.setUp ? (
              <button className="btn small" onClick={() => void go('stop')} disabled={!!doing}>
                {doing === 'stop' ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button className="btn small primary" onClick={() => void go('start')} disabled={!!doing || !dockerOk || !!s?.spec.problems.length}>
                {doing === 'start' ? 'Starting…' : 'Start'}
              </button>
            )}
            <button className="btn small" onClick={() => void window.tide.practiceData.open()} disabled={!ready}>
              Open Metabase
            </button>
          </span>
        </Row>
        {s?.setUp && <LoginRow />}
        {s?.error && <Row label={<span className="set-error">Last attempt failed</span>} hint={s.error} />}
        <Row
          label="Your spec"
          hint={
            s?.spec.path ? (
              s.spec.problems.length ? (
                <span className="set-error">{s.spec.problems.slice(0, 3).join(' ')}</span>
              ) : (
                <>
                  <code className="path">{s.spec.path}</code> · {s.spec.collections} collections, {s.spec.documents.toLocaleString('en-GB')} documents
                </>
              )
            ) : (
              (s?.spec.problems[0] ?? 'Looking…')
            )
          }
        />
        <Row
          label="Data loaded"
          hint={s?.seeded ? `${new Date(s.seeded.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${s.seeded.collections.reduce((n, c) => n + c.count, 0).toLocaleString('en-GB')} documents in ${s.seeded.collections.length} collections` : 'Not yet: Start loads it the first time.'}
        >
          {asking ? (
            <span className="set-inline">
              <button className="btn small" onClick={() => setAsking(false)}>
                Keep it
              </button>
              <button className="btn small danger" onClick={() => void go('reset')} disabled={!!doing}>
                Reset data
              </button>
            </span>
          ) : (
            <button className="btn small" onClick={() => setAsking(true)} disabled={!!doing || !dockerOk || !s?.spec.path || !!s?.spec.problems.length}>
              {doing === 'reset' ? 'Resetting…' : 'Reset practice data'}
            </button>
          )}
        </Row>
        {s?.layout?.path && (
          <Row
            label="Your layout"
            hint={
              s.layout.problems.length ? (
                <span className="set-error">{s.layout.problems.slice(0, 3).join(' ')}</span>
              ) : (
                <>
                  <code className="path">{s.layout.path}</code> · {s.layout.questions} questions, {s.layout.dashboards} dashboards
                  {s.layout.built ? ` · rebuilt ${new Date(s.layout.built.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  {s.layout.built?.missing.length ? <span className="set-error"> · not in the data: {s.layout.built.missing.slice(0, 4).join(', ')}</span> : null}
                </>
              )
            }
          >
            <button className="btn small" onClick={() => void go('layout')} disabled={!!doing || !ready || !!s.layout.problems.length}>
              {doing === 'layout' ? 'Rebuilding…' : 'Rebuild layout'}
            </button>
          </Row>
        )}
        {asking && <div className="set-pad pr-confirm">Reset makes the data again from your spec and replaces every practice collection. Questions you saved in the practice Metabase are kept.</div>}
      </Group>
    </>
  )
}

/** The practice Metabase's sign-in, for looking around yourself: the password is copied, never shown in full */
function LoginRow() {
  const [login, setLogin] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void window.tide.practiceData.login().then(setLogin).catch(() => {})
  }, [])
  if (!login) return null
  return (
    <Row label="Sign in to it yourself" hint={<span>Email <code>{login.email}</code>, and the password Tide made for it</span>}>
      <button
        className="btn small"
        onClick={() => {
          void navigator.clipboard.writeText(login.password).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy password'}
      </button>
    </Row>
  )
}
