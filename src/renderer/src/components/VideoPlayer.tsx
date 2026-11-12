/**
 * A video with its transcript beside it (below it in a narrow space). YouTube videos play in
 * YouTube's own embedded player, driven with its postMessage protocol (lib/youtubeBridge); videos
 * of your own play in a plain <video>. Light by design: a thumbnail until you press play, one
 * player at a time (lib/videoHub), and the iframe removed when closed or scrolled far away.
 *
 * The line being spoken is marked and kept in view; a line or its time seeks there; text selected
 * in the transcript gets the page's own selection actions. Keys while the player has focus: space
 * or K play/pause, ←/→ 5 s, J/L 10 s, < and > the speed. A clip opens at its start and pauses at
 * its end. Playing, it opens in cinema: across the page on a dark band, unless you turn that off.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatRange, formatTime, lineAt, thumbUrl, watchUrl, type Line, type Transcript } from '@shared/video'
import { embedUrl, errorText, STATE, YouTubeBridge } from '../lib/youtubeBridge'
import { RATES, activate, cinemaOn, deactivate, preferredRate, register, rememberCinema, rememberPosition, rememberRate, resumeAt, type PlayerHandle } from '../lib/videoHub'
import { vaultUrl } from '../lib/markdown'
import { Icon } from './Icon'
import { addVideoNote } from '../lib/companion'
import { setScreenVideo } from '../lib/onScreen'
import { transcriptAround } from '@shared/onScreen'

export type VideoSource = { kind: 'youtube'; id: string; path?: string; course?: string; title?: string; fetch?: boolean } | { kind: 'file'; path: string }

export interface VideoClip {
  start: number
  end: number
}

interface Props {
  source: VideoSource
  /** Open at this moment */
  start?: number
  /** Only this part: opens at its start and pauses at its end */
  clip?: VideoClip
  /** Shown over the thumbnail (a saved video's note has its own title above) */
  title?: string
  /** No transcript pane (a clip in a lesson shows only its own lines) */
  compact?: boolean
  onClipEnd?: () => void
  /** Stays where it is when playing (a course's video column beside its text) */
  noCinema?: boolean
  /** How much of it has been watched so far, 0 to 1 (the furthest moment reached), now and then while it plays */
  onWatched?: (fraction: number) => void
  /** The player opened (true) or went back to its thumbnail (false) */
  onActive?: (active: boolean) => void
}

/** What both kinds of player do */
interface Engine {
  play(): void
  pause(): void
  toggle(): void
  seek(t: number): void
  setRate(r: number): void
  time(): number
  duration(): number
  playing(): boolean
}

type TranscriptState = { status: 'none' } | { status: 'loading' } | { status: 'ready'; t: Transcript } | { status: 'missing'; why: 'no-captions' | 'offline' | 'unknown' }

const keyOf = (s: VideoSource) => (s.kind === 'youtube' ? s.id : `file:${s.path}`)
const fileName = (p: string) => p.split('/').pop() ?? p

/** The nearest scrolling box around an element: what "far away" and the cinema band are measured in */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight >= p.clientHeight) return p
  }
  return null
}

export function VideoPlayer({ source, start, clip, title, compact, onClipEnd, noCinema, onWatched, onActive }: Props) {
  const key = keyOf(source)
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const bridge = useRef<YouTubeBridge | null>(null)
  const [active, setActive] = useState(false)
  const [openAt, setOpenAt] = useState<number | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [rate, setRateState] = useState(preferredRate)
  const [error, setError] = useState<string | null>(null)
  const [silent, setSilent] = useState(false)
  const [clipDone, setClipDone] = useState(false)
  /** "Keep watching" after a clip: it plays on past the clip's end */
  const free = useRef(false)
  const [cinema, setCinema] = useState(cinemaOn)
  const [follow, setFollow] = useState(true)
  const [wide, setWide] = useState(false)
  const [showLines, setShowLines] = useState(!compact)
  const [tr, setTr] = useState<TranscriptState>({ status: 'none' })
  const [clock, setClock] = useState(0)
  const lineEls = useRef<(HTMLElement | null)[]>([])
  const marked = useRef(-1)
  const userScrolled = useRef(0)
  const lastSaved = useRef(0)
  const handle = useRef<PlayerHandle | null>(null)
  // Notes while watching: the moment a note is about is when you started writing it
  const [notesOpen, setNotesOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [noteAt, setNoteAt] = useState<number | null>(null)
  const [taken, setTaken] = useState<{ at: number; text: string }[]>([])
  const [notesPage, setNotesPage] = useState<string | null>(null)
  const resumeAfterNote = useRef(false)

  const lines: Line[] = tr.status === 'ready' ? tr.t.lines : []
  const duration = () => engine.current?.duration() || (tr.status === 'ready' ? (tr.t.duration ?? 0) : 0)

  // ---------- The transcript ----------

  const loadTranscript = useCallback(
    async (fetch: boolean) => {
      if (source.kind === 'file') {
        setTr({ status: 'loading' })
        const t = await window.tide.videos.fileTranscript(source.path).catch(() => null)
        setTr(t ? { status: 'ready', t } : { status: 'missing', why: 'no-captions' })
        return
      }
      setTr((s) => (s.status === 'ready' ? s : { status: 'loading' }))
      const r = await window.tide.videos.transcript(source.id, { path: source.path, fetch, course: source.course, title: source.title }).catch(() => null)
      if (r?.transcript) setTr({ status: 'ready', t: r.transcript })
      else setTr((s) => (s.status === 'ready' ? s : fetch ? { status: 'missing', why: r && !r.transcript ? r.why : 'unknown' } : { status: 'none' }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, source.kind === 'youtube' ? source.path : '', source.kind === 'youtube' ? source.fetch : false]
  )

  // What needs no network now (a kept transcript, a saved note's, a caption file); YouTube's captions when asked to, or on play
  useEffect(() => {
    void loadTranscript(source.kind === 'youtube' ? !!source.fetch : true)
  }, [loadTranscript]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Opening and closing ----------

  const stop = useCallback(() => {
    const e = engine.current
    if (e) rememberPosition(key, e.time(), e.duration() || undefined)
    bridge.current?.dispose()
    bridge.current = null
    engine.current = null
    setActive(false)
    setReady(false)
    setPlaying(false)
    setSilent(false)
    if (handle.current) deactivate(handle.current)
  }, [key])

  const open = useCallback(
    (at?: number) => {
      const from = at ?? (clip ? clip.start : start) ?? resumeAt(key, duration() || undefined) ?? 0
      setOpenAt(from)
      setError(null)
      setClipDone(false)
      free.current = false
      setActive(true)
      if (handle.current) activate(handle.current)
      if (source.kind === 'youtube' && (tr.status === 'none' || (tr.status === 'ready' && tr.t.from === 'note'))) void loadTranscript(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clip?.start, start, key, tr, loadTranscript]
  )

  const seekTo = useCallback(
    (t: number) => {
      if (t < 0) return !active || !engine.current ? open() : engine.current.play()
      if (!active || !engine.current) return open(t)
      engine.current.seek(t)
      engine.current.play()
      setClipDone(false)
      tickNow(t)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, open]
  )
  const seekRef = useRef(seekTo)
  seekRef.current = seekTo

  // One player at a time, and timestamp links on the page find it
  useEffect(() => {
    const h: PlayerHandle = { key, stop: () => stop(), playAt: (t) => seekRef.current(t), el: () => rootRef.current }
    handle.current = h
    const off = register(h)
    return () => {
      off()
      handle.current = null
    }
  }, [key, stop])

  // Remembered where it was when the page goes
  useEffect(() => () => stop(), [stop])

  // Scrolled far away (more than a screen and a half), it goes back to its thumbnail
  useEffect(() => {
    if (!active || !rootRef.current) return
    const io = new IntersectionObserver((es) => es.forEach((e) => !e.isIntersecting && stop()), { root: scroller(rootRef.current), rootMargin: '150% 0px 150% 0px' })
    io.observe(rootRef.current)
    return () => io.disconnect()
  }, [active, stop])

  // ---------- The YouTube player ----------

  useEffect(() => {
    if (!active || source.kind !== 'youtube') return
    const b = new YouTubeBridge(
      () => frameRef.current?.contentWindow ?? null,
      (e) => {
        if (e.kind === 'ready') {
          setReady(true)
          setSilent(false)
          if (preferredRate() !== 1) b.setRate(preferredRate())
        } else if (e.kind === 'error') setError(errorText(e.code))
        else if (e.kind === 'rate') setRateState(e.rate)
        if (e.kind === 'state' || (e.kind === 'info' && e.info.playerState !== undefined)) setPlaying(b.state === STATE.playing || b.state === STATE.buffering)
      }
    )
    bridge.current = b
    engine.current = {
      play: b.play,
      pause: b.pause,
      toggle: () => b.toggle(),
      seek: (t) => b.seek(t),
      setRate: (r) => b.setRate(r),
      time: () => b.currentTime(),
      duration: () => b.duration,
      playing: () => b.state === STATE.playing || b.state === STATE.buffering
    }
    const onMessage = (ev: MessageEvent) => void b.handle(ev)
    window.addEventListener('message', onMessage)
    // The player that never answers: it may still play, but Tide can't follow along
    const quiet = setTimeout(() => !b.ready && setSilent(true), 12_000)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(quiet)
      b.dispose()
    }
  }, [active, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFrameLoad = () => bridge.current?.start()

  // ---------- A video of your own ----------

  useEffect(() => {
    if (!active || source.kind !== 'file') return
    const v = videoRef.current
    if (!v) return
    engine.current = {
      play: () => void v.play().catch(() => {}),
      pause: () => v.pause(),
      toggle: () => (v.paused ? void v.play().catch(() => {}) : v.pause()),
      seek: (t) => {
        v.currentTime = Math.max(0, t)
      },
      setRate: (r) => {
        v.playbackRate = r
      },
      time: () => v.currentTime,
      duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
      playing: () => !v.paused && !v.ended
    }
    v.playbackRate = preferredRate()
    const started = () => {
      if (openAt) v.currentTime = openAt
      void v.play().catch(() => {})
      setReady(true)
    }
    const on = () => setPlaying(!v.paused && !v.ended)
    const fail = () => setError('This video file can’t be played here. Tide plays MP4, WebM and MOV files the Mac can decode.')
    v.addEventListener('loadedmetadata', started, { once: true })
    v.addEventListener('play', on)
    v.addEventListener('pause', on)
    v.addEventListener('ended', on)
    v.addEventListener('error', fail)
    return () => {
      v.removeEventListener('play', on)
      v.removeEventListener('pause', on)
      v.removeEventListener('ended', on)
      v.removeEventListener('error', fail)
    }
  }, [active, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Following along ----------

  const markLine = useCallback(
    (t: number) => {
      if (!lines.length) return
      const i = lineAt(lines, t)
      if (i === marked.current) return
      lineEls.current[marked.current]?.classList.remove('now')
      marked.current = i
      const el = lineEls.current[i]
      if (!el) return
      el.classList.add('now')
      const list = listRef.current
      if (!list || !follow || Date.now() - userScrolled.current < 4000) return
      const top = el.offsetTop - list.clientHeight * 0.38
      list.scrollTo({ top: Math.max(0, top), behavior: Math.abs(list.scrollTop - top) > list.clientHeight * 2 ? 'auto' : 'smooth' })
    },
    [lines, follow]
  )
  const tickNow = (t: number) => markLine(t)

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const e = engine.current
      if (!e) return
      const t = e.time()
      markLine(t)
      if (clip && !clipDone && !free.current && e.playing() && t >= clip.end - 0.2) {
        e.pause()
        setClipDone(true)
        onClipEnd?.()
      }
      if (e.playing() && Date.now() - lastSaved.current > 5000) {
        lastSaved.current = Date.now()
        rememberPosition(key, t, e.duration() || undefined)
        setClock(t)
      }
    }, 200)
    return () => clearInterval(id)
  }, [active, markLine, clip, clipDone, key, onClipEnd])

  const activeCb = useRef(onActive)
  activeCb.current = onActive
  useEffect(() => {
    activeCb.current?.(active)
  }, [active])
  useEffect(() => () => activeCb.current?.(false), [])

  // How far it has been watched, for course progress: the furthest moment reached while playing
  const furthest = useRef(0)
  const watchedRef = useRef(onWatched)
  watchedRef.current = onWatched
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const e = engine.current
      const d = e?.duration() || (tr.status === 'ready' ? (tr.t.duration ?? 0) : 0)
      if (!e || !d || !e.playing()) return
      const f = Math.min(1, e.time() / d)
      if (f > furthest.current + 0.02 || (f > 0.97 && furthest.current < 1)) {
        furthest.current = f > 0.97 ? 1 : f
        watchedRef.current?.(furthest.current)
      }
    }, 4000)
    return () => clearInterval(id)
  }, [active, tr])

  // What the tutor sees of it (lib/onScreen): its moment and the words around it, while it's open
  const linesRef = useRef<Line[]>([])
  linesRef.current = tr.status === 'ready' ? tr.t.lines : []
  const titleRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!active || source.kind !== 'youtube') return
    const id = source.id
    return setScreenVideo(() => {
      const e = engine.current
      const at = e ? e.time() : (openAt ?? 0)
      return { id, ...(titleRef.current ? { title: titleRef.current } : {}), at, playing: !!e?.playing(), around: transcriptAround(linesRef.current, at), ...(source.course ? { course: source.course } : {}) }
    })
  }, [active, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // A clip's progress, a few times a second only while it plays
  useEffect(() => {
    if (!active || !clip || !playing) return
    const id = setInterval(() => setClock(engine.current?.time() ?? 0), 500)
    return () => clearInterval(id)
  }, [active, clip, playing])

  // The marked line again once the transcript arrives or is redrawn
  useEffect(() => {
    marked.current = -1
    if (engine.current) markLine(engine.current.time())
  }, [lines, markLine])

  // ---------- Layout ----------

  // Beside the player when there's room for both, below it when not
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 820))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Cinema: while it plays, the player spans the page it's on, edge to edge with a small gutter
  const [band, setBand] = useState<{ left: number; width: number } | null>(null)
  const inCinema = active && cinema && !noCinema
  useLayoutEffect(() => {
    if (!inCinema) return setBand(null)
    const el = rootRef.current
    const host = el?.parentElement
    const sc = scroller(el)
    if (!el || !host || !sc) return
    const place = () => {
      const s = sc.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      const gutter = s.width > 900 ? 28 : 12
      const width = Math.min(sc.clientWidth - gutter * 2, 1680)
      const left = s.left + (sc.clientWidth - width) / 2 - h.left
      setBand((b) => (b && Math.abs(b.left - left) < 1 && Math.abs(b.width - width) < 1 ? b : { left, width }))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(sc)
    ro.observe(host)
    return () => ro.disconnect()
  }, [inCinema])

  // ---------- Keys ----------

  const changeRate = (r: number) => {
    setRateState(r)
    rememberRate(r)
    engine.current?.setRate(r)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return
    const k = e.key
    const by = (d: number) => {
      const eng = engine.current
      if (!eng) return
      const to = Math.max(0, Math.min(eng.time() + d, eng.duration() || Infinity))
      eng.seek(to)
      markLine(to)
      setClipDone(false)
    }
    if (k === ' ' || k === 'k' || k === 'K') {
      e.preventDefault()
      if (!active) open()
      else engine.current?.toggle()
    } else if (k === 'ArrowLeft') (e.preventDefault(), by(-5))
    else if (k === 'ArrowRight') (e.preventDefault(), by(5))
    else if (k === 'j' || k === 'J') (e.preventDefault(), by(-10))
    else if (k === 'l' || k === 'L') (e.preventDefault(), by(10))
    else if (k === '>' || k === '<') {
      e.preventDefault()
      const i = RATES.indexOf(rate)
      changeRate(RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 1 : i) + (k === '>' ? 1 : -1)))])
    } else if (k === 'n' || k === 'N') {
      e.preventDefault()
      setNotesOpen(true)
    } else if (k === 'Escape' && active) {
      e.preventDefault()
      stop()
    }
  }

  // ---------- Notes while watching ----------

  const startNote = () => {
    if (noteAt !== null) return
    const e = engine.current
    setNoteAt(e ? e.time() : (clip?.start ?? 0))
    // Paused while you write, and played again when the note is kept
    resumeAfterNote.current = !!e?.playing()
    if (e?.playing()) e.pause()
  }
  const keepNote = async () => {
    const text = draft.trim()
    if (!text) return
    const at = noteAt ?? engine.current?.time() ?? 0
    const videoTitle = name ?? (source.kind === 'file' ? fileName(source.path) : 'Video')
    try {
      const page = await addVideoNote(source.kind === 'youtube' ? { id: source.id, path: source.path, title: videoTitle, at, text } : { file: source.path, title: videoTitle, at, text })
      setNotesPage(page)
      setTaken((l) => [...l, { at, text }])
      setDraft('')
      setNoteAt(null)
      if (resumeAfterNote.current) engine.current?.play()
      resumeAfterNote.current = false
    } catch {
      setNotesPage(null)
    }
  }

  // ---------- Drawing ----------

  const inClip = (l: Line) => !clip || (l.end > clip.start + 0.5 && l.start < clip.end - 0.5)
  const onLineClick = (e: React.MouseEvent, l: Line) => {
    // Selecting words to highlight or ask about is not a seek
    if (window.getSelection()?.toString().trim()) return
    e.preventDefault()
    seekTo(l.start)
    rootRef.current?.focus({ preventScroll: true })
  }

  const linesView = useMemo(
    () =>
      lines.map((l, i) => (
        <p key={i} ref={(el) => void (lineEls.current[i] = el)} className={`vt-line${clip && !inClip(l) ? ' out' : ''}`} onClick={(e) => onLineClick(e, l)}>
          <button className="vt-time" tabIndex={-1} onClick={(e) => (e.stopPropagation(), seekTo(l.start))} aria-label={`Play from ${formatTime(l.start)}`}>
            {formatTime(l.start)}
          </button>
          <span className="vt-said">{l.text}</span>
        </p>
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, clip?.start, clip?.end, seekTo]
  )

  const name = title ?? (tr.status === 'ready' ? tr.t.title : source.kind === 'file' ? fileName(source.path) : source.kind === 'youtube' ? source.title : undefined)
  titleRef.current = name
  const resume = !clip && start === undefined ? resumeAt(key, duration() || undefined) : null
  const hasLines = lines.length > 0
  const transcriptShown = showLines && (hasLines || tr.status === 'loading' || tr.status === 'missing' || (active && source.kind === 'youtube'))
  const side = transcriptShown && (wide || !!band)
  const ytUrl = source.kind === 'youtube' ? watchUrl(source.id, engine.current?.time() ?? openAt ?? clip?.start) : null
  const clipPct = clip && active ? Math.max(0, Math.min(1, ((clock || clip.start) - clip.start) / (clip.end - clip.start))) : 0

  return (
    <div
      ref={rootRef}
      className={`vt${active ? ' on' : ''}${band ? ' cinema' : ''}${side ? ' side' : ' stack'}${transcriptShown ? '' : ' bare'}${compact ? ' compact' : ''}`}
      style={band ? { marginLeft: band.left, width: band.width } : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={name ? `Video: ${name}` : 'Video'}
      data-video={key}
    >
      <div className="vt-main">
        <div className="vt-stage">
          {!active ? (
            <button className="vt-facade" onClick={() => open()} aria-label={`Play${name ? ` ${name}` : ''}`}>
              {source.kind === 'youtube' ? <img src={thumbUrl(source.id)} alt="" loading="lazy" draggable={false} /> : <span className="vt-file-poster" aria-hidden="true"><Icon name="video" size={28} /></span>}
              <span className="vt-facade-shade" />
              <span className="vt-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
              </span>
              <span className="vt-facade-meta">
                {name && <span className="vt-facade-title">{name}</span>}
                <span className="vt-chip">{clip ? `Clip ${formatRange(clip.start, clip.end)}` : resume ? `Resume at ${formatTime(resume)}` : source.kind === 'youtube' ? 'YouTube' : fileName(source.path)}</span>
              </span>
            </button>
          ) : error ? (
            <div className="vt-error" role="alert">
              <Icon name="video" size={22} />
              <p>{error}</p>
              {ytUrl && (
                <button className="btn small" onClick={() => window.tide.app.openExternal(ytUrl)}>
                  Watch on YouTube <Icon name="external" size={12} />
                </button>
              )}
            </div>
          ) : source.kind === 'youtube' ? (
            <iframe
              ref={frameRef}
              src={embedUrl(source.id, { start: openAt, origin: location.origin })}
              title={name ? `YouTube video: ${name}` : 'YouTube video'}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={onFrameLoad}
            />
          ) : (
            <video ref={videoRef} src={vaultUrl(source.path)} controls preload="metadata" playsInline />
          )}
          {active && clipDone && clip && (
            <div className="vt-clip-done">
              <p>End of the clip</p>
              <div className="row-gap">
                <button
                  className="btn small"
                  onClick={() => {
                    free.current = false
                    seekTo(clip.start)
                  }}
                >
                  <Icon name="refresh" size={12} /> Replay
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    free.current = true
                    setClipDone(false)
                    engine.current?.play()
                  }}
                >
                  Keep watching
                </button>
              </div>
            </div>
          )}
        </div>
        {(
          <div className="vt-bar">
            {clip ? (
              <span className="vt-cliprange" title="Only this part plays, then it pauses">
                <span className="vt-clipbar" aria-hidden="true">
                  <span style={{ width: `${clipPct * 100}%` }} />
                </span>
                Clip {formatRange(clip.start, clip.end)}
              </span>
            ) : (
              <span className="vt-bar-title">{active ? (silent ? 'Playing, but the player isn’t answering, so the transcript can’t follow' : ready ? (playing ? 'Playing' : 'Paused') : 'Loading the player…') : name}</span>
            )}
            <span className="vt-bar-gap" />
            {active && (
              <label className="vt-rate" title="Playback speed (< and >)">
                <span className="sr-only">Speed</span>
                <select value={rate} onChange={(e) => changeRate(Number(e.target.value))}>
                  {RATES.map((r) => (
                    <option key={r} value={r}>
                      {r === 1 ? '1×' : `${r}×`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(hasLines || tr.status === 'missing') && (
              <button className={`vt-btn${showLines ? ' on' : ''}`} onClick={() => setShowLines((v) => !v)} aria-pressed={showLines} title={showLines ? 'Hide the transcript' : 'Show the transcript'}>
                <Icon name="list" size={14} />
                <span>Transcript</span>
              </button>
            )}
            {active && !noCinema && (
              <button
                className={`vt-btn${cinema ? ' on' : ''}`}
                onClick={() => {
                  rememberCinema(!cinema)
                  setCinema(!cinema)
                }}
                aria-pressed={cinema}
                title={cinema ? 'Cinema: across the page. Click to keep it in the column' : 'Across the page, on a dark band'}
              >
                <Icon name="width" size={14} />
                <span>Cinema</span>
              </button>
            )}
            <button className={`vt-btn${notesOpen ? ' on' : ''}`} onClick={() => setNotesOpen((v) => !v)} aria-pressed={notesOpen} title="Write notes as you watch, each at its moment (N)">
              <Icon name="edit" size={14} />
              <span>Notes</span>
            </button>
            {ytUrl && (
              <button className="vt-btn icon" onClick={() => window.tide.app.openExternal(ytUrl)} title="Open on YouTube, at this moment">
                <Icon name="external" size={14} />
              </button>
            )}
            {active && (
              <button className="vt-btn icon" onClick={stop} title="Close the player (Esc)">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        )}
        {notesOpen && (
          <div className="vt-notes">
            <div className="vt-notes-row">
              <span className="vt-notes-at">{formatTime(noteAt ?? engine.current?.time() ?? clock)}</span>
              <textarea
                autoFocus
                value={draft}
                placeholder="A note at this moment. The video pauses while you write."
                onChange={(e) => {
                  if (e.target.value && noteAt === null) startNote()
                  setDraft(e.target.value)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) {
                    e.preventDefault()
                    void keepNote()
                  } else if (e.key === 'Escape') {
                    setDraft('')
                    setNoteAt(null)
                    if (resumeAfterNote.current) engine.current?.play()
                    resumeAfterNote.current = false
                    rootRef.current?.focus()
                  }
                }}
              />
            </div>
            {taken.length > 0 && (
              <ul className="vt-notes-list">
                {taken.map((n, i) => (
                  <li key={i}>
                    <button className="vt-time" onClick={() => seekTo(n.at)}>
                      {formatTime(n.at)}
                    </button>
                    <span>{n.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="vt-notes-foot">
              <span>
                <kbd>↵</kbd> keep · <kbd>⇧↵</kbd> new line · <kbd>esc</kbd> discard
              </span>
              <span className="vt-bar-gap" />
              {notesPage && <span title={notesPage}>Kept in {notesPage.split('/').pop()?.replace(/\.md$/, '')}</span>}
            </div>
          </div>
        )}
      </div>
      {transcriptShown && (
        <aside className="vt-transcript" aria-label="Transcript">
          <header className="vt-tr-head">
            <span>Transcript</span>
            {tr.status === 'ready' && tr.t.from === 'note' && <span className="vt-tr-note" title="Read from the note's paragraphs: each line's time is estimated within its paragraph">times approximate</span>}
            <span className="vt-bar-gap" />
            {hasLines && !follow && (
              <button className="vt-btn small" onClick={() => (setFollow(true), (userScrolled.current = 0), engine.current && ((marked.current = -1), markLine(engine.current.time())))}>
                Follow along
              </button>
            )}
          </header>
          <div
            className="vt-lines"
            ref={listRef}
            onWheel={() => {
              userScrolled.current = Date.now()
              if (active && playing) setFollow(false)
            }}
          >
            {hasLines ? (
              linesView
            ) : tr.status === 'loading' ? (
              <p className="vt-empty">Reading the captions…</p>
            ) : tr.status === 'missing' ? (
              <div className="vt-empty">
                <p>{tr.why === 'offline' ? 'Couldn’t reach YouTube for the captions.' : 'This video has no captions, so there’s no transcript to follow.'}</p>
                {tr.why === 'offline' && (
                  <button className="link-btn small" onClick={() => void loadTranscript(true)}>
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <p className="vt-empty">The transcript appears as it plays.</p>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
