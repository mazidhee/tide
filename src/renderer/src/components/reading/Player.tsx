import { useEffect, useState } from 'react'
import type { BookVoice } from '@shared/readingRoom'
import { clock, type TtsEngineInfo } from '@shared/speech'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { chapterTitle, nowPiece, secondsLeft, setVoice, skip, SPEEDS, stop, toggle, ttsEngines, usePlayer } from '../../lib/readAloud'

/** The voices to choose from: the engine's own, or a note that the Mac's voice is reading */
function useEngines() {
  const [list, setList] = useState<TtsEngineInfo[]>([])
  useEffect(() => {
    ttsEngines().then(setList)
  }, [])
  return list
}

/** In the reader, at the foot of the page: play, the voice, dialogue voices, speed and time left */
export function PlayerBar({ path, onVoice }: { path: string; onVoice(v: BookVoice): void }) {
  const p = usePlayer()
  const engines = useEngines()
  const [open, setOpen] = useState(false)
  if (!p || p.path !== path) return null
  const engine = engines.find((e) => e.id === p.voice.engine)
  const voiceName = engine?.voices.find((v) => v.id === p.voice.narrator)?.label ?? p.voice.narrator
  const change = (v: BookVoice) => {
    setVoice(v)
    onVoice(v)
  }
  return (
    <div className="rr-player" role="region" aria-label="Reading aloud">
      <button className="rr-play" onClick={toggle} aria-label={p.playing ? 'Pause' : 'Play'}>
        <Icon name={p.playing ? 'pause' : 'play'} size={15} />
      </button>
      <button className="rr-player-skip" onClick={() => skip(-1)} aria-label="Back a sentence">
        <Icon name="back" size={13} />
      </button>
      <span className="rr-player-what" title={p.error}>{p.error && !p.playing ? p.error : p.loading ? 'Making the voice…' : p.system ? 'Reading with the Mac’s voice' : 'Reading aloud from your place'}</span>
      <div className="rr-anchor">
        <button className="rr-voice" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={p.system}>
          Voice: {p.system ? 'Mac' : voiceName}
          {p.voice.characters && ' + dialogue'}
          <Icon name="chevron" size={11} />
        </button>
        {open && engine && (
          <div className="rr-voices" role="dialog" aria-label="Voice" onMouseLeave={() => setOpen(false)}>
            <div className="rr-voices-head">{engine.label}</div>
            <div className="rr-voices-list">
              {engine.voices.map((v) => (
                <button key={v.id} className={v.id === p.voice.narrator ? 'on' : ''} onClick={() => change({ ...p.voice, narrator: v.id })}>
                  <b>{v.label}</b>
                  <span>{v.detail}</span>
                </button>
              ))}
            </div>
            {engine.multiVoice && (
              <label className="rr-voices-check">
                <input type="checkbox" checked={!!p.voice.characters} onChange={(e) => change({ ...p.voice, characters: e.target.checked })} />
                <span>
                  Narrator plus character voices
                  <small>Quoted dialogue is read in other voices, taking turns by paragraph.</small>
                </span>
              </label>
            )}
          </div>
        )}
      </div>
      <select className="rr-speed" value={p.voice.speed ?? 1} onChange={(e) => change({ ...p.voice, speed: Number(e.target.value) })} aria-label="Speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <span className="rr-player-left">{clock(secondsLeft(p))} left</span>
      <button className="rr-player-x" onClick={stop} aria-label="Stop reading aloud">
        <Icon name="x" size={13} />
      </button>
    </div>
  )
}

/** Everywhere else in Tide (the IDE, a note, Home): the line being read, and a way back to the page */
export function MiniPlayer() {
  const app = useApp()
  const p = usePlayer()
  const v = app.view
  if (!p) return null
  if ((v.kind === 'reader' || v.kind === 'file') && v.path === p.path) return null
  const piece = nowPiece(p)
  return (
    <div className="rr-mini" role="region" aria-label="Reading aloud">
      <button className="rr-play small" onClick={toggle} aria-label={p.playing ? 'Pause' : 'Play'}>
        <Icon name={p.playing ? 'pause' : 'play'} size={13} />
      </button>
      <button className="rr-mini-line" onClick={() => app.setView({ kind: 'reader', path: p.path })} title="Back to the page">
        <span className="rr-mini-book">
          {p.title} · {chapterTitle(p)}
        </span>
        <span className="rr-mini-text">{piece?.text ?? ''}</span>
      </button>
      <button className="rr-player-x" onClick={stop} aria-label="Stop reading aloud">
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
