/**
 * A simulation's tour told in the professor's voice as it runs. Narrate starts the tour again from
 * its first step; each step's actions are done as its words begin (a training run plays while
 * they're said), and the next step waits until the words end and the simulation has done what
 * the step set running. Back and Next go on from where you moved to. Pause holds both the voice
 * and the simulation. The audio is made by main/lectureVoice (Fish, Kokoro standing in) and kept,
 * so a second telling starts at once. The voice library loads only when Narrate is first pressed.
 */
import { CATCH_UP_MS, STEP_GAP_MS, stepRange } from '@shared/narration'
import type { LectureState } from '@shared/types'

type Lecture = typeof import('../lecture')

export type NarrationState = 'idle' | 'preparing' | 'playing' | 'paused'

export interface NarrationHost {
  says: string[]
  /** The tour from the top: the simulation reset, step one's actions done */
  restart(): void
  /** To a step, doing its actions (the narrator moving on) */
  goTo(step: number): void
  /** Whether the simulation has done what the step set running */
  caughtUp(): boolean
  /** Holds the simulation still while the narration is paused */
  hold(on: boolean): void
  show(state: NarrationState, label: string, note?: string): void
}

export interface Narrator {
  /** The button: start, pause, resume, or stop while preparing */
  toggle(): void
  stop(): void
  /** The learner moved the tour (Back, Next, arrows): the narration goes on from there */
  moved(step: number): void
  destroy(): void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Whether this window can narrate (a simulation shown outside Tide's windows can't) */
export const canNarrate = () => typeof window !== 'undefined' && !!(window as { tide?: { lecture?: unknown } }).tide?.lecture

export function createNarrator(host: NarrationHost): Narrator {
  let lect: Lecture | null = null
  let gen = 0
  let state: NarrationState = 'idle'
  let id: string | null = null
  let unsub: (() => void) | null = null

  const st = (): LectureState | undefined => (id && lect ? lect.current().states[id] : undefined)

  function show(next: NarrationState) {
    state = next
    const s = st()
    const made = s ? s.pieces.filter((p) => p.ready).length : 0
    const total = s?.pieces.length ?? 0
    const label =
      next === 'preparing' ? (total ? `Preparing the voice… ${made}/${total}` : 'Preparing the voice…') : next === 'paused' ? 'Paused' : next === 'playing' ? (made < total ? `Narrating · voice ${made}/${total} made` : 'Narrating') : ''
    host.show(next, label, s?.note)
  }

  async function start() {
    const mine = ++gen
    show('preparing')
    lect ??= await import('../lecture')
    unsub ??= lect.subscribe(() => state !== 'idle' && show(state))
    const made = await lect.narrate(host.says).catch(() => null)
    if (mine !== gen) return
    if (!made || !made.pieces.length) return finish(mine, 'The voice couldn’t be made.')
    id = made.id
    show('preparing')
    if (!(await lect.whenReady(made.id, Date.now(), () => mine === gen))) return
    host.restart()
    await runFrom(mine, 0)
  }

  async function runFrom(mine: number, from: number) {
    const l = lect!
    for (let s = from; s < host.says.length; s++) {
      if (s > from) host.goTo(s)
      show('playing')
      const [a, b] = stepRange(st()?.pieces ?? [], s)
      if (b > a && !(await l.playRange(id!, a, b))) {
        // Stopped by something else (a key, dictation, another reply): the narration ends there
        if (mine === gen) finish(mine)
        return
      }
      const t0 = Date.now()
      while (mine === gen && (state === 'paused' || (!host.caughtUp() && Date.now() - t0 < CATCH_UP_MS))) await sleep(150)
      if (mine !== gen) return
      if (s < host.says.length - 1) await sleep(STEP_GAP_MS)
      while (mine === gen && state === 'paused') await sleep(150)
      if (mine !== gen) return
    }
    finish(mine)
  }

  function finish(mine: number, note?: string) {
    if (mine !== gen) return
    gen++
    host.hold(false)
    state = 'idle'
    host.show('idle', '', note)
  }

  function stop() {
    if (state === 'idle') return
    const playingMine = lect && id && lect.current().playing?.id === id
    finish(gen)
    if (playingMine) lect!.stop()
  }

  return {
    toggle() {
      if (state === 'idle') void start()
      else if (state === 'preparing') stop()
      else if (state === 'playing') {
        lect?.pause()
        host.hold(true)
        show('paused')
      } else {
        host.hold(false)
        show('playing')
        lect?.resume()
      }
    },
    stop,
    moved(step) {
      if (state !== 'playing' && state !== 'paused') return
      const mine = ++gen
      host.hold(false)
      lect!.stop()
      void runFrom(mine, step)
    },
    destroy() {
      stop()
      unsub?.()
    }
  }
}
