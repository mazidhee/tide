import { useEffect, useRef } from 'react'
import type { CellProposal } from '@shared/notebook/api'
import { highlight, monaco, refreshTheme, tideTheme } from '../../lib/monaco'
import { Icon } from '../Icon'

let seq = 0

/**
 * A cell the tutor proposed: the change as a diff (Monaco's, as in the IDE), editable on the right
 * before keeping it. Keep writes what's on the right into the notebook; Drop leaves it as it was.
 */
export function ProposalCard({ p, original, onKeep, onDrop }: { p: CellProposal; original: string; onKeep(text: string): void; onDrop(): void }) {
  const host = useRef<HTMLDivElement>(null)
  const reader = useRef<(() => string) | null>(null)
  useEffect(() => {
    const lang = p.cellType === 'markdown' ? 'markdown' : 'python'
    const id = ++seq
    const a = monaco.editor.createModel(original, lang, monaco.Uri.from({ scheme: 'nb-proposal', path: `/${id}/before` }))
    const b = monaco.editor.createModel(p.source, lang, monaco.Uri.from({ scheme: 'nb-proposal', path: `/${id}/after` }))
    const common = {
      theme: tideTheme(),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 13,
      lineHeight: 20,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim() || 'Menlo, monospace',
      glyphMargin: false,
      folding: false,
      scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8 },
      padding: { top: 8, bottom: 8 }
    }
    // A new cell is shown as itself, ready to edit; a change to a cell as a diff against it
    let read: () => string
    let dispose: () => void
    let relayout: () => void
    if (p.kind === 'insert') {
      const e = monaco.editor.create(host.current!, { ...common, model: b, lineNumbers: 'off', renderLineHighlight: 'none' })
      read = () => e.getValue()
      dispose = () => e.dispose()
      relayout = () => e.layout()
    } else {
      const d = monaco.editor.createDiffEditor(host.current!, { ...common, renderSideBySide: false, readOnly: false, originalEditable: false, renderOverviewRuler: false, lineNumbers: 'off' })
      d.setModel({ original: a, modified: b })
      read = () => d.getModifiedEditor().getValue()
      dispose = () => d.dispose()
      relayout = () => d.layout()
    }
    reader.current = read
    void highlight(lang)
    const size = () => {
      const lines = p.kind === 'insert' ? b.getLineCount() : Math.max(a.getLineCount(), b.getLineCount()) + Math.min(a.getLineCount(), 30)
      host.current!.style.height = `${Math.min(520, Math.max(40, lines * 20 + 18))}px`
      relayout()
    }
    size()
    const sub = b.onDidChangeContent(size)
    const mo = new MutationObserver(() => void refreshTheme())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => {
      mo.disconnect()
      sub.dispose()
      reader.current = null
      dispose()
      a.dispose()
      b.dispose()
    }
  }, [p.id, p.source, p.cellType, p.kind, original])
  return (
    <div className="nb-proposal">
      <div className="nb-proposal-head">
        <Icon name="claude" size={14} />
        <span>{p.kind === 'replace' ? 'Proposed change to this cell' : 'Proposed new cell'}</span>
        <span className="nb-spacer" />
        <button className="btn ghost small" onClick={onDrop}>
          Drop
        </button>
        <button className="btn primary small" onClick={() => onKeep(reader.current?.() ?? p.source)}>
          <Icon name="check" size={13} /> Keep
        </button>
      </div>
      {p.explanation && <p className="nb-proposal-why">{p.explanation}</p>}
      <div ref={host} className="nb-proposal-diff" />
    </div>
  )
}
