/**
 * A short blockchain the learner can mine, tamper with and fork. Every hash on screen is a real
 * SHA-256 from the model (chain.ts); a step is one batch of nonces for each miner. Hashing is
 * asynchronous, so a step asks for a batch and the picture changes when it lands: the work is
 * done one batch at a time, in order, and stops while the window is hidden or the model is busy.
 */
import { BATCH, CHAIN_LIMITS, Chain, PREIMAGE_FORMAT, STATUS_WORD, describeBlockchainPart, expectedTries, parseBlockchainPart, preimage, shortHash, type Block, type BlockchainSpec, type Candidate } from '../chain'
import { button, h, ring, segmented, stat } from '../dom'
import type { SimHost, SimKindDef, SimView } from '../shell'

/** A piece of work: something to start (a change to the chain), then steps until it is done */
interface Task {
  start?: () => Promise<unknown>
  done: () => boolean
  started?: boolean
}

interface Card {
  el: HTMLElement
  title: HTMLButtonElement
  chip: HTMLElement
  link: HTMLButtonElement
  prev: HTMLElement
  input: HTMLInputElement
  miner: HTMLElement
  nonce: HTMLButtonElement
  nonceValue: HTMLElement
  hash: HTMLButtonElement
  hashValue: HTMLElement
  act: HTMLButtonElement
  aside: HTMLElement
  block: Block
}

/** Steps that may wait for their batch: fewer when each batch is large, so Pause never leaves seconds of work behind */
const maxOwed = (d: number) => Math.max(24, Math.min(600, Math.round(4800 / BATCH[d])))
const LEFT_OUT =
  'Left out: transactions and their Merkle tree, signatures, difficulty adjustment, and network delay (news of a block arrives at once, except in the forced fork). Real chains hash a binary header, Bitcoin twice over; here it is one SHA-256 of the text shown.'

const count = (n: number) => n.toLocaleString('en-GB')
const busy = () => document.hidden || document.documentElement.dataset.modelBusy === '1'

/** A hash with its leading zeros set apart, so the target can be seen being met */
function hashNodes(hash: string, shown: number): (Node | string)[] {
  const lead = /^0*/.exec(hash)?.[0].length ?? 0
  const cut = Math.min(lead, shown)
  return [h('b', null, hash.slice(0, cut)), hash.slice(cut, shown) + (shown < hash.length ? '…' : '')]
}

function create(spec: BlockchainSpec, host: SimHost): SimView {
  let model = new Chain(spec)
  let owed = 0
  let tasks: Task[] = []
  let pumping = false
  let dead = false
  let marked: string | null = null
  /** The block whose hashed text is written out (by id); null follows the tip */
  let focus: number | null = null
  let drawn = -1

  // ---------- The work: one batch at a time ----------
  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    let worked = false
    try {
      while (!dead && !busy() && !model.error) {
        const chain = model
        if (chain.ready) {
          const task = tasks[0]
          if (task && !task.started) {
            task.started = true
            worked = true
            await task.start?.()
            host.invalidate()
            continue
          }
          if (task?.done()) {
            tasks.shift()
            continue
          }
          if (!task && owed <= 0) break
          // Nothing left to mine: the remaining steps have nothing to do
          if (chain.full) {
            owed = 0
            tasks = []
            break
          }
        }
        if (owed > 0) owed--
        worked = true
        await chain.round()
        host.invalidate()
      }
    } finally {
      pumping = false
      if (!dead && worked) host.invalidate()
    }
  }
  const kick = () => void pump()
  const queue = (task: Task) => {
    tasks.push(task)
    kick()
  }
  // Work that stopped for a busy model or a hidden window picks up when that ends
  const watcher = new MutationObserver(kick)
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-model-busy'] })
  document.addEventListener('visibilitychange', kick)

  const mendTo = (height: number): Task => ({
    done: () => {
      const f = model.firstBroken()
      return !f || f.height > height
    }
  })

  function choose(part: string, block?: Block): void {
    if (block) focus = block.id
    host.select(part)
    host.invalidate()
  }

  // ---------- Controls ----------
  const levels = [1, 2, 3, 4].map((d) => [String(d), String(d)] as const)
  const difficulty = segmented('Difficulty', levels, String(spec.difficulty), (v) => queue({ start: () => model.setDifficulty(Number(v)), done: () => true }))
  difficulty.el.classList.add('sim-bc-level')
  const target = h('button', { type: 'button', class: 'sim-part sim-bc-target' })
  target.addEventListener('click', () => choose('difficulty'))
  const forkBtn = button('Mine a fork', () => queue({ start: () => model.fork(), done: () => !model.forcing }), 'quiet')
  forkBtn.title = 'Hold back news of the next block until each miner has found one'
  const params = h('div', { class: 'sim-params sim-bc-params' }, difficulty.el, target, forkBtn)

  // ---------- The chain ----------
  const grid = h('div', { class: 'sim-bc-grid' })
  const strip = h('div', { class: 'sim-bc-strip', tabindex: 0, role: 'group', 'aria-label': 'The chain of blocks, first block on the left' }, grid)
  const ghost = h('div', { class: 'sim-bc-card ghost' })
  const cards = new Map<number, Card>()

  function makeCard(block: Block): Card {
    const title = h('button', { type: 'button', class: 'sim-part sim-bc-title' })
    const chip = h('span', { class: 'sim-chip' })
    const prev = h('span', { class: 'sim-mono sim-bc-value' })
    const link = h('button', { type: 'button', class: 'sim-part sim-bc-row' }, h('span', { class: 'sim-bc-key' }, 'prev'), prev)
    const input = h('input', { type: 'text', class: 'sim-input sim-bc-data', maxlength: CHAIN_LIMITS.data, spellcheck: 'false', autocomplete: 'off' })
    const miner = h('span', { class: 'sim-bc-value' })
    const nonceValue = h('span', { class: 'sim-mono sim-bc-value' })
    const nonce = h('button', { type: 'button', class: 'sim-part sim-bc-row' }, h('span', { class: 'sim-bc-key' }, 'nonce'), nonceValue)
    const hashValue = h('span', { class: 'sim-mono sim-bc-value' })
    const hash = h('button', { type: 'button', class: 'sim-part sim-bc-row' }, h('span', { class: 'sim-bc-key' }, 'hash'), hashValue)
    const act = button('Tamper', () => undefined, 'quiet sim-bc-act')
    const aside = h('p', { class: 'sim-bc-aside' })
    const el = h(
      'div',
      { class: 'sim-bc-card' },
      h('div', { class: 'sim-bc-top' }, title, chip),
      link,
      h('label', { class: 'sim-bc-row' }, h('span', { class: 'sim-bc-key' }, 'data'), input),
      h('div', { class: 'sim-bc-row' }, h('span', { class: 'sim-bc-key' }, 'miner'), miner),
      nonce,
      hash,
      act,
      aside
    )
    const card: Card = { el, title, chip, link, prev, input, miner, nonce, nonceValue, hash, hashValue, act, aside, block }
    const name = (kind: string) => {
      const b = card.block
      const onMain = model.place(b) === 'main'
      return onMain ? `${kind}:${b.height}` : `orphan:${model.side().findIndex((x) => x.id === b.id) + 1}`
    }
    title.addEventListener('click', () => choose(name('block'), card.block))
    link.addEventListener('click', () => choose(name('link'), card.block))
    nonce.addEventListener('click', () => choose(name('nonce'), card.block))
    hash.addEventListener('click', () => choose(name('hash'), card.block))
    input.addEventListener('change', () => {
      const b = card.block
      if (model.place(b) === 'main') queue({ start: () => model.tamper(b.height, input.value), done: () => true })
    })
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur())
    act.addEventListener('click', () => {
      const b = card.block
      if (model.status(b) === 'valid') queue({ start: () => model.tamper(b.height), done: () => true })
      else queue(mendTo(b.height))
    })
    return card
  }

  function setText(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value
  }

  function setChip(node: HTMLElement, word: string, tone: '' | 'bad' | 'pos' | 'neg' | 'accent'): void {
    setText(node, word)
    const cls = `sim-chip${tone ? ` ${tone}` : ''}`
    if (node.className !== cls) node.className = cls
  }

  function drawChain(): void {
    const main = model.main()
    const onMain = new Set(main.map((b) => b.id))
    const side = model.side()
    const broken = model.firstBroken()
    const split = model.forcing || model.forkOpen
    const columns = Math.max(main.length + (model.ready ? 0 : 1), 1)
    grid.style.gridTemplateColumns = Array.from({ length: columns }, () => 'var(--bc-card)').join(' var(--bc-gap) ')
    for (const [id, card] of cards)
      if (model.blocks[id] !== card.block) {
        card.el.remove()
        cards.delete(id)
      }
    const links: HTMLElement[] = []
    for (const b of model.blocks) {
      let card = cards.get(b.id)
      if (!card) {
        card = makeCard(b)
        cards.set(b.id, card)
        grid.append(card.el)
      }
      const isMain = onMain.has(b.id)
      const status = model.status(b)
      const place = isMain ? 'main' : model.place(b)
      const linked = model.linkOk(b)
      card.el.style.gridColumn = String(2 * b.height - 1)
      card.el.style.gridRow = isMain ? '1' : '2'
      card.el.dataset.state = status !== 'valid' ? 'bad' : place === 'orphaned' ? 'stale' : 'ok'
      setText(card.title, `Block ${b.height}`)
      if (status !== 'valid') setChip(card.chip, STATUS_WORD[status], 'bad')
      else if (model.isHeld(b)) setChip(card.chip, 'unannounced', 'neg')
      else if (place === 'orphaned') setChip(card.chip, 'orphaned', '')
      else if (place === 'competing' || (split && !model.forcing && b.id === model.bestTip()?.id)) setChip(card.chip, 'competing', 'neg')
      else setChip(card.chip, b.remined ? 'valid again' : 'valid', 'pos')
      setText(card.prev, b.parent === null ? '0000000000…' : shortHash(b.prev))
      card.link.classList.toggle('bad', !linked)
      card.link.title = b.parent === null ? 'The first block records 64 zeros: nothing comes before it' : linked ? `Matches the hash of block ${b.height - 1}` : `Does not match the hash of block ${b.height - 1}`
      if (card.input.ownerDocument.activeElement !== card.input && card.input.value !== b.data) card.input.value = b.data
      card.input.disabled = !isMain || split
      card.input.setAttribute('aria-label', `Data of block ${b.height}`)
      setText(card.miner, b.miner)
      setText(card.nonceValue, String(b.nonce))
      const sealed = model.sealOk(b)
      card.hash.classList.toggle('bad', !sealed)
      card.hash.title = sealed ? `Starts with ${'0'.repeat(b.difficulty)}: meets its target` : `Does not start with ${'0'.repeat(b.difficulty)}: misses its target`
      if (card.hashValue.dataset.hash !== b.hash) {
        card.hashValue.dataset.hash = b.hash
        card.hashValue.replaceChildren(...hashNodes(b.hash, 10))
      }
      card.act.hidden = !isMain
      setText(card.act, status === 'valid' ? 'Tamper' : model.repair && broken?.id === b.id ? 'Mining again…' : 'Mine again')
      card.act.disabled = status === 'valid' ? split || !model.ready : false
      card.act.title = status === 'valid' ? (split ? 'Settle the fork first' : 'Change this block’s data and see what breaks') : broken?.id === b.id ? 'Search for a nonce that makes this block valid again' : `Mines block ${broken?.height ?? b.height} again first, then each block in turn up to this one`
      setText(card.aside, isMain ? '' : place === 'orphaned' ? 'Real work, but no one builds on it: it is not part of the chain.' : `${b.miner} saw this block first and builds on it.`)
      card.aside.hidden = isMain

      // The link into this block: straight along the chain, or dropping from the main row to a side block
      if (b.parent !== null) {
        const parentOnMain = onMain.has(b.parent)
        const elbow = !isMain && parentOnMain
        const mark = h('div', { class: `sim-bc-link${linked ? '' : ' bad'}${elbow ? ' elbow' : ''}`, 'aria-hidden': 'true' }, h('i'), h('span', null, linked ? 'linked' : 'broken'))
        mark.style.gridColumn = elbow ? `${2 * b.height - 3} / span 2` : String(2 * b.height - 2)
        mark.style.gridRow = isMain ? '1' : '2'
        links.push(mark)
      }
    }
    grid.querySelectorAll('.sim-bc-link').forEach((node) => node.remove())
    grid.append(...links)
    if (!model.ready) {
      const c = model.starting
      ghost.style.gridColumn = String(2 * (model.blocks.length + 1) - 1)
      ghost.style.gridRow = '1'
      setText(ghost, `Block ${model.blocks.length + 1}: mining…${c ? ` ${count(c.tries)} tries so far` : ''}`)
      if (!ghost.isConnected) grid.append(ghost)
    } else ghost.remove()
    grid.classList.toggle('forked', side.length > 0)
    // A new block is brought into view; the strip is otherwise left where the learner put it
    if (drawn !== model.blocks.length) {
      drawn = model.blocks.length
      strip.scrollLeft = strip.scrollWidth
    }
    edges()
  }

  /** Fades whichever side of the strip has more chain beyond it */
  function edges(): void {
    strip.classList.toggle('more-left', strip.scrollLeft > 8)
    strip.classList.toggle('more-right', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 8)
  }
  strip.addEventListener('scroll', edges, { passive: true })

  // ---------- What just happened, the miners, and what is hashed ----------
  const says = h('p', { class: 'sim-bc-says', 'aria-live': 'polite' })
  const minerRows = [0, 1].map((i) => {
    const what = h('span', { class: 'sim-bc-what' })
    const tried = h('span', { class: 'sim-mono sim-bc-tried' })
    const tally = h('span', { class: 'sim-bc-tally' })
    const name = h('span', { class: 'sim-chip' })
    const el = h('button', { type: 'button', class: 'sim-part sim-bc-miner' }, h('span', { class: 'sim-bc-who' }, name, what), tried, tally)
    el.addEventListener('click', () => choose(`miner:${i === 0 ? 'a' : 'b'}`))
    return { el, name, what, tried, tally }
  })
  const extra = { what: h('span', { class: 'sim-bc-what' }), tried: h('span', { class: 'sim-mono sim-bc-tried' }), tally: h('span', { class: 'sim-bc-tally' }), name: h('span', { class: 'sim-chip bad' }) }
  const extraRow = h('div', { class: 'sim-bc-miner' }, h('span', { class: 'sim-bc-who' }, extra.name, extra.what), extra.tried, extra.tally)
  const roundNote = h('span')
  const mining = h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Mining'), roundNote), extraRow, ...minerRows.map((r) => r.el))

  function showCandidate(row: { tried: HTMLElement; tally: HTMLElement }, c: Candidate | null, idle: string): void {
    if (!c || c.last < 0) {
      setText(row.tried, c ? 'no nonce tried yet' : idle)
      setText(row.tally, c ? `0 tries · about ${count(expectedTries(c.difficulty))} expected` : '')
      return
    }
    const range = c.first === c.last ? `nonce ${c.last}` : `nonces ${c.first}–${c.last}`
    setText(row.tried, `${range} → ${shortHash(c.lastHash, 12)} ${c.lastMet ? 'meets the target' : 'misses'}`)
    setText(row.tally, `${count(c.tries)} ${c.tries === 1 ? 'try' : 'tries'} · about ${count(expectedTries(c.difficulty))} expected`)
  }

  const hashedTitle = h('span')
  const hashedText = h('code', { class: 'sim-mono sim-bc-pre' })
  const hashedHash = h('code', { class: 'sim-mono sim-bc-pre' })
  const hashedShell = h('code', { class: 'sim-mono sim-bc-pre shell' })
  const hashedVerdict = h('p', { class: 'sim-note' })
  const hashed = h(
    'div',
    { class: 'sim-panel sim-bc-hashed' },
    h('div', { class: 'sim-panel-title' }, hashedTitle, h('span', null, 'SHA-256')),
    h('p', { class: 'sim-note' }, `The block's fields joined by "|" (${PREIMAGE_FORMAT}), as UTF-8 text:`),
    hashedText,
    h('p', { class: 'sim-note' }, 'Its SHA-256, the block’s hash:'),
    hashedHash,
    hashedVerdict,
    h('p', { class: 'sim-note' }, 'Check it in a terminal:'),
    hashedShell
  )
  const stats = { blocks: stat('Blocks on the chain'), tried: stat('Hashes tried'), rewriting: stat('Spent re-mining'), orphaned: stat('Orphaned blocks') }
  const log = h('ul', { class: 'sim-log sim-bc-log', 'aria-label': 'Earlier events, newest first' })
  const logBox = h('div', { class: 'sim-bc-earlier' }, h('span', { class: 'sim-label' }, 'Earlier'), log)
  let logged = ''
  const el = h(
    'div',
    { class: 'sim-bc' },
    params,
    strip,
    says,
    h('div', { class: 'sim-two sim-bc-two' }, h('div', { class: 'sim-stack' }, mining, h('div', { class: 'sim-stats' }, ...Object.values(stats).map((x) => x.el)), logBox), hashed),
    h('p', { class: 'sim-note sim-bc-note' }, LEFT_OUT)
  )

  function drawRest(): void {
    const d = model.difficulty
    difficulty.set(String(d))
    setText(target, `A block is valid when its hash starts with ${'0'.repeat(d)} (${d} zero hex digit${d === 1 ? '' : 's'}): 1 try in ${count(expectedTries(d))} does, so about ${count(expectedTries(d))} tries a block. A step tries ${BATCH[d] === 1 ? 'one nonce' : `${BATCH[d]} nonces`} for each miner.`)
    const broken = model.firstBroken()
    forkBtn.disabled = !model.ready || model.forcing || model.forkOpen || !!broken || model.height >= CHAIN_LIMITS.height
    setText(forkBtn, model.forcing ? 'Forking…' : 'Mine a fork')
    setText(says, model.says)
    says.classList.toggle('bad', !!model.error)

    setText(roundNote, model.rounds ? `step ${count(model.rounds)}` : '')
    const special = !model.ready ? model.starting : broken ? model.repair : null
    extraRow.hidden = model.ready && !broken
    if (!model.ready) {
      setChip(extra.name, 'start', '')
      setText(extra.what, `mining starting block ${model.blocks.length + 1} of ${spec.blocks.length}`)
    } else if (broken) {
      setChip(extra.name, 'rewrite', 'bad')
      setText(extra.what, `mining block ${broken.height} again${model.repair ? '' : ' (press Step, Play or Mine again)'}`)
    }
    if (!extraRow.hidden) showCandidate(extra, special, '')
    model.miners.forEach((m, i) => {
      const row = minerRows[i]
      setChip(row.name, m.name, '')
      if (!model.ready) {
        setText(row.what, 'waits for the starting blocks')
        showCandidate(row, null, '')
      } else if (broken) {
        setText(row.what, 'waits: miners build only on a valid chain')
        showCandidate(row, null, '')
      } else if (m.held !== null) {
        setText(row.what, `found block ${model.blocks[m.held].height}; the news is held back`)
        showCandidate(row, null, '')
      } else {
        const tip = model.blocks[m.tip]
        setText(row.what, `tries block ${tip.height + 1} on block ${tip.height} (${shortHash(tip.hash, 6)})`)
        showCandidate(row, m.cand, 'no nonce tried yet')
      }
    })

    const tip = model.bestTip()
    const shown = (focus !== null && model.blocks[focus]) || tip
    if (shown) {
      const source = preimage(shown)
      const sealed = model.sealOk(shown)
      setText(hashedTitle, `What is hashed: block ${shown.height}${model.place(shown) === 'main' ? '' : ` (${shown.miner}'s, off the main chain)`}`)
      setText(hashedText, source)
      if (hashedHash.dataset.hash !== shown.hash) {
        hashedHash.dataset.hash = shown.hash
        hashedHash.replaceChildren(...hashNodes(shown.hash, 64))
      }
      setText(hashedVerdict, sealed ? `It starts with ${'0'.repeat(shown.difficulty)}, so it meets the block's target (difficulty ${shown.difficulty}).` : `It does not start with ${'0'.repeat(shown.difficulty)}, so it misses the block's target (difficulty ${shown.difficulty}).`)
      hashedVerdict.classList.toggle('bad', !sealed)
      setText(hashedShell, `printf '%s' '${source}' | shasum -a 256`)
    } else {
      setText(hashedTitle, 'What is hashed')
      setText(hashedText, PREIMAGE_FORMAT)
      hashedHash.replaceChildren()
      delete hashedHash.dataset.hash
      setText(hashedVerdict, 'Nothing yet: the first block is still being mined.')
      setText(hashedShell, '')
    }

    stats.blocks.set(String(model.height))
    stats.tried.set(count(model.totalTries))
    stats.rewriting.set(count(model.rewriteTries))
    stats.orphaned.set(String(model.side().filter((b) => model.place(b) === 'orphaned').length))
    // Earlier events; the latest is the sentence above
    const earlier = model.events.slice(model.events[0] === model.says ? 1 : 0, 12)
    const key = `${model.events.length}:${earlier[0] ?? ''}`
    if (key !== logged) {
      logged = key
      log.replaceChildren(...earlier.map((line) => h('li', null, line)))
    }
    logBox.hidden = !earlier.length
  }

  function highlight(): void {
    const part = marked ? parseBlockchainPart(marked, model) : null
    const main = model.main()
    const side = model.side()
    const tipId = model.bestTip()?.id
    // The two blocks of a fork: what each miner builds on, once those differ
    const [a, b] = model.miners
    const rivals = (model.forkOpen || model.forcing) && a.tip !== b.tip ? [a.tip, b.tip] : []
    for (const [id, card] of cards) {
      const mainAt = main[card.block.height - 1]?.id === id ? card.block.height : 0
      const on = !!part && ((part.type === 'block' && part.n === mainAt) || (part.type === 'orphan' && side[part.n - 1]?.id === id) || (part.type === 'tip' && id === tipId) || (part.type === 'fork' && rivals.includes(id)))
      ring(card.el, on)
      ring(card.hash, part?.type === 'hash' && part.n === mainAt)
      ring(card.nonce, part?.type === 'nonce' && part.n === mainAt)
      ring(card.link, part?.type === 'link' && part.n === mainAt)
    }
    ring(difficulty.el, part?.type === 'difficulty')
    ring(forkBtn, part?.type === 'fork' && !rivals.length)
    minerRows.forEach((r, i) => ring(r.el, part?.type === 'miner' && part.i === i))
  }

  kick()

  return {
    el,
    stepsPerSecond: () => 6,
    done: () => model.error ?? (model.full ? `Stopped at ${CHAIN_LIMITS.height} blocks. Reset to start again.` : null),
    step() {
      owed = Math.min(owed + 1, maxOwed(model.difficulty))
      kick()
    },
    reset() {
      model = new Chain(spec)
      owed = 0
      tasks = []
      focus = null
      drawn = -1
      logged = ''
      kick()
    },
    draw() {
      drawChain()
      drawRest()
      highlight()
      // Work that was waiting (a hidden window, a busy model) goes on once the picture is being drawn again
      if ((owed > 0 || tasks.length || !model.ready) && !pumping) kick()
    },
    relayout() {
      edges()
    },
    describe(part) {
      const parsed = parseBlockchainPart(part, model)
      return parsed ? describeBlockchainPart(model, parsed) : null
    },
    highlight(part) {
      marked = part
      highlight()
    },
    act(action) {
      const { difficulty: level, tamper, repair, fork, mine } = action
      if (typeof level === 'number') queue({ start: () => model.setDifficulty(level), done: () => true })
      if (typeof tamper === 'number') queue({ start: () => model.tamper(Math.round(tamper)), done: () => true })
      if (typeof repair === 'number' || repair === true) queue(mendTo(repair === true ? CHAIN_LIMITS.height + 1 : Math.round(repair)))
      if (fork === true) queue({ start: () => model.fork(), done: () => !model.forcing })
      if (typeof mine === 'number' && mine >= 1) {
        let goal = Infinity
        queue({
          start: async () => (goal = Math.min(CHAIN_LIMITS.height, model.height + Math.min(CHAIN_LIMITS.mine, Math.round(mine)))),
          done: () => !model.firstBroken() && !model.forcing && model.height >= goal
        })
      }
    },
    destroy() {
      dead = true
      watcher.disconnect()
      document.removeEventListener('visibilitychange', kick)
    }
  }
}

export const blockchainKind: SimKindDef<BlockchainSpec> = {
  label: 'Blockchain',
  transport: true,
  autoplay: (spec) => spec.autoplay,
  create
}
