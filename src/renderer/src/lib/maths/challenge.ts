/**
 * Poke-holes challenges (shared/pokeHoles) in tutor text: a ```challenge block becomes something
 * to attack. A counterexample is checked here, at once, by evaluating both sides of the claim at
 * their values (the plot simulation's safe expression reader, nothing run as code); the wrong step
 * and always/sometimes/never are checked against the block's answer. Then "Use as my answer" puts
 * their pick in the lesson's answer box to finish with their reasons, which the tutor marks.
 * A block still streaming in, or one that isn't a challenge, stays visible as code.
 */
import { createKeeper, watchBlocks } from '../liveBlocks'
import { h } from '../sims/dom'
import { parseExpr, compile } from '../sims/plotExpr'
import { toAnswerBox } from '../sims/exploreBus'
import { answerStart, checkCounterexample, parseChallenge, type Asn, type Challenge, type Evaluate } from '@shared/pokeHoles'

const sourceOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''
const isChallengeBlock = (pre: HTMLElement) => (pre.dataset.lang ?? '').toLowerCase() === 'challenge'

const keeper = createKeeper({ widget: 'figure.challenge', isSource: isChallengeBlock, sourceOf })

/** Evaluates an expression in a few one-letter variables with the plot simulation's reader */
export const evaluateExpr: Evaluate = (expr, vars) => {
  const names = Object.keys(vars).filter((n) => n !== 'x')
  const parsed = parseExpr(expr.replace(/\*\*/g, '^').replace(/[−–]/g, '-'), new Set(names))
  if (!parsed.ok) return NaN
  return compile(parsed.tree)(vars.x ?? NaN, new Map(Object.entries(vars)))
}

const KIND_LABEL: Record<Challenge['type'], string> = { counterexample: 'Break the claim', 'wrong-step': 'Find the wrong step', asn: 'Always, sometimes or never?' }

/** Builds the widget for one challenge */
export function mountChallenge(c: Challenge): HTMLElement {
  const root = h('figure', { class: `challenge challenge-${c.type}`, role: 'group', 'aria-label': KIND_LABEL[c.type] })
  const result = h('p', { class: 'challenge-result', 'aria-live': 'polite', hidden: true })
  const use = h('button', { type: 'button', class: 'sim-btn quiet challenge-use', hidden: true }, 'Use as my answer')
  let start = ''
  use.addEventListener('click', () => {
    const where = toAnswerBox(root, start)
    use.textContent = where === 'answer' ? 'In your answer: now say why' : where === 'ask' ? 'Added to your question' : 'Copied'
  })
  const show = (ok: boolean | null, line: string, answer?: string) => {
    result.hidden = false
    result.textContent = line
    result.className = `challenge-result${ok === true ? ' right' : ok === false ? ' wrong' : ''}`
    if (answer) {
      start = answer
      use.hidden = false
    }
  }
  root.append(h('figcaption', { class: 'challenge-head' }, h('span', { class: 'challenge-kind' }, 'Poke holes'), h('span', { class: 'challenge-title' }, KIND_LABEL[c.type])))

  if (c.type === 'counterexample') {
    root.append(h('p', { class: 'challenge-claim' }, c.claim))
    const fields = h('div', { class: 'challenge-fields' })
    const inputs: Record<string, HTMLInputElement> = {}
    for (const [name, kind] of Object.entries(c.vars)) {
      const input = h('input', { type: 'text', class: 'challenge-input', inputmode: 'decimal', 'aria-label': `${name}, ${kind}`, placeholder: kind === 'real' ? 'e.g. 1/2' : kind === 'positive' ? 'e.g. 0.5' : 'e.g. 3', autocomplete: 'off', spellcheck: false })
      inputs[name] = input
      fields.append(h('label', { class: 'challenge-field' }, h('span', { class: 'challenge-var' }, `${name} =`), input))
    }
    const check = h('button', { type: 'button', class: 'sim-btn primary' }, 'Test it')
    const run = () => {
      const given = Object.fromEntries(Object.entries(inputs).map(([n, i]) => [n, i.value]))
      const r = checkCounterexample(c, given, evaluateExpr)
      show(r.ok ? true : r.reason === 'holds' ? null : false, r.line, r.ok ? answerStart(c, { values: given }, 'Tide checked it breaks the claim') : undefined)
      if (r.ok) root.classList.add('done')
    }
    check.addEventListener('click', run)
    for (const i of Object.values(inputs)) i.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), run()))
    fields.append(check)
    root.append(fields)
    if (c.hint) {
      const hint = h('button', { type: 'button', class: 'sim-btn quiet challenge-hint' }, 'A nudge')
      hint.addEventListener('click', () => hint.replaceWith(h('p', { class: 'challenge-nudge' }, c.hint!)))
      root.append(hint)
    }
  } else if (c.type === 'wrong-step') {
    root.append(h('p', { class: 'challenge-claim' }, c.title))
    const list = h('ol', { class: 'challenge-steps' })
    c.steps.forEach((step, i) => {
      const b = h('button', { type: 'button', class: 'challenge-step', 'aria-pressed': 'false' }, h('span', { class: 'challenge-n' }, String(i + 1)), h('span', { class: 'challenge-text' }, step))
      b.addEventListener('click', () => {
        list.querySelectorAll('.challenge-step').forEach((x) => x.setAttribute('aria-pressed', 'false'))
        b.setAttribute('aria-pressed', 'true')
        const right = i + 1 === c.wrong
        show(right, right ? `Yes: step ${i + 1} is where it breaks. Now say exactly what’s wrong with it.` : `Step ${i + 1} holds up. Read each step against the one before it.`, right ? answerStart(c, { step: i + 1 }, 'Tide confirmed this is the wrong step') : undefined)
        root.classList.toggle('done', right)
      })
      list.append(h('li', null, b))
    })
    root.append(list)
  } else {
    root.append(h('p', { class: 'challenge-claim' }, c.statement))
    const row = h('div', { class: 'challenge-choices', role: 'radiogroup', 'aria-label': 'Always, sometimes or never' })
    for (const choice of ['always', 'sometimes', 'never'] as Asn['answer'][]) {
      const b = h('button', { type: 'button', class: 'challenge-choice', role: 'radio', 'aria-checked': 'false' }, choice.charAt(0).toUpperCase() + choice.slice(1))
      b.addEventListener('click', () => {
        row.querySelectorAll('.challenge-choice').forEach((x) => x.setAttribute('aria-checked', 'false'))
        b.setAttribute('aria-checked', 'true')
        const right = choice === c.answer
        show(right, right ? `${choice.charAt(0).toUpperCase() + choice.slice(1)} it is. Now justify it: ${choice === 'sometimes' ? 'one case where it’s true and one where it isn’t' : choice === 'always' ? 'why it can never fail' : 'why it can never hold'}.` : `Not quite. ${c.answer === 'sometimes' ? 'Look for one case each way.' : 'Try a few cases, including odd ones.'}`, right ? answerStart(c, { choice }, 'Tide confirmed the pick') : undefined)
        root.classList.toggle('done', right)
      })
      row.append(b)
    }
    root.append(row)
  }
  root.append(h('div', { class: 'challenge-foot' }, result, use))
  return root
}

function scan(): void {
  keeper.reclaim()
  document.querySelectorAll<HTMLElement>('pre.code-block').forEach((pre) => {
    if (!isChallengeBlock(pre)) return
    const code = sourceOf(pre)
    if (!code.trim() || pre.dataset.challengeTried === code) return
    pre.dataset.challengeTried = code
    const c = parseChallenge(code)
    if (!c) return
    const slot = keeper.slot(pre)
    const root = mountChallenge(c)
    pre.replaceWith(root)
    keeper.keep(slot, root, () => {})
  })
}

/** Watches the whole document; call once at startup */
export function startChallenges(): void {
  watchBlocks(keeper, scan)
  scan()
}
