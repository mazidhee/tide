import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import type { Proposal } from '@shared/ide'
import { applyHunks, hunks as hunksOf } from '@shared/hunks'
import { highlight, monaco, refreshTheme } from '../../lib/monaco'
import { languageOf } from '../../lib/ide/languages'
import type { Documents } from '../../lib/ide/documents'
import { Icon } from '../Icon'
import { ideEditorOptions } from './EditorPane'

let seq = 0
const tempModel = (text: string, language: string, scheme: string, path: string) => monaco.editor.createModel(text, language, monaco.Uri.from({ scheme, path: `/${++seq}/${path}` }))

function useDiffEditor(host: React.RefObject<HTMLDivElement | null>, opts: Monaco.editor.IStandaloneDiffEditorConstructionOptions) {
  const ref = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  useEffect(() => {
    const base = ideEditorOptions()
    const d = monaco.editor.createDiffEditor(host.current!, {
      ...(base as Monaco.editor.IStandaloneDiffEditorConstructionOptions),
      minimap: { enabled: false },
      glyphMargin: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 760,
      ignoreTrimWhitespace: false,
      renderOverviewRuler: true,
      hideUnchangedRegions: { enabled: true, contextLineCount: 4, minimumLineCount: 6, revealLineCount: 10 },
      ...opts
    })
    ref.current = d
    const mo = new MutationObserver(() => void refreshTheme())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design', 'style', 'class'] })
    return () => {
      mo.disconnect()
      // Cleared first, so the panes' own cleanups (which run after) leave a disposed editor alone
      ref.current = null
      d.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

/**
 * A file against git: HEAD on the left, the file as it is now on the right, editable, as VS Code
 * opens a changed file from Source Control.
 */
export function GitDiffPane({ docs, path, base, label, modified: modifiedText }: { docs: Documents; path: string; base: string | null; label: string; /** Read-only text for the right side (the index); the file itself when not given */ modified?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const diff = useDiffEditor(host, { originalEditable: false })
  useEffect(() => {
    const d = diff.current
    if (!d) return
    let live = true
    let original: Monaco.editor.ITextModel | null = null
    if (modifiedText !== undefined) {
      const lang = languageOf(path)
      original = tempModel(base ?? '', lang, 'git-base', path)
      const right = tempModel(modifiedText, lang, 'git-gone', path)
      d.setModel({ original, modified: right })
      d.updateOptions({ readOnly: true })
      void highlight(lang)
      return () => {
        if (diff.current === d) d.setModel(null)
        original?.dispose()
        right.dispose()
      }
    }
    docs
      .open(path)
      .then((doc) => {
        if (!live) return
        original = tempModel(base ?? '', doc.model.getLanguageId(), 'git-base', path)
        d.setModel({ original, modified: doc.model })
        void highlight(doc.model.getLanguageId())
      })
      .catch(async () => {
        // Deleted in the working tree: show what HEAD had against nothing
        if (!live) return
        const lang = languageOf(path)
        original = tempModel(base ?? '', lang, 'git-base', path)
        d.setModel({ original, modified: tempModel('', lang, 'git-gone', path) })
      })
    return () => {
      live = false
      const m = d.getModel()
      if (diff.current === d) d.setModel(null)
      original?.dispose()
      if (m?.modified.uri.scheme === 'git-gone') m.modified.dispose()
    }
  }, [path, base, docs, diff, modifiedText])
  return (
    <div className="ix-diff">
      <div className="ix-diff-bar">
        <Icon name="diff" size={14} />
        <span className="ix-diff-title">{path}</span>
        <span className="muted small">{label}</span>
      </div>
      <div className="ix-diff-host" ref={host} />
    </div>
  )
}

type Decision = 'keep' | 'undo' | undefined

/**
 * Claude's proposed edit: the file as it is on the left, Claude's version on the right. Each
 * change has its own Keep and Undo under it; Apply writes the kept ones (nothing is written
 * before that), as Copilot's and Cursor's reviews of an agent's edits work.
 */
export function ProposalPane({ proposal, current, onResolve, onOpenFile }: { proposal: Proposal; current: string | null; onResolve(text: string | null): void; onOpenFile(): void }) {
  const host = useRef<HTMLDivElement>(null)
  const diff = useDiffEditor(host, { readOnly: true, originalEditable: false, renderSideBySide: false, renderMarginRevertIcon: false, renderIndicators: true, hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 5, revealLineCount: 10 } })
  const list = useMemo(() => hunksOf(proposal.original, proposal.proposed), [proposal])
  const [decisions, setDecisions] = useState<Decision[]>(() => list.map(() => undefined))
  const models = useRef<{ original: Monaco.editor.ITextModel; modified: Monaco.editor.ITextModel } | null>(null)
  const zoneIds = useRef<string[]>([])
  const decide = useRef((i: number, d: Decision) => setDecisions((all) => all.map((x, j) => (j === i ? d : x))))
  const text = useMemo(() => applyHunks(proposal.original, list, (i) => decisions[i] !== 'undo'), [proposal, list, decisions])
  const pending = decisions.filter((d) => !d).length
  const kept = decisions.filter((d) => d === 'keep').length
  const stale = current !== null && current !== proposal.original

  useEffect(() => {
    const d = diff.current
    if (!d) return
    const lang = languageOf(proposal.path)
    const original = tempModel(proposal.original, lang, 'claude-base', proposal.path)
    const modified = tempModel(proposal.proposed, lang, 'claude-proposal', proposal.path)
    models.current = { original, modified }
    d.setModel({ original, modified })
    void highlight(lang)
    return () => {
      if (diff.current === d) d.setModel(null)
      original.dispose()
      modified.dispose()
      models.current = null
    }
  }, [proposal, diff])

  // The right side shows the file with the undone hunks taken back out
  useEffect(() => {
    const m = models.current?.modified
    if (m && m.getValue() !== text) m.setValue(text)
  }, [text])

  // Keep and Undo under each change still in the right side
  useEffect(() => {
    const d = diff.current
    if (!d) return
    const ed = d.getModifiedEditor()
    const place = () => {
      ed.changeViewZones((acc) => {
        for (const z of zoneIds.current) acc.removeZone(z)
        zoneIds.current = []
        let shift = 0
        list.forEach((h, i) => {
          const undone = decisions[i] === 'undo'
          const start = h.oldStart + shift
          if (!undone) shift += h.new.length - h.old.length
          if (undone) return
          const node = document.createElement('div')
          node.className = `ix-hunk-bar${decisions[i] === 'keep' ? ' kept' : ''}`
          const label = document.createElement('span')
          label.textContent = decisions[i] === 'keep' ? 'Kept' : `Change ${i + 1} of ${list.length}`
          node.append(label)
          const btn = (text: string, cls: string, fn: () => void) => {
            const b = document.createElement('button')
            b.textContent = text
            b.className = cls
            b.onmousedown = (e) => {
              e.preventDefault()
              e.stopPropagation()
              fn()
            }
            node.append(b)
          }
          if (decisions[i] === 'keep') btn('Undo', 'ghost', () => decide.current(i, undefined))
          else {
            btn('Keep', 'keep', () => decide.current(i, 'keep'))
            btn('Undo', 'ghost', () => decide.current(i, 'undo'))
          }
          const after = Math.max(0, start + (decisions[i] === 'undo' ? h.old.length : h.new.length))
          zoneIds.current.push(acc.addZone({ afterLineNumber: after, heightInPx: 30, domNode: node, suppressMouseDown: false }))
        })
      })
    }
    // The diff is computed after the text changes: place the bars once it has been
    const sub = d.onDidUpdateDiff(place)
    place()
    return () => sub.dispose()
  }, [list, decisions, diff, text])

  const undone = decisions.filter((d) => d === 'undo').length
  return (
    <div className="ix-diff proposal">
      <div className="ix-diff-bar">
        <Icon name="claude" size={14} />
        <button className="ix-link" onClick={onOpenFile} title="Open the file">
          {proposal.path}
        </button>
        <span className="muted small">
          {proposal.isNew ? 'New file · ' : ''}
          {list.length} change{list.length === 1 ? '' : 's'}
          {kept ? ` · ${kept} kept` : ''}
          {undone ? ` · ${undone} undone` : ''}
        </span>
        <span className="ix-gap" />
        <button className="btn small" onClick={() => onResolve(null)} title="Throw the whole proposal away">
          Reject
        </button>
        <button className="btn small" onClick={() => setDecisions(list.map(() => 'keep'))} disabled={!pending}>
          Keep all
        </button>
        <button className="btn small primary" onClick={() => onResolve(text)} disabled={undone === list.length} title={pending ? 'Writes the kept changes and the ones not decided yet' : 'Writes the kept changes'}>
          {pending && kept ? `Apply ${list.length - undone}` : 'Apply'}
        </button>
      </div>
      {proposal.explanation && <p className="ix-diff-why">{proposal.explanation}</p>}
      {stale && <p className="ix-diff-warn">The file has changed since Claude proposed this. Applying replaces it with the version on the right.</p>}
      <div className="ix-diff-host" ref={host} />
    </div>
  )
}
