import { useEffect, useRef, useState } from 'react'
import { coverOf, coverQuery, type Artwork } from '@shared/noteCover'
import { propsLine } from '@shared/bookPage'
import { vaultUrl } from '../lib/markdown'
import { useApp } from '../state'
import { Icon } from './Icon'

/**
 * A note's cover banner, as on a Notion page: the image across the top (change it, drag it to
 * reposition it, or take it off), the note's icon over its lower edge, and for a book page, the
 * book as its icon and a line of its properties. Any note can have one; it lives in the note's
 * frontmatter (shared/noteCover), so it travels with the note.
 */

const src = (s: string) => (/^https:\/\//i.test(s) ? s : vaultUrl(s))

export function NoteCover({ path, props, title, onChange }: { path: string; props: Record<string, unknown>; /** A book page's title, set under its icon with its properties (read mode) */ title?: string; onChange(): void }) {
  const app = useApp()
  const { cover, icon } = coverOf(props)
  const [picking, setPicking] = useState(false)
  const [moving, setMoving] = useState<number | null>(null)
  const drag = useRef<{ y: number; from: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.tide.room.pageInfo>>>(null)
  const isBook = 'tide_book' in props

  useEffect(() => {
    if (!isBook) return setInfo(null)
    window.tide.room.pageInfo(path).then(setInfo).catch(() => setInfo(null))
  }, [path, isBook, props])

  const y = moving ?? cover?.y ?? 40
  const save = async () => {
    if (moving === null) return
    await window.tide.covers.y(path, moving)
    setMoving(null)
    onChange()
  }

  const line = info ? propsLine({ author: info.author, chapter: info.chapter, progress: info.progress, quotes: info.quotes, notes: info.notes, started: info.started }) : []

  return (
    <div className={`note-cover-host${cover ? ' has-cover' : ''}${icon ? ' has-icon' : ''}`}>
      {cover ? (
        <div
          ref={boxRef}
          className={`note-cover${moving !== null ? ' moving' : ''}`}
          style={{ backgroundImage: `url("${src(cover.src)}")`, backgroundPosition: `center ${y}%` }}
          onMouseDown={(e) => {
            if (moving === null) return
            drag.current = { y: e.clientY, from: y }
            const move = (ev: MouseEvent) => {
              if (!drag.current) return
              const h = boxRef.current?.offsetHeight ?? 220
              setMoving(Math.max(0, Math.min(100, drag.current.from - ((ev.clientY - drag.current.y) / h) * 100)))
            }
            const up = () => {
              drag.current = null
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          }}
          role="img"
          aria-label={cover.credit ? `Cover: ${cover.credit}` : 'Cover'}
          title={moving === null ? cover.credit : undefined}
        >
          <div className="note-cover-acts">
            {moving === null ? (
              <>
                <button onClick={() => setPicking(true)}>Change cover</button>
                <button onClick={() => setMoving(cover.y)}>Reposition</button>
              </>
            ) : (
              <>
                <span className="note-cover-hint">Drag the image to reposition</span>
                <button onClick={save}>Save position</button>
                <button onClick={() => setMoving(null)}>Cancel</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="note-cover-add">
          <button onClick={() => setPicking(true)}>
            <Icon name="image" size={13} /> Add cover
          </button>
        </div>
      )}
      {(icon || line.length > 0) && (
        <div className="note-cover-under reading-column">
          {icon && <div className={`note-icon${isBook ? ' book' : ''}`} style={{ backgroundImage: `url("${src(icon)}")` }} role="img" aria-label="Icon" />}
          {isBook && title && <h1 className="note-cover-title">{title}</h1>}
          {line.length > 0 && (
            <div className="note-props" aria-label="About this book">
              {line.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
              {info && (
                <button className="note-props-open" onClick={() => app.setView({ kind: 'reader', path: info.book })}>
                  <Icon name="book" size={13} /> Open the book
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {picking && (
        <CoverPicker
          path={path}
          query={coverQuery({ title: String(props.title ?? path.split('/').pop() ?? ''), subjects: [] })}
          hasCover={!!cover}
          onClose={() => setPicking(false)}
          onDone={() => {
            setPicking(false)
            onChange()
          }}
        />
      )}
    </div>
  )
}

/** Choosing a cover: public-domain art from The Met and the Art Institute of Chicago, or an image of yours */
export function CoverPicker({ path, query, hasCover, onClose, onDone }: { path: string; query: string; hasCover: boolean; onClose(): void; onDone(): void }) {
  const app = useApp()
  const [q, setQ] = useState(query)
  const [art, setArt] = useState<Artwork[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const err = (e: unknown) => setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

  const search = async (text = q) => {
    setBusy('search')
    setError(null)
    try {
      const found = await window.tide.covers.search(text)
      setArt(found)
      if (!found.length) setError('Nothing found. Try another word: a place, a season, a painter.')
    } catch (e) {
      err(e)
    } finally {
      setBusy(null)
    }
  }
  useEffect(() => {
    search(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const pick = async (a: Artwork) => {
    setBusy(a.id)
    try {
      await window.tide.covers.art(path, a)
      app.toast(`Cover: ${a.title}${a.artist ? `, ${a.artist}` : ''}`)
      onDone()
    } catch (e) {
      err(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="cover-picker-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cover-picker" role="dialog" aria-label="Choose a cover">
        <div className="cover-picker-head">
          <b>Choose a cover</b>
          <button className="rr-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <form
          className="cover-picker-row"
          onSubmit={(e) => {
            e.preventDefault()
            search()
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="landscape, sea, winter, a painter…" aria-label="Search public-domain art" />
          <button className="rr-btn primary" disabled={!!busy}>
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
        </form>
        <p className="cover-picker-note">Public-domain art (CC0) from The Met and the Art Institute of Chicago. The image is kept with your note, credited.</p>
        <div className="cover-grid" aria-busy={busy === 'search'}>
          {(art ?? []).map((a) => (
            <button key={a.id} className={`cover-thumb${busy === a.id ? ' busy' : ''}`} disabled={!!busy} onClick={(e) => e.nativeEvent.isTrusted !== false && pick(a)} title={`${a.title}${a.artist ? `, ${a.artist}` : ''}${a.date ? ` (${a.date})` : ''} · ${a.museum}`}>
              <Thumb url={a.thumb} alt={a.title} />
              <span>
                <b>{a.title}</b>
                <small>{[a.artist, a.museum].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="rr-error">{error}</p>}
        <div className="cover-picker-foot">
          <button
            className="rr-btn"
            disabled={!!busy}
            onClick={async () => {
              try {
                if (await window.tide.covers.own(path)) onDone()
              } catch (e) {
                err(e)
              }
            }}
          >
            <Icon name="upload" size={13} /> Your own image…
          </button>
          {hasCover && (
            <button
              className="rr-btn ghost"
              onClick={async () => {
                await window.tide.covers.remove(path)
                onDone()
              }}
            >
              Remove cover
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** A museum thumbnail, fetched by the main process and shown when it arrives */
function Thumb({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.tide.covers.thumb(url).then((d) => live && setSrc(d)).catch(() => {})
    return () => {
      live = false
    }
  }, [url])
  return src ? <img src={src} alt={alt} /> : <span className="cover-thumb-wait" aria-hidden="true" />
}
