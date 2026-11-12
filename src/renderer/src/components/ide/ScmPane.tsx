import { useEffect, useState } from 'react'
import type { GitCommit, GitFile, GitStatus } from '@shared/ide'
import { gitBadge } from '../../lib/ide/tree'
import { Icon } from '../Icon'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Source control, as VS Code's: the branch, a commit message and Commit (⌘Enter), staged changes
 * and changes with stage, unstage and discard on each, a file opening as a diff against HEAD,
 * and the last few commits. Claude's review of the changes starts here too.
 */
export function ScmPane({
  root,
  status,
  refresh,
  onOpenDiff,
  onToast,
  onReview,
  claudeReady
}: {
  root: string
  status: GitStatus | null
  refresh(): void
  onOpenDiff(path: string, staged: boolean): void
  onToast(msg: string, error?: boolean): void
  onReview(): void
  claudeReady: boolean
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<string[] | null>(null)
  const [newBranch, setNewBranch] = useState('')

  useEffect(() => {
    if (status?.repo) window.tide.ide.git.log(root, 8).then(setLog).catch(() => {})
  }, [root, status])

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await fn()
      if (done) onToast(done)
    } catch (e) {
      onToast(clean(e), true)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (!status) return <div className="ix-scm"><p className="ix-empty-note">Reading git…</p></div>
  if (!status.repo)
    return (
      <div className="ix-scm">
        <div className="ix-side-head">
          <span className="ix-side-title">Source control</span>
        </div>
        <p className="ix-empty-note">This folder isn’t a git repository.{status.error ? ` ${status.error}` : ''}</p>
        <button className="btn small ix-scm-init" onClick={() => act(() => window.tide.ide.git.init(root), 'Made a git repository')}>
          Initialise a repository
        </button>
      </div>
    )

  const staged = status.files.filter((f) => f.index !== '.' && f.index !== '?' && !f.conflicted)
  const changes = status.files.filter((f) => f.work !== '.' || f.conflicted)
  const commit = () =>
    act(async () => {
      // Nothing staged: commit everything, as VS Code offers to
      const hash = await window.tide.ide.git.commit(root, message, { all: !staged.length })
      setMessage('')
      onToast(`Committed ${hash}`)
    })

  const fileRow = (f: GitFile, isStaged: boolean) => {
    const b = gitBadge(isStaged ? f.index : '.', isStaged ? '.' : f.work) ?? gitBadge(f.index, f.work)
    const name = f.path.split('/').pop()
    return (
      <li key={`${isStaged}:${f.path}`} className="ix-scm-file">
        <button className={`ix-row file git-${b?.tone ?? 'modified'}`} onClick={() => onOpenDiff(f.path, isStaged)} title={f.from ? `${f.from} → ${f.path}` : f.path}>
          <span className="ix-row-name">{name}</span>
          <span className="ix-row-dir">{f.path.split('/').slice(0, -1).join('/')}</span>
          <span className="ix-row-git">{b?.letter}</span>
        </button>
        <span className="ix-scm-actions">
          {isStaged ? (
            <button className="icon-btn small" onClick={() => act(() => window.tide.ide.git.unstage(root, [f.path]))} title="Unstage" aria-label={`Unstage ${name}`}>
              <Icon name="minus" size={12} />
            </button>
          ) : (
            <>
              <button className="icon-btn small" onClick={() => confirm(`Discard your changes to ${name}?${f.work === '?' ? ' The new file goes to the Bin.' : ''}`) && act(() => window.tide.ide.git.discard(root, [f.path]))} title="Discard changes" aria-label={`Discard ${name}`}>
                <Icon name="restart" size={12} />
              </button>
              <button className="icon-btn small" onClick={() => act(() => window.tide.ide.git.stage(root, [f.path]))} title="Stage" aria-label={`Stage ${name}`}>
                <Icon name="plus" size={12} />
              </button>
            </>
          )}
        </span>
      </li>
    )
  }

  return (
    <div className="ix-scm">
      <div className="ix-side-head">
        <span className="ix-side-title">Source control</span>
        <button className="icon-btn small" onClick={refresh} title="Refresh" aria-label="Refresh">
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <div className="ix-scm-branch">
        <button
          className="ix-link"
          onClick={() =>
            branches
              ? setBranches(null)
              : window.tide.ide.git
                  .branches(root)
                  .then((b) => setBranches(b.local))
                  .catch(() => setBranches([]))
          }
          title="Switch branch"
        >
          <Icon name="branch" size={13} />
          {status.branch ?? `detached at ${status.detached}`}
          {status.ahead || status.behind ? <span className="muted small"> ↑{status.ahead} ↓{status.behind}</span> : null}
        </button>
        {branches && (
          <div className="ix-scm-branches">
            {branches.map((b) => (
              <button key={b} className={`ix-row${b === status.branch ? ' on' : ''}`} onClick={() => (setBranches(null), act(() => window.tide.ide.git.checkout(root, b), `On ${b}`))}>
                {b}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!newBranch.trim()) return
                setBranches(null)
                void act(() => window.tide.ide.git.checkout(root, newBranch.trim(), true), `Made ${newBranch.trim()}`)
                setNewBranch('')
              }}
            >
              <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="New branch name" aria-label="New branch name" />
            </form>
          </div>
        )}
      </div>
      <div className="ix-scm-commit">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Message (⌘Enter to commit on ${status.branch ?? 'HEAD'})`}
          aria-label="Commit message"
          rows={Math.min(6, Math.max(2, message.split('\n').length))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault()
              if (message.trim() && (staged.length || changes.length)) void commit()
            }
          }}
        />
        <button className="btn small primary" onClick={commit} disabled={busy || !message.trim() || !(staged.length || changes.length)}>
          <Icon name="check" size={13} />
          {staged.length ? 'Commit' : 'Commit all'}
        </button>
        <button className="btn small" onClick={onReview} disabled={!claudeReady || !(staged.length || changes.length)} title={claudeReady ? 'Claude reviews your changes like a senior engineer, with comments in the editor' : 'Claude isn’t available'}>
          <Icon name="claude" size={13} />
          Review my changes
        </button>
      </div>
      <div className="ix-scm-lists">
        {staged.length > 0 && (
          <section>
            <div className="ix-section-head static">
              Staged changes <span className="ix-count">{staged.length}</span>
              <span className="ix-gap" />
              <button className="icon-btn small" onClick={() => act(() => window.tide.ide.git.unstage(root, staged.map((f) => f.path)))} title="Unstage all" aria-label="Unstage all">
                <Icon name="minus" size={12} />
              </button>
            </div>
            <ul>{staged.map((f) => fileRow(f, true))}</ul>
          </section>
        )}
        <section>
          <div className="ix-section-head static">
            Changes <span className="ix-count">{changes.length}</span>
            <span className="ix-gap" />
            {changes.length > 0 && (
              <button className="icon-btn small" onClick={() => act(() => window.tide.ide.git.stage(root, changes.map((f) => f.path)))} title="Stage all" aria-label="Stage all">
                <Icon name="plus" size={12} />
              </button>
            )}
          </div>
          {changes.length ? <ul>{changes.map((f) => fileRow(f, false))}</ul> : <p className="ix-empty-note">No changes since the last commit.</p>}
        </section>
        {log.length > 0 && (
          <section>
            <div className="ix-section-head static">Recent commits</div>
            <ul className="ix-log">
              {log.map((c) => (
                <li key={c.hash} title={`${c.hash} · ${c.author} · ${new Date(c.time).toLocaleString('en-GB')}`}>
                  <Icon name="commit" size={12} />
                  <span className="ix-log-subject">{c.subject}</span>
                  <span className="ix-row-dir">{c.hash}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
