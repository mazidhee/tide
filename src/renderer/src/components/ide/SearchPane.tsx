import { useEffect, useRef, useState } from 'react'
import type { SearchOptions, SearchResult } from '@shared/ide'
import { Icon } from '../Icon'

/**
 * Search across files (⇧⌘F), as VS Code lays it out: the query with match case, whole word and
 * regular expression, replace, files to include and leave out, and the matches by file. Runs on
 * ripgrep in main as you type.
 */
export function SearchPane({ root, seed, onOpen, onReplaced, focusNonce }: { root: string; seed: string; onOpen(path: string, line: number, column: number, length: number): void; onReplaced(paths: string[]): void; focusNonce: number }) {
  const [o, setO] = useState<SearchOptions>(() => {
    try {
      return { ...JSON.parse(localStorage.getItem('tide.ide.search') ?? '{}'), query: seed }
    } catch {
      return { query: seed }
    }
  })
  const [replace, setReplace] = useState<string | null>(null)
  const [more, setMore] = useState(!!(o.include || o.exclude))
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (seed) setO((x) => ({ ...x, query: seed }))
    requestAnimationFrame(() => input.current?.select())
  }, [seed, focusNonce])

  useEffect(() => {
    const { query: _q, ...keep } = o
    void _q
    localStorage.setItem('tide.ide.search', JSON.stringify(keep))
    if (!o.query) return setResult(null)
    let live = true
    setBusy(true)
    const t = setTimeout(() => {
      window.tide.ide
        .search(root, o)
        .then((r) => {
          if (!live) return
          setResult(r)
          setClosed(new Set())
        })
        .catch(() => {})
        .finally(() => live && setBusy(false))
    }, 180)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [o, root])

  const toggle = (k: 'caseSensitive' | 'wholeWord' | 'regex') => setO((x) => ({ ...x, [k]: !x[k] }))
  const doReplace = async (paths: string[]) => {
    if (replace === null || !paths.length) return
    await window.tide.ide.replace(root, o, replace, paths)
    onReplaced(paths)
    setO((x) => ({ ...x }))
  }

  const highlight = (preview: string, at: number, len: number, replaceWith: string | null) => (
    <>
      <span>{preview.slice(0, at)}</span>
      <mark className={replaceWith !== null ? 'strike' : ''}>{preview.slice(at, at + len)}</mark>
      {replaceWith !== null && <ins>{replaceWith}</ins>}
      <span>{preview.slice(at + len)}</span>
    </>
  )

  return (
    <div className="ix-search">
      <div className="ix-side-head">
        <span className="ix-side-title">Search</span>
        {busy && <span className="ix-spinner" aria-label="Searching" />}
      </div>
      <div className="ix-search-form">
        <div className="ix-search-row">
          <button className={`icon-btn small ix-search-expand${replace !== null ? ' open' : ''}`} onClick={() => setReplace((r) => (r === null ? '' : null))} title="Replace" aria-label="Show replace">
            <Icon name="chevron" size={11} />
          </button>
          <div className="ix-input">
            <input ref={input} value={o.query} onChange={(e) => setO((x) => ({ ...x, query: e.target.value }))} placeholder="Search" aria-label="Search" spellCheck={false} />
            <button className={o.caseSensitive ? 'on' : ''} onClick={() => toggle('caseSensitive')} title="Match case" aria-pressed={!!o.caseSensitive}>
              Aa
            </button>
            <button className={o.wholeWord ? 'on' : ''} onClick={() => toggle('wholeWord')} title="Match whole word" aria-pressed={!!o.wholeWord}>
              <u>ab</u>
            </button>
            <button className={o.regex ? 'on' : ''} onClick={() => toggle('regex')} title="Use regular expression" aria-pressed={!!o.regex}>
              .*
            </button>
          </div>
        </div>
        {replace !== null && (
          <div className="ix-search-row indent">
            <div className="ix-input">
              <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replace" aria-label="Replace" spellCheck={false} />
              <button onClick={() => doReplace(result?.files.map((f) => f.path) ?? [])} disabled={!result?.total} title="Replace all">
                All
              </button>
            </div>
          </div>
        )}
        <button className="ix-link small ix-search-more" onClick={() => setMore((m) => !m)}>
          {more ? 'Fewer options' : 'Files to include or exclude'}
        </button>
        {more && (
          <div className="ix-search-globs">
            <input value={o.include ?? ''} onChange={(e) => setO((x) => ({ ...x, include: e.target.value }))} placeholder="Files to include, e.g. src, *.py" aria-label="Files to include" spellCheck={false} />
            <input value={o.exclude ?? ''} onChange={(e) => setO((x) => ({ ...x, exclude: e.target.value }))} placeholder="Files to exclude, e.g. tests" aria-label="Files to exclude" spellCheck={false} />
          </div>
        )}
      </div>
      {result?.error && <p className="ix-search-error">{result.error}</p>}
      {result && !result.error && (
        <p className="ix-search-summary">
          {result.total ? `${result.total.toLocaleString()} result${result.total === 1 ? '' : 's'} in ${result.files.length} file${result.files.length === 1 ? '' : 's'}${result.truncated ? ' (the first ones)' : ''}` : 'No results.'}
          {result.engine === 'node' ? ' · without ripgrep' : ''}
        </p>
      )}
      <div className="ix-search-results">
        {result?.files.map((f) => {
          const open = !closed.has(f.path)
          return (
            <div key={f.path} className="ix-search-file">
              <div className="ix-search-file-row">
                <button
                  className="ix-row"
                  onClick={() =>
                    setClosed((c) => {
                      const n = new Set(c)
                      if (open) n.add(f.path)
                      else n.delete(f.path)
                      return n
                    })
                  }
                  aria-expanded={open}
                >
                  <Icon name="chevron" size={10} className={`ix-chev${open ? ' open' : ''}`} />
                  <span className="ix-row-name">{f.path.split('/').pop()}</span>
                  <span className="ix-row-dir">{f.path.split('/').slice(0, -1).join('/')}</span>
                  <span className="ix-row-count">{f.matches.length}</span>
                </button>
                {replace !== null && (
                  <button className="icon-btn small" onClick={() => doReplace([f.path])} title="Replace in this file" aria-label={`Replace in ${f.path}`}>
                    <Icon name="check" size={12} />
                  </button>
                )}
              </div>
              {open && (
                <ul>
                  {f.matches.map((m, i) => (
                    <li key={i}>
                      <button className="ix-match" onClick={() => onOpen(f.path, m.line, m.column, m.length)} title={`Line ${m.line}`}>
                        {highlight(m.preview.trimStart(), m.previewColumn - (m.preview.length - m.preview.trimStart().length), m.length, replace)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
