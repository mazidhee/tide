/**
 * Regular expressions, live: the pattern as a railroad diagram (parsed by regexp-tree), the test
 * strings with every match and capture group marked, and a table of the chosen string's matches.
 * The pattern, its flags and the strings are all editable; matching is JavaScript's own engine,
 * run in a worker with a time limit (regexClient.ts).
 */
import { button, h, ring } from '../dom'
import { FLAGS, REGEX_LIMITS, cleanFlags, describeRegexPart, parseRegexPart, splitLiteral, type MatchOutcome, type RegexSpec, type TestResult } from '../regex'
import { matchAll } from '../regexClient'
import { parsePattern, railroad } from '../regexRail'
import type { SimHost, SimKindDef, SimView } from '../shell'

const FLAG_WORDS: Record<string, string> = { g: 'every match', i: 'ignore case', m: '^ $ at each line', s: '. matches newline' }

/** The test string as runs: plain, inside a match, inside a capture group (the innermost) */
export function marks(test: string, r: TestResult | null): { text: string; match: number; group: number }[] {
  const at = Array.from({ length: test.length }, () => ({ match: 0, group: 0 }))
  r?.matches.forEach((m, k) => {
    for (let i = m.start; i < m.end; i++) at[i].match = k + 1
    // Later (inner) groups paint over earlier (outer) ones
    for (const g of m.groups) if (g.text !== null && g.start >= 0) for (let i = g.start; i < g.start + g.text.length; i++) at[i].group = g.n
  })
  const runs: { text: string; match: number; group: number }[] = []
  for (let i = 0; i < test.length; i++) {
    const last = runs[runs.length - 1]
    if (last && last.match === at[i].match && last.group === at[i].group) last.text += test[i]
    else runs.push({ text: test[i], ...at[i] })
  }
  return runs
}

function create(spec: RegexSpec, host: SimHost): SimView {
  let pattern = spec.pattern
  let flags = spec.flags
  let tests = [...spec.tests]
  let select = spec.select
  let outcome: MatchOutcome | null = null
  let version = 0
  let groups = 0
  let marked: string | null = null
  let dirtyDiagram = true

  // ---------- Pattern and flags ----------
  const input = h('input', { type: 'text', class: 'sim-input sim-mono sim-rx-pattern', 'aria-label': 'Pattern', spellcheck: 'false', autocomplete: 'off', maxlength: REGEX_LIMITS.pattern })
  input.value = pattern
  input.addEventListener('input', () => {
    const lit = splitLiteral(input.value, flags)
    pattern = lit.pattern
    if (lit.flags !== flags) {
      flags = cleanFlags(lit.flags)
      input.value = pattern
    }
    rerun()
  })
  input.addEventListener('keydown', (e) => e.key === 'Enter' && host.select('pattern'))
  const flagButtons = FLAGS.map((f) => {
    const b = h('button', { type: 'button', class: 'sim-seg-btn', title: FLAG_WORDS[f], 'aria-label': `Flag ${f}: ${FLAG_WORDS[f]}` }, f)
    b.addEventListener('click', () => {
      flags = flags.includes(f) ? flags.replace(f, '') : cleanFlags(flags + f)
      host.select('flags')
      rerun()
    })
    return b
  })
  const flagGroup = h('div', { class: 'sim-seg sim-rx-flags', role: 'group', 'aria-label': 'Flags' }, ...flagButtons)
  const patternLabel = h('button', { type: 'button', class: 'sim-label sim-pl-windowlabel' }, 'Pattern')
  patternLabel.addEventListener('click', () => host.select('pattern'))
  const patternField = h('div', { class: 'sim-field sim-rx-field' }, patternLabel, h('div', { class: 'sim-inline sim-rx-inline' }, h('span', { class: 'sim-rx-slash' }, '/'), input, h('span', { class: 'sim-rx-slash' }, '/'), flagGroup))
  const error = h('p', { class: 'sim-pl-err', role: 'status' })

  // ---------- Diagram ----------
  const diagram = h('div', { class: 'sim-rx-diagram', tabindex: 0, 'aria-label': 'Railroad diagram' })
  diagram.addEventListener('click', (e) => {
    const part = (e.target as Element).closest('[data-part]')?.getAttribute('data-part')
    host.select(part ?? 'diagram')
  })
  const diagramBox = h('div', { class: 'sim-panel sim-rx-diagrambox' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Read it as a railroad: any path from left to right is a match')), diagram)

  // ---------- Test strings ----------
  const testList = h('div', { class: 'sim-rx-tests' })
  const addBtn = button('Add a test string', () => {
    if (tests.length >= REGEX_LIMITS.tests) return
    tests.push('')
    select = tests.length - 1
    buildTests()
    rerun()
    testRows[select]?.input.focus()
  }, 'quiet sim-pl-add')
  let testRows: { el: HTMLElement; input: HTMLInputElement; view: HTMLElement; count: HTMLElement; name: HTMLButtonElement }[] = []

  function buildTests(): void {
    testRows = tests.map((t, i) => {
      const name = h('button', { type: 'button', class: 'sim-rx-name', title: 'List this string’s matches' }, String(i + 1))
      name.addEventListener('click', () => {
        select = i
        host.select(`test:${i + 1}`)
        host.invalidate()
      })
      const field = h('input', { type: 'text', class: 'sim-input sim-mono sim-rx-test', 'aria-label': `Test string ${i + 1}`, spellcheck: 'false', autocomplete: 'off', maxlength: REGEX_LIMITS.test })
      field.value = t
      field.addEventListener('input', () => {
        tests[i] = field.value
        select = i
        rerun()
      })
      field.addEventListener('focus', () => {
        if (select !== i) {
          select = i
          host.invalidate()
        }
      })
      const view = h('div', { class: 'sim-rx-view sim-mono', 'aria-hidden': 'true' })
      const count = h('span', { class: 'sim-rx-count' })
      return { el: h('div', { class: 'sim-rx-row' }, name, h('div', { class: 'sim-rx-cell' }, field, view), count), input: field, view, count, name }
    })
    testList.replaceChildren(...testRows.map((r) => r.el))
  }

  // ---------- Matches of the chosen string ----------
  const matchHead = h('tr')
  const matchBody = h('tbody')
  const matchTable = h('table', { class: 'sim-table sim-rx-table' }, h('thead', null, matchHead), matchBody)
  const matchTitle = h('span')
  const matchBox = h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, matchTitle), matchTable)

  const el = h('div', { class: 'sim-rx' }, h('div', { class: 'sim-params' }, patternField, error), diagramBox, h('div', { class: 'sim-two sim-rx-two' }, h('div', { class: 'sim-stack' }, testList, addBtn), matchBox))

  function rerun(): void {
    const mine = ++version
    dirtyDiagram = true
    outcome = null
    const parsed = parsePattern(pattern, flags)
    groups = parsed.ok ? parsed.groups : 0
    void matchAll(pattern, flags, [...tests]).then((o) => {
      if (mine !== version) return
      outcome = o
      // Painted at once: the answer can arrive while the figure waits for nothing else
      draw()
      host.invalidate()
    })
    host.invalidate()
  }

  function drawDiagram(): void {
    if (!dirtyDiagram) return
    dirtyDiagram = false
    const parsed = parsePattern(pattern, flags)
    if (!parsed.ok) {
      diagram.replaceChildren(h('p', { class: 'sim-note' }, 'The diagram returns when the pattern can be read.'))
      return
    }
    diagram.replaceChildren(railroad(parsed.ast).svg)
  }

  function draw(): void {
    drawDiagram()
    flagButtons.forEach((b, i) => b.setAttribute('aria-pressed', flags.includes(FLAGS[i]) ? 'true' : 'false'))
    const compileError = outcome && !outcome.ok ? outcome.error : ''
    if (error.textContent !== compileError) error.textContent = compileError
    error.hidden = !compileError
    input.classList.toggle('bad', !!compileError && !(outcome && !outcome.ok && outcome.slow))
    const results = outcome?.ok ? outcome.results : null
    testRows.forEach((row, i) => {
      const r = results?.[i] ?? null
      row.name.setAttribute('aria-pressed', i === select ? 'true' : 'false')
      row.view.replaceChildren(
        ...(tests[i]
          ? marks(tests[i], r).map((run) => (run.match ? h('mark', { class: `sim-rx-mark${run.group ? ` g${((run.group - 1) % 4) + 1}` : ''}${run.match % 2 ? '' : ' alt'}` }, run.text) : document.createTextNode(run.text)))
          : [h('span', { class: 'sim-rx-empty' }, 'empty')])
      )
      row.count.textContent = r ? `${r.matches.length}${r.capped ? '+' : ''} ${r.matches.length === 1 ? 'match' : 'matches'}` : outcome ? '–' : '…'
      row.el.classList.toggle('chosen', i === select)
    })
    addBtn.hidden = tests.length >= REGEX_LIMITS.tests
    // The chosen string's matches, and each group's text
    const r = results?.[select] ?? null
    matchTitle.textContent = `Matches in string ${select + 1}${flags.includes('g') ? '' : ' (no g flag: the first only)'}`
    const heads = ['', 'Match', 'At', ...Array.from({ length: Math.min(groups, 4) }, (_, k) => `Group ${k + 1}`)]
    if (matchHead.childElementCount !== heads.length) matchHead.replaceChildren(...heads.map((t, k) => h('th', { class: k === 2 ? 'n' : k > 2 ? `g${k - 2}` : '' }, t)))
    matchBody.replaceChildren(
      ...(r && r.matches.length
        ? r.matches.slice(0, 12).map((m, k) => {
            const row = h(
              'tr',
              { class: 'sim-part' },
              h('th', null, String(k + 1)),
              h('td', { class: 'sim-mono' }, m.text === '' ? '(empty)' : m.text),
              h('td', { class: 'n' }, String(m.start)),
              ...m.groups.slice(0, 4).map((g) => h('td', { class: `sim-mono${g.text === null ? ' sim-rx-none' : ''}` }, g.text === null ? '–' : g.text || '(empty)'))
            )
            row.addEventListener('click', () => host.select(`match:${k + 1}`))
            ring(row, marked === `match:${k + 1}`)
            return row
          })
        : [h('tr', null, h('td', { colspan: heads.length, class: 'sim-rx-nomatch' }, outcome === null ? 'Matching…' : outcome.ok ? 'No match in this string.' : 'Fix the pattern to see matches.'))])
    )
  }

  buildTests()
  rerun()

  const state = () => ({ pattern, flags, tests, select, outcome, groups })
  const counts = () => [tests.length, outcome?.ok ? (outcome.results[select]?.matches.length ?? 0) : 0, groups] as const

  return {
    el,
    step() {},
    reset() {
      pattern = spec.pattern
      flags = spec.flags
      tests = [...spec.tests]
      select = spec.select
      input.value = pattern
      buildTests()
      rerun()
    },
    draw,
    sample(n) {
      if (n >= 1 && n <= tests.length) select = n - 1
    },
    describe(name) {
      const part = parseRegexPart(name, ...counts())
      return part ? describeRegexPart(part, state()) : null
    },
    highlight(name) {
      marked = name
      const part = name ? parseRegexPart(name, ...counts()) : null
      ring(patternField, part?.type === 'pattern' || part?.type === 'flags')
      ring(diagramBox, part?.type === 'diagram')
      testRows.forEach((r, i) => ring(r.el, part?.type === 'test' && part.i === i + 1))
      diagram.querySelectorAll('[data-part]').forEach((g) => g.classList.toggle('on', part?.type === 'group' && g.getAttribute('data-part') === `group:${part.i}`))
    },
    act(action) {
      if (typeof action.pattern === 'string') {
        const lit = splitLiteral(action.pattern, flags)
        pattern = lit.pattern
        flags = cleanFlags(lit.flags)
        input.value = pattern
      }
      if (typeof action.flags === 'string') flags = cleanFlags(action.flags)
      if (typeof action.test === 'string' && tests.length < REGEX_LIMITS.tests) {
        tests.push(action.test.slice(0, REGEX_LIMITS.test))
        select = tests.length - 1
        buildTests()
      }
      rerun()
    }
  }
}

export const regexKind: SimKindDef<RegexSpec> = {
  label: 'Regular expression',
  transport: false,
  autoplay: () => false,
  create
}
