import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '../../lib/ide/tree'
import { symbolBadge } from '../../lib/ide/symbols'
import { quickOpen } from '../../lib/codeProject'

export interface Command {
  id: string
  label: string
  /** Its keys, as shown (⇧⌘P) */
  keys?: string
  run(): void
}

export interface PaletteSymbol {
  name: string
  detail?: string
  kind: number
  line: number
  column: number
  /** For a workspace symbol: its file */
  path?: string
  depth?: number
}

interface Item {
  key: string
  label: string
  detail?: string
  keys?: string
  badge?: { letter: string; tone: string }
  run(): void
}

/** Commands whose words hold every word typed come first, in their order; scattered letters only when nothing does */
function commandFilter(commands: Command[], q: string): Command[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return commands.slice(0, 80)
  const hits = commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
  if (hits.length) return hits.sort((a, b) => Number(!a.label.toLowerCase().split(/[\s:]+/).some((x) => x.startsWith(words[0]))) - Number(!b.label.toLowerCase().split(/[\s:]+/).some((x) => x.startsWith(words[0])))).slice(0, 80)
  return fuzzyFilter(commands, q, (c) => c.label, 80)
}

/**
 * VS Code's quick open in one box, chosen by the first character as there: a file by name, > a
 * command, @ a symbol in this file, # a symbol anywhere in the project, : a line.
 */
export function Palette({
  initial,
  files,
  recent,
  commands,
  symbols,
  workspaceSymbols,
  onOpen,
  onReveal,
  onClose
}: {
  initial: string
  files: string[]
  recent: string[]
  commands: Command[]
  symbols(): Promise<PaletteSymbol[]>
  workspaceSymbols(query: string): Promise<PaletteSymbol[]>
  onOpen(path: string, at?: { line: number; column: number }): void
  onReveal(line: number, column: number): void
  onClose(): void
}) {
  const [query, setQuery] = useState(initial)
  const [index, setIndex] = useState(0)
  const [syms, setSyms] = useState<PaletteSymbol[] | null>(null)
  const [wsyms, setWsyms] = useState<PaletteSymbol[]>([])
  const list = useRef<HTMLUListElement>(null)
  const mode = query.startsWith('>') ? 'commands' : query.startsWith('@') ? 'symbols' : query.startsWith('#') ? 'workspace' : query.startsWith(':') ? 'line' : 'files'
  const q = mode === 'files' ? query : query.slice(1)

  useEffect(() => {
    if (mode === 'symbols' && !syms) symbols().then(setSyms).catch(() => setSyms([]))
  }, [mode, syms, symbols])

  useEffect(() => {
    if (mode !== 'workspace') return
    let live = true
    const t = setTimeout(() => {
      workspaceSymbols(q.trim())
        .then((r) => live && setWsyms(r))
        .catch(() => {})
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [mode, q, workspaceSymbols])

  const items: Item[] = useMemo(() => {
    if (mode === 'commands')
      return commandFilter(commands, q).map((c) => ({ key: c.id, label: c.label, keys: c.keys, run: c.run }))
    if (mode === 'symbols') {
      const all = syms ?? []
      const shown = q.trim() ? fuzzyFilter(all, q, (s) => s.name, 100) : all
      return shown.map((s, i) => ({ key: `${s.name}:${s.line}:${i}`, label: `${q.trim() ? '' : '  '.repeat(s.depth ?? 0)}${s.name}`, detail: s.detail || `line ${s.line}`, badge: symbolBadge(s.kind), run: () => onReveal(s.line, s.column) }))
    }
    if (mode === 'workspace')
      return wsyms.map((s, i) => ({ key: `${s.path}:${s.line}:${i}`, label: s.name, detail: `${s.path}:${s.line}`, badge: symbolBadge(s.kind), run: () => s.path && onOpen(s.path, { line: s.line, column: s.column }) }))
    if (mode === 'line') {
      const m = /^\s*(\d+)(?:[:,](\d+))?/.exec(q)
      if (!m) return [{ key: 'line', label: 'Type a line number, and :column if you like', run: () => {} }]
      return [{ key: 'line', label: `Go to line ${m[1]}${m[2] ? `, column ${m[2]}` : ''}`, run: () => onReveal(Number(m[1]), Number(m[2] ?? 1)) }]
    }
    const paths = q.trim() ? quickOpen(q, files, 60) : [...recent.filter((r) => files.includes(r)), ...files.filter((f) => !recent.includes(f))].slice(0, 60)
    return paths.map((p) => ({ key: p, label: p.split('/').pop()!, detail: p.split('/').slice(0, -1).join('/'), run: () => onOpen(p) }))
  }, [mode, q, commands, syms, wsyms, files, recent, onOpen, onReveal])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (it: Item | undefined) => {
    if (!it) return
    onClose()
    it.run()
  }

  const placeholder = mode === 'commands' ? 'Run a command' : mode === 'symbols' ? 'Go to a symbol in this file' : mode === 'workspace' ? 'Go to a symbol in the project' : mode === 'line' ? 'Go to a line' : 'Go to a file by name (> commands, @ symbols, # project symbols, : line)'
  return (
    <div className="ix-palette-scrim no-drag" onMouseDown={onClose}>
      <div className="ix-palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
              e.preventDefault()
              setIndex((i) => Math.min(items.length - 1, i + 1))
            } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(items[index])
            }
          }}
        />
        <ul ref={list} role="listbox">
          {items.map((it, i) => (
            <li key={it.key}>
              <button className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => choose(it)} role="option" aria-selected={i === index}>
                {it.badge && <span className={`ix-sym ${it.badge.tone}`}>{it.badge.letter}</span>}
                <span className="ix-palette-label">{it.label}</span>
                {it.detail && <span className="ix-palette-detail">{it.detail}</span>}
                {it.keys && <kbd className="ix-kbd">{it.keys}</kbd>}
              </button>
            </li>
          ))}
          {!items.length && <li className="ix-palette-none">{mode === 'symbols' && !syms ? 'Reading the file’s symbols…' : mode === 'workspace' && !q.trim() ? 'Type to search the project’s symbols' : 'Nothing matches.'}</li>}
        </ul>
      </div>
    </div>
  )
}
