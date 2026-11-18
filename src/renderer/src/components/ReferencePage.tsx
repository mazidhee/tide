/**
 * A page of the offline reference (shared/reference) in the reading sheet or the course reader: a
 * docs, man or book page as its article, scrolled to the section cited; a source file (CPython)
 * read-only in the code editor, scrolled to the cited line with it selected. Links inside a page
 * open the neighbouring reference page; links out go through the usual router.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { REF_LABELS, isCodeSource, refSourcePath } from '@shared/reference'
import { codeLanguage, type LinkTarget } from '@shared/links'
import type { OnScreen } from '@shared/onScreen'
import { openTarget, openUrl, scrollToHeading } from '../lib/linkNav'
import { clearScreen, setScreen } from '../lib/onScreen'

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))

type RefTarget = Extract<LinkTarget, { kind: 'reference' }>

export function ReferencePage({ target }: { target: RefTarget }) {
  return isCodeSource(target.source) ? <RefCode target={target} /> : <RefDoc target={target} />
}

function useRefScreen(target: RefTarget, title: string) {
  const screen = useMemo<OnScreen>(() => ({ kind: 'article', title: title || target.path, path: refSourcePath({ source: target.source, path: target.path }) }), [target.source, target.path, title])
  useEffect(() => {
    setScreen(screen)
    return () => clearScreen(screen)
  }, [screen])
}

function Head({ target, title }: { target: RefTarget; title: string }) {
  return (
    <header className="lv-head">
      <nav className="lv-crumbs" aria-label="Where in the reference">
        <span className="lv-crumb">{REF_LABELS[target.source]}</span>
        <span className="lv-crumb-wrap">
          <span aria-hidden="true">/</span>
          <span className="lv-crumb here">{target.path}</span>
        </span>
      </nav>
      {title && <h1 className="lv-title">{title}</h1>}
    </header>
  )
}

function RefDoc({ target }: { target: RefTarget }) {
  const [page, setPage] = useState<{ title: string; html: string } | null | undefined>(undefined)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    setPage(undefined)
    window.tide.reference
      .page(target.source, target.path)
      .then((p) => live && setPage(p))
      .catch(() => live && setPage(null))
    return () => {
      live = false
    }
  }, [target.source, target.path])
  useRefScreen(target, page?.title ?? '')
  useEffect(() => {
    if (page && target.anchor && ref.current) requestAnimationFrame(() => ref.current && scrollToHeading(ref.current, target.anchor!))
  }, [page, target.anchor])

  // Links in the page: a section of it, another page of the same reference, or out to the web
  const click = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || e.button !== 0) return
    const href = a.getAttribute('href') ?? ''
    e.preventDefault()
    if (href.startsWith('#')) {
      if (ref.current && href.length > 1) scrollToHeading(ref.current, decodeURIComponent(href.slice(1)))
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return openUrl(href)
    const u = new URL(href, `http://ref/${target.path}`)
    const path = decodeURIComponent(u.pathname.slice(1))
    const anchor = u.hash ? decodeURIComponent(u.hash.slice(1)) : undefined
    openTarget({ kind: 'reference', source: target.source, path, ...(anchor ? { anchor } : {}) })
  }

  return (
    <div className="lv-page" ref={ref} data-link-root>
      <Head target={target} title={page?.title ?? ''} />
      {page === undefined ? (
        <div className="crs-skeleton" aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      ) : page === null ? (
        <p className="lv-quiet">This page isn’t in the reference on this Mac. Rebuild it in Settings › Reference & data.</p>
      ) : (
        <article className="prose crs-prose" data-own-links onClick={click} dangerouslySetInnerHTML={{ __html: page.html }} />
      )}
    </div>
  )
}

function RefCode({ target }: { target: RefTarget }) {
  const [file, setFile] = useState<{ abs: string; text: string } | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setFile(undefined)
    window.tide.reference
      .file(target.source, target.path)
      .then((f) => live && setFile(f))
      .catch(() => live && setFile(null))
    return () => {
      live = false
    }
  }, [target.source, target.path])
  useRefScreen(target, target.path.split('/').pop() ?? '')
  const lang = codeLanguage(target.path)
  // Shown again once the editor has its size: revealed on its first layout, Monaco centred the wrong lines
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null)
  useEffect(() => {
    if (!target.line || !file) return
    setReveal({ line: target.line, nonce: Date.now() })
    const t = setTimeout(() => setReveal({ line: target.line!, nonce: Date.now() + 1 }), 350)
    return () => clearTimeout(t)
  }, [target.line, file])

  return (
    <div className="lv-page ref-code-page">
      <Head target={target} title={target.line ? `${target.path.split('/').pop()}, line ${target.line}` : (target.path.split('/').pop() ?? '')} />
      {file === undefined ? (
        <div className="crs-skeleton" aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      ) : file === null ? (
        <p className="lv-quiet">This file isn’t in the reference on this Mac. Rebuild it in Settings › Reference & data.</p>
      ) : (
        <div className="ref-code">
          <Suspense fallback={null}>
            <CodeEditor value={file.text} onChange={() => {}} language={lang === 'c' || lang === 'h' ? 'cpp' : lang || 'plaintext'} fill readOnly lint={false} reveal={reveal} />
          </Suspense>
        </div>
      )}
    </div>
  )
}
