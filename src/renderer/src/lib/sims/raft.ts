/**
 * Raft consensus as in Figure 2 of Ongaro and Ousterhout, "In Search of an Understandable
 * Consensus Algorithm": a cluster of 3 or 5 nodes on a simulated clock (whole simulated
 * milliseconds, nothing tied to wall time), with randomised election timeouts, heartbeats,
 * RequestVote and AppendEntries travelling with a seeded random latency, nodes that can be
 * stopped and started, and a network that can be cut and healed.
 *
 * Pure and deterministic: the same options and the same calls give the same run. One step()
 * handles the next event (a message arriving or being dropped, a timer running out), or lets
 * RAFT_LIMITS.tick milliseconds pass when nothing is due sooner. Every event carries a sentence
 * saying what happened and which rule applied.
 *
 * Not modelled: membership changes, snapshots and log compaction, the state machine itself, and
 * the no-op entry a new leader may append.
 */
import type { PartInfo } from './parts'
import { mulberry32 } from './rng'
import { clamp, int, num, onlyVerbs, pick, text, type Raw, type SimBase } from './specUtil'

export const RAFT_VERBS = ['stop', 'start', 'partition', 'isolate', 'heal', 'command', 'to'] as const

export const RAFT_LIMITS = {
  /** Characters in one command */
  command: 12,
  /** Commands a spec may queue for the client */
  queue: 8,
  /** Entries a log may hold (there is no compaction) */
  log: 32,
  /** The most simulated milliseconds one step lets pass */
  tick: 20,
  /** Events remembered for the list of recent events */
  events: 60
}

export type RaftScenario = 'fresh' | 'figure-8'

export interface RaftSpec extends SimBase {
  kind: 'raft'
  nodes: 3 | 5
  /** Milliseconds between a leader's heartbeats */
  heartbeat: number
  /** Election timeout range in milliseconds: each timer is drawn uniformly from it */
  election: [number, number]
  /** One-way message latency range in milliseconds */
  latency: [number, number]
  /** Probability that a message is lost in the network */
  loss: number
  scenario: RaftScenario
  /** Commands a client submits by itself, one at a time, whenever there is a leader */
  commands: string[]
}

/** A range given as [lo, hi], {min, max} or one number (which becomes [n, n × spread]) */
function range(v: unknown, fallback: [number, number], lo: number, hi: number, spread: number): [number, number] {
  let a: number
  let b: number
  if (Array.isArray(v) && v.length) {
    a = num(v[0], NaN, lo, hi)
    b = num(v.length > 1 ? v[1] : v[0], NaN, lo, hi)
  } else if (v && typeof v === 'object') {
    const o = v as Raw
    a = num(o.min ?? o.lo ?? o.from, NaN, lo, hi)
    b = num(o.max ?? o.hi ?? o.to, NaN, lo, hi)
  } else {
    a = num(v, NaN, lo, hi)
    b = Number.isNaN(a) ? NaN : clamp(a * spread, lo, hi)
  }
  if (Number.isNaN(a) && Number.isNaN(b)) return [fallback[0], fallback[1]]
  if (Number.isNaN(a)) a = Math.min(fallback[0], b)
  if (Number.isNaN(b)) b = Math.max(fallback[1], a)
  return [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))]
}

/** A client command as the logs show it: one short line */
export function cleanCommand(v: unknown): string {
  return text(typeof v === 'number' && Number.isFinite(v) ? String(v) : v, RAFT_LIMITS.command).trim()
}

export function parseRaftSpec(raw: Raw, base: SimBase): RaftSpec | null {
  const scenario = pick(raw.scenario ?? raw.start ?? raw.preset, ['fresh', 'figure-8'] as const, 'fresh', {
    figure8: 'figure-8',
    'fig-8': 'figure-8',
    fig8: 'figure-8',
    'figure-8-scenario': 'figure-8',
    new: 'fresh',
    empty: 'fresh'
  })
  const given = raw.nodes ?? raw.servers ?? raw.size ?? raw.n ?? raw.cluster
  const count = Array.isArray(given) ? given.length : num(given, 5, 1, 99)
  const heartbeat = int(raw.heartbeat ?? raw.heartbeatInterval ?? raw.heartbeat_interval, 50, 10, 500)
  const election = range(raw.election ?? raw.electionTimeout ?? raw.election_timeout ?? raw.timeout, [150, 300], 20, 5000, 2)
  // A timeout shorter than two heartbeats would depose a healthy leader
  election[0] = Math.max(election[0], heartbeat * 2)
  election[1] = Math.max(election[1], election[0])
  const lossGiven = num(raw.loss ?? raw.drop ?? raw.lossRate, 0, 0, 100)
  const queued = Array.isArray(raw.commands) ? raw.commands : raw.commands !== undefined ? [raw.commands] : []
  const spec: RaftSpec = {
    ...base,
    kind: 'raft',
    nodes: scenario === 'figure-8' ? 5 : count < 4 ? 3 : 5,
    heartbeat,
    election,
    latency: range(raw.latency ?? raw.delay, [15, 35], 1, 500, 1),
    // "20" means 20%
    loss: clamp(lossGiven > 1 ? lossGiven / 100 : lossGiven, 0, 0.5),
    scenario,
    commands: queued.map(cleanCommand).filter(Boolean).slice(0, RAFT_LIMITS.queue)
  }
  return onlyVerbs(spec, RAFT_VERBS)
}

// ---------- The model ----------

export type RaftRole = 'follower' | 'candidate' | 'leader'

export interface RaftEntry {
  term: number
  command: string
}

export interface RaftNode {
  /** Counted from 1 */
  id: number
  /** false while stopped */
  up: boolean
  // Persistent state: survives a stop and start
  term: number
  votedFor: number | null
  log: RaftEntry[]
  // Volatile state: lost when the node stops
  role: RaftRole
  commitIndex: number
  /** The node it last heard from as leader */
  leaderId: number | null
  /** Who has granted this candidate (or leader) its vote, itself included */
  votes: number[]
  /** Leader only, indexed by node id − 1: the next entry to send to each node */
  nextIndex: number[]
  /** Leader only: the highest entry known to be on each node */
  matchIndex: number[]
  // Timers, as times on the simulated clock
  electionAt: number
  /** The timeout that was drawn, for showing how much is left */
  electionSpan: number
  heartbeatAt: number
}

export interface RequestVote {
  type: 'RequestVote'
  term: number
  candidateId: number
  lastLogIndex: number
  lastLogTerm: number
}

export interface RequestVoteReply {
  type: 'RequestVoteReply'
  term: number
  voteGranted: boolean
}

export interface AppendEntries {
  type: 'AppendEntries'
  term: number
  leaderId: number
  prevLogIndex: number
  prevLogTerm: number
  entries: RaftEntry[]
  leaderCommit: number
}

/**
 * The paper's reply is (term, success), matched to its request by the RPC. Messages here travel
 * on their own, so the reply repeats what the request covered: on success the index of the last
 * entry now known to match, on failure the prevLogIndex that was refused.
 */
export interface AppendEntriesReply {
  type: 'AppendEntriesReply'
  term: number
  success: boolean
  index: number
}

export type RaftBody = RequestVote | RequestVoteReply | AppendEntries | AppendEntriesReply
export type DropReason = 'stopped' | 'partition' | 'loss'

export interface RaftMessage {
  id: number
  from: number
  to: number
  sentAt: number
  /** When it arrives, or when it is dropped on the way if doomed */
  arriveAt: number
  /** Set at sending when it will never arrive: cut off by the partition, or lost */
  doom?: 'partition' | 'loss'
  body: RaftBody
}

export interface RaftDrop {
  message: RaftMessage
  reason: DropReason
  /** The step it was dropped in */
  step: number
}

export type RaftEventKind = 'begin' | 'quiet' | 'timeout' | 'heartbeat' | 'deliver' | 'drop' | 'client' | 'stop' | 'start' | 'partition' | 'heal' | 'refused'

export interface RaftEvent {
  time: number
  kind: RaftEventKind
  /** The node it happened at, or 0 */
  node: number
  /** A sentence: what happened and the rule that applied */
  text: string
  /** One short line for the list of recent events */
  brief: string
  /** false when something the learner asked for could not be done */
  ok: boolean
  message?: RaftMessage
}

export interface RaftOptions {
  nodes: number
  heartbeat: number
  election: [number, number]
  latency: [number, number]
  loss: number
  seed: number
  /** Probability that a message is delivered twice (for tests) */
  duplicate?: number
  scenario?: RaftScenario
  commands?: string[]
}

const cap = (id: number) => `Node ${id}`
const low = (id: number) => `node ${id}`
const entries = (k: number) => (k === 1 ? '1 entry' : `${k} entries`)
const list = (ids: readonly number[]) => (ids.length === 1 ? `node ${ids[0]}` : `nodes ${ids.join(', ')}`)

/** What a message is called in a sentence */
export function messageName(body: RaftBody): string {
  switch (body.type) {
    case 'RequestVote':
      return 'RequestVote'
    case 'RequestVoteReply':
      return body.voteGranted ? 'vote' : 'refusal'
    case 'AppendEntries':
      return body.entries.length ? `AppendEntries (${entries(body.entries.length)})` : 'heartbeat'
    case 'AppendEntriesReply':
      return body.success ? 'AppendEntries reply (success)' : 'AppendEntries reply (rejected)'
  }
}

export class Raft {
  readonly n: number
  /** Votes or copies needed: more than half */
  readonly majority: number
  readonly nodes: RaftNode[]
  /** Simulated milliseconds since the start */
  now = 0
  steps = 0
  /** In flight, in the order they were sent */
  messages: RaftMessage[] = []
  /** Messages dropped in the last few steps */
  drops: RaftDrop[] = []
  /** Everything that happened except quiet ticks, oldest first */
  events: RaftEvent[] = []
  last: RaftEvent
  /** Which side of the network each node is on; all the same when the network is whole */
  group: number[]
  /** Commands the client has yet to submit */
  queue: string[]
  heartbeat: number
  election: [number, number]
  latency: [number, number]
  loss: number
  duplicate: number
  private rand: () => number
  private nextId = 1
  private clientAt = 0

  constructor(o: RaftOptions) {
    this.n = o.scenario === 'figure-8' ? 5 : o.nodes < 4 ? 3 : 5
    this.majority = Math.floor(this.n / 2) + 1
    this.heartbeat = o.heartbeat
    this.election = [o.election[0], Math.max(o.election[0], o.election[1])]
    this.latency = [o.latency[0], Math.max(o.latency[0], o.latency[1])]
    this.loss = o.loss
    this.duplicate = o.duplicate ?? 0
    this.rand = mulberry32(o.seed)
    this.queue = [...(o.commands ?? [])]
    this.group = new Array<number>(this.n).fill(0)
    this.nodes = Array.from({ length: this.n }, (_, i) => {
      const node: RaftNode = {
        id: i + 1,
        up: true,
        term: 0,
        votedFor: null,
        log: [],
        role: 'follower',
        commitIndex: 0,
        leaderId: null,
        votes: [],
        nextIndex: [],
        matchIndex: [],
        electionAt: 0,
        electionSpan: 0,
        heartbeatAt: Infinity
      }
      this.resetElection(node)
      return node
    })
    if (o.scenario === 'figure-8') {
      this.loadFigure8()
      this.last = {
        time: 0,
        kind: 'begin',
        node: 0,
        ok: true,
        brief: 'Figure 8 of the paper, part way through',
        text: 'Figure 8 of the paper, part way through. Nodes 1 and 2 hold y=2 from term 2 at index 2; node 5 was elected in term 3, took y=9 at the same index and is now stopped. Nodes 1 and 2 are still in term 2. Only a node whose log is at least as up to date as a majority can win the next election.'
      }
    } else {
      const words = this.n === 3 ? 'Three' : 'Five'
      this.last = {
        time: 0,
        kind: 'begin',
        node: 0,
        ok: true,
        brief: `${words} followers, term 0, empty logs`,
        text: `${words} nodes start as followers in term 0 with empty logs. Each waits for its own election timeout, drawn at random from ${this.election[0]} to ${this.election[1]} ms; the first to run out starts an election.`
      }
    }
    this.events.push(this.last)
  }

  /** The state after Figure 8 (b): entries from terms 2 and 3 compete for index 2 */
  private loadFigure8(): void {
    const a: RaftEntry = { term: 1, command: 'x=1' }
    const b: RaftEntry = { term: 2, command: 'y=2' }
    const c: RaftEntry = { term: 3, command: 'y=9' }
    const logs = [[a, b], [a, b], [a], [a], [a, c]]
    const terms = [2, 2, 3, 3, 3]
    const votes = [1, 1, 5, 5, 5]
    this.nodes.forEach((node, i) => {
      node.log = logs[i]
      node.term = terms[i]
      node.votedFor = votes[i]
      node.commitIndex = 1
    })
    const five = this.nodes[4]
    five.up = false
    five.commitIndex = 0
    five.electionAt = Infinity
    // Node 1 has just come back and is the first to time out
    const one = this.nodes[0]
    one.electionSpan = 40
    one.electionAt = 40
  }

  // ---------- Reading the state ----------

  node(id: number): RaftNode {
    return this.nodes[id - 1]
  }

  connected(a: number, b: number): boolean {
    return this.group[a - 1] === this.group[b - 1]
  }

  get partitioned(): boolean {
    return this.group.some((g) => g !== this.group[0])
  }

  /** The sides of the network, each a list of node ids */
  sides(): number[][] {
    const out = new Map<number, number[]>()
    this.group.forEach((g, i) => out.set(g, [...(out.get(g) ?? []), i + 1]))
    return [...out.values()]
  }

  /** Every running node that believes it is leader, newest term first */
  leaders(): RaftNode[] {
    return this.nodes.filter((x) => x.up && x.role === 'leader').sort((p, q) => q.term - p.term)
  }

  /** The running leader with the highest term, if there is one */
  leader(): RaftNode | null {
    return this.leaders()[0] ?? null
  }

  maxTerm(): number {
    return Math.max(...this.nodes.map((x) => x.term))
  }

  maxCommit(): number {
    return Math.max(...this.nodes.map((x) => x.commitIndex))
  }

  /** How many nodes hold this exact entry (same index and term) */
  copies(index: number, term: number): number {
    return this.nodes.filter((x) => x.log[index - 1]?.term === term).length
  }

  /** Milliseconds until a node's election timer runs out (Infinity for a leader or a stopped node) */
  timeLeft(node: RaftNode): number {
    return !node.up || node.role === 'leader' ? Infinity : Math.max(0, node.electionAt - this.now)
  }

  /** How far along its way a message is, from 0 to 1; a doomed one stops half way */
  progress(m: RaftMessage): number {
    const f = m.arriveAt > m.sentAt ? clamp((this.now - m.sentAt) / (m.arriveAt - m.sentAt), 0, 1) : 1
    return m.doom ? f * 0.5 : f
  }

  /** The node a tour or control names: a number from 1, or "leader" for the current leader. 0 if there is none. */
  refer(ref: unknown): number {
    if (typeof ref === 'string' && ref.trim().toLowerCase() === 'leader') return this.leader()?.id ?? 0
    const id = typeof ref === 'number' ? ref : typeof ref === 'string' && ref.trim() !== '' ? Number(ref.replace(/^node\s*/i, '')) : NaN
    return this.known(id) ? id : 0
  }

  /** Says that something asked of "the leader" cannot be done because there is none */
  noLeader(what: string): RaftEvent {
    return this.refuse(`There is no leader to ${what} at the moment: run on until an election finishes.`, `No leader to ${what}`)
  }

  /** A reason there is nothing to run, or null */
  idle(): string | null {
    return this.nodes.every((x) => !x.up) && !this.messages.length ? 'Every node is stopped: start one to go on' : null
  }

  // ---------- Plumbing ----------

  private emit(kind: RaftEventKind, node: number, sentence: string, brief: string, ok = true, message?: RaftMessage): RaftEvent {
    const event: RaftEvent = { time: this.now, kind, node, text: sentence, brief, ok, message }
    this.last = event
    if (kind !== 'quiet') {
      this.events.push(event)
      if (this.events.length > RAFT_LIMITS.events) this.events.shift()
    }
    return event
  }

  private between(lo: number, hi: number): number {
    return lo + Math.floor(this.rand() * (hi - lo + 1))
  }

  private resetElection(node: RaftNode): void {
    node.electionSpan = this.between(this.election[0], this.election[1])
    node.electionAt = this.now + node.electionSpan
  }

  private send(from: number, to: number, body: RaftBody): void {
    const copies = this.duplicate > 0 && this.rand() < this.duplicate ? 2 : 1
    for (let k = 0; k < copies; k++) {
      const latency = this.between(this.latency[0], this.latency[1])
      const m: RaftMessage = { id: this.nextId++, from, to, sentAt: this.now, arriveAt: this.now + latency, body }
      if (!this.connected(from, to)) m.doom = 'partition'
      else if (this.loss > 0 && this.rand() < this.loss) m.doom = 'loss'
      // A doomed message gets half way
      if (m.doom) m.arriveAt = this.now + Math.max(1, Math.ceil(latency / 2))
      this.messages.push(m)
    }
  }

  private lastTerm(node: RaftNode): number {
    return node.log.length ? node.log[node.log.length - 1].term : 0
  }

  /**
   * Any message carrying a higher term makes the receiver a follower in that term (Figure 2,
   * rules for all servers). Returns the sentence that says so, or ''.
   */
  private seeTerm(node: RaftNode, term: number, from: number): string {
    if (term <= node.term) return ''
    const old = node.term
    const was = node.role
    node.term = term
    node.votedFor = null
    node.role = 'follower'
    node.votes = []
    node.leaderId = null
    node.heartbeatAt = Infinity
    // A leader has no election timer running, so it needs one again
    if (was === 'leader') this.resetElection(node)
    return `${cap(node.id)} sees term ${term} from ${low(from)}, higher than its own ${old}: it moves to term ${term}${was === 'follower' ? ' and forgets its old vote' : ` and steps down from ${was} to follower`}. `
  }

  // ---------- Elections ----------

  private startElection(node: RaftNode): RaftEvent {
    const again = node.role === 'candidate'
    node.term++
    node.role = 'candidate'
    node.votedFor = node.id
    node.votes = [node.id]
    node.leaderId = null
    this.resetElection(node)
    const lastLogIndex = node.log.length
    const lastLogTerm = this.lastTerm(node)
    for (const peer of this.nodes) if (peer.id !== node.id) this.send(node.id, peer.id, { type: 'RequestVote', term: node.term, candidateId: node.id, lastLogIndex, lastLogTerm })
    const why = again ? `${cap(node.id)}'s election timer ran out before it won or heard from a leader` : `${cap(node.id)}'s election timer ran out with no word from a leader`
    return this.emit(
      'timeout',
      node.id,
      `${why}: it becomes a candidate in term ${node.term}, votes for itself and asks the others for their votes (RequestVote with its last log index ${lastLogIndex} and term ${lastLogTerm}).`,
      `${node.id} times out: candidate, term ${node.term}`
    )
  }

  private becomeLeader(node: RaftNode): void {
    node.role = 'leader'
    node.leaderId = node.id
    node.electionAt = Infinity
    node.nextIndex = this.nodes.map(() => node.log.length + 1)
    node.matchIndex = this.nodes.map((peer) => (peer.id === node.id ? node.log.length : 0))
    this.broadcast(node)
  }

  private onRequestVote(node: RaftNode, m: RaftMessage, b: RequestVote): RaftEvent {
    const pre = this.seeTerm(node, b.term, m.from)
    const myIndex = node.log.length
    const myTerm = this.lastTerm(node)
    let refusal = ''
    if (b.term < node.term) refusal = `the request is from term ${b.term}, older than its own term ${node.term}`
    else if (node.votedFor !== null && node.votedFor !== b.candidateId)
      refusal = `it has already voted for ${node.votedFor === node.id ? 'itself' : low(node.votedFor)} in term ${node.term}, and a node gives one vote per term`
    else if (!(b.lastLogTerm > myTerm || (b.lastLogTerm === myTerm && b.lastLogIndex >= myIndex)))
      refusal = `${low(b.candidateId)}'s log (last entry from term ${b.lastLogTerm}, length ${b.lastLogIndex}) is behind its own (term ${myTerm}, length ${myIndex}), so it could be missing committed entries: the election restriction`
    const granted = !refusal
    if (granted) {
      node.votedFor = b.candidateId
      this.resetElection(node)
    }
    this.send(node.id, m.from, { type: 'RequestVoteReply', term: node.term, voteGranted: granted })
    const sentence = granted
      ? `${cap(node.id)} grants ${low(b.candidateId)} its vote for term ${node.term}: it has not voted for anyone else in this term, and ${low(b.candidateId)}'s log is at least as up to date as its own. It resets its election timer.`
      : `${cap(node.id)} refuses ${low(b.candidateId)}'s request for a vote: ${refusal}.`
    return this.emit('deliver', node.id, pre + sentence, `${m.from} → ${m.to} RequestVote, term ${b.term}: ${granted ? 'granted' : 'refused'}`, true, m)
  }

  private onVoteReply(node: RaftNode, m: RaftMessage, b: RequestVoteReply): RaftEvent {
    const pre = this.seeTerm(node, b.term, m.from)
    const brief = `${m.from} → ${m.to} ${b.voteGranted ? 'vote' : 'refusal'}`
    if (pre) return this.emit('deliver', node.id, `${pre}Its election in the older term is over.`, `${brief}: ${node.id} steps down, term ${node.term}`, true, m)
    if (node.role !== 'candidate' || b.term !== node.term) {
      const why = node.role === 'leader' && b.term === node.term ? 'it has already won this election' : 'that election is over'
      return this.emit('deliver', node.id, `${cap(node.id)} ignores a late reply from ${low(m.from)}: ${why}.`, `${brief}: ignored, too late`, true, m)
    }
    if (!b.voteGranted)
      return this.emit('deliver', node.id, `${cap(m.from)} refused ${low(node.id)}, which still has ${node.votes.length} of ${this.n} votes and needs ${this.majority}.`, `${brief}: ${node.votes.length} of ${this.n}`, true, m)
    if (!node.votes.includes(m.from)) node.votes.push(m.from)
    const have = node.votes.length
    if (have < this.majority)
      return this.emit('deliver', node.id, `${cap(node.id)} now has ${have} of ${this.n} votes for term ${node.term}; it needs ${this.majority}, a majority.`, `${brief}: ${have} of ${this.n}`, true, m)
    this.becomeLeader(node)
    return this.emit(
      'deliver',
      node.id,
      `${cap(node.id)} has ${have} of ${this.n} votes, a majority: it becomes leader for term ${node.term}. It sets nextIndex to ${node.log.length + 1} for every follower and sends heartbeats at once so that no other election starts.`,
      `${brief}: ${node.id} becomes leader, term ${node.term}`,
      true,
      m
    )
  }

  // ---------- Replication ----------

  private sendAppend(leader: RaftNode, to: number): void {
    const prevLogIndex = leader.nextIndex[to - 1] - 1
    this.send(leader.id, to, {
      type: 'AppendEntries',
      term: leader.term,
      leaderId: leader.id,
      prevLogIndex,
      prevLogTerm: prevLogIndex > 0 ? leader.log[prevLogIndex - 1].term : 0,
      entries: leader.log.slice(prevLogIndex),
      leaderCommit: leader.commitIndex
    })
  }

  /** AppendEntries to every other node: a heartbeat for those up to date, entries for the rest */
  private broadcast(leader: RaftNode): void {
    for (const peer of this.nodes) if (peer.id !== leader.id) this.sendAppend(leader, peer.id)
    leader.heartbeatAt = this.now + this.heartbeat
  }

  private onAppendEntries(node: RaftNode, m: RaftMessage, b: AppendEntries): RaftEvent {
    const what = b.entries.length ? 'AppendEntries' : 'heartbeat'
    const brief = `${m.from} → ${m.to} ${b.entries.length ? `AppendEntries (${entries(b.entries.length)})` : 'heartbeat'}`
    if (b.term < node.term) {
      this.send(node.id, m.from, { type: 'AppendEntriesReply', term: node.term, success: false, index: b.prevLogIndex })
      return this.emit(
        'deliver',
        node.id,
        `${cap(node.id)} rejects ${low(m.from)}'s ${what}: it is from term ${b.term}, older than its own term ${node.term}. Its reply carries term ${node.term}, which will make ${low(m.from)} step down.`,
        `${brief}: rejected, old term ${b.term}`,
        true,
        m
      )
    }
    let pre = this.seeTerm(node, b.term, m.from)
    if (node.role !== 'follower') {
      // A candidate that hears from the leader of its own term gives up its election
      pre += `${cap(node.id)}, a ${node.role} in term ${node.term}, hears from that term's leader and returns to follower. `
      node.role = 'follower'
      node.votes = []
      node.heartbeatAt = Infinity
    }
    node.leaderId = b.leaderId
    this.resetElection(node)
    const P = b.prevLogIndex
    let mismatch = ''
    if (P > node.log.length) mismatch = `it has no entry at index ${P} (its log has ${entries(node.log.length)}), so it cannot tell that the two logs agree up to there`
    else if (P > 0 && node.log[P - 1].term !== b.prevLogTerm) mismatch = `its entry at index ${P} is from term ${node.log[P - 1].term}, but the leader's is from term ${b.prevLogTerm}`
    if (mismatch) {
      this.send(node.id, m.from, { type: 'AppendEntriesReply', term: node.term, success: false, index: P })
      return this.emit('deliver', node.id, `${pre}${cap(node.id)} rejects ${low(m.from)}'s ${what}: ${mismatch} (the consistency check). It still resets its election timer, because the leader is current.`, `${brief}: rejected at index ${P}`, true, m)
    }
    // Delete a conflicting entry and all that follow it, then append what is missing
    let cutFrom = 0
    let added = 0
    b.entries.forEach((entry, i) => {
      const index = P + 1 + i
      const mine = node.log[index - 1]
      if (mine && mine.term !== entry.term) {
        cutFrom = index
        node.log.length = index - 1
      }
      if (node.log.length < index) {
        node.log.push(entry)
        added++
      }
    })
    const lastNew = P + b.entries.length
    let learned = ''
    const target = Math.min(b.leaderCommit, lastNew)
    if (target > node.commitIndex) {
      node.commitIndex = target
      learned = ` The leader has committed up to index ${b.leaderCommit}, so it sets its commit index to ${target} (the smaller of that and its last new entry, ${lastNew}).`
    }
    this.send(node.id, m.from, { type: 'AppendEntriesReply', term: node.term, success: true, index: lastNew })
    const match = P > 0 ? `its log matches the leader's at index ${P} (term ${b.prevLogTerm})` : 'there is nothing before index 1 to check'
    let did: string
    if (!b.entries.length) did = `${cap(node.id)} accepts ${low(m.from)}'s heartbeat (${match}) and resets its election timer.`
    else if (cutFrom) did = `${cap(node.id)}'s entry at index ${cutFrom} conflicts with the leader's (a different term), so it deletes it and everything after it, then appends ${entries(added)} from ${low(m.from)}; ${match}.`
    else if (added) did = `${cap(node.id)} appends ${entries(added)} from ${low(m.from)} (up to index ${lastNew}): ${match}. It resets its election timer.`
    else did = `${cap(node.id)} already holds the entries ${low(m.from)} sent (up to index ${lastNew}) and changes nothing; ${match}.`
    const result = !b.entries.length ? 'accepted' : cutFrom ? `conflict from index ${cutFrom} replaced` : added ? `appended to index ${lastNew}` : 'already held'
    return this.emit('deliver', node.id, pre + did + learned, `${brief}: ${result}${learned ? `, commit ${target}` : ''}`, true, m)
  }

  /**
   * The leader's commit rule: the highest index held by a majority, and only if that entry is
   * from the leader's current term. Entries from earlier terms are committed with it, never by
   * counting their own copies (Figure 8). Returns a sentence, or ''.
   */
  private advanceCommit(leader: RaftNode): string {
    for (let N = leader.log.length; N > leader.commitIndex; N--) {
      const held = this.nodes.filter((peer) => (peer.id === leader.id ? leader.log.length : leader.matchIndex[peer.id - 1]) >= N).length
      if (held < this.majority) continue
      const term = leader.log[N - 1].term
      if (term !== leader.term)
        return ` Index ${N} is on ${held} of ${this.n} nodes, a majority, but it is from term ${term}, not the current term ${leader.term}: a leader never commits an earlier term's entry by counting copies (Figure 8). It will be committed once an entry from term ${leader.term} after it is on a majority.`
      const from = leader.commitIndex + 1
      leader.commitIndex = N
      return ` Index ${N} is now on ${held} of ${this.n} nodes, a majority, and is from the current term ${term}: ${low(leader.id)} commits ${from === N ? 'it' : `entries ${from} to ${N}`}. The followers will learn of it from the next AppendEntries.`
    }
    return ''
  }

  private onAppendReply(node: RaftNode, m: RaftMessage, b: AppendEntriesReply): RaftEvent {
    const brief = `${m.from} → ${m.to} reply`
    const pre = this.seeTerm(node, b.term, m.from)
    if (pre) return this.emit('deliver', node.id, `${pre}There is a newer leader or election, so it stops acting as leader.`, `${brief}: ${node.id} steps down, term ${node.term}`, true, m)
    if (node.role !== 'leader' || b.term !== node.term)
      return this.emit('deliver', node.id, `${cap(node.id)} ignores a late AppendEntries reply from ${low(m.from)}: ${node.role === 'leader' ? 'it is from an older term' : 'it is no longer leader'}.`, `${brief}: ignored, too late`, true, m)
    const at = m.from - 1
    if (b.success) {
      const before = node.matchIndex[at]
      node.matchIndex[at] = Math.max(before, b.index)
      node.nextIndex[at] = Math.max(node.nextIndex[at], node.matchIndex[at] + 1)
      const was = node.commitIndex
      const committed = this.advanceCommit(node)
      const behind = node.nextIndex[at] <= node.log.length
      if (behind) this.sendAppend(node, m.from)
      const news =
        node.matchIndex[at] > before
          ? `${cap(node.id)} learns that ${low(m.from)} holds its log up to index ${node.matchIndex[at]}: matchIndex ${node.matchIndex[at]}, nextIndex ${node.nextIndex[at]}.`
          : `${cap(m.from)} confirms to ${low(node.id)} that it is still in step (matchIndex ${node.matchIndex[at]}).`
      return this.emit(
        'deliver',
        node.id,
        news + committed + (behind ? ` ${cap(m.from)} still lacks entries from index ${node.nextIndex[at]}, so the leader sends them now.` : ''),
        `${brief}: success, match ${node.matchIndex[at]}${node.commitIndex > was ? `, ${node.id} commits ${node.commitIndex}` : ''}`,
        true,
        m
      )
    }
    // Rejected: back nextIndex off by one and try again, but only for the request that is current
    const floor = node.matchIndex[at] + 1
    if (b.index === node.nextIndex[at] - 1 && node.nextIndex[at] > floor) {
      node.nextIndex[at]--
      this.sendAppend(node, m.from)
      return this.emit(
        'deliver',
        node.id,
        `${cap(m.from)} rejected the entries after index ${b.index}: its log does not match ${low(node.id)}'s there. ${cap(node.id)} backs nextIndex for ${low(m.from)} off to ${node.nextIndex[at]} and tries again one entry earlier.`,
        `${brief}: rejected, next ${node.nextIndex[at]}`,
        true,
        m
      )
    }
    return this.emit('deliver', node.id, `${cap(node.id)} ignores a rejection from ${low(m.from)} for index ${b.index}: it has already moved nextIndex to ${node.nextIndex[at]}.`, `${brief}: rejection ignored, out of date`, true, m)
  }

  // ---------- The clock ----------

  private drop(m: RaftMessage, reason: DropReason): RaftEvent {
    this.drops.push({ message: m, reason, step: this.steps })
    const why = reason === 'stopped' ? `${low(m.to)} is stopped` : reason === 'partition' ? 'the network is cut between them' : 'it is lost in the network'
    const name = messageName(m.body)
    return this.emit('drop', m.to, `${cap(m.from)}'s ${name} to ${low(m.to)} is dropped: ${why}.`, `${m.from} → ${m.to} ${name} dropped (${reason === 'loss' ? 'lost' : reason})`, true, m)
  }

  private arrive(m: RaftMessage): RaftEvent {
    this.messages.splice(this.messages.indexOf(m), 1)
    const node = this.node(m.to)
    if (m.doom) return this.drop(m, m.doom)
    if (!node.up) return this.drop(m, 'stopped')
    if (!this.connected(m.from, m.to)) return this.drop(m, 'partition')
    switch (m.body.type) {
      case 'RequestVote':
        return this.onRequestVote(node, m, m.body)
      case 'RequestVoteReply':
        return this.onVoteReply(node, m, m.body)
      case 'AppendEntries':
        return this.onAppendEntries(node, m, m.body)
      case 'AppendEntriesReply':
        return this.onAppendReply(node, m, m.body)
    }
  }

  /** The next timer to run out, if any: [node, time] */
  private nextTimer(): [RaftNode, number] | null {
    let best: [RaftNode, number] | null = null
    for (const node of this.nodes) {
      if (!node.up) continue
      const at = node.role === 'leader' ? node.heartbeatAt : node.electionAt
      if (!best || at < best[1]) best = [node, at]
    }
    return best
  }

  /**
   * One step: the client's next queued command if there is a leader to take it; otherwise the
   * next message to arrive or timer to run out; otherwise up to RAFT_LIMITS.tick milliseconds of
   * waiting. Messages go before timers due at the same instant, older messages first.
   */
  step(): RaftEvent {
    this.steps++
    this.drops = this.drops.filter((d) => d.step >= this.steps - 2)
    if (this.queue.length && this.now >= this.clientAt && this.leader()) {
      this.clientAt = this.now + this.heartbeat * 2
      return this.command(this.queue.shift() as string)
    }
    let message: RaftMessage | null = null
    for (const m of this.messages) if (!message || m.arriveAt < message.arriveAt) message = m
    const timer = this.nextTimer()
    const due = Math.min(message?.arriveAt ?? Infinity, timer?.[1] ?? Infinity)
    if (due > this.now + RAFT_LIMITS.tick) {
      this.now += RAFT_LIMITS.tick
      const flying = this.messages.length
      const next = this.nodes.filter((x) => x.up && x.role !== 'leader').sort((p, q) => p.electionAt - q.electionAt)[0]
      const waiting = !timer
        ? 'Every node is stopped, so nothing can happen until one is started.'
        : flying
          ? `${flying === 1 ? '1 message is' : `${flying} messages are`} still on the way.`
          : next
            ? `Nothing is in flight; the election timers run down. ${cap(next.id)}'s is the next to run out, in ${next.electionAt - this.now} ms.`
            : 'Nothing is in flight.'
      return this.emit('quiet', 0, `${RAFT_LIMITS.tick} ms pass. ${waiting}`, `${RAFT_LIMITS.tick} ms pass`)
    }
    this.now = Math.max(this.now, due)
    if (message && message.arriveAt <= due) return this.arrive(message)
    const node = (timer as [RaftNode, number])[0]
    if (node.role !== 'leader') return this.startElection(node)
    this.broadcast(node)
    return this.emit(
      'heartbeat',
      node.id,
      `${cap(node.id)}'s heartbeat interval (${this.heartbeat} ms) is up: as leader it sends AppendEntries to every other node, empty for those that are up to date and carrying the missing entries for the rest. Each one resets the receiver's election timer.`,
      `${node.id} sends heartbeats, term ${node.term}`
    )
  }

  // ---------- What the learner (or a tour) does ----------

  private refuse(sentence: string, brief: string): RaftEvent {
    return this.emit('refused', 0, sentence, brief, false)
  }

  private known(id: number): boolean {
    return Number.isInteger(id) && id >= 1 && id <= this.n
  }

  stop(id: number): RaftEvent {
    if (!this.known(id)) return this.refuse(`There is no node ${id}: the nodes are 1 to ${this.n}.`, `No node ${id}`)
    const node = this.node(id)
    if (!node.up) return this.refuse(`${cap(id)} is already stopped.`, `${id} is already stopped`)
    const was = node.role
    node.up = false
    // Everything held in memory goes; term, vote and log are on disk
    node.role = 'follower'
    node.commitIndex = 0
    node.leaderId = null
    node.votes = []
    node.nextIndex = []
    node.matchIndex = []
    node.electionAt = Infinity
    node.heartbeatAt = Infinity
    const lost = was === 'leader' ? ' The others stop hearing heartbeats, and the first election timer to run out starts an election.' : ''
    return this.emit('stop', id, `${cap(id)} stops${was === 'follower' ? '' : ` while ${was}`}. Messages sent to it are dropped. It keeps on disk its term (${node.term}), its vote and its ${entries(node.log.length)}.${lost}`, `${id} stops`)
  }

  start(id: number): RaftEvent {
    if (!this.known(id)) return this.refuse(`There is no node ${id}: the nodes are 1 to ${this.n}.`, `No node ${id}`)
    const node = this.node(id)
    if (node.up) return this.refuse(`${cap(id)} is already running.`, `${id} is already running`)
    node.up = true
    node.role = 'follower'
    node.commitIndex = 0
    this.resetElection(node)
    const vote = node.votedFor === null ? 'no vote' : `its vote for ${node.votedFor === id ? 'itself' : low(node.votedFor)}`
    return this.emit(
      'start',
      id,
      `${cap(id)} starts again as a follower with what it saved to disk: term ${node.term}, ${vote} and ${entries(node.log.length)}. What it held in memory is gone, so its commit index is 0 until a leader tells it otherwise.`,
      `${id} starts, term ${node.term}`
    )
  }

  /**
   * Cuts the network into the given sides (lists of node ids); nodes not listed form one more
   * side together. A message already in flight across the new cut is dropped when it arrives.
   */
  partition(groups: readonly (readonly number[])[]): RaftEvent {
    const group = new Array<number>(this.n).fill(-1)
    let side = 0
    for (const ids of groups) {
      let used = false
      for (const id of ids)
        if (this.known(id) && group[id - 1] === -1) {
          group[id - 1] = side
          used = true
        }
      if (used) side++
    }
    for (let i = 0; i < this.n; i++) if (group[i] === -1) group[i] = side
    if (group.every((g) => g === group[0])) return this.refuse('That would put every node on the same side, so nothing would be cut. Name the nodes on one side, for example nodes 1 and 2.', 'Nothing to cut')
    this.group = group
    const sides = this.sides()
    const able = sides.filter((x) => x.length >= this.majority)
    const words = sides.map(list).join(' | ')
    return this.emit(
      'partition',
      0,
      `The network is cut: ${words}. Messages between sides are dropped. ${able.length ? `Only the side with a majority (${list(able[0])}: ${able[0].length} of ${this.n}) can elect a leader or commit entries.` : `No side has a majority (${this.majority} of ${this.n}), so nothing can be committed until it heals.`}`,
      `Network cut: ${words}`
    )
  }

  /** Cuts one node off from all the others */
  isolate(id: number): RaftEvent {
    if (!this.known(id)) return this.refuse(`There is no node ${id}: the nodes are 1 to ${this.n}.`, `No node ${id}`)
    return this.partition([[id]])
  }

  heal(): RaftEvent {
    if (!this.partitioned) return this.refuse('The network is already whole: every node can reach every other.', 'Network already whole')
    this.group.fill(0)
    return this.emit('heal', 0, 'The network is whole again: every node can reach every other. A node that was cut off may come back with a higher term, and any message carrying it makes the others move to that term.', 'Network healed')
  }

  /**
   * A client's command. It goes to the running leader with the highest term, or to node `to`
   * if that node believes it is leader (which a cut-off leader of an old term still does).
   */
  command(value: string, to?: number): RaftEvent {
    const cmd = cleanCommand(value)
    if (!cmd) return this.refuse('The command is empty: type something short such as x=1.', 'Empty command')
    let leader = this.leader()
    if (to !== undefined) {
      if (!this.known(to)) return this.refuse(`There is no node ${to}: the nodes are 1 to ${this.n}.`, `No node ${to}`)
      const target = this.node(to)
      if (!target.up) return this.refuse(`${cap(to)} is stopped and cannot take ${cmd}.`, `${cmd} refused: ${to} is stopped`)
      if (target.role !== 'leader')
        return this.refuse(`${cap(to)} is a ${target.role}, not a leader, so it does not take ${cmd}: in Raft only the leader appends client commands (a follower would point the client to the leader).`, `${cmd} refused: ${to} is not leader`)
      leader = target
    }
    if (!leader) return this.refuse(`No node is leader at the moment, so there is nowhere to send ${cmd}. Run on until an election finishes, then submit it again.`, `${cmd} refused: no leader`)
    if (leader.log.length >= RAFT_LIMITS.log) return this.refuse(`${cap(leader.id)}'s log is full (${RAFT_LIMITS.log} entries): this simulation has no log compaction. Reset to start again.`, `${cmd} refused: log full`)
    leader.log.push({ term: leader.term, command: cmd })
    leader.matchIndex[leader.id - 1] = leader.log.length
    this.broadcast(leader)
    const index = leader.log.length
    return this.emit(
      'client',
      leader.id,
      `The client's command ${cmd} goes to the leader, ${low(leader.id)}: it appends it at index ${index} in term ${leader.term} and sends AppendEntries to the others. The entry is not committed until a majority (${this.majority} of ${this.n}) hold it.`,
      `Client → ${leader.id}: ${cmd} appended at index ${index}`
    )
  }
}

// ---------- Named parts ----------

type Whole = 'leader' | 'term' | 'commit' | 'messages' | 'network' | 'clock'

export type RaftPart = { type: 'node' | 'log' | 'timer'; n: number } | { type: 'entry'; n: number; i: number } | { type: 'message'; id: number } | { type: Whole }

const PART_ALIASES: Record<string, Whole> = {
  leader: 'leader',
  term: 'term',
  terms: 'term',
  commit: 'commit',
  commitindex: 'commit',
  committed: 'commit',
  messages: 'messages',
  network: 'network',
  partition: 'network',
  clock: 'clock',
  time: 'clock'
}

/**
 * node:N, log:N, timer:N, entry:N:I (node, index), message:ID (one in flight), leader, term,
 * commit, messages, network, clock. Nodes and log indexes are counted from 1.
 */
export function parseRaftPart(name: string, model: Raft): RaftPart | null {
  const [head, ...rest] = name.trim().toLowerCase().split(':')
  const nums = rest.map(Number)
  if (nums.some((v) => !Number.isInteger(v) || v < 1)) return null
  const [a, b] = nums
  if (!nums.length) return Object.hasOwn(PART_ALIASES, head) ? { type: PART_ALIASES[head] } : null
  if (nums.length === 1 && (head === 'node' || head === 'log' || head === 'timer') && a <= model.n) return { type: head, n: a }
  if (nums.length === 2 && head === 'entry' && a <= model.n && b <= model.node(a).log.length) return { type: 'entry', n: a, i: b }
  if (nums.length === 1 && head === 'message' && model.messages.some((m) => m.id === a)) return { type: 'message', id: a }
  return null
}

const voteOf = (node: RaftNode) => (node.votedFor === null ? 'no one' : node.votedFor === node.id ? 'itself' : low(node.votedFor))

function describeMessage(model: Raft, m: RaftMessage): PartInfo {
  const b = m.body
  const way = `from node ${m.from} to node ${m.to}`
  const fate = m.doom ? `, about to be dropped: ${m.doom === 'loss' ? 'lost' : 'the network is cut'}` : ''
  const base = { from: `node ${m.from}`, to: `node ${m.to}`, term: b.term }
  const arrives = { 'arrives in ms': m.arriveAt - model.now }
  switch (b.type) {
    case 'RequestVote':
      return { label: `the RequestVote ${way} (term ${b.term}, lastLogIndex ${b.lastLogIndex}, lastLogTerm ${b.lastLogTerm}${fate})`, values: { ...base, lastLogIndex: b.lastLogIndex, lastLogTerm: b.lastLogTerm, ...arrives } }
    case 'RequestVoteReply':
      return { label: `the reply to RequestVote ${way} (term ${b.term}, vote ${b.voteGranted ? 'granted' : 'refused'}${fate})`, values: { ...base, voteGranted: b.voteGranted ? 'yes' : 'no', ...arrives } }
    case 'AppendEntries':
      return {
        label: `the ${b.entries.length ? 'AppendEntries' : 'heartbeat (an empty AppendEntries)'} ${way} (term ${b.term}, prevLogIndex ${b.prevLogIndex}, prevLogTerm ${b.prevLogTerm}, ${entries(b.entries.length)}, leaderCommit ${b.leaderCommit}${fate})`,
        values: { ...base, prevLogIndex: b.prevLogIndex, prevLogTerm: b.prevLogTerm, entries: b.entries.map((e) => e.command).join(' ') || 'none', leaderCommit: b.leaderCommit }
      }
    case 'AppendEntriesReply':
      return {
        label: `the reply to AppendEntries ${way} (term ${b.term}, ${b.success ? `success, matching up to index ${b.index}` : `rejected at index ${b.index}`}${fate})`,
        values: { ...base, success: b.success ? 'yes' : 'no', index: b.index, ...arrives }
      }
  }
}

export function describeRaftPart(model: Raft, part: RaftPart): PartInfo {
  const each = (f: (node: RaftNode) => number) => model.nodes.map(f).join(', ')
  const perNode = (f: (node: RaftNode) => number) => Object.fromEntries(model.nodes.map((x) => [`node ${x.id}`, f(x)]))
  switch (part.type) {
    case 'node': {
      const node = model.node(part.n)
      if (!node.up)
        return {
          label: `node ${node.id} (stopped; on disk it keeps term ${node.term}, its vote for ${voteOf(node)} and ${entries(node.log.length)})`,
          values: { state: 'stopped', term: node.term, 'voted for': node.votedFor ?? 'none', 'log length': node.log.length }
        }
      const timer: Record<string, number> = node.role === 'leader' ? { 'next heartbeat ms': node.heartbeatAt - model.now } : { 'timer ms': model.timeLeft(node) }
      return {
        label: `node ${node.id} (${node.role} in term ${node.term}, voted for ${voteOf(node)}, ${entries(node.log.length)} in its log, commit index ${node.commitIndex})`,
        values: { role: node.role, term: node.term, 'voted for': node.votedFor ?? 'none', 'commit index': node.commitIndex, 'log length': node.log.length, ...timer }
      }
    }
    case 'log': {
      const node = model.node(part.n)
      const shown = node.log.slice(-4)
      return {
        label: `node ${node.id}'s log (${node.log.length ? `${entries(node.log.length)}, from terms ${node.log.map((e) => e.term).join(', ')}` : 'empty'}; committed up to index ${node.commitIndex})`,
        values: { length: node.log.length, 'commit index': node.commitIndex, ...Object.fromEntries(shown.map((e, k) => [`index ${node.log.length - shown.length + k + 1}`, `${e.command} (term ${e.term})`])) }
      }
    }
    case 'entry': {
      const node = model.node(part.n)
      const entry = node.log[part.i - 1]
      const held = model.copies(part.i, entry.term)
      const committed = node.up && part.i <= node.commitIndex
      return {
        label: `entry ${part.i} in node ${node.id}'s log (command "${entry.command}" from term ${entry.term}, ${committed ? 'committed' : `not committed as far as node ${node.id} knows`}; ${held} of ${model.n} nodes hold it)`,
        values: { index: part.i, term: entry.term, command: entry.command, committed: committed ? 'yes' : 'no', copies: held, 'majority needs': model.majority }
      }
    }
    case 'timer': {
      const node = model.node(part.n)
      if (!node.up) return { label: `node ${node.id}'s election timer (not running: the node is stopped)`, values: { state: 'stopped' } }
      if (node.role === 'leader')
        return {
          label: `node ${node.id}'s heartbeat timer (next heartbeat in ${node.heartbeatAt - model.now} ms of ${model.heartbeat}; a leader runs no election timer)`,
          values: { 'next heartbeat ms': node.heartbeatAt - model.now, 'interval ms': model.heartbeat }
        }
      return {
        label: `node ${node.id}'s election timer (${model.timeLeft(node)} ms left of ${node.electionSpan}, drawn at random from ${model.election[0]} to ${model.election[1]} ms)`,
        values: { 'left ms': model.timeLeft(node), 'timeout ms': node.electionSpan, 'range ms': `${model.election[0]} to ${model.election[1]}` }
      }
    }
    case 'leader': {
      const leaders = model.leaders()
      if (!leaders.length) return { label: `the leader (there is none at the moment; the highest term is ${model.maxTerm()})`, values: { leader: 'none', 'highest term': model.maxTerm() } }
      const top = leaders[0]
      const others = leaders.slice(1).map((x) => `node ${x.id} still believes it leads term ${x.term}`)
      return {
        label: `the leader (node ${top.id}, elected for term ${top.term} with ${top.votes.length} of ${model.n} votes${others.length ? `; ${others.join(' and ')}` : ''})`,
        values: {
          leader: `node ${top.id}`,
          term: top.term,
          'commit index': top.commitIndex,
          nextIndex: model.nodes.map((x) => (x.id === top.id ? '–' : top.nextIndex[x.id - 1])).join(' '),
          matchIndex: model.nodes.map((x) => (x.id === top.id ? '–' : top.matchIndex[x.id - 1])).join(' '),
          votes: `${top.votes.length} of ${model.n}`
        }
      }
    }
    case 'term':
      return { label: `the current term (the highest is ${model.maxTerm()}; nodes 1 to ${model.n} are in terms ${each((x) => x.term)})`, values: { highest: model.maxTerm(), ...perNode((x) => x.term) } }
    case 'commit':
      return { label: `the commit index (the highest is ${model.maxCommit()}; nodes 1 to ${model.n} have ${each((x) => x.commitIndex)})`, values: { highest: model.maxCommit(), ...perNode((x) => x.commitIndex) } }
    case 'messages': {
      const count = (type: RaftBody['type']) => model.messages.filter((m) => m.body.type === type).length
      const total = model.messages.length
      return {
        label: `the messages in flight (${total === 0 ? 'none' : total} at ${model.now} ms${model.drops.length ? `; ${model.drops.length} dropped just now` : ''})`,
        values: {
          'in flight': total,
          RequestVote: count('RequestVote'),
          'vote replies': count('RequestVoteReply'),
          AppendEntries: count('AppendEntries'),
          'append replies': count('AppendEntriesReply'),
          'dropped just now': model.drops.length
        }
      }
    }
    case 'message':
      return describeMessage(model, model.messages.find((x) => x.id === part.id) as RaftMessage)
    case 'network': {
      const sides = model.sides()
      return model.partitioned
        ? { label: `the network (cut into ${sides.map(list).join(' | ')}; a side needs ${model.majority} of ${model.n} nodes to elect or commit)`, values: { state: 'partitioned', sides: sides.map((x) => x.join(' ')).join(' | '), majority: model.majority } }
        : {
            label: `the network (whole: every node can reach every other; latency ${model.latency[0]} to ${model.latency[1]} ms${model.loss ? `, ${Math.round(model.loss * 100)}% of messages lost` : ''})`,
            values: { state: 'whole', 'latency ms': `${model.latency[0]} to ${model.latency[1]}`, loss: `${Math.round(model.loss * 100)}%` }
          }
    }
    case 'clock':
      return {
        label: `the simulated clock (${model.now} ms; heartbeats every ${model.heartbeat} ms, election timeouts ${model.election[0]} to ${model.election[1]} ms)`,
        values: { 'time ms': model.now, 'heartbeat ms': model.heartbeat, 'election ms': `${model.election[0]} to ${model.election[1]}`, 'latency ms': `${model.latency[0]} to ${model.latency[1]}` }
      }
  }
}
