/**
 * Raft consensus, one event at a time: the nodes in a ring with their role, term, vote and
 * election timer, the messages travelling between them (and the ones that are dropped), every
 * node's log with what it knows to be committed, and a sentence for what just happened and the
 * rule that applied. The learner can stop and start nodes, cut and heal the network and submit
 * client commands. Everything shown is read from the model in ../raft.
 */
import { button, h, ring, s } from '../dom'
import { Raft, RAFT_LIMITS, describeRaftPart, parseRaftPart, type RaftBody, type RaftEvent, type RaftMessage, type RaftSpec } from '../raft'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../spec'

/** The ring is laid out in a box 400 wide (300 high, 258 for three nodes) and placed in percentages, so it needs no measuring */
const W = 400
const heightFor = (n: number) => (n === 3 ? 258 : 300)
/** A node's card in those units, at the narrowest the ring gets */
const CARD_W = 104
const CARD_H = 78

function ringLayout(n: number): [number, number][] {
  const cy = n === 3 ? 150 : 158
  const ry = n === 3 ? 104 : 110
  return Array.from({ length: n }, (_, i) => {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180
    return [200 + 142 * Math.cos(a), cy + ry * Math.sin(a)]
  })
}

/** What a message's pill says: RV and AE are the two calls, a tick or cross is a reply */
function pillText(b: RaftBody): string {
  switch (b.type) {
    case 'RequestVote':
      return 'RV'
    case 'RequestVoteReply':
      return b.voteGranted ? 'RV ✓' : 'RV ✗'
    case 'AppendEntries':
      return b.entries.length ? `AE ${b.entries.length}` : 'HB'
    case 'AppendEntriesReply':
      return b.success ? 'AE ✓' : 'AE ✗'
  }
}

const ROLE_WORD = { leader: 'Leader', candidate: 'Candidate', follower: 'Follower' } as const
const ROLE_CHIP = { leader: 'accent', candidate: 'neg', follower: '' } as const

/** The most steps a tour action waits for a leader to be elected */
const LEADER_WAIT = 600

/** "x=1" → "x=2": the command box moves on after each submit */
function nextCommand(cmd: string): string {
  const m = /^(.*?)(\d+)$/.exec(cmd)
  return m ? `${m[1]}${Number(m[2]) + 1}`.slice(0, RAFT_LIMITS.command) : cmd
}

function create(spec: RaftSpec, host: SimHost): SimView {
  let model = new Raft(spec)
  const n = model.n
  const pos = ringLayout(n)
  const H = heightFor(n)
  /** The node the Stop and Isolate buttons act on */
  let sel = 1
  let marked: string | null = null
  let shownEvent: RaftEvent | null = null
  let listedEvent: RaftEvent | null = null

  /** After something the learner did: the model has already said what happened */
  const act = (_event: RaftEvent): void => host.invalidate()

  // ---------- Controls ----------
  const nodeLabel = h('span', { class: 'sim-label' })
  const stopBtn = button('Stop', () => act(model.node(sel).up ? model.stop(sel) : model.start(sel)))
  const isolateBtn = button('Isolate', () => act(model.isolate(sel)))
  const isolateLeaderBtn = button('Isolate the leader', () => {
    const leader = model.leader()
    act(leader ? model.isolate(leader.id) : model.noLeader('isolate'))
  })
  const splitBtn = button('Split 2 | 3', () => {
    // The leader and its neighbour on one side, so the side that keeps going has to elect again
    const a = model.leader()?.id ?? 1
    act(model.partition([[a, (a % n) + 1]]))
  })
  const healBtn = button('Heal', () => act(model.heal()))
  const cmdInput = h('input', { type: 'text', class: 'sim-input sim-mono sim-rf-cmd', value: 'x=1', maxlength: RAFT_LIMITS.command, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Client command' })
  const submit = (): void => {
    const value = cmdInput.value
    // A selected node that believes it leads takes it (a cut-off leader of an old term too)
    const target = model.node(sel)
    const event = model.command(value, target.up && target.role === 'leader' ? sel : undefined)
    cmdInput.classList.toggle('bad', !event.ok && !value.trim())
    if (event.ok) cmdInput.value = nextCommand(value.trim())
    act(event)
  }
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    submit()
  })
  cmdInput.addEventListener('input', () => cmdInput.classList.remove('bad'))
  const submitBtn = button('Submit', submit)
  const params = h(
    'div',
    { class: 'sim-params' },
    h('div', { class: 'sim-field' }, nodeLabel, h('div', { class: 'sim-inline' }, stopBtn, isolateBtn)),
    h('div', { class: 'sim-field' }, h('span', { class: 'sim-label' }, 'Client command'), h('div', { class: 'sim-inline' }, cmdInput, submitBtn)),
    h('div', { class: 'sim-field' }, h('span', { class: 'sim-label' }, 'Network'), h('div', { class: 'sim-inline' }, isolateLeaderBtn, n === 5 ? splitBtn : null, healBtn))
  )

  // ---------- Stats ----------
  function statPart(label: string, part: string): { el: HTMLButtonElement; set(text: string): void } {
    const value = h('span', { class: 'sim-stat-value' }, '–')
    const el = h('button', { type: 'button', class: 'sim-stat sim-part sim-rf-stat' }, h('span', { class: 'sim-stat-label' }, label), value)
    el.addEventListener('click', () => host.select(part))
    return { el, set: (text) => void (value.textContent !== text && (value.textContent = text)) }
  }
  const stats = {
    clock: statPart('Clock', 'clock'),
    term: statPart('Term', 'term'),
    leader: statPart('Leader', 'leader'),
    commit: statPart('Committed', 'commit'),
    network: statPart('Network', 'network')
  }

  // ---------- The ring ----------
  const links: { a: number; b: number; el: SVGLineElement }[] = []
  const linkLayer = s('svg', { class: 'sim-rf-links', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' })
  for (let a = 1; a <= n; a++)
    for (let b = a + 1; b <= n; b++) {
      const el = s('line', { x1: pos[a - 1][0], y1: pos[a - 1][1], x2: pos[b - 1][0], y2: pos[b - 1][1] })
      links.push({ a, b, el })
      linkLayer.append(el)
    }

  const cards = model.nodes.map((node) => {
    const id = node.id
    const chip = h('span', { class: 'sim-chip' })
    const meta = h('span', { class: 'sim-rf-meta' })
    const main = h('button', { type: 'button', class: 'sim-rf-main sim-part' }, h('span', { class: 'sim-rf-top' }, h('span', { class: 'sim-rf-id' }, String(id)), chip), meta)
    main.addEventListener('click', () => {
      sel = id
      host.select(`node:${id}`)
      host.invalidate()
    })
    const fill = h('i')
    const ms = h('span', { class: 'sim-rf-ms' })
    const timer = h('button', { type: 'button', class: 'sim-rf-timer sim-part' }, h('span', { class: 'sim-rf-bar' }, fill), ms)
    timer.addEventListener('click', () => {
      sel = id
      host.select(`timer:${id}`)
      host.invalidate()
    })
    const el = h('div', { class: 'sim-rf-node', style: `left:${(pos[id - 1][0] / W) * 100}%;top:${(pos[id - 1][1] / H) * 100}%` }, main, timer)
    return { el, main, chip, meta, timer, fill, ms }
  })

  const pillLayer = h('div', { class: 'sim-rf-pills' })
  const pills = new Map<number, HTMLButtonElement>()
  const ringBox = h('div', { class: 'sim-rf-ring', role: 'group', 'aria-label': 'The cluster and the messages in flight' }, linkLayer, ...cards.map((c) => c.el), pillLayer)

  function placePill(el: HTMLElement, m: RaftMessage): void {
    const [x1, y1] = pos[m.from - 1]
    const [x2, y2] = pos[m.to - 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    // From the edge of one card to the edge of the other (cards are about CARD_W × CARD_H in the
    // ring's own units), a little to one side so a reply does not sit on its request
    const edge = Math.min(0.42, Math.min(CARD_W / 2 / Math.abs(dx || 1e-9), CARD_H / 2 / Math.abs(dy || 1e-9)) + 14 / len)
    const t = edge + (1 - 2 * edge) * model.progress(m)
    el.style.left = `${((x1 + dx * t - (dy / len) * 9) / W) * 100}%`
    el.style.top = `${((y1 + dy * t + (dx / len) * 9) / H) * 100}%`
  }

  function drawPills(): void {
    const live = new Map<number, [RaftMessage, boolean]>()
    for (const m of model.messages) live.set(m.id, [m, false])
    for (const d of model.drops) live.set(d.message.id, [d.message, true])
    for (const [id, el] of pills) {
      if (live.has(id)) continue
      // Keys must keep reaching the simulation when the focused message arrives
      if (document.activeElement === el) host.root.focus()
      el.remove()
      pills.delete(id)
    }
    for (const [id, [m, dropped]] of live) {
      let el = pills.get(id)
      if (!el) {
        const b = m.body
        const kind = b.type === 'RequestVote' || b.type === 'RequestVoteReply' ? 'vote' : 'append'
        const reply = b.type === 'RequestVoteReply' || b.type === 'AppendEntriesReply'
        const no = (b.type === 'RequestVoteReply' && !b.voteGranted) || (b.type === 'AppendEntriesReply' && !b.success)
        el = h('button', { type: 'button', class: `sim-rf-pill ${kind}${reply ? ' reply' : ''}${no ? ' no' : ''}`, title: `${b.type} from node ${m.from} to node ${m.to}` }, pillText(b))
        el.addEventListener('click', () => host.select(`message:${id}`))
        pills.set(id, el)
        pillLayer.append(el)
      }
      if (dropped && !el.classList.contains('dropped')) {
        el.classList.add('dropped')
        el.textContent = `× ${pillText(m.body)}`
        el.title = `Dropped: ${el.title}`
        el.disabled = true
      }
      placePill(el, m)
    }
  }

  // ---------- The logs ----------
  const nameCol = h('div', { class: 'sim-rf-col' }, h('span', { class: 'sim-rf-th' }, 'Node'))
  const indexRow = h('div', { class: 'sim-rf-indexes' })
  const scroll = h('div', { class: 'sim-rf-scroll', tabindex: 0, 'data-arrows': '', role: 'group', 'aria-label': 'Log entries by index' }, indexRow)
  const sideCol = h('div', { class: 'sim-rf-col side' }, h('span', { class: 'sim-rf-th' }, h('span', null, 'Commit'), h('span', { title: 'What the leader holds for this follower: nextIndex and matchIndex' }, 'Next / match')))
  const rows = model.nodes.map((node) => {
    const id = node.id
    const name = h('button', { type: 'button', class: 'sim-rf-name sim-part' }, `Node ${id}`)
    name.addEventListener('click', () => {
      sel = id
      host.select(`log:${id}`)
      host.invalidate()
    })
    const cells = h('div', { class: 'sim-rf-cells' })
    const commit = h('span', { class: 'sim-rf-num' })
    const next = h('span', { class: 'sim-rf-num' })
    const side = h('div', { class: 'sim-rf-side' }, commit, next)
    nameCol.append(name)
    scroll.append(cells)
    sideCol.append(side)
    return { name, cells, commit, next, side, entries: [] as { el: HTMLButtonElement; term: HTMLElement; cmd: HTMLElement }[], empty: h('span', { class: 'sim-rf-empty' }, 'empty') }
  })
  const logs = h('div', { class: 'sim-rf-logs' }, nameCol, scroll, sideCol)
  let longest = -1

  function drawLogs(): void {
    const top = model.leader()
    const most = Math.max(1, ...model.nodes.map((x) => x.log.length))
    if (most !== longest) {
      indexRow.replaceChildren(...Array.from({ length: most }, (_, i) => h('span', { class: 'sim-rf-index' }, String(i + 1))))
      // Keep the newest entries in view when a log grows
      if (most > longest && longest >= 0) scroll.scrollLeft = scroll.scrollWidth
      longest = most
    }
    model.nodes.forEach((node, k) => {
      const row = rows[k]
      row.name.classList.toggle('down', !node.up)
      row.cells.classList.toggle('down', !node.up)
      while (row.entries.length > node.log.length) {
        const gone = row.entries.pop()
        if (gone && document.activeElement === gone.el) host.root.focus()
        gone?.el.remove()
      }
      node.log.forEach((entry, i) => {
        let cell = row.entries[i]
        if (!cell) {
          const term = h('i', { class: 'sim-rf-term' })
          const cmd = h('span', { class: 'sim-rf-cmdtext' })
          const el = h('button', { type: 'button', class: 'sim-cell sim-rf-entry' }, term, cmd)
          el.addEventListener('click', () => host.select(`entry:${node.id}:${i + 1}`))
          cell = { el, term, cmd }
          row.entries.push(cell)
          row.cells.append(el)
        }
        const committed = node.up && i < node.commitIndex
        const termText = String(entry.term)
        if (cell.term.textContent !== termText) {
          cell.term.textContent = termText
          cell.el.style.setProperty('--sim-rf-tc', `var(--series-${((entry.term - 1) % 6) + 1})`)
        }
        if (cell.cmd.textContent !== entry.command) cell.cmd.textContent = entry.command
        cell.el.classList.toggle('committed', committed)
        cell.el.title = `Index ${i + 1}: ${entry.command}, term ${entry.term}, ${committed ? 'committed' : 'not committed'}`
      })
      if (!node.log.length && !row.empty.isConnected) row.cells.append(row.empty)
      else if (node.log.length && row.empty.isConnected) row.empty.remove()
      row.commit.textContent = node.up ? String(node.commitIndex) : '–'
      row.next.textContent = !top ? '–' : top.id === node.id ? 'leader' : `${top.nextIndex[k]} / ${top.matchIndex[k]}`
    })
  }

  // ---------- What just happened ----------
  const nowTime = h('span', { class: 'sim-mono' })
  const nowText = h('p', { class: 'sim-rf-say', 'aria-live': 'polite' })
  const now = h('div', { class: 'sim-panel sim-rf-now' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'What just happened'), nowTime), nowText)
  const eventList = h('ul', { class: 'sim-log sim-rf-events' })
  const msgCount = h('button', { type: 'button', class: 'sim-rf-count sim-part' })
  msgCount.addEventListener('click', () => host.select('messages'))

  function drawEvents(): void {
    const last = model.last
    if (last !== shownEvent) {
      shownEvent = last
      nowTime.textContent = `${last.time} ms`
      nowText.textContent = last.text
      now.classList.toggle('bad', !last.ok)
    }
    const newest = model.events[model.events.length - 1]
    if (newest === listedEvent) return
    listedEvent = newest
    eventList.replaceChildren(...model.events.slice(-24).reverse().map((event) => h('li', { class: event.ok ? '' : 'bad' }, h('span', { class: 'sim-rf-at sim-mono' }, String(event.time)), h('span', null, event.brief))))
  }

  const legend = h(
    'p',
    { class: 'sim-rf-legend' },
    h('span', null, h('i', { class: 'sim-rf-key vote' }, 'RV'), 'RequestVote'),
    h('span', null, h('i', { class: 'sim-rf-key append' }, 'AE 2'), 'AppendEntries with 2 entries'),
    h('span', null, h('i', { class: 'sim-rf-key append' }, 'HB'), 'heartbeat (an empty AppendEntries)'),
    h('span', null, h('i', { class: 'sim-rf-key append reply' }, '✓ ✗'), 'a reply'),
    h('span', null, h('i', { class: 'sim-rf-key dropped' }, '×'), 'dropped'),
    h('span', null, h('i', { class: 'sim-rf-key entry committed' }, '1'), 'committed entry, with its term'),
    h('span', null, h('i', { class: 'sim-rf-key entry' }, '1'), 'not yet committed')
  )

  const el = h(
    'div',
    { class: 'sim-rf', 'data-nodes': n },
    params,
    h('div', { class: 'sim-stats sim-rf-stats' }, ...Object.values(stats).map((x) => x.el)),
    h(
      'div',
      { class: 'sim-rf-grid' },
      h('div', { class: 'sim-stack' }, ringBox, now),
      h(
        'div',
        { class: 'sim-stack' },
        h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Logs'), h('span', null, 'index, term and command')), logs),
        h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Recent events'), msgCount), eventList)
      )
    ),
    legend,
    h(
      'p',
      { class: 'sim-note' },
      `Raft as in Figure 2 of the paper, on a simulated clock: heartbeats every ${spec.heartbeat} ms, election timeouts drawn from ${spec.election[0]} to ${spec.election[1]} ms, messages taking ${spec.latency[0]} to ${spec.latency[1]} ms${spec.loss ? ` with ${Math.round(spec.loss * 100)}% lost` : ''}. Left out: membership changes, snapshots, log compaction and the no-op entry a new leader may append, so an entry from an earlier term waits for a command in the leader's own term.`
    )
  )

  function mark(): void {
    const part = marked ? parseRaftPart(marked, model) : null
    const leaders = part?.type === 'leader' ? model.leaders().map((x) => x.id) : []
    cards.forEach((card, k) => {
      ring(card.el, (part?.type === 'node' && part.n === k + 1) || leaders.includes(k + 1))
      ring(card.timer, part?.type === 'timer' && part.n === k + 1)
    })
    rows.forEach((row, k) => {
      ring(row.name, part?.type === 'log' && part.n === k + 1)
      ring(row.cells, part?.type === 'log' && part.n === k + 1)
      row.entries.forEach((cell, i) => ring(cell.el, part?.type === 'entry' && part.n === k + 1 && part.i === i + 1))
    })
    ring(stats.leader.el, part?.type === 'leader')
    ring(stats.term.el, part?.type === 'term')
    ring(stats.commit.el, part?.type === 'commit')
    ring(stats.network.el, part?.type === 'network')
    ring(stats.clock.el, part?.type === 'clock')
    ring(ringBox, part?.type === 'messages')
    for (const [id, pill] of pills) ring(pill, part?.type === 'message' && part.id === id)
  }

  return {
    el,
    step() {
      model.step()
    },
    reset() {
      model = new Raft(spec)
      sel = 1
      longest = -1
      shownEvent = null
      listedEvent = null
      for (const pill of pills.values()) pill.remove()
      pills.clear()
      cmdInput.value = 'x=1'
      cmdInput.classList.remove('bad')
    },
    stepsPerSecond: () => 6,
    done: () => model.idle(),
    draw() {
      const leaders = model.leaders()
      const top = leaders[0] ?? null
      stats.clock.set(`${model.now} ms`)
      stats.term.set(String(model.maxTerm()))
      stats.leader.set(top ? `Node ${top.id}${leaders.length > 1 ? ` (and ${leaders.slice(1).map((x) => x.id).join(', ')})` : ''}` : 'None')
      stats.commit.set(String(model.maxCommit()))
      stats.network.set(model.partitioned ? model.sides().map((x) => x.join(' ')).join(' | ') : 'Whole')
      stats.network.el.classList.toggle('cut', model.partitioned)

      model.nodes.forEach((node, k) => {
        const card = cards[k]
        const state = node.up ? node.role : 'down'
        card.el.className = `sim-rf-node ${state}${sel === node.id ? ' sel' : ''}${model.last.node === node.id ? ' active' : ''}`
        card.chip.className = `sim-chip ${node.up ? ROLE_CHIP[node.role] : 'bad'}`.trim()
        card.chip.textContent = node.up ? ROLE_WORD[node.role] : 'Stopped'
        card.meta.textContent = `term ${node.term} · ${node.votedFor === null ? 'no vote' : `voted ${node.votedFor}`}`
        card.main.setAttribute('aria-pressed', sel === node.id ? 'true' : 'false')
        let share = 0
        let label = 'off'
        if (node.up && node.role === 'leader') {
          const left = node.heartbeatAt - model.now
          share = left / model.heartbeat
          label = `beat ${left}`
        } else if (node.up) {
          const left = model.timeLeft(node)
          share = node.electionSpan ? left / node.electionSpan : 0
          label = `${left} ms`
        }
        card.fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`
        card.ms.textContent = label
        const what = describeRaftPart(model, { type: 'timer', n: node.id }).label
        card.timer.setAttribute('aria-label', what)
        card.timer.title = what.charAt(0).toUpperCase() + what.slice(1)
      })
      for (const link of links) {
        const cut = !model.connected(link.a, link.b)
        const down = !model.node(link.a).up || !model.node(link.b).up
        link.el.setAttribute('class', cut ? 'cut' : down ? 'down' : '')
      }
      drawPills()
      drawLogs()
      drawEvents()
      const flying = model.messages.length
      msgCount.textContent = `${flying} in flight`

      const node = model.node(sel)
      nodeLabel.textContent = `Node ${sel}, ${node.up ? node.role : 'stopped'}`
      stopBtn.textContent = node.up ? 'Stop' : 'Start'
      isolateBtn.disabled = model.sides().some((side) => side.length === 1 && side[0] === sel)
      healBtn.disabled = !model.partitioned
      mark()
    },
    describe(part) {
      const parsed = parseRaftPart(part, model)
      return parsed ? describeRaftPart(model, parsed) : null
    },
    highlight(part) {
      marked = part
      mark()
    },
    act(action: TourAction) {
      // A step that needs a leader (a command, or "leader" as the node) runs on until there is
      // one, so a tour's words and the picture agree even if the step before had not finished
      const wantsLeader = action.command !== undefined || [action.stop, action.isolate, action.to].some((v) => typeof v === 'string' && v.trim().toLowerCase() === 'leader')
      for (let i = 0; wantsLeader && !model.leader() && !model.idle() && i < LEADER_WAIT; i++) model.step()
      const node = (ref: unknown, what: string, f: (id: number) => RaftEvent): void => {
        const id = model.refer(ref)
        if (id) f(id)
        else if (typeof ref === 'string' && ref.trim().toLowerCase() === 'leader') model.noLeader(what)
        else f(Number(ref) || 0)
      }
      if (action.heal) model.heal()
      const cut = action.partition
      if (Array.isArray(cut)) {
        const groups = (cut.some((x) => Array.isArray(x)) ? cut : [cut]) as unknown[]
        model.partition(groups.map((g) => (Array.isArray(g) ? g : [g]).map((x) => model.refer(x))))
      }
      if (action.isolate !== undefined) node(action.isolate, 'isolate', (id) => model.isolate(id))
      if (action.stop !== undefined) node(action.stop, 'stop', (id) => model.stop(id))
      if (action.start !== undefined) node(action.start, 'start', (id) => model.start(id))
      if (typeof action.command === 'string' || typeof action.command === 'number') {
        const cmd = String(action.command)
        if (action.to === undefined) model.command(cmd)
        else node(action.to, 'take the command', (id) => model.command(cmd, id))
      }
    }
  }
}

export const raftKind: SimKindDef<RaftSpec> = {
  label: 'Raft consensus',
  transport: true,
  autoplay: () => false,
  create
}
