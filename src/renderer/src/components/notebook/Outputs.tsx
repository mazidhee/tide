/**
 * A code cell's outputs, the richest form of each that Tide can draw: Tide's own finance visuals
 * and graphs, Plotly charts, HTML (pandas tables, sanitised), SVG and PNG pictures, LaTeX,
 * Markdown, JSON, and plain text with its terminal colours. Errors show the exception first, then
 * the traceback.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import katex from 'katex'
import type { DataOutput, Output } from '@shared/notebook/ipynb'
import { ansiToHtml } from '@shared/notebook/ansi'
import { pickMime } from '@shared/notebook/mime'
import { renderMarkdown } from '../../lib/markdown'
import { FinanceVisual } from './FinanceVisual'
import { useApp } from '../../state'

const text = (v: unknown) => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : JSON.stringify(v, null, 1))

/** HTML from a kernel: no scripts, no stylesheets that would restyle Tide, links open outside */
export function cleanHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'link', 'meta'], FORBID_ATTR: ['onclick', 'onerror', 'onload'], ADD_ATTR: ['target'] })
}

function Plotly({ spec }: { spec: { data?: unknown[]; layout?: Record<string, unknown> } }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let gone = false
    let lib: { newPlot(el: HTMLElement, d: unknown, l: unknown, c: unknown): void; purge(el: HTMLElement): void } | null = null
    void import('plotly.js-dist-min').then((m) => {
      if (gone || !host.current) return
      lib = (m.default ?? m) as typeof lib
      const css = getComputedStyle(document.documentElement)
      const v = (n: string) => css.getPropertyValue(n).trim()
      const layout = {
        ...(spec.layout ?? {}),
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: v('--font-ui') || 'Inter, sans-serif', size: 12, color: v('--ink') },
        colorway: [1, 2, 3, 4, 5, 6].map((i) => v(`--series-${i}`)),
        xaxis: { gridcolor: v('--line'), zerolinecolor: v('--line-strong'), ...((spec.layout?.xaxis as object) ?? {}) },
        yaxis: { gridcolor: v('--line'), zerolinecolor: v('--line-strong'), ...((spec.layout?.yaxis as object) ?? {}) },
        margin: { l: 48, r: 16, t: spec.layout?.title ? 40 : 16, b: 40 },
        autosize: true,
        template: undefined
      }
      lib!.newPlot(host.current, spec.data ?? [], layout, { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'] })
    })
    return () => {
      gone = true
      if (lib && host.current) lib.purge(host.current)
    }
  }, [spec])
  return <div ref={host} className="nb-plotly" />
}

function GraphBlock({ spec }: { spec: unknown }) {
  // A ```graph block, which lib/graphs draws wherever it appears in the window
  const html = useMemo(() => `<pre class="code-block" data-lang="graph"><code>${JSON.stringify(spec).replace(/</g, '\\u003c')}</code></pre>`, [spec])
  return <div className="nb-graph" dangerouslySetInnerHTML={{ __html: html }} />
}

function Data({ o }: { o: DataOutput }) {
  const app = useApp()
  const mime = pickMime(o.data)
  if (!mime) return null
  const v = o.data[mime]
  if (mime === 'application/vnd.tide.finance+json') return <FinanceVisual data={v as Record<string, unknown>} />
  if (mime === 'application/vnd.tide.graph+json') return <GraphBlock spec={v} />
  if (mime === 'application/vnd.plotly.v1+json') return <Plotly spec={v as { data?: unknown[] }} />
  if (mime === 'text/html') return <div className="nb-html" dangerouslySetInnerHTML={{ __html: cleanHtml(text(v)) }} />
  if (mime === 'image/svg+xml') return <div className="nb-svg" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(text(v), { USE_PROFILES: { svg: true, svgFilters: true } }) }} />
  if (mime.startsWith('image/')) {
    const meta = (o.metadata?.[mime] ?? {}) as { width?: number; height?: number }
    return <img className="nb-image" alt="" src={`data:${mime};base64,${text(v).replace(/\s/g, '')}`} style={meta.width ? { width: meta.width } : undefined} />
  }
  if (mime === 'text/latex') {
    const src = text(v).trim().replace(/^\$\$?|\$\$?$/g, '')
    let html = ''
    try {
      html = katex.renderToString(src, { displayMode: true, throwOnError: false })
    } catch {
      html = ''
    }
    return html ? <div className="nb-latex" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="nb-text">{text(v)}</pre>
  }
  if (mime === 'text/markdown') return <div className="nb-md prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(text(v), { notePath: '', filesByName: app.filesByName }) }} />
  if (mime === 'application/json') return <pre className="nb-text">{JSON.stringify(v, null, 2)}</pre>
  return <pre className="nb-text" dangerouslySetInnerHTML={{ __html: ansiToHtml(text(v)) }} />
}

const LONG = 400

function Stream({ text: t, name }: { text: string; name: string }) {
  const lines = useMemo(() => t.split('\n'), [t])
  const [all, setAll] = useState(false)
  const shown = all || lines.length <= LONG ? t : lines.slice(-LONG).join('\n')
  return (
    <div className={`nb-stream ${name}`}>
      {!all && lines.length > LONG && (
        <button className="nb-more" onClick={() => setAll(true)}>
          Show the first {lines.length - LONG} lines
        </button>
      )}
      <pre className="nb-text" dangerouslySetInnerHTML={{ __html: ansiToHtml(shown) }} />
    </div>
  )
}

function ErrorView({ ename, evalue, traceback }: { ename: string; evalue: string; traceback: string[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="nb-error">
      <button className="nb-error-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="nb-error-name">{ename}</span>
        <span className="nb-error-value">{evalue}</span>
      </button>
      {open && traceback.length > 0 && <pre className="nb-text nb-traceback" dangerouslySetInnerHTML={{ __html: ansiToHtml(traceback.join('\n')) }} />}
    </div>
  )
}

export const Outputs = memo(function Outputs({ outputs, stale }: { outputs: Output[]; stale?: boolean }) {
  if (!outputs.length) return null
  return (
    <div className={`nb-outputs${stale ? ' stale' : ''}`}>
      {outputs.map((o, i) =>
        o.output_type === 'stream' ? <Stream key={i} text={o.text} name={o.name} /> : o.output_type === 'error' ? <ErrorView key={i} {...o} /> : <Data key={i} o={o} />
      )}
    </div>
  )
})
