/**
 * Guided projects in the app (shared/workshop.ts has the idea, main/workshop.ts the work): the
 * list, a project's preview and its screen, and a roadmap's "Project:" item, which opens the
 * project Tide already designed for it or offers to design one. The screens themselves are in
 * workshop/ProjectScreen.tsx, so the design harness can draw them without the app.
 */
import { useCallback, useEffect, useState } from 'react'
import { projectTopic, type WorkshopCard, type WorkshopState } from '@shared/workshop'
import { useApp } from '../state'
import { Icon } from './Icon'
import { ProjectList, ProjectPreview, ProjectScreen, type WorkshopBusy } from './workshop/ProjectScreen'

export function WorkshopView({ id, from }: { id?: string; from?: { notebook?: string; topic?: string } }) {
  const app = useApp()
  const [cards, setCards] = useState<WorkshopCard[] | null>(null)
  const [state, setState] = useState<WorkshopState | null>(null)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState<WorkshopBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ question: string; text: string; by: 'cloud' | 'local' | 'none' } | null>(null)
  const [forTopic, setForTopic] = useState<WorkshopCard | null | undefined>(undefined)
  const [proposal, setProposal] = useState<{ tries: number; problems: string[] } | null>(null)

  const show = useCallback((s: WorkshopState | null) => {
    setState(s)
    if (s) setSelected(s.current)
  }, [])

  useEffect(() => {
    window.tide.workshop.list().then(setCards).catch(() => setCards([]))
  }, [])
  useEffect(() => {
    setState(null)
    setAnswer(null)
    setError(null)
    if (id) window.tide.workshop.state(id).then(show).catch(() => show(null))
  }, [id, show])
  useEffect(() => {
    if (id || !from?.topic) return
    window.tide.workshop.forTopic(from.topic).then(setForTopic).catch(() => setForTopic(null))
  }, [id, from?.topic])

  const open = (cardId: string) => app.setView({ kind: 'workshop', id: cardId, ...(from ? { from } : {}) })
  const act = async (kind: Exclude<WorkshopBusy, null>, f: () => Promise<WorkshopState | null | void>) => {
    setBusy(kind)
    setError(null)
    try {
      const next = await f()
      if (next) {
        setState(next)
        // A run that passed moves the screen on to the stage it opened
        if (kind === 'run' || kind === 'start') setSelected(next.current)
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }

  const back = (
    <button className="ws-back" onClick={() => (id ? app.setView({ kind: 'workshop', ...(from ? { from } : {}) }) : app.back())}>
      <Icon name="back" size={14} />
      {id ? 'Projects' : 'Back'}
    </button>
  )

  let body: React.ReactNode
  if (id && state) {
    body = (
      <ProjectScreen
        state={state}
        selected={selected}
        onSelect={setSelected}
        busy={busy}
        answer={answer}
        error={error}
        now={Date.now()}
        onRun={() => act('run', () => window.tide.workshop.run(id))}
        onHint={() => act('hint', () => window.tide.workshop.hint(id))}
        onReview={() => act('review', () => window.tide.workshop.review(id, selected))}
        onAsk={(question) =>
          act('ask', async () => {
            const r = await window.tide.workshop.ask(id, question)
            setAnswer({ question, text: r.answer, by: r.by })
          })
        }
        onOpenFile={(path) => (/\.md$/i.test(path) ? app.openPath(path) : app.setView({ kind: 'code', path }))}
        onLearn={(concept) => app.setView({ kind: 'session', mode: 'teach', scope: from?.notebook ? { kind: 'folder', path: from.notebook } : { kind: 'none' }, topic: concept, nonce: Date.now() })}
      />
    )
  } else if (id) {
    const card = cards?.find((c) => c.id === id)
    body = card ? (
      <ProjectPreview card={card} busy={busy} from={from?.topic ? projectTopic(from.topic) : undefined} onStart={() => act('start', () => window.tide.workshop.start(id, from))} />
    ) : (
      <p className="ws-meta">{cards ? 'That project is not in the library.' : 'Loading…'}</p>
    )
  } else {
    const topic = from?.topic ? projectTopic(from.topic) : null
    const intro = topic ? (
      <section className="ws-for-topic">
        <p className="ws-kicker">From your roadmap</p>
        <h1 className="ws-title">{topic}</h1>
        {forTopic ? (
          <>
            <p className="ws-lede">Tide has already designed a project for this item: {forTopic.title}.</p>
            <button className="btn primary" onClick={() => open(forTopic.id)}>
              {forTopic.progress ? 'Carry on' : 'Open it'}
            </button>
          </>
        ) : (
          <>
            <p className="ws-lede">Tide can design a project for this item, in stages with tests. It is kept only if its own solution passes its own tests when Tide runs them here, and its starting files fail them.</p>
            <button
              className="btn primary"
              disabled={busy === 'propose' || forTopic === undefined}
              onClick={() =>
                act('propose', async () => {
                  const r = await window.tide.workshop.propose({ topic: from!.topic!, notebook: from?.notebook })
                  setProposal({ tries: r.tries, problems: r.problems })
                  if (r.card) {
                    setCards((cs) => [r.card!, ...(cs ?? []).filter((c) => c.id !== r.card!.id)])
                    open(r.card.id)
                  }
                })
              }
            >
              {busy === 'propose' ? 'Designing and testing it…' : 'Design a project for this'}
            </button>
            {proposal && proposal.problems.length > 0 && (
              <div className="ws-nothing">
                <p>{proposal.tries ? `Tide asked ${proposal.tries} time${proposal.tries === 1 ? '' : 's'} and could not prove a design:` : 'Tide could not ask for one:'}</p>
                <ul>
                  {proposal.problems.slice(0, 4).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="ws-meta">Or pick one of the library’s projects below.</p>
          </>
        )}
      </section>
    ) : (
      <header className="ws-list-head">
        <h1 className="ws-title">Projects</h1>
        <p className="ws-lede">Build something real, a stage at a time. Each stage has a brief and tests; Tide runs them here and the tutor reviews your code without writing it for you.</p>
      </header>
    )
    body = cards ? <ProjectList cards={cards} onOpen={open} intro={intro} /> : <p className="ws-meta">Loading…</p>
  }

  return (
    <div className="doc-view ws-page">
      <div className="ws-scroll">
        <div className="ws-wrap">
          {back}
          {body}
        </div>
      </div>
    </div>
  )
}

/**
 * Learn's way in (a small hook in LearnView): the projects in hand, and the way to the rest.
 */
export function WorkshopShelf() {
  const app = useApp()
  const [cards, setCards] = useState<WorkshopCard[]>([])
  useEffect(() => {
    window.tide.workshop
      .list()
      .then(setCards)
      .catch(() => {})
  }, [])
  const inHand = cards.filter((c) => c.progress && !c.progress.finishedAt).slice(0, 3)
  return (
    <section className="ws-shelf">
      <div className="ws-shelf-head">
        <h2 className="section-title">Build a project</h2>
        <button className="tool-btn" onClick={() => app.setView({ kind: 'workshop' })}>
          {cards.length ? `All ${cards.length} projects` : 'Projects'}
        </button>
      </div>
      {inHand.length ? (
        <ul className="ws-shelf-rows">
          {inHand.map((c) => (
            <li key={c.id}>
              <button className="ws-shelf-row" onClick={() => app.setView({ kind: 'workshop', id: c.id })}>
                <span className="ws-shelf-title">{c.title}</span>
                <span className="muted small">
                  Stage {c.progress!.stage + 1} of {c.stages}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">A key-value store with a write-ahead log, a Raft node, a tokeniser, a ledger in SQL: real things, built in stages against tests.</p>
      )}
    </section>
  )
}
