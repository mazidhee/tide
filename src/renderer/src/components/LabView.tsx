import { useEffect, useRef, useState } from 'react'
import { terminalInstructions } from '@shared/session'
import { useApp } from '../state'
import { Composer, TurnView, useConversation } from './Conversation'
import { Icon } from './Icon'
import { TerminalView } from './TerminalView'
import { TimeThis } from './TimeThis'

const LAB_TOPICS = ['Moving around: pwd, ls, cd', 'Files: cp, mv, rm, mkdir', 'Reading files: cat, less, head, tail', 'Permissions and chmod', 'grep, pipes and redirection', 'find and xargs', 'Processes: ps, top, kill', 'Shell scripting basics', 'Networking: curl, ping, ss', 'Users, sudo and packages']

/**
 * A terminal with the tutor beside it. In the Linux lab (a throwaway Ubuntu container) the tutor
 * can set up exercises and check your work in the terminal; on your own Mac it only reads and
 * suggests.
 */
export function LabView({ kind, topic: initialTopic }: { kind: 'lab' | 'local'; topic?: string }) {
  const app = useApp()
  const convo = useConversation()
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [topic, setTopic] = useState(initialTopic ?? '')
  const [input, setInput] = useState('')
  const [restart, setRestart] = useState(0)
  const [stopped, setStopped] = useState(false)
  const [tutorOpen, setTutorOpen] = useState(true)
  const [carding, setCarding] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const instructions = terminalInstructions(kind, topic || undefined)

  const send = async (text: string) => {
    if (!terminalId) return
    if (await convo.send(text, { scope: { kind: 'none' }, instructions, terminalId })) setInput('')
  }

  // Start the lesson once the terminal is up, if a topic was chosen
  useEffect(() => {
    if (!terminalId || started.current || !initialTopic) return
    started.current = true
    send(`Teach me ${initialTopic} in this terminal. Start by finding out what I already know.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId])

  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [convo.turns])

  const title = kind === 'lab' ? 'Linux lab' : 'Terminal'

  /** Flashcards from the commands run so far, so the lab comes back in Review */
  const makeCards = async () => {
    if (!terminalId || carding) return
    setCarding(true)
    try {
      const r = await window.tide.terminal.flashcards(terminalId, topic || undefined)
      app.toast(r.added ? `Added ${r.added} card${r.added === 1 ? '' : 's'} to Lab commands` : 'These commands already have cards', {
        action: { label: 'Open', run: () => app.openPath(r.path) }
      })
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    } finally {
      setCarding(false)
    }
  }

  return (
    <div className={`lab${tutorOpen ? ' with-tutor' : ''}`}>
      <header className="doc-toolbar drag lab-head">
        <div className="crumbs no-drag">
          <span className="crumb current">{title}</span>
          <span className="muted lab-sub">{kind === 'lab' ? 'Ubuntu sandbox' : 'Your Mac · the tutor only reads'}</span>
        </div>
        <div className="toolbar-actions no-drag">
          <TimeThis context={{ label: topic ? `${title}: ${topic}` : title, path: `lab:${kind}:${(topic || 'free').toLowerCase()}`, kind: 'session' }} />
          {kind === 'lab' && (
            <button className="tool-btn" onClick={makeCards} disabled={!terminalId || carding} title="Make flashcards from the commands you ran">
              <Icon name="cards" />
              <span>{carding ? 'Making cards…' : 'Cards'}</span>
            </button>
          )}
          <button
            className="tool-btn"
            onClick={() => {
              setTerminalId(null)
              setStopped(false)
              setRestart((n) => n + 1)
            }}
            title={kind === 'lab' ? 'Start a fresh lab' : 'Start a new shell'}
          >
            <Icon name="refresh" />
            <span>{kind === 'lab' ? 'Fresh lab' : 'New shell'}</span>
          </button>
          <button className={`tool-btn${tutorOpen ? ' on' : ''}`} onClick={() => setTutorOpen((o) => !o)} title="Show or hide the tutor">
            <Icon name="panel" />
            <span>Tutor</span>
          </button>
        </div>
      </header>
      <div className="lab-body">
        <section className="lab-terminal">
          <TerminalView
            key={restart}
            kind={kind}
            onReady={(id) => {
              setTerminalId(id)
              setStopped(false)
            }}
            onExit={() => setStopped(true)}
          />
          {stopped && (
            <div className="lab-stopped">
              <span>{kind === 'lab' ? 'The lab has stopped.' : 'The shell has exited.'}</span>
              <button className="btn small" onClick={() => setRestart((n) => n + 1)}>
                Start again
              </button>
            </div>
          )}
        </section>
        {tutorOpen && (
          <aside className="lab-tutor no-drag" aria-label="Tutor">
            <div className="lab-thread" ref={listRef}>
              {convo.turns.length === 0 && (
                <div className="lab-welcome">
                  <p className="lab-welcome-title">{kind === 'lab' ? 'Learn the command line' : 'Your terminal'}</p>
                  <p className="muted small">
                    {kind === 'lab'
                      ? 'Pick a topic.'
                      : 'Ask about anything you run.'}
                  </p>
                  {kind === 'lab' && (
                    <div className="lab-topics">
                      {LAB_TOPICS.map((t) => (
                        <button
                          key={t}
                          className="pill"
                          disabled={!terminalId}
                          onClick={() => {
                            setTopic(t)
                            convo.send(`Teach me ${t} in this terminal. Start by finding out what I already know.`, { scope: { kind: 'none' }, instructions: terminalInstructions(kind, t), terminalId: terminalId! })
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {convo.turns.map((t) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  codeAction={
                    terminalId
                      ? {
                          // In the lab a click runs it; on your Mac it's only typed, so you press Enter yourself
                          label: kind === 'lab' ? 'Run in terminal' : 'Type in terminal',
                          run: (code) => window.tide.terminal.write(terminalId, kind === 'lab' ? code.replace(/\n/g, '\r') + '\r' : code.replace(/\n/g, ' && '))
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            <Composer
              value={input}
              onChange={setInput}
              onSend={() => send(input)}
              busy={convo.busy}
              onStop={convo.stop}
              web={convo.web}
              onWeb={convo.setWeb}
              placeholder={terminalId ? 'Ask about what you just ran' : 'Starting the terminal…'}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
