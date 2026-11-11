/**
 * Renders ```sim code blocks as live simulations anywhere tutor text appears (notes, tutor
 * threads, lessons), the same way mermaid blocks become diagrams. A block still streaming in,
 * invalid JSON or an unknown kind stays visible as code.
 */
import { createKeeper, watchBlocks } from '../liveBlocks'
import { isSimSource } from '@shared/sims'
import { ASK_EVENT, askQuestion, type AskDetail } from './parts'

let runtime: Promise<typeof import('./runtime')> | null = null

const sourceOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''

// Labelled sim, or labelled json (or nothing) and holding a simulation: see isSimSource
const isSimBlock = (pre: HTMLElement) => isSimSource(pre.dataset.lang ?? '', sourceOf(pre))

/** Simulations survive the text around them being replaced (see liveBlocks) */
const keeper = createKeeper({ widget: 'figure.sim', isSource: isSimBlock, sourceOf })

async function renderBlock(pre: HTMLElement): Promise<void> {
  const code = sourceOf(pre)
  if (!code.trim() || pre.dataset.simTried === code) return
  pre.dataset.simTried = code
  // Cheap check before loading anything: a block that isn't complete JSON yet is left alone
  try {
    JSON.parse(code)
  } catch {
    return
  }
  try {
    runtime ??= import('./runtime')
    const { parseSim, mount } = await runtime
    const spec = parseSim(code)
    if (!spec || !pre.isConnected || pre.dataset.simTried !== code) return
    const slot = keeper.slot(pre)
    const sim = mount(spec, (root) => pre.replaceWith(root))
    keeper.keep(slot, sim.root, sim.destroy)
  } catch {
    // Leave the code visible if the simulation can't be drawn
  }
}

function scan(): void {
  keeper.reclaim()
  document.querySelectorAll<HTMLElement>('pre.code-block').forEach((pre) => {
    if (isSimBlock(pre)) void renderBlock(pre)
  })
}

/**
 * "Ask about this" on a simulation: if the simulation sits in a view with an obvious question
 * box (one that says "Ask…"), the question is put there for the learner to send or edit.
 */
function fillNearestQuestionBox(event: Event): void {
  const detail = (event as CustomEvent<AskDetail>).detail
  if (!detail?.label) return
  for (let el = (event.target as HTMLElement | null)?.parentElement; el; el = el.parentElement) {
    const boxes = Array.from(el.querySelectorAll<HTMLTextAreaElement>('textarea:not([readonly]):not([disabled])')).filter((t) => /^ask\b/i.test(t.placeholder || t.getAttribute('aria-label') || ''))
    const box = boxes[boxes.length - 1]
    if (!box) continue
    const question = askQuestion(detail)
    // React tracks the value itself, so set it the way typing would
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(box, box.value.trim() ? `${box.value.trimEnd()}\n${question}` : question)
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.focus()
    event.preventDefault()
    return
  }
}

/** Watches the whole document; call once at startup */
export function startSims(): void {
  watchBlocks(keeper, scan)
  document.addEventListener(ASK_EVENT, fillNearestQuestionBox)
  scan()
}
