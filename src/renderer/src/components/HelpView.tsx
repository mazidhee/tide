import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { parsePage, searchDocs, sections, segments, type DocPage, type Segment, type WalkStep } from '@shared/docs'
import { renderMarkdown, slugify } from '../lib/markdown'
import { motionPaused } from '../lib/motion'
import { reveal } from '../lib/scroll'
import { useApp, type View } from '../state'
import { Icon } from './Icon'

/**
 * The guide, bundled with the app: docs/guide, one Markdown page each (see shared/docs.ts). A
 * home page with a tour and the walkthroughs, then pages with the guide's contents on the left
 * and the page's own on the right. Walkthroughs play over screenshots of Tide and can open the
 * real screen they show.
 */

const RAW = import.meta.glob('../../../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const IMAGES = import.meta.glob('../../../../docs/guide/img/*.jpg', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const imageUrl = (name: string) => IMAGES[`../../../../docs/guide/img/${name}.jpg`]

const ALL = Object.keys(RAW)
  .sort()
  .map((f) => parsePage(f, RAW[f]))
const INDEX = ALL.find((p) => p.id === 'index')!
const PAGES = ALL.filter((p) => p !== INDEX)
const GROUPS = [...new Set(PAGES.map((p) => p.group))]

/** Screens a walkthrough step can open */
const OPEN: Record<string, { label: string; view: View }> = {
  home: { label: 'Open Home', view: { kind: 'home' } },
  library: { label: 'Open the Library', view: { kind: 'library' } },
  learn: { label: 'Open Learn', view: { kind: 'learn' } },
  practice: { label: 'Open Practice', view: { kind: 'practice' } },
  review: { label: 'Open Review', view: { kind: 'study', scope: { kind: 'vault' } } },
  week: { label: 'Open Your week', view: { kind: 'coach' } },
  brain: { label: 'Open the Brain', view: { kind: 'graph' } },
  chat: { label: 'Open Chat', view: { kind: 'chat' } },
  voice: { label: 'Open voice settings', view: { kind: 'settings', section: 'tutor' } }
}

const md = (text: string) => renderMarkdown(text, { notePath: '', filesByName: new Map() })

/** Which page a section in a link or the menu points at: a page id, a heading on a page, or home */
function resolve(section?: string): { page?: DocPage; heading?: string } {
  if (!section || section === 'index') return {}
  const id = section.replace(/\.md$/, '').replace(/^\d+-/, '')
  const page = PAGES.find((p) => p.id === id)
  if (page) return { page }
  const slug = slugify(section)
  for (const p of PAGES) if (sections(p.body).some((s) => slugify(s) === slug)) return { page: p, heading: slug }
  return {}
}

export function HelpView({ section }: { section?: string }) {
  const app = useApp()
  const { page, heading } = resolve(section)
  const scrollRef = useRef<HTMLDivElement>(null)
  const go = (to: string) => app.setView({ kind: 'help', section: to })

  // A new page starts at the top, or at the section asked for
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (heading) setTimeout(() => reveal(el.querySelector<HTMLElement>(`[id="${CSS.escape(heading)}"]`)), 30)
    else el.scrollTop = 0
  }, [page?.id, heading])

  // Links between pages stay in Help; web links open in the browser
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href') ?? ''
    if (!a || /^https?:/.test(href)) return
    if (/\.md(#.*)?$/.test(href)) {
      e.preventDefault()
      go(href.replace(/#.*$/, ''))
    } else if (href.startsWith('#') && href.length > 1) {
      e.preventDefault()
      reveal(scrollRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(href.slice(1))}"]`))
    }
  }

  return (
    <div className="doc-view help">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          {page ? (
            <>
              <button className="crumb crumb-link" onClick={() => go('index')}>
                Guide
              </button>
              <span className="crumb">
                <Icon name="chevron" size={11} />
              </span>
              <span className="crumb current">{page.title}</span>
            </>
          ) : (
            <span className="crumb current">Guide</span>
          )}
        </div>
        <div className="gd-spacer" />
        {page && <GuideSearch onGo={go} compact />}
      </header>
      {page ? (
        <div className="gd-layout">
          <GuideNav current={page.id} onGo={go} />
          <div className="doc-scroll gd-scroll" ref={scrollRef} onClick={onClick}>
            <GuidePage page={page} onGo={go} />
          </div>
          <OnThisPage page={page} scrollRef={scrollRef} />
        </div>
      ) : (
        <div className="doc-scroll gd-scroll" ref={scrollRef} onClick={onClick}>
          <GuideHome onGo={go} />
        </div>
      )}
    </div>
  )
}

function GuideHome({ onGo }: { onGo(to: string): void }) {
  const tour = segments(INDEX.body).find((s): s is Extract<Segment, { kind: 'walk' }> => s.kind === 'walk')
  const flows = PAGES.filter((p) => p.group === 'Walkthroughs' && p.meta.card !== 'no')
  const news = PAGES.filter((p) => p.meta.new)
  return (
    <div className="gd-home">
      <section className="gd-hero">
        <h1>{INDEX.title}</h1>
        <p className="gd-lede">{INDEX.summary}</p>
        <GuideSearch onGo={onGo} />
        <div className="gd-hero-actions">
          <button className="btn primary" onClick={() => onGo('setup')}>
            Set up Tide
          </button>
          <button className="btn" onClick={() => onGo('flow-day')}>
            Walk through a study day
          </button>
        </div>
      </section>

      {tour && (
        <section className="gd-tour">
          <Walkthrough steps={tour.steps} title={tour.title} tour />
        </section>
      )}

      <section className="gd-band">
        <div className="gd-band-head">
          <h2>Start with what you want to do</h2>
          <p>Each one is a complete walkthrough, from the first click to the end of the session.</p>
        </div>
        <div className="gd-cards">
          {flows.map((p) => (
            <button key={p.id} className="gd-card" onClick={() => onGo(p.id)}>
              <div className="gd-card-art">
                <Anim anim={p.meta.animation ?? 'map'} labels={[]} />
              </div>
              <h3>{p.title}</h3>
              <p>{p.summary}</p>
            </button>
          ))}
        </div>
      </section>

      {news.length > 0 && (
        <section className="gd-band">
          <div className="gd-band-head">
            <h2>New in this version</h2>
            <p>What changed in November 2026.</p>
          </div>
          <div className="gd-news">
            {news.map((p) => (
              <button key={p.id} className="gd-new" onClick={() => onGo(p.id)}>
                {p.meta['new-image'] && <img src={imageUrl(p.meta['new-image'])} alt="" />}
                <span>
                  <b>{p.meta.new}</b>
                  <span>{p.meta['new-text']}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="gd-band">
        <div className="gd-band-head">
          <h2>Everything in the guide</h2>
        </div>
        <div className="gd-all">
          {GROUPS.map((g) => (
            <div key={g}>
              <h4>{g}</h4>
              {PAGES.filter((p) => p.group === g).map((p) => (
                <button key={p.id} onClick={() => onGo(p.id)}>
                  {p.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function GuideNav({ current, onGo }: { current: string; onGo(to: string): void }) {
  return (
    <nav className="gd-nav" aria-label="Guide">
      <button className="gd-nav-item" onClick={() => onGo('index')}>
        Guide home
      </button>
      {GROUPS.map((g) => (
        <div key={g}>
          <h4>{g}</h4>
          {PAGES.filter((p) => p.group === g).map((p) => (
            <button key={p.id} className={`gd-nav-item${p.id === current ? ' on' : ''}`} aria-current={p.id === current ? 'page' : undefined} onClick={() => onGo(p.id)}>
              {p.title}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

function GuidePage({ page, onGo }: { page: DocPage; onGo(to: string): void }) {
  const parts = useMemo(() => segments(page.body), [page])
  const i = PAGES.indexOf(page)
  const prev = PAGES[i - 1]
  const next = PAGES[i + 1]
  return (
    <article className="gd-page">
      <p className="gd-group">{page.group}</p>
      <h1>{page.title}</h1>
      {page.summary && <p className="gd-sub">{page.summary}</p>}
      {parts.map((s, n) => (
        <Part key={`${page.id}-${n}`} seg={s} />
      ))}
      <nav className="gd-pager">
        {prev ? (
          <button onClick={() => onGo(prev.id)}>
            <small>Previous</small>
            {prev.title}
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button className="next" onClick={() => onGo(next.id)}>
            <small>Next</small>
            {next.title}
          </button>
        )}
      </nav>
    </article>
  )
}

function Part({ seg }: { seg: Segment }): ReactNode {
  const html = useMemo(() => (seg.kind === 'md' ? md(seg.text) : ''), [seg])
  if (seg.kind === 'md') return <div className="prose gd-prose" dangerouslySetInnerHTML={{ __html: html }} />
  if (seg.kind === 'walk') return <Walkthrough steps={seg.steps} title={seg.title} />
  if (seg.kind === 'anim')
    return (
      <div className="gd-anim-box">
        <Anim anim={seg.anim} labels={seg.labels} />
      </div>
    )
  return (
    <figure className="gd-figure">
      <img src={imageUrl(seg.image)} alt={seg.caption} loading="lazy" />
      {seg.caption && <figcaption>{seg.caption}</figcaption>}
    </figure>
  )
}

/** The page's own sections, with the one being read marked */
function OnThisPage({ page, scrollRef }: { page: DocPage; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const heads = useMemo(() => sections(page.body).map((t) => ({ t, id: slugify(t) })), [page])
  const [active, setActive] = useState('')
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const line = el.getBoundingClientRect().top + 120
      let cur = ''
      for (const h of heads) {
        const node = el.querySelector<HTMLElement>(`[id="${CSS.escape(h.id)}"]`)
        if (node && node.getBoundingClientRect().top <= line) cur = h.id
      }
      setActive(cur)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [heads, scrollRef])
  if (!heads.length) return <aside className="gd-toc" />
  return (
    <aside className="gd-toc">
      <p>On this page</p>
      {heads.map((h) => (
        <button key={h.id} className={active === h.id ? 'on' : ''} onClick={() => reveal(scrollRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(h.id)}"]`))}>
          {h.t}
        </button>
      ))}
    </aside>
  )
}

function GuideSearch({ onGo, compact }: { onGo(to: string): void; compact?: boolean }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchDocs(PAGES, q, 8), [q])
  const pick = (i: number) => {
    const h = hits[i]
    if (!h) return
    setOpen(false)
    setQ('')
    onGo(h.section ? h.section : h.page)
  }
  // "/" finds, like most docs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(el?.tagName ?? '') && !el?.isContentEditable) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={`gd-search${compact ? ' compact' : ''} no-drag`}>
      <Icon name="search" size={compact ? 13 : 16} />
      <input
        ref={ref}
        value={q}
        placeholder={compact ? 'Search the guide' : 'Search the guide, e.g. “bookcase” or “plan my week”'}
        aria-label="Search the guide"
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length))
          } else if (e.key === 'Enter') pick(sel)
          else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
      />
      {!q && <kbd>/</kbd>}
      {open && q.trim() && (
        <div className="gd-results" role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <button key={`${h.page}-${h.section ?? ''}`} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setSel(i)}>
                <span className="gd-r-title">
                  {h.title} <span>{h.where}</span>
                </span>
                <span className="gd-r-snip">{h.snippet}</span>
              </button>
            ))
          ) : (
            <p className="gd-r-empty">Nothing matches “{q}”. Try a feature name like “bookcase” or “Things”.</p>
          )}
        </div>
      )}
    </div>
  )
}

const STEP_MS = 6000

/** Steps over screenshots of Tide: a ring moves to what each step is about, and plays by itself */
function Walkthrough({ steps, title, tour }: { steps: WalkStep[]; title: string; tour?: boolean }) {
  const app = useApp()
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [progress, setProgress] = useState(0)
  const [shown, setShown] = useState(steps[0]?.image)
  const [fade, setFade] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const step = steps[at]
  const say = useMemo(() => (step ? md(step.text) : ''), [step])

  // Crossfade when the screenshot changes
  useEffect(() => {
    if (!step || step.image === shown) return
    setFade(true)
    const t = setTimeout(() => {
      setShown(step.image)
      setFade(false)
    }, 160)
    return () => clearTimeout(t)
  }, [step, shown])

  // Plays only while it's on screen and the model isn't working
  useEffect(() => {
    if (!playing) return
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.3 })
    if (box.current) io.observe(box.current)
    let last = performance.now()
    let elapsed = 0
    let raf = 0
    const tick = (now: number) => {
      if (visible && !motionPaused()) elapsed += now - last
      last = now
      setProgress(Math.min(1, elapsed / STEP_MS))
      if (elapsed >= STEP_MS) {
        elapsed = 0
        setAt((a) => (a + 1) % steps.length)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [playing, at, steps.length])

  if (!step) return null
  const choose = (i: number) => {
    setAt((i + steps.length) % steps.length)
    setPlaying(false)
    setProgress(0)
  }
  const [x, y, w, h] = step.hot
  const open = step.open ? OPEN[step.open] : undefined
  return (
    <div className={`gd-walk${tour ? ' tour' : ''}`} ref={box}>
      <div className="gd-walk-head">
        <b>{title}</b>
        <span>
          {at + 1} of {steps.length}
        </span>
        <div className="gd-walk-ctl">
          <button className="icon-btn small" onClick={() => choose(at - 1)} aria-label="Previous step">
            <Icon name="back" size={13} />
          </button>
          <button className="btn small" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="icon-btn small" onClick={() => choose(at + 1)} aria-label="Next step">
            <Icon name="chevron" size={13} />
          </button>
        </div>
      </div>
      <div className="gd-stage">
        <img src={imageUrl(shown)} alt="" className={fade ? 'fading' : ''} />
        <div className="gd-ring" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }} />
      </div>
      <div className="gd-bar">
        <i style={{ width: `${(playing ? progress : 0) * 100}%` }} />
      </div>
      <div className="gd-say">
        <div className="gd-say-text" dangerouslySetInnerHTML={{ __html: say }} />
        {open && (
          <button className="btn small" onClick={() => app.setView(open.view)}>
            {open.label}
          </button>
        )}
      </div>
      <ol className="gd-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <button aria-current={i === at} onClick={() => choose(i)}>
              <span className="n">{i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

const SPINES: [string, number][] = [
  ['#7c4a3a', 58],
  ['#3f5f7c', 66],
  ['#c9a25a', 72],
  ['#4e6b4f', 54],
  ['#8b8f96', 64],
  ['#5a4a7a', 60],
  ['#9a5b3d', 50]
]

const vars = (v: Record<string, string | number>) => v as React.CSSProperties

/** Small looping drawings for the cards and pages; still while the model is working */
function Anim({ anim, labels }: { anim: string; labels: string[] }) {
  if (anim === 'day')
    return (
      <div className="gd-anim a-day" aria-hidden="true">
        {[62, 48, 70, 38].map((w, i) => (
          <div key={i} style={vars({ '--i': i })}>
            <i />
            <s style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    )
  if (anim === 'ladder') {
    const l = labels.length ? labels : ['1', '2', '3', '4']
    return (
      <div className="gd-anim a-ladder" aria-hidden="true">
        {l.map((t, i) => (
          <div key={i} style={vars({ '--i': i, '--h': `${30 + (i * 56) / Math.max(1, l.length - 1)}%` })}>
            {t}
          </div>
        ))}
      </div>
    )
  }
  if (anim === 'shelf')
    return (
      <div className="gd-anim a-shelf" aria-hidden="true">
        {SPINES.map(([c, h], i) => (
          <b key={i} className={i === 2 ? 'out' : ''} style={{ background: c, height: h }} />
        ))}
      </div>
    )
  if (anim === 'wave')
    return (
      <div className="gd-anim a-wave" aria-hidden="true">
        {Array.from({ length: 15 }, (_, i) => (
          <b key={i} style={vars({ '--i': i })} />
        ))}
      </div>
    )
  if (anim === 'brain')
    return (
      <div className="gd-anim a-brain" aria-hidden="true">
        <svg viewBox="0 0 300 112">
          <line x1="150" y1="56" x2="70" y2="30" />
          <line x1="150" y1="56" x2="230" y2="28" />
          <line x1="150" y1="56" x2="90" y2="90" />
          <line x1="150" y1="56" x2="220" y2="88" />
          <line x1="70" y1="30" x2="40" y2="62" />
          <line x1="230" y1="28" x2="268" y2="58" />
          <circle className="you" cx="150" cy="56" r="7" />
          <circle className="glow" cx="70" cy="30" r="5" />
          <circle cx="230" cy="28" r="4" />
          <circle className="glow b" cx="90" cy="90" r="5" />
          <circle cx="220" cy="88" r="4" />
          <circle cx="40" cy="62" r="3" />
          <circle className="glow c" cx="268" cy="58" r="4" />
        </svg>
      </div>
    )
  const l = labels.length ? labels : ['Statement', 'Matcher', 'Ledger', 'Bank file', 'Exceptions', 'Report']
  return (
    <div className="gd-anim a-map" aria-hidden="true">
      {l.map((t, i) => (
        <div key={i} style={vars({ '--i': i })}>
          {t}
        </div>
      ))}
    </div>
  )
}
