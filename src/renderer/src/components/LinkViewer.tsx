/**
 * Where a link opens in Tide (shared/links): a file of a course's repository or any GitHub
 * repository rendered natively (Markdown, notebooks with their plots, code, pictures, PDFs, CSV,
 * folders with their README), a YouTube video in Tide's player with its transcript, a web page in
 * the reader view (its article, with "Save to library"), or, when a page is an app rather than an
 * article, Tide's sandboxed web view (main/webView). The course reader shows these in its column;
 * anywhere else they open in the reading sheet (components/LinkSheet).
 *
 * Each page tells the tutor what's on screen (lib/onScreen): the page, the section in view, the
 * video's moment, a passage selected.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { codeLanguage, targetUrl, type LinkTarget } from '@shared/links'
import { catalogueCourse } from '@shared/courseCatalogue'
import { parseDelimited, sniffDelimiter } from '@shared/csvTable'
import type { OnScreen } from '@shared/onScreen'
import type { RepoFileView } from '../../../main/courseFiles'
import type { ReadPage } from '../../../main/linkReader'
import type { WebState } from '../../../main/webView'
import { renderMarkdown } from '../lib/markdown'
import { codeBlockClick } from '../lib/runBlocks'
import { courseRepos, onGoto, openInBrowser, openTarget, scrollToHeading } from '../lib/linkNav'
import { clearScreen, patchScreen, sectionIn, setScreen, trackSelection } from '../lib/onScreen'
import { useApp } from '../state'
import { Icon } from './Icon'
import { CleanedNote, originalHtml, useShowOriginal } from './CleanedNote'
import { VideoPlayer } from './VideoPlayer'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const env = { notePath: '', filesByName: new Map<string, string>() }
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The page's name, for the bar above it and the history */
export function targetTitle(t: LinkTarget): string {
  if (t.kind === 'course-file') return t.path.split('/').pop() || catalogueCourse(t.course)?.title || 'Course'
  if (t.kind === 'github-file') return t.path.split('/').pop() || t.repo
  if (t.kind === 'youtube') return 'Video'
  if (t.kind === 'web') return host(t.url)
  return ''
}

// ---------- The bar over a page: back, forward, where it is from ----------

export function ViewerBar({ back, forward, onBack, onForward, url, label, onClose, children }: { back: boolean; forward: boolean; onBack(): void; onForward(): void; url?: string | null; label?: string; onClose?: () => void; children?: React.ReactNode }) {
  return (
    <div className="lv-bar" role="toolbar" aria-label="Page">
      <button className="icon-btn small" disabled={!back} onClick={onBack} title="Back (⌘[)" aria-label="Back">
        <Icon name="back" size={14} />
      </button>
      <button className="icon-btn small lv-fwd" disabled={!forward} onClick={onForward} title="Forward (⌘])" aria-label="Forward">
        <Icon name="back" size={14} />
      </button>
      <span className="lv-where" title={url ?? undefined}>
        {label && <span className="lv-label">{label}</span>}
        {url && <span className="lv-url">{url.replace(/^https?:\/\/(www\.)?/, '')}</span>}
      </span>
      {children}
      {url && (
        <button className="icon-btn small" onClick={() => openInBrowser(url)} title="Open in your browser" aria-label="Open in your browser">
          <Icon name="external" size={13} />
        </button>
      )}
      {onClose && (
        <button className="icon-btn small" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  )
}

// ---------- One page ----------

export function LinkPage({ target, onShow }: { target: LinkTarget; onShow?: (t: LinkTarget) => void }) {
  if (target.kind === 'course-file' || target.kind === 'github-file') return <RepoPage key={`${target.kind}:${'course' in target ? target.course : target.repo}:${target.path}`} target={target} />
  if (target.kind === 'youtube') return <VideoPage key={target.id} id={target.id} t={target.t} />
  if (target.kind === 'web') return <WebPage key={target.url} url={target.url} onShow={onShow} />
  return null
}

/** Keeps the tutor told which section is in view, as the page scrolls */
export function useSectionInView(root: React.RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    const el = root.current
    if (!el || !ready) return
    const sc = scrollerOf(el)
    let raf = 0
    const look = () => {
      raf = 0
      const seen = sectionIn(el, (sc?.getBoundingClientRect().top ?? 0) + 90)
      if (seen) patchScreen(seen)
    }
    const on = () => (raf ||= requestAnimationFrame(look))
    look()
    ;(sc ?? window).addEventListener('scroll', on, { passive: true })
    return () => {
      ;(sc ?? window).removeEventListener('scroll', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [root, ready])
  // The tutor pointing at a section (show_in_view)
  useEffect(() => onGoto((g) => !!g.section && !!root.current && scrollToHeading(root.current, g.section)), [root])
  useEffect(() => (root.current ? trackSelection(root.current) : undefined), [root, ready])
}

export function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

// ---------- A file in a repository ----------

function RepoPage({ target }: { target: Extract<LinkTarget, { kind: 'course-file' | 'github-file' }> }) {
  const [v, setV] = useState<RepoFileView | null | undefined>(undefined)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    setV(undefined)
    const p = target.kind === 'course-file' ? window.tide.links.courseFile(target.course, target.path) : window.tide.links.githubFile(target.repo, target.ref, target.path)
    p.then((x) => live && setV(x)).catch(() => live && setV(null))
    return () => {
      live = false
    }
  }, [target])
  const course = target.kind === 'course-file' ? catalogueCourse(target.course) : undefined
  const title = target.path.split('/').pop() || course?.title || (target.kind === 'github-file' ? target.repo : '')
  const screen = useMemo<OnScreen>(
    () => ({ kind: target.kind, title, path: target.path, url: targetUrl(target, courseRepos()) ?? undefined, ...(course ? { course: { id: course.id, title: course.title } } : {}) }),
    [target, title, course]
  )
  useEffect(() => {
    setScreen(screen)
    return () => clearScreen(screen)
  }, [screen])
  useEffect(() => {
    if (v && target.anchor && ref.current) requestAnimationFrame(() => ref.current && scrollToHeading(ref.current, target.anchor!))
  }, [v, target.anchor])
  useSectionInView(ref, !!v)
  const [original, toggleOriginal] = useShowOriginal(v)

  const linkBase = target.kind === 'course-file' ? { 'data-link-course': target.course, 'data-link-path': v?.kind === 'folder' ? `${target.path}/README.md` : target.path } : { 'data-link-repo': target.repo, 'data-link-ref': target.ref, 'data-link-path': v?.kind === 'folder' ? `${target.path}/README.md` : target.path }
  const crumbs = target.path.split('/').filter(Boolean)
  const to = (path: string): LinkTarget => (target.kind === 'course-file' ? { kind: 'course-file', course: target.course, path } : { kind: 'github-file', repo: target.repo, ref: target.ref, path })

  return (
    <div className="lv-page lv-repo" ref={ref} data-link-root {...linkBase}>
      <header className="lv-head">
        <nav className="lv-crumbs" aria-label="Where in the repository">
          <button className="lv-crumb" onClick={() => openTarget(to(''))}>
            {course?.title ?? (target.kind === 'github-file' ? target.repo : '')}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="lv-crumb-wrap">
              <span aria-hidden="true">/</span>
              {i < crumbs.length - 1 ? (
                <button className="lv-crumb" onClick={() => openTarget(to(crumbs.slice(0, i + 1).join('/')))}>
                  {c}
                </button>
              ) : (
                <span className="lv-crumb here">{c}</span>
              )}
            </span>
          ))}
        </nav>
        {v && v.kind !== 'folder' && <h1 className="lv-title">{title}</h1>}
        {v && <CleanedNote cleaning={v.cleaning} original={original} onToggle={toggleOriginal} />}
      </header>
      {v === undefined ? (
        <Skeleton />
      ) : v === null ? (
        <p className="lv-quiet">This couldn’t be opened.</p>
      ) : v.missing ? (
        <Missing why={v.missing} url={targetUrl(target, courseRepos())} />
      ) : (
        <FileBody v={v} target={target} original={original} open={(p) => openTarget(to(p))} />
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="crs-skeleton" aria-busy="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function Missing({ why, url }: { why: string; url?: string | null }) {
  return (
    <div className="lv-missing">
      <p>{why}</p>
      {url && (
        <button className="link-btn small" onClick={() => openInBrowser(url)}>
          Open it in your browser instead
        </button>
      )}
    </div>
  )
}

function FileBody({ v, target, original, open }: { v: RepoFileView; target: Extract<LinkTarget, { kind: 'course-file' | 'github-file' }>; original: boolean; open: (path: string) => void }) {
  const html = useMemo(() => {
    if (!v.text) return ''
    const prep = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '')
    if (v.kind === 'markdown' || v.kind === 'notebook' || v.kind === 'folder') return original && v.cleaning ? originalHtml(v.cleaning, (md) => renderMarkdown(md, env), prep) : renderMarkdown(prep(v.text), env)
    if (v.kind === 'code' && v.text.length < 300_000) {
      const fence = '`'.repeat(Math.max(3, ...(v.text.match(/`{3,}/g) ?? []).map((t) => t.length + 1)))
      return renderMarkdown(`${fence}${codeLanguage(v.path)}\n${v.text.replace(/\n$/, '')}\n${fence}`, env)
    }
    return ''
  }, [v, original])
  if (v.kind === 'folder') {
    return (
      <>
        <ul className="lv-files">
          {(v.entries ?? []).map((e) => (
            <li key={e.path}>
              <button className="lv-file" onClick={() => open(e.path)}>
                <Icon name={e.folder ? 'folder' : /\.(md|ipynb)$/i.test(e.name) ? 'article' : /\.pdf$/i.test(e.name) ? 'pdf' : /\.(png|jpe?g|gif|svg|webp)$/i.test(e.name) ? 'image' : 'note'} size={13} />
                <span>{e.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {html && <article className="prose crs-prose lv-readme" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => void codeBlockClick(e.target)} />}
      </>
    )
  }
  if (v.kind === 'image') return <figure className="lv-image"><img src={v.url} alt={v.path.split('/').pop()} /></figure>
  if (v.kind === 'video') return <video className="lv-video" src={v.url} controls preload="metadata" />
  if (v.kind === 'pdf') return <PdfPages load={() => window.tide.links.repoPdf('course' in v.source ? { course: v.source.course } : { repo: v.source.repo, ref: v.source.ref }, v.path)} />
  if (v.kind === 'csv' && v.text) return <CsvTable text={v.text} />
  if (html) return <article className={`prose crs-prose${v.kind === 'notebook' ? ' notebook' : ''}${v.kind === 'code' ? ' lv-code' : ''}`} dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => void codeBlockClick(e.target, { cumulative: v.kind === 'notebook' })} />
  if (v.text) return <pre className="lv-plain">{v.text}</pre>
  return <Missing why="There’s nothing to show in it." url={targetUrl(target, courseRepos())} />
}

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => {
    try {
      return parseDelimited(text.slice(0, 2_000_000), sniffDelimiter(text.slice(0, 20_000)))
    } catch {
      return []
    }
  }, [text])
  if (!rows.length) return <pre className="lv-plain">{text.slice(0, 50_000)}</pre>
  const [head, ...body] = rows
  const shown = body.slice(0, 500)
  return (
    <div className="lv-table-wrap">
      <p className="lv-meta">
        {body.length.toLocaleString()} rows · {head.length} columns{body.length > shown.length ? ` · the first ${shown.length} shown` : ''}
      </p>
      <div className="lv-table-scroll">
        <table className="lv-table">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {head.map((_, j) => (
                  <td key={j}>{r[j] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- A PDF, page by page ----------

export function PdfPages({ load }: { load: () => Promise<Uint8Array | null> }) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null | undefined>(undefined)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    let opened: pdfjs.PDFDocumentProxy | null = null
    load()
      .then(async (bytes) => {
        if (!bytes || !live) return live && setDoc(null)
        opened = await pdfjs.getDocument({ data: bytes }).promise
        if (live) setDoc(opened)
        else void opened.destroy()
      })
      .catch(() => live && setDoc(null))
    return () => {
      live = false
      void opened?.destroy()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Pages are drawn as they come near the screen, and let go far from it
  useEffect(() => {
    const el = wrap.current
    if (!doc || !el) return
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const c = e.target as HTMLCanvasElement
          const n = Number(c.dataset.page)
          if (!e.isIntersecting || c.dataset.drawn) continue
          c.dataset.drawn = '1'
          void doc.getPage(n).then((p) => {
            const width = el.clientWidth || 760
            const base = p.getViewport({ scale: 1 })
            const scale = (width / base.width) * Math.min(2, window.devicePixelRatio || 1)
            const vp = p.getViewport({ scale })
            c.width = vp.width
            c.height = vp.height
            c.style.aspectRatio = `${base.width} / ${base.height}`
            return p.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c }).promise
          })
        }
      },
      { root: scrollerOf(el), rootMargin: '800px 0px' }
    )
    el.querySelectorAll('canvas').forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, [doc])
  if (doc === undefined) return <Skeleton />
  if (doc === null) return <p className="lv-quiet">This PDF couldn’t be opened.</p>
  return (
    <div className="lv-pdf" ref={wrap}>
      <p className="lv-meta">{doc.numPages} pages</p>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <canvas key={i} data-page={i + 1} className="lv-pdf-page" style={{ aspectRatio: '1 / 1.414' }} />
      ))}
    </div>
  )
}

// ---------- A video ----------

function VideoPage({ id, t }: { id: string; t?: number }) {
  const screen = useMemo<OnScreen>(() => ({ kind: 'video', title: 'Video', url: `https://www.youtube.com/watch?v=${id}` }), [id])
  useEffect(() => {
    setScreen(screen)
    return () => clearScreen(screen)
  }, [screen])
  return (
    <div className="lv-page lv-video-page">
      <VideoPlayer source={{ kind: 'youtube', id, fetch: true }} start={t} noCinema />
      <p className="lv-meta lv-video-note">Plays in YouTube’s own player inside Tide. Click a line of the transcript to go to it, or select words to ask the tutor about them.</p>
    </div>
  )
}

// ---------- A web page: the reader view, or the page itself ----------

function WebPage({ url, onShow }: { url: string; onShow?: (t: LinkTarget) => void }) {
  const app = useApp()
  const [page, setPage] = useState<ReadPage | undefined>(undefined)
  const [asPage, setAsPage] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    setPage(undefined)
    setAsPage(false)
    window.tide.links
      .read(url)
      .then((p) => live && setPage(p))
      .catch(() => live && setPage({ kind: 'error', url, why: 'The page couldn’t be read.' }))
    return () => {
      live = false
    }
  }, [url])
  const showWeb = asPage || page?.kind === 'app'
  const screen = useMemo<OnScreen | null>(() => (page && page.kind === 'article' && !showWeb ? { kind: 'article', title: page.title, url: page.url } : page ? { kind: 'web', title: ('title' in page && page.title) || host(url), url: page.url } : null), [page, showWeb, url])
  useEffect(() => {
    if (!screen) return
    setScreen(screen)
    return () => clearScreen(screen)
  }, [screen])
  // [clean] The article without its ads, trackers, sign-up boxes and "Related posts" (main/linkReader); the original on request
  const [original, toggleOriginal] = useShowOriginal(page)
  const html = useMemo(() => (page?.kind !== 'article' ? '' : original && page.cleaning ? originalHtml(page.cleaning, (md) => renderMarkdown(md, env)) : renderMarkdown(page.markdown, env)), [page, original])
  useSectionInView(ref, page?.kind === 'article' && !showWeb)
  useEffect(() => {
    if (page && page.kind === 'article' && ref.current && /#./.test(url)) requestAnimationFrame(() => ref.current && scrollToHeading(ref.current, decodeURIComponent(url.split('#').pop()!)))
  }, [page, url])

  const save = async () => {
    try {
      const r = await window.tide.library.saveUrl(url)
      setSaved(r.path)
      await app.refreshTree()
      app.toast(`Saved to your library: ${r.title}`, { action: { label: 'Open', run: () => app.openPath(r.path) } })
    } catch (e) {
      app.toast(`Couldn’t save it: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { tone: 'error' })
    }
  }
  void onShow

  if (page === undefined) return <div className="lv-page"><Skeleton /></div>
  if (showWeb) {
    return (
      <div className="lv-page lv-web-page">
        <div className="lv-web-note">
          <span>{page.kind === 'app' ? `Shown as the page itself: ${page.why.replace(/\.$/, '').toLowerCase()}.` : 'The page itself, in Tide’s sandboxed web view.'}</span>
          <span className="lv-gap" />
          {page.kind === 'article' && (
            <button className="link-btn small" onClick={() => setAsPage(false)}>
              Back to the reader view
            </button>
          )}
        </div>
        <WebFrame url={page.url} excerpt={page.kind === 'article' ? page.markdown : undefined} />
      </div>
    )
  }
  if (page.kind === 'pdf') return <div className="lv-page"><PdfPages load={() => window.tide.links.pdf(page.url)} /></div>
  if (page.kind === 'error') {
    return (
      <div className="lv-page">
        <div className="lv-missing">
          <p>{page.why}</p>
          <button className="link-btn small" onClick={() => setAsPage(true)}>
            Try showing the page itself
          </button>
        </div>
      </div>
    )
  }
  if (page.kind !== 'article') return null
  return (
    <div className="lv-page lv-article" ref={ref} data-link-root>
      <header className="lv-head">
        <p className="lv-kicker">
          {page.site}
          {page.published && <> · {page.published}</>} · {Math.max(1, Math.round(page.words / 220))} min read
        </p>
        <h1 className="lv-title">{page.title}</h1>
        {page.byline && <p className="lv-byline">{page.byline}</p>}
        <CleanedNote cleaning={page.cleaning} original={original} onToggle={toggleOriginal} />
        <div className="lv-actions">
          <button className="btn small" onClick={() => void save()} disabled={!!saved}>
            <Icon name={saved ? 'check' : 'library'} size={13} /> {saved ? 'Saved to library' : 'Save to library'}
          </button>
          <button className="tool-btn" onClick={() => setAsPage(true)} title="The page as the site shows it, in Tide’s sandboxed web view">
            <Icon name="globe" size={13} /> Show the page
          </button>
        </div>
      </header>
      <article className="prose crs-prose lv-prose" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => void codeBlockClick(e.target)} />
    </div>
  )
}

/**
 * The web view: a sandboxed page from the web drawn by main over this box (main/webView). It
 * follows the box as the layout moves, hides while something covers the window, and is destroyed
 * when this goes.
 */
export function WebFrame({ url, excerpt }: { url: string; /** The page's article as the reader cleaned it, when it has one: what the tutor reads of it */ excerpt?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<WebState | null>(null)
  const place = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const rect = () => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    let alive = true
    void window.tide.web.open(url, rect()).then((s) => alive && s && setState(s))
    let raf = 0
    place.current = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        // Covered by a dialog or the search palette: out of the way until it closes
        const covered = !!document.querySelector('.modal-backdrop, .palette, .dialog-backdrop, [role="dialog"][aria-modal="true"]')
        void window.tide.web.place(rect(), !covered && document.visibilityState === 'visible')
      })
    }
    const ro = new ResizeObserver(() => place.current())
    ro.observe(el)
    ro.observe(document.body)
    const sc = scrollerOf(el)
    sc?.addEventListener('scroll', place.current, { passive: true })
    window.addEventListener('resize', place.current)
    const mo = new MutationObserver(() => place.current())
    mo.observe(document.body, { childList: true })
    const off = window.tide.web.onState((s) => setState(s))
    return () => {
      alive = false
      ro.disconnect()
      mo.disconnect()
      sc?.removeEventListener('scroll', place.current)
      window.removeEventListener('resize', place.current)
      if (raf) cancelAnimationFrame(raf)
      off()
      void window.tide.web.close()
    }
  }, [url])
  useEffect(() => {
    if (!state) return
    // [clean] The tutor reads the cleaned article, not the page's ads and banners (only while it is still that page)
    const same = excerpt && state.url.split('#')[0] === url.split('#')[0]
    const s: OnScreen = { kind: 'web', title: state.title || host(state.url), url: state.url, ...(same ? { excerpt: excerpt.slice(0, 2200) } : {}) }
    setScreen(s)
    return () => clearScreen(s)
  }, [state?.url, state?.title, excerpt]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="lv-web">
      <div className="lv-web-bar">
        <button className="icon-btn small" disabled={!state?.canGoBack} onClick={() => void window.tide.web.go('back')} aria-label="Back in the page">
          <Icon name="back" size={13} />
        </button>
        <button className="icon-btn small lv-fwd" disabled={!state?.canGoForward} onClick={() => void window.tide.web.go('forward')} aria-label="Forward in the page">
          <Icon name="back" size={13} />
        </button>
        <button className="icon-btn small" onClick={() => void window.tide.web.go(state?.loading ? 'stop' : 'reload')} aria-label={state?.loading ? 'Stop' : 'Reload'}>
          <Icon name={state?.loading ? 'x' : 'refresh'} size={13} />
        </button>
        <span className="lv-web-url" title={state?.url ?? url}>
          <Icon name="globe" size={12} /> {(state?.url || url).replace(/^https?:\/\/(www\.)?/, '')}
        </span>
        {state?.blocked && <span className="lv-web-blocked">Download blocked: {state.blocked}</span>}
      </div>
      <div className="lv-web-box" ref={box} />
    </div>
  )
}
