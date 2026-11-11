/**
 * Byte-pair encoding learnt live from a short text: each step counts the adjacent pairs, merges
 * the most frequent into a new token and re-segments the text, while the learner's own sentence
 * is split again with the merges learnt so far. The variant and its choices are in ../bpe.
 */
import { button, h, ring, stat } from '../dom'
import { BPE_LIMITS, Bpe, END, END_MARK, UNK, describeTokeniserPart, explainMerge, parseTokeniserPart, show, tidy, type TokeniserSpec } from '../bpe'
import type { SimHost, SimKindDef, SimView } from '../shell'

const READY = 'Ready. Each step counts every adjacent pair of tokens in the text, then merges the most frequent pair into one new token.'
const PAIR_ROWS = 6

/** A token as an element: its text, with the end-of-word mark drawn apart from real characters */
function tokenText(el: HTMLElement, token: string): HTMLElement {
  if (token === UNK) el.append(UNK)
  else
    token.split(END).forEach((part, i) => {
      if (i) el.append(h('i', { class: 'sim-bpe-end' }, END_MARK))
      if (part) el.append(part)
    })
  return el
}

const chip = (token: string, cls = '') => tokenText(h('span', { class: `sim-bpe-tok ${cls}`.trim() }), token)

function create(spec: TokeniserSpec, host: SimHost): SimView {
  let text = spec.text
  let sentence = spec.sentence
  let bpe = train(text, spec.start)
  let editing = false
  let problem = ''
  let marked: string | null = null
  /** What the rebuilt lists were last built from, so typing in the sentence box doesn't rebuild the text */
  let built = ''

  function train(source: string, start: number): Bpe {
    const model = new Bpe(source, { lowercase: spec.lowercase, merges: spec.merges })
    model.run(start)
    return model
  }

  const select = (part: string) => {
    host.select(part)
    host.invalidate()
  }
  const panelPart = (el: HTMLElement, part: string) => {
    el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button, input, textarea')) select(part)
    })
    return el
  }

  // ---------- The learner's input ----------
  const sentenceInput = h('input', { type: 'text', class: 'sim-input sim-bpe-sentence-input', maxlength: BPE_LIMITS.sentence, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Your sentence' })
  sentenceInput.value = sentence
  sentenceInput.addEventListener('input', () => {
    sentence = sentenceInput.value
    host.invalidate()
  })
  const editBtn = button('Edit training text', () => {
    editing = true
    problem = ''
    area.value = text
    host.invalidate()
    area.focus()
  }, 'quiet')
  const params = h('div', { class: 'sim-params' }, h('label', { class: 'sim-field sim-bpe-field' }, h('span', { class: 'sim-label' }, 'Your sentence, split with the merges learnt so far'), sentenceInput), editBtn)

  const area = h('textarea', { class: 'sim-input sim-bpe-area', rows: 4, maxlength: BPE_LIMITS.text, spellcheck: 'false', 'aria-label': 'Training text' })
  const problemLine = h('p', { class: 'sim-bpe-problem', role: 'alert' })
  function learn(source: string): void {
    const clean = tidy(source, BPE_LIMITS.text, spec.lowercase)
    if (!clean) {
      problem = 'There is nothing to learn from yet: type a few words, with some of them repeated.'
      host.invalidate()
      return
    }
    text = clean
    bpe = train(text, text === spec.text ? spec.start : 0)
    editing = false
    problem = ''
    host.select(null)
    host.invalidate()
  }
  const restoreBtn = button('Restore the original', () => learn(spec.text), 'quiet')
  const editor = h(
    'div',
    { class: 'sim-bpe-editor' },
    area,
    problemLine,
    h(
      'div',
      { class: 'sim-inline' },
      button('Learn from this text', () => learn(area.value), 'primary'),
      button('Cancel', () => {
        editing = false
        problem = ''
        host.invalidate()
      }, 'quiet'),
      restoreBtn,
      h('span', { class: 'sim-bpe-hint' }, `Up to ${BPE_LIMITS.text} characters${spec.lowercase ? '; put in lower case' : ''}`)
    )
  )
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      learn(area.value)
      e.preventDefault()
    }
  })

  // ---------- What just happened ----------
  const stats = { merges: stat('Merges learnt'), length: stat('Text length'), ratio: stat('Compression'), vocab: stat('Vocabulary') }
  const statBox = h('div', { class: 'sim-stats sim-part sim-bpe-stats', tabindex: 0, role: 'button', 'aria-label': 'The length of the text in tokens' }, ...Object.values(stats).map((x) => x.el))
  statBox.addEventListener('click', () => select('length'))
  statBox.addEventListener('keydown', (e) => e.key === 'Enter' && select('length'))
  const say = h('p', { class: 'sim-bpe-say', 'aria-live': 'polite' })
  const now = h('div', { class: 'sim-bpe-now' }, statBox, say)

  // ---------- The training text, as tokens ----------
  const textFlow = h('div', { class: 'sim-bpe-flow sim-mono' })
  const textHint = h('span', { class: 'sim-bpe-hint' })
  const textPanel = panelPart(h('div', { class: 'sim-panel sim-bpe-text', tabindex: 0, role: 'button', 'aria-label': 'The training text as tokens' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Training text as tokens'), textHint), textFlow, editor), 'text')
  textPanel.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === textPanel && select('text'))

  // ---------- Pair counts ----------
  const pairList = h('div', { class: 'sim-bpe-pairs sim-mono' })
  const pairHint = h('span', { class: 'sim-bpe-hint' })
  const pairPanel = panelPart(h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Pair counts now'), pairHint), pairList), 'pairs')
  let pairRows: HTMLElement[] = []

  // ---------- Merges learnt ----------
  const mergeList = h('div', { class: 'sim-bpe-merges sim-mono' })
  const mergeHint = h('span', { class: 'sim-bpe-hint' })
  const mergePanel = panelPart(h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Merges, in the order learnt'), mergeHint), mergeList), 'merges')
  let mergeRows: HTMLElement[] = []

  // ---------- Vocabulary ----------
  const vocabList = h('div', { class: 'sim-bpe-vocab sim-mono' })
  const vocabHint = h('span', { class: 'sim-bpe-hint' })
  const vocabPanel = panelPart(h('div', { class: 'sim-panel sim-part sim-bpe-vocabbox', tabindex: 0, role: 'button', 'aria-label': 'The vocabulary' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Vocabulary, with ids'), vocabHint), vocabList), 'vocabulary')
  vocabPanel.addEventListener('keydown', (e) => e.key === 'Enter' && select('vocabulary'))

  // ---------- The learner's sentence ----------
  const pieceList = h('div', { class: 'sim-bpe-pieces sim-mono' })
  const pieceHint = h('span', { class: 'sim-bpe-hint' })
  const unknownLine = h('p', { class: 'sim-bpe-unknown' })
  const sentencePanel = panelPart(h('div', { class: 'sim-panel sim-bpe-sentence' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Your sentence as tokens, with ids'), pieceHint), pieceList, unknownLine), 'sentence')
  let pieceEls: HTMLElement[] = []

  const rule = (name: string, body: string) => h('div', { class: 'sim-bpe-rule' }, h('span', null, name), h('span', null, body))
  const rules = h(
    'div',
    { class: 'sim-bpe-rules' },
    h('p', { class: 'sim-bpe-toy' }, 'A tiny tokeniser trained on this text only, not a production one. The method is the original word-level byte-pair encoding, with these choices:'),
    rule('Starting symbols', 'Single characters. Production tokenisers start from UTF\u20118 bytes, so they can spell any text.'),
    rule('Words', `Split at spaces${spec.lowercase ? ', in lower case' : ''}; punctuation stays on its word. Each word ends with the mark ${END_MARK}, and pairs are only counted inside a word, so a merge never crosses a word boundary.`),
    rule('Ties', 'When pairs are equally frequent, the one that appears first in the text is merged.'),
    rule('Encoding', `Your sentence is split into characters, then the merges are applied in the order they were learnt. A character never seen in training has no token and becomes ${UNK}, id 0.`)
  )

  const el = h('div', { class: 'sim-bpe' }, params, now, h('div', { class: 'sim-two sim-bpe-main' }, textPanel, pairPanel), sentencePanel, h('div', { class: 'sim-two sim-bpe-foot' }, mergePanel, vocabPanel), rules)

  function elementOf(part: string | null): Element | null {
    const p = part ? parseTokeniserPart(part, bpe, sentence) : null
    if (!p) return null
    switch (p.type) {
      case 'text':
        return textPanel
      case 'pairs':
        return pairPanel
      case 'merges':
        return mergePanel
      case 'vocabulary':
        return vocabPanel
      case 'sentence':
        return sentencePanel
      case 'length':
        return statBox
      case 'pair':
        return pairRows[p.n - 1] ?? pairPanel
      case 'merge':
        return mergeRows[p.n - 1] ?? mergePanel
      case 'token':
        return pieceEls[p.n - 1] ?? sentencePanel
    }
  }
  let ringed: Element | null = null
  function mark(part: string | null): void {
    marked = part
    ring(ringed, false)
    ringed = elementOf(part)
    ring(ringed, true)
  }

  function rebuild(): void {
    const last = bpe.merges[bpe.merges.length - 1]
    const finished = bpe.finished

    // The text, word by word
    const flow = document.createDocumentFragment()
    for (const symbols of bpe.segmented()) {
      const word = h('span', { class: 'sim-bpe-word' })
      for (const sym of symbols) word.append(chip(sym, last && sym === last.token ? 'new' : ''))
      flow.append(word)
    }
    textFlow.replaceChildren(flow)

    // Pair counts
    const all = bpe.pairs()
    const top = all[0]?.count ?? 1
    pairRows = all.slice(0, PAIR_ROWS).map((p, i) => {
      const next = i === 0 && !finished
      const tied = i > 0 && !finished && p.count === top
      const row = h(
        'button',
        { type: 'button', class: `sim-part sim-bpe-pair${next ? ' on' : ''}` },
        h('span', { class: 'sim-bpe-rank' }, String(i + 1)),
        h('span', { class: 'sim-bpe-pairtoks' }, chip(p.left), h('i', { class: 'sim-bpe-plus' }, '+'), chip(p.right)),
        h('span', { class: 'sim-bpe-bar' }, h('i', { style: `width: ${((p.count / top) * 100).toFixed(1)}%` })),
        h('span', { class: 'sim-bpe-count' }, String(p.count)),
        h('span', { class: 'sim-bpe-tag' }, next ? 'next' : tied ? 'tied' : '')
      )
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        select(`pair:${i + 1}`)
      })
      return row
    })
    // One width for the pair column, so the bars start in line
    const widest = Math.max(0, ...all.slice(0, PAIR_ROWS).map((p) => Array.from(p.left + p.right).length))
    pairList.style.setProperty('--pair', `${Math.min(22, widest + 6)}ch`)
    pairList.replaceChildren(...(pairRows.length ? pairRows : [h('p', { class: 'sim-bpe-empty' }, 'No adjacent pairs are left: every word is one token.')]))
    if (all.length > PAIR_ROWS) pairList.append(h('p', { class: 'sim-bpe-empty' }, `and ${all.length - PAIR_ROWS} more pair${all.length - PAIR_ROWS === 1 ? '' : 's'}`))
    pairHint.textContent = finished ? 'finished' : 'Step merges the top pair'

    // Merges
    mergeRows = bpe.merges.map((m) => {
      const row = h(
        'button',
        { type: 'button', class: `sim-part sim-bpe-merge${m === last ? ' new' : ''}` },
        h('span', { class: 'sim-bpe-rank' }, String(m.n)),
        h('span', { class: 'sim-bpe-pairtoks' }, chip(m.left), h('i', { class: 'sim-bpe-plus' }, '+'), chip(m.right), h('i', { class: 'sim-bpe-plus' }, '→'), chip(m.token, m === last ? 'new' : 'made')),
        h('span', { class: 'sim-bpe-count' }, `×${m.count}`)
      )
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        select(`merge:${m.n}`)
      })
      return row
    })
    mergeList.replaceChildren(...(mergeRows.length ? mergeRows : [h('p', { class: 'sim-bpe-empty' }, 'None yet. Step learns the first.')]))
    // The newest merge stays in view
    mergeList.scrollTop = mergeList.scrollHeight
    mergeHint.textContent = `${bpe.merges.length} of at most ${bpe.maxMerges}`

    // Vocabulary
    vocabList.replaceChildren(
      ...bpe.vocab.map((token, id) => {
        const cls = id === 0 ? 'unk' : id > bpe.alphabet ? (last && id === last.id ? 'new' : 'made') : ''
        return h('span', { class: `sim-bpe-entry ${cls}`.trim() }, h('i', null, String(id)), tokenText(h('span'), token))
      })
    )
    vocabList.scrollTop = vocabList.scrollHeight
    vocabHint.textContent = `${bpe.vocab.length} tokens: ${UNK}, ${bpe.alphabet} characters, ${bpe.merges.length} merged`
  }

  function draw(): void {
    const key = `${bpe.text}\n${bpe.merges.length}`
    if (key !== built) {
      built = key
      rebuild()
    }
    const last = bpe.merges[bpe.merges.length - 1]

    params.classList.toggle('editing', editing)
    editBtn.hidden = editing
    textFlow.hidden = editing
    editor.hidden = !editing
    restoreBtn.hidden = text === spec.text && area.value === spec.text
    problemLine.textContent = problem
    problemLine.hidden = !problem
    area.classList.toggle('bad', !!problem)
    textHint.textContent = editing ? '⌘↵ learns from it' : `${bpe.words} word${bpe.words === 1 ? '' : 's'}, ${bpe.length} tokens${last ? '; new token marked' : ''}`

    stats.merges.set(`${bpe.merges.length} of ${bpe.maxMerges}`)
    stats.length.set(`${bpe.length} tokens${bpe.merges.length ? `, was ${bpe.startLength}` : ''}`)
    stats.ratio.set(`${bpe.compression.toFixed(2)}×`)
    stats.vocab.set(`${bpe.vocab.length} tokens`)
    const line = last ? explainMerge(last) : READY
    const cut = last ? line.indexOf(':') : -1
    say.replaceChildren(...(cut > 0 ? [h('b', null, line.slice(0, cut))] : []), cut > 0 ? line.slice(cut) : line)

    // The learner's sentence, split again with the merges learnt so far
    const pieces = bpe.encode(sentence)
    pieceEls = pieces.map((p, i) => {
      const b = h(
        'button',
        { type: 'button', class: `sim-part sim-bpe-piece${p.unknown ? ' bad' : ''}`, 'aria-label': `Token ${i + 1}: ${show(p.text)}, id ${p.id}` },
        chip(p.text, p.unknown ? 'bad' : last && p.id === last.id ? 'new' : p.id > bpe.alphabet ? 'made' : ''),
        h('i', { class: 'sim-bpe-id' }, p.unknown ? 'unk 0' : String(p.id))
      )
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        select(`token:${i + 1}`)
      })
      return b
    })
    // Grouped by word, so a word wraps whole
    const groups: HTMLElement[] = []
    pieces.forEach((p, i) => {
      if (!groups[p.word]) groups[p.word] = h('span', { class: 'sim-bpe-pword' })
      groups[p.word].append(pieceEls[i])
    })
    pieceList.replaceChildren(...(pieceEls.length ? groups.filter(Boolean) : [h('p', { class: 'sim-bpe-empty' }, 'Type a sentence above to see it split into tokens.')]))
    const wordCount = new Set(pieces.map((p) => p.word)).size
    pieceHint.textContent = pieces.length ? `${wordCount} word${wordCount === 1 ? '' : 's'}, ${pieces.length} token${pieces.length === 1 ? '' : 's'}` : ''
    const unknown = Array.from(new Set(pieces.filter((p) => p.unknown).map((p) => p.text)))
    unknownLine.hidden = !unknown.length
    unknownLine.textContent = unknown.length
      ? `${unknown.map((c) => `"${c}"`).join(', ')} never appeared in the training text, so ${unknown.length === 1 ? 'it has no token: it is' : 'they have no tokens: each is'} encoded as ${UNK}, id 0, and its spelling is lost. A tokeniser that starts from bytes can spell any character.`
      : ''
    mark(marked)
  }

  return {
    el,
    stepsPerSecond: () => 1,
    step() {
      bpe.step()
    },
    done: () => bpe.finished,
    reset() {
      // Learning starts again on the text in use; the sentence stays
      bpe = train(text, text === spec.text ? spec.start : 0)
      editing = false
      problem = ''
    },
    draw,
    relayout() {
      mark(marked)
    },
    describe(part) {
      const p = parseTokeniserPart(part, bpe, sentence)
      return p ? describeTokeniserPart(p, bpe, sentence) : null
    },
    highlight: mark,
    act(action) {
      if (typeof action.text === 'string') {
        const clean = tidy(action.text, BPE_LIMITS.text, spec.lowercase)
        if (clean) {
          text = clean
          bpe = train(text, 0)
          editing = false
        }
      }
      if (typeof action.sentence === 'string') {
        sentence = tidy(action.sentence, BPE_LIMITS.sentence, spec.lowercase)
        sentenceInput.value = sentence
      }
    }
  }
}

export const tokeniserKind: SimKindDef<TokeniserSpec> = {
  label: 'Byte-pair tokeniser',
  transport: true,
  autoplay: () => false,
  create
}
