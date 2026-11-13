/**
 * How explorables and poke-holes challenges talk to the lesson around them, without knowing it:
 * - What the learner did in an explorable (the values they left it at, what they predicted) is
 *   collected with their next message as a hidden note, so the tutor can ask about exactly that
 *   (takeExploreNotes, read by SessionView like Claude's visuals' notes).
 * - "Tell the tutor" and "Use as my answer" put text in the lesson's answer box (MATHS_ANSWER_EVENT,
 *   taken by SessionView); outside a lesson the nearest "Ask…" box gets it, else it is copied.
 */
export const MATHS_ANSWER_EVENT = 'tide:maths-answer'

export interface MathsAnswerDetail {
  text: string
}

interface Live {
  root: HTMLElement
  note(): string
  dirty: boolean
}

const live = new Set<Live>()

/** An explorable on screen; call the returned function when it goes */
export function registerExplorable(root: HTMLElement, note: () => string): { touched(): void; done(): void } {
  const entry: Live = { root, note, dirty: false }
  live.add(entry)
  return {
    touched: () => (entry.dirty = true),
    done: () => live.delete(entry)
  }
}

/** Notes for the tutor from explorables in `container` the learner has touched since the last message */
export function takeExploreNotes(container: Element | null): string[] {
  if (!container) return []
  const out: string[] = []
  for (const e of live) {
    if (!e.dirty || !e.root.isConnected || !container.contains(e.root)) continue
    e.dirty = false
    const note = e.note()
    if (note) out.push(`(Tide: the learner used the explorable ${note}. Build on what they found.)`)
  }
  return out
}

/** Puts text in the lesson's answer box; else the nearest "Ask…" box; else the clipboard. Says which. */
export function toAnswerBox(from: HTMLElement, text: string): 'answer' | 'ask' | 'copied' {
  const event = new CustomEvent<MathsAnswerDetail>(MATHS_ANSWER_EVENT, { bubbles: true, cancelable: true, detail: { text } })
  from.dispatchEvent(event)
  if (event.defaultPrevented) return 'answer'
  for (let el = from.parentElement; el; el = el.parentElement) {
    const boxes = Array.from(el.querySelectorAll<HTMLTextAreaElement>('textarea:not([readonly]):not([disabled])')).filter((t) => /^ask\b/i.test(t.placeholder || t.getAttribute('aria-label') || ''))
    const box = boxes[boxes.length - 1]
    if (!box) continue
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(box, box.value.trim() ? `${box.value.trimEnd()}\n${text}` : text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.focus()
    return 'ask'
  }
  void navigator.clipboard?.writeText(text).catch(() => undefined)
  return 'copied'
}
