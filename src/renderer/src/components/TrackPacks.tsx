import { useCallback, useEffect, useState } from 'react'
import { trackPack, type TrackPackId, type TrackPackStatus } from '@shared/trackPacks'
import { Icon } from './Icon'

/**
 * A track pack's state and its install, shared by Settings › Tools, the offer a lesson shows when
 * its code needs a pack, and a track's page. The install runs in the main process; progress comes
 * back as lines, and an install started elsewhere (another window, Settings) is followed here too.
 */
export function useTrackPack(id: TrackPackId) {
  const [status, setStatus] = useState<TrackPackStatus | null>(null)
  const [step, setStep] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const check = useCallback(async () => {
    try {
      setStatus(await window.tide.packs.status(id))
    } catch (e) {
      setStatus({ id, ready: false, detail: (e as Error).message, parts: [] })
    }
  }, [id])
  useEffect(() => {
    let live = true
    void window.tide.packs.status(id).then((s) => live && setStatus(s), () => {})
    void window.tide.packs.installing().then((ids) => live && ids.includes(id) && setBusy(true), () => {})
    const off = window.tide.packs.onProgress((p) => {
      if (p.id !== id || !live) return
      setBusy(true)
      setStep(p.step)
    })
    return () => {
      live = false
      off()
    }
  }, [id])
  const install = async () => {
    setBusy(true)
    setNote('')
    setStep('Starting…')
    try {
      const s = await window.tide.packs.install(id)
      setStatus(s)
    } catch (e) {
      setStatus((old) => ({ ...(old ?? { id, parts: [] }), ready: false, detail: (e as Error).message }))
    } finally {
      setBusy(false)
      setStep('')
    }
  }
  const appleTools = async () => {
    const r = await window.tide.packs.appleTools()
    setNote(r.detail)
  }
  return { status, step, busy, note, install, appleTools, check }
}

/** "45" from "Downloading Foundry 1.9.0: 45% of 122 MB…" */
export const stepPercent = (step: string): number | null => {
  const m = /(\d{1,3})% of/.exec(step)
  return m ? Math.min(100, Number(m[1])) : null
}

/** A thin bar for a download's progress; nothing when the step has no percentage */
export function PackProgress({ step }: { step: string }) {
  const pct = stepPercent(step)
  return (
    <span className="pack-progress" role="status">
      <span className="pack-progress-text">{step || 'Installing…'}</span>
      {pct !== null && (
        <span className="pack-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  )
}

/** What the button says: the pack's measured size, or Apple's tools first */
export function installLabel(id: TrackPackId, s: TrackPackStatus | null): string {
  if (s?.needs === 'xcode') return 'Get Apple’s tools'
  return `Install · ${trackPack(id)!.download.replace(/^about /, '')}`
}

/**
 * The offer a lesson shows when it needs a pack that isn't installed: what it adds, its real
 * size, and Install. Once installed it says so and gets out of the way.
 */
export function PackOffer({ id, why, onReady }: { id: TrackPackId; why?: string; onReady?(): void }) {
  const pack = trackPack(id)!
  const { status, step, busy, note, install, appleTools, check } = useTrackPack(id)
  useEffect(() => {
    if (status?.ready) onReady?.()
  }, [status?.ready, onReady])
  if (!status || (status.ready && !busy)) return status?.ready ? <div className="pack-offer done"><Icon name="check" size={14} /> {pack.title} installed. Run it again.</div> : null
  return (
    <div className="pack-offer" role="group" aria-label={pack.title}>
      <div className="pack-offer-text">
        <strong>{why ?? `This needs the ${pack.title}`}</strong>
        {busy ? <PackProgress step={step} /> : <span>{status.needs === 'xcode' ? status.detail : `${pack.contents}. ${pack.download} to download, ${pack.size} on disk, into Tide’s own tools folder.`}</span>}
        {note && <span>{note}</span>}
      </div>
      {!busy && (
        <div className="pack-offer-actions">
          <button className="btn small primary" onClick={() => void (status.needs === 'xcode' ? appleTools() : install())}>
            {installLabel(id, status)}
          </button>
          {status.needs === 'xcode' && note && (
            <button className="btn small" onClick={() => void check()}>
              Check again
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The pack a run's message asks for ("needs the Foundry pack"), so a lesson can offer it there */
export function packNamedIn(text: string): TrackPackId | null {
  const m = /needs the (C\+\+|Foundry|Big data|Postgres) pack\b/.exec(text)
  if (!m) return null
  return ({ 'C++': 'cpp', Foundry: 'foundry', 'Big data': 'bigdata', Postgres: 'postgres' } as const)[m[1] as 'C++' | 'Foundry' | 'Big data' | 'Postgres']
}
