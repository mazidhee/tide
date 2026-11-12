import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../state'
import { renderMarkdown } from '../../lib/markdown'
import { hoverAt } from '../../lib/ide/symbols'
import type { Documents } from '../../lib/ide/documents'

/**
 * Quick Help: what the language server says about the symbol under the cursor (its signature and
 * docs), shown as you move, without hovering. Claude can explain it from here.
 */
export function QuickHelp({ docs, cursor, onExplain, claudeReady }: { docs: Documents | null; cursor: { path: string; line: number; column: number } | null; onExplain(symbol: string): void; claudeReady: boolean }) {
  const app = useApp()
  const [parts, setParts] = useState<string[] | null>(null)
  const [word, setWord] = useState('')
  const env = useMemo(() => ({ notePath: '', filesByName: app.filesByName }), [app.filesByName])

  useEffect(() => {
    if (!docs || !cursor) return setParts(null)
    let live = true
    const t = setTimeout(() => {
      const d = docs.get(cursor.path)
      if (!d || d.model.isDisposed()) return
      const w = d.model.getWordAtPosition({ lineNumber: cursor.line, column: cursor.column })
      setWord(w?.word ?? '')
      if (!w) return setParts([])
      hoverAt(d.model, { lineNumber: cursor.line, column: cursor.column }).then((p) => live && setParts(p))
    }, 220)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [docs, cursor])

  return (
    <div className="ix-help">
      {!cursor ? (
        <p className="ix-empty-note">Put the cursor on a name to see what it is.</p>
      ) : parts === null ? (
        <p className="ix-empty-note">…</p>
      ) : parts.length ? (
        <>
          <div className="ix-help-body prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(parts.join('\n\n---\n\n'), env) }} />
          {word && claudeReady && (
            <button className="ix-link small ix-help-explain" onClick={() => onExplain(word)}>
              Explain <code>{word}</code> with Claude
            </button>
          )}
        </>
      ) : (
        <p className="ix-empty-note">{word ? <>Nothing known about <code>{word}</code>.</> : 'No symbol under the cursor.'}</p>
      )}
    </div>
  )
}
