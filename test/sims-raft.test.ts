import { describe, expect, it } from 'vitest'
import {
  Raft,
  RAFT_LIMITS,
  describeRaftPart,
  parseRaftPart,
  type RaftBody,
  type RaftEntry,
  type RaftEvent,
  type RaftNode,
  type RaftOptions,
  type RaftSpec
} from '../src/renderer/src/lib/sims/raft'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const base: RaftOptions = { nodes: 5, heartbeat: 50, election: [150, 300], latency: [15, 35], loss: 0, seed: 1 }
const make = (o: Partial<RaftOptions> = {}) => new Raft({ ...base, ...o })
const e = (term: number, command = `c${term}`): RaftEntry => ({ term, command })
const terms = (node: RaftNode) => node.log.map((x) => x.term)

/** A cluster with every timer pushed far away and nothing in flight, for building states by hand */
function still(o: Partial<RaftOptions> = {}): Raft {
  const model = make(o)
  for (const node of model.nodes) node.electionAt = 1e9
  return model
}

/** Puts one message on the wire arriving now, and handles exactly that message */
function deliver(model: Raft, from: number, to: number, body: RaftBody): RaftEvent {
  model.messages = [{ id: 9000 + model.steps, from, to, sentAt: model.now, arriveAt: model.now, body }, ...model.messages]
  return model.step()
}

/** The newest message in flight from one node to another */
function sent<T extends RaftBody['type']>(model: Raft, from: number, to: number, type: T): Extract<RaftBody, { type: T }> {
  const found = [...model.messages].reverse().find((m) => m.from === from && m.to === to && m.body.type === type)
  if (!found) throw new Error(`no ${type} from ${from} to ${to}`)
  return found.body as Extract<RaftBody, { type: T }>
}

function runUntil(model: Raft, done: () => boolean, limitMs: number): boolean {
  const end = model.now + limitMs
  while (model.now <= end) {
    if (done()) return true
    model.step()
  }
  return done()
}

function makeLeader(model: Raft, id: number, term: number): RaftNode {
  const node = model.node(id)
  for (const x of model.nodes) {
    x.term = term
    x.votedFor = id
  }
  node.role = 'leader'
  node.leaderId = id
  node.votes = [id]
  node.electionAt = Infinity
  node.heartbeatAt = model.now + model.heartbeat
  node.nextIndex = model.nodes.map(() => node.log.length + 1)
  node.matchIndex = model.nodes.map((x) => (x.id === id ? node.log.length : 0))
  return node
}

// ---------- The safety properties of the paper, checked after every event ----------

class Checker {
  private leaderOf = new Map<number, number>()
  /** Every entry any node has ever committed, with the term it was first committed in */
  committed: { entry: RaftEntry; inTerm: number }[] = []
  private high: number[]
  private lastTerm: number[]
  private voted: (number | null)[]
  elections = 0

  constructor(private model: Raft) {
    this.high = model.nodes.map(() => 0)
    this.lastTerm = model.nodes.map((x) => x.term)
    this.voted = model.nodes.map((x) => x.votedFor)
  }

  check(context: string): void {
    const { model } = this
    const fail = (what: string): never => {
      throw new Error(`${what} (${context}, t=${model.now}, last: ${model.last.text})`)
    }
    model.nodes.forEach((node, k) => {
      // Terms only grow; one vote per term
      if (node.term < this.lastTerm[k]) fail(`node ${node.id}'s term went backwards`)
      if (node.term === this.lastTerm[k] && this.voted[k] !== null && node.votedFor !== this.voted[k]) fail(`node ${node.id} changed its vote within term ${node.term}`)
      this.lastTerm[k] = node.term
      this.voted[k] = node.votedFor
      if (node.commitIndex > node.log.length) fail(`node ${node.id} committed past the end of its log`)
      for (let i = 0; i < node.log.length; i++) {
        if (node.log[i].term > node.term) fail(`node ${node.id} holds an entry from a term above its own`)
        if (i && node.log[i].term < node.log[i - 1].term) fail(`node ${node.id}'s log terms go down`)
      }
      // Election Safety: at most one leader per term, ever
      if (node.role === 'leader') {
        const prev = this.leaderOf.get(node.term)
        if (prev === undefined) {
          this.leaderOf.set(node.term, node.id)
          this.elections++
        } else if (prev !== node.id) fail(`Election Safety: nodes ${prev} and ${node.id} both led term ${node.term}`)
      }
    })
    // Log Matching: the same index and term means the same entry and the same log before it
    for (let a = 0; a < model.n; a++)
      for (let b = a + 1; b < model.n; b++) {
        const p = model.nodes[a].log
        const q = model.nodes[b].log
        let i = Math.min(p.length, q.length) - 1
        while (i >= 0 && p[i].term !== q[i].term) i--
        for (; i >= 0; i--) if (p[i].term !== q[i].term || p[i].command !== q[i].command) fail(`Log Matching: nodes ${a + 1} and ${b + 1} differ at index ${i + 1} below a matching entry`)
      }
    // State Machine Safety: no two nodes commit different entries at an index, and a committed entry stays
    model.nodes.forEach((node, k) => {
      this.high[k] = Math.max(this.high[k], node.commitIndex)
      for (let i = 0; i < this.high[k]; i++) {
        const mine = node.log[i]
        if (!mine) fail(`State Machine Safety: node ${node.id} lost committed index ${i + 1}`)
        const known = this.committed[i]
        if (!known) this.committed[i] = { entry: mine, inTerm: node.term }
        else if (known.entry.term !== mine.term || known.entry.command !== mine.command) fail(`State Machine Safety: index ${i + 1} committed as ${known.entry.command}/t${known.entry.term} and as ${mine.command}/t${mine.term} on node ${node.id}`)
      }
    })
    // Leader Completeness: a leader holds every entry committed in its own or an earlier term
    for (const node of model.nodes) {
      if (node.role !== 'leader') continue
      this.committed.forEach((known, i) => {
        if (known.inTerm > node.term) return
        const mine = node.log[i]
        if (!mine || mine.term !== known.entry.term || mine.command !== known.entry.command) fail(`Leader Completeness: leader ${node.id} of term ${node.term} lacks committed index ${i + 1}`)
      })
    }
  }
}

describe('raft: elections', () => {
  it('starts as followers in term 0 with timers drawn from the range, and elects one leader', () => {
    for (const nodes of [3, 5]) {
      const model = make({ nodes })
      expect(model.nodes).toHaveLength(nodes)
      expect(model.majority).toBe(nodes === 3 ? 2 : 3)
      for (const node of model.nodes) {
        expect([node.role, node.term, node.votedFor, node.log.length, node.commitIndex]).toEqual(['follower', 0, null, 0, 0])
        expect(node.electionSpan).toBeGreaterThanOrEqual(150)
        expect(node.electionSpan).toBeLessThanOrEqual(300)
      }
      const first = [...model.nodes].sort((a, b) => a.electionAt - b.electionAt)[0]
      expect(runUntil(model, () => model.leader() !== null, 2000)).toBe(true)
      const leader = model.leader() as RaftNode
      expect(leader.votes.length).toBeGreaterThanOrEqual(model.majority)
      expect(model.leaders()).toHaveLength(1)
      // In a calm network the first timer to run out wins
      expect(leader.id).toBe(first.id)
      expect(leader.term).toBe(1)
      expect(model.events.some((x) => x.kind === 'timeout' && x.text.includes(`Node ${first.id}'s election timer ran out`))).toBe(true)
    }
  })

  it('a candidate votes for itself, raises its term and asks every other node', () => {
    const model = still()
    model.node(2).electionAt = 5
    const event = model.step()
    const two = model.node(2)
    expect(event.kind).toBe('timeout')
    expect([two.role, two.term, two.votedFor, two.votes]).toEqual(['candidate', 1, 2, [2]])
    expect(model.messages.map((m) => [m.from, m.to, m.body.type])).toEqual([1, 3, 4, 5].map((to) => [2, to, 'RequestVote']))
    expect(sent(model, 2, 1, 'RequestVote')).toMatchObject({ term: 1, candidateId: 2, lastLogIndex: 0, lastLogTerm: 0 })
    // It runs a fresh timer for this election
    expect(two.electionAt).toBeGreaterThanOrEqual(5 + 150)
  })

  it('grants at most one vote per term, and resets the timer only when it grants', () => {
    const model = still()
    const one = model.node(1)
    one.electionAt = 500
    const ask = (candidateId: number, term: number): RaftBody => ({ type: 'RequestVote', term, candidateId, lastLogIndex: 0, lastLogTerm: 0 })
    deliver(model, 2, 1, ask(2, 1))
    expect(one.votedFor).toBe(2)
    expect(sent(model, 1, 2, 'RequestVoteReply')).toEqual({ type: 'RequestVoteReply', term: 1, voteGranted: true })
    const timer = one.electionAt
    expect(timer).not.toBe(500)
    const refused = deliver(model, 3, 1, ask(3, 1))
    expect(one.votedFor).toBe(2)
    expect(sent(model, 1, 3, 'RequestVoteReply').voteGranted).toBe(false)
    expect(refused.text).toContain('one vote per term')
    expect(one.electionAt).toBe(timer)
    // The same candidate asking again (a duplicate) is granted again
    deliver(model, 2, 1, ask(2, 1))
    expect(sent(model, 1, 2, 'RequestVoteReply').voteGranted).toBe(true)
    // A new term frees the vote
    deliver(model, 3, 1, ask(3, 2))
    expect([one.term, one.votedFor]).toEqual([2, 3])
  })

  it('refuses a candidate from an older term and tells it the current term', () => {
    const model = still()
    model.node(1).term = 5
    deliver(model, 2, 1, { type: 'RequestVote', term: 3, candidateId: 2, lastLogIndex: 9, lastLogTerm: 3 })
    expect(sent(model, 1, 2, 'RequestVoteReply')).toEqual({ type: 'RequestVoteReply', term: 5, voteGranted: false })
    expect(model.node(1).votedFor).toBe(null)
  })

  it('the election restriction: no vote for a candidate whose log is less up to date', () => {
    const cases: [number[], number, number, boolean][] = [
      // voter's log terms, candidate lastLogTerm, lastLogIndex, granted
      [[1, 1, 2], 1, 9, false], // older last term loses however long the log
      [[1, 1, 2], 2, 2, false], // same last term, shorter
      [[1, 1, 2], 2, 3, true], // same last term, same length
      [[1, 1, 2], 2, 4, true], // same last term, longer
      [[1, 1, 2], 3, 1, true], // newer last term wins however short
      [[], 0, 0, true]
    ]
    for (const [log, lastLogTerm, lastLogIndex, granted] of cases) {
      const model = still()
      const one = model.node(1)
      one.log = log.map((t) => e(t))
      one.term = 3
      const event = deliver(model, 2, 1, { type: 'RequestVote', term: 4, candidateId: 2, lastLogIndex, lastLogTerm })
      expect(sent(model, 1, 2, 'RequestVoteReply').voteGranted, JSON.stringify([log, lastLogTerm, lastLogIndex])).toBe(granted)
      expect(one.votedFor).toBe(granted ? 2 : null)
      // It moved to the higher term either way
      expect(one.term).toBe(4)
      if (!granted) expect(event.text).toContain('election restriction')
    }
  })

  it('a node with a stale log cannot win, however often it times out', () => {
    const model = still({ nodes: 3 })
    model.node(1).log = [e(1), e(1)]
    model.node(2).log = [e(1), e(1)]
    for (const node of model.nodes) node.term = 1
    model.node(3).electionAt = 10
    runUntil(model, () => false, 120)
    expect(model.node(3).role).toBe('candidate')
    expect(model.node(3).votes).toEqual([3])
    expect(model.events.filter((x) => x.text.includes('election restriction'))).toHaveLength(2)
  })

  it('needs a majority: 2 of 5 votes is not enough, 3 is', () => {
    const model = still()
    model.node(1).electionAt = 1
    model.step()
    model.messages = []
    const one = model.node(1)
    deliver(model, 2, 1, { type: 'RequestVoteReply', term: 1, voteGranted: true })
    expect(one.role).toBe('candidate')
    // The same voter twice is still one vote
    deliver(model, 2, 1, { type: 'RequestVoteReply', term: 1, voteGranted: true })
    expect([one.role, one.votes]).toEqual(['candidate', [1, 2]])
    deliver(model, 4, 1, { type: 'RequestVoteReply', term: 1, voteGranted: false })
    expect(one.role).toBe('candidate')
    const won = deliver(model, 3, 1, { type: 'RequestVoteReply', term: 1, voteGranted: true })
    expect(one.role).toBe('leader')
    expect(won.text).toContain('3 of 5 votes')
    // nextIndex is one past its log, matchIndex 0, and heartbeats go out at once
    expect(one.nextIndex).toEqual([1, 1, 1, 1, 1])
    expect(one.matchIndex).toEqual([0, 0, 0, 0, 0])
    expect(model.messages.filter((m) => m.body.type === 'AppendEntries').map((m) => m.to)).toEqual([2, 3, 4, 5])
    expect(one.heartbeatAt).toBe(model.now + 50)
    // A vote from an old election is ignored
    const late = deliver(model, 5, 1, { type: 'RequestVoteReply', term: 1, voteGranted: true })
    expect(late.text).toContain('ignores')
  })

  it('a split vote ends when a timer runs out again, in a higher term', () => {
    const model = still({ nodes: 3 })
    model.partition([[1], [2], [3]])
    model.node(1).electionAt = 5
    runUntil(model, () => model.node(1).term >= 3, 2000)
    expect(model.node(1).role).toBe('candidate')
    expect(model.leader()).toBe(null)
    expect(model.events.some((x) => x.text.includes('before it won or heard from a leader'))).toBe(true)
  })
})

describe('raft: a higher term makes any node a follower', () => {
  const setups: [string, (model: Raft) => RaftBody][] = [
    ['RequestVote', () => ({ type: 'RequestVote', term: 7, candidateId: 2, lastLogIndex: 0, lastLogTerm: 0 })],
    ['RequestVoteReply', () => ({ type: 'RequestVoteReply', term: 7, voteGranted: false })],
    ['AppendEntries', () => ({ type: 'AppendEntries', term: 7, leaderId: 2, prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0 })],
    ['AppendEntriesReply', () => ({ type: 'AppendEntriesReply', term: 7, success: false, index: 0 })]
  ]
  for (const [name, body] of setups) {
    it(`a leader steps down on ${name} with a higher term`, () => {
      const model = still()
      const one = makeLeader(model, 1, 3)
      const event = deliver(model, 2, 1, body(model))
      expect([one.role, one.term]).toEqual(['follower', 7])
      expect(event.text).toContain('sees term 7')
      expect(event.text).toContain('steps down from leader')
      // It runs an election timer again and sends no more heartbeats
      expect(Number.isFinite(one.electionAt)).toBe(true)
      expect(one.heartbeatAt).toBe(Infinity)
      // Its old vote does not carry into the new term
      expect(one.votedFor).toBe(name === 'RequestVote' ? 2 : null)
    })
    it(`a candidate steps down on ${name} with a higher term`, () => {
      const model = still()
      model.node(1).electionAt = 1
      model.step()
      model.messages = []
      deliver(model, 2, 1, body(model))
      expect([model.node(1).role, model.node(1).term]).toEqual(['follower', 7])
    })
  }

  it('a candidate returns to follower on AppendEntries from the leader of its own term', () => {
    const model = still()
    model.node(1).electionAt = 1
    model.step()
    model.messages = []
    const event = deliver(model, 2, 1, { type: 'AppendEntries', term: 1, leaderId: 2, prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0 })
    expect([model.node(1).role, model.node(1).term, model.node(1).leaderId]).toEqual(['follower', 1, 2])
    expect(event.text).toContain('returns to follower')
  })

  it('a stale leader learns of the new term from the reply to its own heartbeat', () => {
    const model = still()
    const one = makeLeader(model, 1, 2)
    model.node(3).term = 4
    deliver(model, 1, 3, { type: 'AppendEntries', term: 2, leaderId: 1, prevLogIndex: 0, prevLogTerm: 0, entries: [e(2)], leaderCommit: 0 })
    expect(model.node(3).log).toEqual([])
    const reply = sent(model, 3, 1, 'AppendEntriesReply')
    expect(reply).toMatchObject({ term: 4, success: false })
    model.messages = []
    deliver(model, 3, 1, reply)
    expect([one.role, one.term]).toEqual(['follower', 4])
  })
})

describe('raft: AppendEntries', () => {
  const append = (over: Partial<Extract<RaftBody, { type: 'AppendEntries' }>>): RaftBody => ({ type: 'AppendEntries', term: 3, leaderId: 1, prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0, ...over })

  function follower(log: number[], commitIndex = 0): [Raft, RaftNode] {
    const model = still()
    const two = model.node(2)
    two.log = log.map((t, i) => e(t, `old${i + 1}`))
    two.term = 3
    two.commitIndex = commitIndex
    return [model, two]
  }

  it('a heartbeat resets the election timer and records the leader', () => {
    const [model, two] = follower([])
    two.electionAt = 7
    deliver(model, 1, 2, append({}))
    expect(two.leaderId).toBe(1)
    expect(two.electionAt).toBeGreaterThanOrEqual(model.now + 150)
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toEqual({ type: 'AppendEntriesReply', term: 3, success: true, index: 0 })
  })

  it('an AppendEntries from an older term is rejected and does not reset the timer', () => {
    const [model, two] = follower([])
    two.electionAt = 777
    deliver(model, 1, 2, append({ term: 2, entries: [e(2)] }))
    expect(two.log).toEqual([])
    expect(two.electionAt).toBe(777)
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toMatchObject({ term: 3, success: false })
  })

  it('the consistency check: rejects when the entry before is missing or from another term', () => {
    const [model, two] = follower([1, 1])
    const missing = deliver(model, 1, 2, append({ prevLogIndex: 3, prevLogTerm: 2, entries: [e(3)] }))
    expect(terms(two)).toEqual([1, 1])
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toEqual({ type: 'AppendEntriesReply', term: 3, success: false, index: 3 })
    expect(missing.text).toContain('no entry at index 3')
    const other = deliver(model, 1, 2, append({ prevLogIndex: 2, prevLogTerm: 2, entries: [e(3)] }))
    expect(terms(two)).toEqual([1, 1])
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toMatchObject({ success: false, index: 2 })
    expect(other.text).toContain('from term 1, but the leader')
  })

  it('appends new entries when the entry before matches', () => {
    const [model, two] = follower([1, 1])
    deliver(model, 1, 2, append({ prevLogIndex: 2, prevLogTerm: 1, entries: [e(3, 'a'), e(3, 'b')] }))
    expect(two.log).toEqual([e(1, 'old1'), e(1, 'old2'), e(3, 'a'), e(3, 'b')])
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toMatchObject({ success: true, index: 4 })
  })

  it('deletes a conflicting entry and everything after it', () => {
    const [model, two] = follower([1, 1, 2, 2, 2])
    const event = deliver(model, 1, 2, append({ prevLogIndex: 2, prevLogTerm: 1, entries: [e(3, 'new')] }))
    expect(two.log).toEqual([e(1, 'old1'), e(1, 'old2'), e(3, 'new')])
    expect(event.text).toContain('conflicts')
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toMatchObject({ success: true, index: 3 })
  })

  it('keeps entries that agree: a late, shorter AppendEntries deletes nothing', () => {
    const [model, two] = follower([1, 1, 3, 3])
    deliver(model, 1, 2, append({ prevLogIndex: 1, prevLogTerm: 1, entries: [e(1, 'old2')] }))
    expect(terms(two)).toEqual([1, 1, 3, 3])
    // The reply only vouches for what this request covered
    expect(sent(model, 2, 1, 'AppendEntriesReply')).toMatchObject({ success: true, index: 2 })
  })

  it('sets commitIndex to min(leaderCommit, index of last new entry), and never lowers it', () => {
    const [model, two] = follower([1, 1, 1, 1])
    deliver(model, 1, 2, append({ prevLogIndex: 1, prevLogTerm: 1, entries: [e(1, 'old2')], leaderCommit: 4 }))
    // Entries 3 and 4 have not been checked against this leader, so only 2 is known committed
    expect(two.commitIndex).toBe(2)
    deliver(model, 1, 2, append({ prevLogIndex: 4, prevLogTerm: 1, leaderCommit: 3 }))
    expect(two.commitIndex).toBe(3)
    deliver(model, 1, 2, append({ prevLogIndex: 0, prevLogTerm: 0, leaderCommit: 1 }))
    expect(two.commitIndex).toBe(3)
    deliver(model, 1, 2, append({ prevLogIndex: 4, prevLogTerm: 1, leaderCommit: 9 }))
    expect(two.commitIndex).toBe(4)
  })
})

describe('raft: the leader', () => {
  it('sends heartbeats every interval, well inside the election timeout', () => {
    const model = make({ nodes: 3 })
    runUntil(model, () => model.leader() !== null, 2000)
    const leader = model.leader() as RaftNode
    let beats = 0
    let timeouts = 0
    runUntil(
      model,
      () => {
        if (model.last.kind === 'heartbeat') beats++
        if (model.last.kind === 'timeout') timeouts++
        return false
      },
      1000
    )
    // One every 50 ms (each step is looked at once, and a heartbeat is one step)
    expect(beats).toBeGreaterThanOrEqual(19)
    expect(beats).toBeLessThanOrEqual(21)
    expect(timeouts).toBe(0)
    expect(model.leader()).toBe(leader)
    expect(leader.term).toBe(1)
  })

  it('backs nextIndex off one entry per rejection until the logs meet, then repairs the follower', () => {
    const model = still({ nodes: 3 })
    const one = model.node(1)
    one.log = [e(1, 'a'), e(1, 'b'), e(4, 'c'), e(4, 'd')]
    const two = model.node(2)
    two.log = [e(1, 'a'), e(2, 'x'), e(2, 'y'), e(3, 'z'), e(3, 'w')]
    model.node(3).log = [...one.log]
    makeLeader(model, 1, 4)
    one.heartbeatAt = model.now
    const seen: number[] = []
    runUntil(
      model,
      () => {
        if (seen[seen.length - 1] !== one.nextIndex[1]) seen.push(one.nextIndex[1])
        return one.matchIndex[1] === 4
      },
      2000
    )
    // 5 (one past its log), then one step back per rejection to the last entry that matches (index 1)
    expect(seen).toEqual([5, 4, 3, 2, 5])
    expect(two.log).toEqual(one.log)
    expect(model.events.filter((x) => x.text.includes('backs nextIndex')).length).toBe(3)
    expect(model.events.some((x) => x.node === 2 && x.text.includes('conflicts'))).toBe(true)
  })

  it('commits an entry of its own term once a majority hold it, and followers learn from the next AppendEntries', () => {
    const model = make()
    runUntil(model, () => model.leader() !== null, 2000)
    const leader = model.leader() as RaftNode
    const event = model.command('x=1')
    expect(event.ok).toBe(true)
    expect(leader.log).toEqual([{ term: leader.term, command: 'x=1' }])
    expect(leader.commitIndex).toBe(0)
    // Step until the second success arrives: leader + 2 followers = 3 of 5
    runUntil(model, () => leader.commitIndex === 1, 500)
    expect(leader.commitIndex).toBe(1)
    expect(leader.matchIndex.filter((m) => m >= 1)).toHaveLength(3)
    expect(model.last.text).toContain('3 of 5 nodes')
    // No follower knows yet: the commit travels with the next AppendEntries
    expect(model.nodes.filter((x) => x.commitIndex === 1)).toHaveLength(1)
    expect(runUntil(model, () => model.nodes.every((x) => x.commitIndex === 1), 500)).toBe(true)
  })

  it('ignores replies from an older term and rejections it has already acted on', () => {
    const model = still()
    const one = model.node(1)
    one.log = [e(1), e(1), e(5)]
    makeLeader(model, 1, 5)
    deliver(model, 2, 1, { type: 'AppendEntriesReply', term: 3, success: true, index: 3 })
    expect(one.matchIndex[1]).toBe(0)
    one.nextIndex[1] = 2
    one.matchIndex[1] = 1
    model.messages = []
    // A rejection for a request it is no longer making changes nothing and is not retried
    deliver(model, 2, 1, { type: 'AppendEntriesReply', term: 5, success: false, index: 3 })
    expect(one.nextIndex[1]).toBe(2)
    expect(model.messages).toHaveLength(0)
    // nextIndex never goes back past what is known to match
    deliver(model, 2, 1, { type: 'AppendEntriesReply', term: 5, success: false, index: 1 })
    expect(one.nextIndex[1]).toBe(2)
    // A repeated success cannot lower matchIndex
    one.matchIndex[1] = 3
    one.nextIndex[1] = 4
    deliver(model, 2, 1, { type: 'AppendEntriesReply', term: 5, success: true, index: 1 })
    expect([one.matchIndex[1], one.nextIndex[1]]).toEqual([3, 4])
  })
})

describe('raft: Figure 8, an earlier term\'s entry is not committed by counting copies', () => {
  /** (c) of the figure, built by hand: node 1 leads term 4 and holds the term-2 entry at index 2 */
  function figure(): Raft {
    const model = still()
    const a = e(1, 'x=1')
    const b = e(2, 'y=2')
    const c = e(3, 'y=9')
    const logs = [[a, b], [a, b], [a], [a], [a, c]]
    model.nodes.forEach((node, i) => {
      node.log = [...logs[i]]
      node.commitIndex = 1
    })
    makeLeader(model, 1, 4)
    model.stop(5)
    model.node(1).heartbeatAt = model.now
    return model
  }

  it('index 2 reaches a majority and stays uncommitted', () => {
    const model = figure()
    const one = model.node(1)
    const checker = new Checker(model)
    runUntil(
      model,
      () => {
        checker.check('figure 8')
        return false
      },
      600
    )
    // The term-2 entry is on nodes 1 to 4: more than a majority
    expect(model.copies(2, 2)).toBe(4)
    expect(one.matchIndex.filter((m) => m >= 2).length + 1).toBeGreaterThanOrEqual(model.majority)
    expect(model.nodes.map((x) => x.commitIndex)).toEqual([1, 1, 1, 1, 0])
    expect(model.events.some((x) => x.text.includes('never commits an earlier term'))).toBe(true)
  })

  it('(d): with node 1 gone, node 5 can win and overwrite it, which is why it must not have been committed', () => {
    const model = figure()
    const checker = new Checker(model)
    runUntil(model, () => model.copies(2, 2) === 4, 600)
    expect(model.copies(2, 2)).toBe(4)
    model.stop(1)
    model.stop(4)
    model.start(5)
    // Node 5's last entry is from term 3, newer than the term-2 entry nodes 2 and 3 end with: they vote for it
    model.node(5).electionAt = model.now + 1
    expect(
      runUntil(
        model,
        () => {
          checker.check('figure 8 d')
          return model.node(5).role === 'leader'
        },
        3000
      )
    ).toBe(true)
    model.command('z=3')
    runUntil(
      model,
      () => {
        checker.check('figure 8 d')
        return model.node(5).commitIndex === 3
      },
      1000
    )
    for (const id of [2, 3, 5]) expect(model.node(id).log.map((x) => x.command)).toEqual(['x=1', 'y=9', 'z=3'])
    // y=2 was on a majority and is gone, without any committed entry being lost
    expect(model.copies(2, 2)).toBe(2)
    expect(checker.committed.map((x) => x.entry.command)).toEqual(['x=1', 'y=9', 'z=3'])
  })

  it('(e): once an entry from term 4 is on a majority, both commit and node 5 can no longer win', () => {
    const model = figure()
    const checker = new Checker(model)
    const one = model.node(1)
    model.command('z=3')
    runUntil(
      model,
      () => {
        checker.check('figure 8 e')
        return one.commitIndex === 3
      },
      1000
    )
    // Index 2 (term 2) was committed together with index 3 (term 4), never on its own
    expect(one.commitIndex).toBe(3)
    expect(model.events.some((x) => x.text.includes('commits entries 2 to 3'))).toBe(true)
    runUntil(model, () => model.nodes.every((x) => !x.up || x.commitIndex === 3), 500)
    model.stop(1)
    model.start(5)
    // Give node 5 every chance: only its timer runs for a while
    for (const id of [2, 3, 4]) model.node(id).electionAt = model.now + 1500
    model.node(5).electionAt = model.now + 1
    let restricted = 0
    runUntil(
      model,
      () => {
        checker.check('figure 8 e')
        if (model.last.text.includes('refuses node 5') && model.last.text.includes('election restriction')) restricted++
        expect(model.node(5).role).not.toBe('leader')
        return false
      },
      1400
    )
    expect(model.node(5).term).toBeGreaterThan(5)
    expect(restricted).toBeGreaterThanOrEqual(3)
    // Then one of the others wins and brings node 5's log into line
    runUntil(
      model,
      () => {
        checker.check('figure 8 e')
        return model.leader() !== null && model.node(5).log.length === 3
      },
      4000
    )
    expect((model.leader() as RaftNode).id).not.toBe(5)
    expect(model.node(5).log.map((x) => x.command)).toEqual(['x=1', 'y=2', 'z=3'])
  })

  it('the built-in figure-8 scenario starts from (b) and behaves the same way', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const model = make({ scenario: 'figure-8', seed })
      const checker = new Checker(model)
      expect(model.nodes.map(terms)).toEqual([[1, 2], [1, 2], [1], [1], [1, 3]])
      expect(model.node(5).up).toBe(false)
      runUntil(
        model,
        () => {
          checker.check(`figure-8 seed ${seed}`)
          return false
        },
        3000
      )
      const leader = model.leader() as RaftNode
      // Only nodes 1 and 2 hold the term-2 entry, so only they can win while node 5 is stopped
      expect([1, 2]).toContain(leader.id)
      expect(model.copies(2, 2)).toBe(4)
      expect(leader.commitIndex).toBe(1)
    }
  })
})

describe('raft: stopping and starting', () => {
  it('term, vote and log survive; role, commit index and the leader\'s bookkeeping do not', () => {
    const model = make()
    runUntil(model, () => model.leader() !== null, 2000)
    const leader = model.leader() as RaftNode
    model.command('x=1')
    model.command('y=2')
    runUntil(model, () => model.nodes.every((x) => x.commitIndex === 2), 1000)
    const { id, term, votedFor } = leader
    const log = [...leader.log]
    expect(model.stop(id).ok).toBe(true)
    expect(leader.up).toBe(false)
    expect([leader.term, leader.votedFor, leader.log]).toEqual([term, votedFor, log])
    expect([leader.role, leader.commitIndex, leader.nextIndex, leader.matchIndex, leader.votes]).toEqual(['follower', 0, [], [], []])
    expect(model.timeLeft(leader)).toBe(Infinity)
    expect(model.stop(id).ok).toBe(false)
    // The rest elect a new leader in a higher term
    expect(runUntil(model, () => model.leader() !== null, 2000)).toBe(true)
    const next = model.leader() as RaftNode
    expect(next.id).not.toBe(id)
    expect(next.term).toBeGreaterThan(term)
    expect(model.start(id).ok).toBe(true)
    expect(model.start(id).ok).toBe(false)
    expect([leader.role, leader.term, leader.log, leader.commitIndex]).toEqual(['follower', term, log, 0])
    expect(Number.isFinite(leader.electionAt)).toBe(true)
    // It hears from the new leader, moves to its term and learns the commit index again
    expect(runUntil(model, () => leader.commitIndex === 2 && leader.term === next.term, 500)).toBe(true)
    expect(model.leader()).toBe(next)
  })

  it('a node that voted, stopped and started again does not vote for someone else in the same term', () => {
    const model = still()
    const one = model.node(1)
    deliver(model, 2, 1, { type: 'RequestVote', term: 1, candidateId: 2, lastLogIndex: 0, lastLogTerm: 0 })
    model.stop(1)
    model.start(1)
    one.electionAt = 1e9
    model.messages = []
    deliver(model, 3, 1, { type: 'RequestVote', term: 1, candidateId: 3, lastLogIndex: 0, lastLogTerm: 0 })
    expect(one.votedFor).toBe(2)
    expect(sent(model, 1, 3, 'RequestVoteReply').voteGranted).toBe(false)
  })

  it('messages to a stopped node are dropped and said to be', () => {
    const model = make({ nodes: 3 })
    runUntil(model, () => model.leader() !== null, 2000)
    const leader = model.leader() as RaftNode
    const other = model.nodes.find((x) => x !== leader) as RaftNode
    model.stop(other.id)
    runUntil(model, () => model.last.kind === 'drop', 300)
    expect(model.last).toMatchObject({ kind: 'drop', node: other.id })
    expect(model.last.text).toContain(`node ${other.id} is stopped`)
    expect(model.drops[model.drops.length - 1]).toMatchObject({ reason: 'stopped' })
    // Two of three is still a majority
    model.command('x=1')
    expect(runUntil(model, () => leader.commitIndex === 1, 500)).toBe(true)
    // With every node stopped there is nothing to run
    for (const node of model.nodes) model.stop(node.id)
    runUntil(model, () => model.messages.length === 0, 200)
    expect(model.idle()).toContain('Every node is stopped')
    const before = model.now
    expect(model.step().kind).toBe('quiet')
    expect(model.now).toBe(before + RAFT_LIMITS.tick)
  })
})

describe('raft: partitions', () => {
  it('a cut-off leader cannot commit; the majority elects a new one; healing repairs the old leader\'s log', () => {
    const model = make({ seed: 3 })
    const checker = new Checker(model)
    const run = (done: () => boolean, ms: number) =>
      runUntil(
        model,
        () => {
          checker.check('partition')
          return done()
        },
        ms
      )
    run(() => model.leader() !== null, 2000)
    const old = model.leader() as RaftNode
    model.command('a=1')
    run(() => model.nodes.every((x) => x.commitIndex === 1), 1000)
    const buddy = model.nodes.find((x) => x !== old) as RaftNode
    expect(model.partition([[old.id, buddy.id]]).ok).toBe(true)
    expect(model.partitioned).toBe(true)
    expect(model.connected(old.id, buddy.id)).toBe(true)
    // The old leader still takes a command, but 2 of 5 can never commit it
    expect(model.command('lost=1', old.id).ok).toBe(true)
    run(() => model.leaders().length === 2, 3000)
    const fresh = model.leader() as RaftNode
    expect(fresh.term).toBeGreaterThan(old.term)
    expect(model.connected(fresh.id, old.id)).toBe(false)
    model.command('b=2')
    run(() => fresh.commitIndex === 2, 1000)
    expect(old.role).toBe('leader')
    expect(old.commitIndex).toBe(1)
    expect(old.log.map((x) => x.command)).toEqual(['a=1', 'lost=1'])
    expect(model.events.some((x) => x.kind === 'drop' && x.text.includes('the network is cut'))).toBe(true)
    expect(model.heal().ok).toBe(true)
    expect(model.heal().ok).toBe(false)
    run(() => model.nodes.every((x) => x.commitIndex === 2), 2000)
    expect(old.role).toBe('follower')
    for (const node of model.nodes) expect(node.log.map((x) => x.command)).toEqual(['a=1', 'b=2'])
    expect(model.leaders()).toHaveLength(1)
  })

  it('reads sides loosely: unlisted nodes form their own side, junk is ignored', () => {
    const model = make()
    expect(model.partition([[1, 2]]).ok).toBe(true)
    expect(model.sides()).toEqual([[1, 2], [3, 4, 5]])
    expect(model.partition([[1, 9, 1.5], [1, 3], []]).ok).toBe(true)
    expect(model.sides()).toEqual([[1], [2, 4, 5], [3]])
    expect(model.partition([[1, 2, 3, 4, 5]]).ok).toBe(false)
    expect(model.partition([]).ok).toBe(false)
    expect(model.sides()).toEqual([[1], [2, 4, 5], [3]])
    expect(model.isolate(4).ok).toBe(true)
    expect(model.sides()).toEqual([[1, 2, 3, 5], [4]])
    expect(model.isolate(9).ok).toBe(false)
    const three = make({ nodes: 3 })
    three.partition([[1], [2], [3]])
    expect(three.last.text).toContain('No side has a majority')
  })

  it('a message sent across the cut gets half way and is dropped', () => {
    const model = still({ nodes: 3 })
    model.partition([[1]])
    model.node(1).electionAt = model.now + 1
    model.step()
    expect(model.messages.map((m) => m.doom)).toEqual(['partition', 'partition'])
    for (const m of model.messages) expect(model.progress(m)).toBeLessThanOrEqual(0.5)
    const event = model.step()
    expect(event.kind).toBe('drop')
    expect(model.node(2).term).toBe(0)
  })
})

describe('raft: client commands', () => {
  it('says plainly when there is no leader', () => {
    const model = make()
    const event = model.command('x=1')
    expect(event.ok).toBe(false)
    expect(event.kind).toBe('refused')
    expect(event.text).toContain('No node is leader')
    expect(model.nodes.every((x) => x.log.length === 0)).toBe(true)
    expect(model.command('   ').ok).toBe(false)
  })

  it('goes to the leader; a follower named as the target does not take it', () => {
    const model = make()
    runUntil(model, () => model.leader() !== null, 2000)
    const leader = model.leader() as RaftNode
    const other = model.nodes.find((x) => x !== leader) as RaftNode
    const refused = model.command('x=1', other.id)
    expect(refused.ok).toBe(false)
    expect(refused.text).toContain('not a leader')
    expect(model.command('x=1', 9).ok).toBe(false)
    const ok = model.command('  a   long command name  ')
    expect(ok.ok).toBe(true)
    expect(leader.log[0].command).toBe('a long comma')
    expect(model.messages.filter((m) => m.body.type === 'AppendEntries' && m.body.entries.length === 1)).toHaveLength(4)
  })

  it('a queue of commands is submitted one at a time once there is a leader', () => {
    const model = make({ commands: ['x=1', 'y=2', 'z=3'], nodes: 3 })
    runUntil(model, () => model.nodes.every((x) => x.commitIndex === 3), 3000)
    for (const node of model.nodes) expect(node.log.map((x) => x.command)).toEqual(['x=1', 'y=2', 'z=3'])
    expect(model.queue).toEqual([])
    expect(model.events.filter((x) => x.kind === 'client')).toHaveLength(3)
  })

  it('refuses once the log is full, since there is no compaction', () => {
    const model = make({ nodes: 3 })
    runUntil(model, () => model.leader() !== null, 2000)
    for (let i = 0; i < RAFT_LIMITS.log; i++) expect(model.command(`c${i}`).ok).toBe(true)
    const event = model.command('more')
    expect(event.ok).toBe(false)
    expect(event.text).toContain('no log compaction')
  })
})

describe('raft: the clock', () => {
  it('is deterministic: the same seed and calls give the same run', () => {
    const run = (seed: number) => {
      const model = make({ seed, loss: 0.1, duplicate: 0.1 })
      const out: string[] = []
      for (let i = 0; i < 400; i++) {
        if (i === 150) out.push(model.command('x=1').text)
        if (i === 200) model.isolate(2)
        if (i === 300) model.heal()
        const event = model.step()
        out.push(`${event.time} ${event.text}`)
      }
      return out
    }
    expect(run(7)).toEqual(run(7))
    expect(run(7)).not.toEqual(run(8))
  })

  it('time only moves forward, by at most one tick a step, and every step says something', () => {
    const model = make({ loss: 0.2 })
    let last = 0
    for (let i = 0; i < 600; i++) {
      const event = model.step()
      expect(model.now).toBeGreaterThanOrEqual(last)
      expect(model.now - last).toBeLessThanOrEqual(RAFT_LIMITS.tick)
      expect(event.text.length).toBeGreaterThan(20)
      expect(event.brief.length).toBeGreaterThan(3)
      expect(event.time).toBe(model.now)
      if (event.kind === 'quiet') expect(model.now - last).toBe(RAFT_LIMITS.tick)
      for (const m of model.messages) {
        expect(m.arriveAt).toBeGreaterThanOrEqual(model.now)
        expect(model.progress(m)).toBeGreaterThanOrEqual(0)
        expect(model.progress(m)).toBeLessThanOrEqual(1)
      }
      last = model.now
    }
    expect(model.events.length).toBeLessThanOrEqual(RAFT_LIMITS.events)
    expect(model.events.every((x) => x.kind !== 'quiet')).toBe(true)
  })

  it('latency is drawn from the range, and lost messages are dropped half way', () => {
    const model = make({ latency: [10, 20], loss: 0.3, seed: 4 })
    let lost = 0
    for (let i = 0; i < 800; i++) {
      const event = model.step()
      if (event.kind === 'drop' && event.text.includes('lost in the network')) lost++
      for (const m of model.messages) {
        const took = m.arriveAt - m.sentAt
        if (m.doom) expect(took).toBeLessThanOrEqual(10)
        else {
          expect(took).toBeGreaterThanOrEqual(10)
          expect(took).toBeLessThanOrEqual(20)
        }
      }
    }
    expect(lost).toBeGreaterThan(20)
  })
})

// ---------- Safety over many random schedules ----------

describe('raft: safety under random schedules', () => {
  const SCHEDULES = 320
  const EVENTS = 700

  it(`holds Election Safety, Log Matching, Leader Completeness and State Machine Safety over ${SCHEDULES} schedules`, () => {
    let commits = 0
    let elections = 0
    let overwritten = 0
    let withTwoLeaders = 0
    let calm = 0
    for (let seed = 1; seed <= SCHEDULES; seed++) {
      const rand = mulberry32(seed * 7919 + 13)
      const pickInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
      const nodes = seed % 2 ? 5 : 3
      const model = new Raft({
        nodes,
        seed,
        heartbeat: 50,
        election: [150, 300],
        // A wide range reorders messages; some schedules are slow enough for timeouts to race replies
        latency: [1, seed % 5 === 0 ? 180 : 60],
        loss: seed % 3 === 0 ? 0 : rand() * 0.25,
        duplicate: seed % 4 === 0 ? 0 : rand() * 0.25
      })
      const checker = new Checker(model)
      const context = `seed ${seed}`
      let n = 0
      let two = false
      for (let i = 0; i < EVENTS; i++) {
        const r = rand()
        if (r < 0.9) model.step()
        else if (r < 0.915) model.stop(pickInt(1, nodes))
        else if (r < 0.935) model.start(pickInt(1, nodes))
        else if (r < 0.945) {
          // A random cut: each node lands on one of two or three sides
          const sides: number[][] = [[], [], []]
          for (let id = 1; id <= nodes; id++) sides[pickInt(0, rand() < 0.3 ? 2 : 1)].push(id)
          model.partition(sides)
        } else if (r < 0.96) model.heal()
        else if (r < 0.965 && model.leader()) model.isolate((model.leader() as RaftNode).id)
        else {
          // To the newest leader, or to any node that believes it leads (a stale one included)
          const leaders = model.leaders()
          const target = leaders.length && rand() < 0.5 ? leaders[pickInt(0, leaders.length - 1)].id : undefined
          model.command(`s${seed}c${n++}`.slice(0, RAFT_LIMITS.command), target)
        }
        checker.check(context)
        if (model.leaders().length > 1) two = true
        for (const event of model.events.slice(-1)) if (event.text.includes('conflicts')) overwritten++
      }
      if (two) withTwoLeaders++
      commits += checker.committed.length
      elections += checker.elections

      // Then calm: heal, start everything, a clean network. The cluster must settle.
      model.heal()
      for (const node of model.nodes) model.start(node.id)
      model.loss = 0
      model.duplicate = 0
      model.latency = [15, 35]
      const settle = (done: () => boolean, ms: number) =>
        runUntil(
          model,
          () => {
            checker.check(`${context}, calm`)
            return done()
          },
          ms
        )
      // In-flight strays from the storm may still depose a leader, so wait for one that lasts
      expect(settle(() => model.leaders().length === 1 && model.nodes.every((x) => x.term === (model.leader() as RaftNode).term), 20000), `${context}: one leader`).toBe(true)
      // A client that retries: a leader commits nothing until it has an entry of its own term
      // (there is no no-op entry), and a stray from the storm may still replace the leader.
      let full = false
      const settled = settle(() => {
        const leader = model.leader()
        if (!leader) return false
        if (!leader.log.length || leader.log[leader.log.length - 1].term !== leader.term) {
          if (leader.log.length >= RAFT_LIMITS.log) return (full = true)
          expect(model.command('final').ok).toBe(true)
          return false
        }
        return model.nodes.every((x) => x.commitIndex === leader.log.length && x.log.length === leader.log.length)
      }, 20000)
      expect(settled, `${context}: everything committed everywhere`).toBe(true)
      if (full) continue
      const logs = model.nodes.map((x) => JSON.stringify(x.log))
      expect(new Set(logs).size).toBe(1)
      calm++
    }
    // The schedules really exercised the protocol
    expect(commits).toBeGreaterThan(SCHEDULES * 2)
    expect(elections).toBeGreaterThan(SCHEDULES * 2)
    expect(overwritten).toBeGreaterThan(10)
    expect(withTwoLeaders).toBeGreaterThan(10)
    expect(calm).toBeGreaterThan(SCHEDULES * 0.9)
  })
})

describe('raft: safety from the Figure 8 state under random schedules', () => {
  it('never loses a committed entry while leaders with competing logs come and go', () => {
    let commits = 0
    let replaced = 0
    for (let seed = 1; seed <= 150; seed++) {
      const rand = mulberry32(seed * 104729 + 7)
      const pickInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
      const model = make({ scenario: 'figure-8', seed, latency: [1, 50] })
      const checker = new Checker(model)
      let n = 0
      for (let i = 0; i < 900; i++) {
        const r = rand()
        if (r < 0.93) model.step()
        else if (r < 0.95) {
          // Mostly the leader: that is what lets a node with a competing log take over
          const leader = model.leader()
          model.stop(leader && rand() < 0.7 ? leader.id : pickInt(1, 5))
        } else if (r < 0.98) model.start(pickInt(1, 5))
        else model.command(`f${seed}c${n++}`.slice(0, RAFT_LIMITS.command))
        checker.check(`figure-8 seed ${seed}`)
        if (model.last.text.includes('conflicts')) replaced++
      }
      commits += checker.committed.length
    }
    expect(commits).toBeGreaterThan(300)
    expect(replaced).toBeGreaterThan(20)
  })
})

describe('raft: liveness in a calm network', () => {
  it('elects a leader and commits a command on every node within a bounded time', () => {
    for (const nodes of [3, 5])
      for (let seed = 1; seed <= 60; seed++) {
        const model = make({ nodes, seed })
        const checker = new Checker(model)
        const run = (done: () => boolean, ms: number) =>
          runUntil(
            model,
            () => {
              checker.check(`calm ${nodes}/${seed}`)
              return done()
            },
            ms
          )
        // Timeouts are 150 to 300 ms: a leader within a few of them, even after a split vote
        expect(run(() => model.leader() !== null, 1500), `leader, ${nodes} nodes, seed ${seed}`).toBe(true)
        const leader = model.leader() as RaftNode
        const at = model.now
        expect(model.command('x=1').ok).toBe(true)
        // One round trip to commit, one more heartbeat to tell the followers
        expect(run(() => model.nodes.every((x) => x.commitIndex === 1), 200), `commit, ${nodes} nodes, seed ${seed}`).toBe(true)
        expect(model.now - at).toBeLessThanOrEqual(2 * 35 + 50 + 35)
        expect(model.leader()).toBe(leader)
      }
  })

  it('a majority is enough: with a minority stopped or cut off, commands still commit on the rest', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const model = make({ seed })
      runUntil(model, () => model.leader() !== null, 1500)
      const leader = model.leader() as RaftNode
      const others = model.nodes.filter((x) => x !== leader)
      model.stop(others[0].id)
      model.isolate(others[1].id)
      model.command('x=1')
      const live = [leader, others[2], others[3]]
      expect(runUntil(model, () => live.every((x) => x.commitIndex === 1), 400), `seed ${seed}`).toBe(true)
      // One more stopped and there is no majority: nothing further commits
      model.stop(others[2].id)
      model.command('y=2')
      runUntil(model, () => false, 1500)
      expect(model.maxCommit()).toBe(1)
    }
  })
})

// ---------- Spec ----------

describe('raft: spec', () => {
  const parse = (json: string) => parseSim(json) as RaftSpec

  it('has sensible defaults from the kind alone', () => {
    expect(parse('{"kind":"raft"}')).toEqual({ kind: 'raft', title: '', seed: 1, tour: [], nodes: 5, heartbeat: 50, election: [150, 300], latency: [15, 35], loss: 0, scenario: 'fresh', commands: [] })
    expect(parse('{"kind":"consensus"}').kind).toBe('raft')
  })

  it('reads sizes, aliases and loose values, and clamps', () => {
    expect(parse('{"kind":"raft","nodes":3}').nodes).toBe(3)
    expect(parse('{"kind":"raft","nodes":4}').nodes).toBe(5)
    expect(parse('{"kind":"raft","nodes":1}').nodes).toBe(3)
    expect(parse('{"kind":"raft","nodes":99}').nodes).toBe(5)
    expect(parse('{"kind":"raft","servers":"3"}').nodes).toBe(3)
    expect(parse('{"kind":"raft","nodes":["a","b","c"]}').nodes).toBe(3)
    expect(parse('{"kind":"raft","nodes":"many"}').nodes).toBe(5)
    expect(parse('{"kind":"raft","heartbeat":20,"election":[100,200]}')).toMatchObject({ heartbeat: 20, election: [100, 200] })
    expect(parse('{"kind":"raft","electionTimeout":200}').election).toEqual([200, 400])
    expect(parse('{"kind":"raft","election":{"min":200,"max":250}}').election).toEqual([200, 250])
    expect(parse('{"kind":"raft","election":[400,200]}').election).toEqual([200, 400])
    // A timeout below two heartbeats is raised so a healthy leader is not deposed
    expect(parse('{"kind":"raft","heartbeat":100,"election":[50,120]}').election).toEqual([200, 200])
    expect(parse('{"kind":"raft","heartbeat":99999}').heartbeat).toBe(500)
    expect(parse('{"kind":"raft","election":"soon","latency":null,"heartbeat":"x"}')).toMatchObject({ election: [150, 300], latency: [15, 35], heartbeat: 50 })
    expect(parse('{"kind":"raft","latency":[5,90]}').latency).toEqual([5, 90])
    expect(parse('{"kind":"raft","latency":25}').latency).toEqual([25, 25])
    expect(parse('{"kind":"raft","latency":[-5,99999]}').latency).toEqual([1, 500])
    expect(parse('{"kind":"raft","loss":0.1}').loss).toBe(0.1)
    expect(parse('{"kind":"raft","loss":20}').loss).toBe(0.2)
    expect(parse('{"kind":"raft","loss":0.99}').loss).toBe(0.5)
    expect(parse('{"kind":"raft","loss":-1}').loss).toBe(0)
    expect(parse('{"kind":"raft","seed":42,"title":"Leader election"}')).toMatchObject({ seed: 42, title: 'Leader election' })
  })

  it('reads the scenario and the client queue', () => {
    expect(parse('{"kind":"raft","scenario":"figure-8","nodes":3}')).toMatchObject({ scenario: 'figure-8', nodes: 5 })
    expect(parse('{"kind":"raft","scenario":"Figure 8"}').scenario).toBe('figure-8')
    expect(parse('{"kind":"raft","start":"fig8"}').scenario).toBe('figure-8')
    expect(parse('{"kind":"raft","scenario":"chaos"}').scenario).toBe('fresh')
    expect(parse('{"kind":"raft","commands":["x=1"," y = 2 ",7,null,"","a very long command indeed"]}').commands).toEqual(['x=1', 'y = 2', '7', 'a very long'])
    expect(parse('{"kind":"raft","commands":"x=1"}').commands).toEqual(['x=1'])
    expect(parse(`{"kind":"raft","commands":${JSON.stringify(Array.from({ length: 30 }, (_, i) => `c${i}`))}}`).commands).toHaveLength(RAFT_LIMITS.queue)
  })

  it('keeps its own tour verbs and drops others', () => {
    const spec = parse(
      JSON.stringify({
        kind: 'raft',
        tour: [
          { at: 'Leader', say: 'Wait for a leader.', do: { run: 40 } },
          { at: 'node:2', say: 'Stop it.', do: { stop: 'leader', insert: 4, run: 20 } },
          { at: 'network', say: 'Cut.', do: { partition: [[1, 2], [3, 4, 5]], teleport: true } },
          { at: 'log:1', say: 'Submit.', do: { command: 'x=1', to: 1, heal: true, start: 2, isolate: 3 } },
          { at: 'entry:1:1', say: 'Only junk.', do: { explode: 1 } }
        ]
      })
    )
    expect(spec.tour.map((x) => x.do)).toEqual([
      { run: 40 },
      { stop: 'leader', run: 20 },
      { partition: [[1, 2], [3, 4, 5]] },
      { command: 'x=1', to: 1, heal: true, start: 2, isolate: 3 },
      undefined
    ])
    expect(spec.tour[0].at).toBe('leader')
  })

  it('a model built from the parsed spec runs', () => {
    const spec = parse('{"kind":"raft","nodes":3,"commands":["x=1"],"seed":9}')
    const model = new Raft(spec)
    runUntil(model, () => model.nodes.every((x) => x.commitIndex === 1), 3000)
    expect(model.maxCommit()).toBe(1)
  })
})

// ---------- Parts ----------

describe('raft: parts', () => {
  function busy(): Raft {
    const model = make({ seed: 2 })
    runUntil(model, () => model.leader() !== null, 2000)
    model.command('x=1')
    runUntil(model, () => model.nodes.every((x) => x.commitIndex === 1), 1000)
    model.command('y=2')
    return model
  }

  it('parses names counted from 1 and rejects what is not there', () => {
    const model = busy()
    const leader = model.leader() as RaftNode
    expect(parseRaftPart('node:1', model)).toEqual({ type: 'node', n: 1 })
    expect(parseRaftPart(' Log:5 ', model)).toEqual({ type: 'log', n: 5 })
    expect(parseRaftPart('timer:3', model)).toEqual({ type: 'timer', n: 3 })
    expect(parseRaftPart(`entry:${leader.id}:2`, model)).toEqual({ type: 'entry', n: leader.id, i: 2 })
    for (const name of ['leader', 'term', 'commit', 'messages', 'network', 'clock']) expect(parseRaftPart(name, model)).toEqual({ type: name })
    expect(parseRaftPart('partition', model)).toEqual({ type: 'network' })
    expect(parseRaftPart('time', model)).toEqual({ type: 'clock' })
    const flying = model.messages[0]
    expect(parseRaftPart(`message:${flying.id}`, model)).toEqual({ type: 'message', id: flying.id })
    for (const name of ['node:0', 'node:6', 'node', 'node:1:2', 'entry:1', `entry:${leader.id}:3`, 'entry:1:0', 'log:1.5', 'message:99999', 'leader:1', 'constructor', 'toString', '', 'nonsense'])
      expect(parseRaftPart(name, model), name).toBe(null)
    expect(parseRaftPart('node:4', make({ nodes: 3 }))).toBe(null)
  })

  it('labels carry the current numbers and read as a phrase', () => {
    const model = busy()
    const leader = model.leader() as RaftNode
    const follower = model.nodes.find((x) => x !== leader) as RaftNode
    const say = (name: string) => describeRaftPart(model, parseRaftPart(name, model)!)
    expect(say(`node:${leader.id}`).label).toBe(`node ${leader.id} (leader in term ${leader.term}, voted for itself, 2 entries in its log, commit index 1)`)
    expect(say(`node:${leader.id}`).values).toMatchObject({ role: 'leader', term: leader.term, 'commit index': 1, 'log length': 2 })
    expect(say(`node:${follower.id}`).label).toBe(`node ${follower.id} (follower in term ${leader.term}, voted for node ${leader.id}, 1 entry in its log, commit index 1)`)
    expect(say(`log:${leader.id}`).label).toBe(`node ${leader.id}'s log (2 entries, from terms ${leader.term}, ${leader.term}; committed up to index 1)`)
    expect(say(`log:${leader.id}`).values).toMatchObject({ length: 2, 'index 1': `x=1 (term ${leader.term})`, 'index 2': `y=2 (term ${leader.term})` })
    expect(say(`entry:${leader.id}:1`).label).toBe(`entry 1 in node ${leader.id}'s log (command "x=1" from term ${leader.term}, committed; 5 of 5 nodes hold it)`)
    expect(say(`entry:${leader.id}:2`).label).toContain(`not committed as far as node ${leader.id} knows; 1 of 5 nodes hold it`)
    expect(say(`entry:${leader.id}:2`).values).toEqual({ index: 2, term: leader.term, command: 'y=2', committed: 'no', copies: 1, 'majority needs': 3 })
    expect(say(`timer:${follower.id}`).label).toBe(`node ${follower.id}'s election timer (${follower.electionAt - model.now} ms left of ${follower.electionSpan}, drawn at random from 150 to 300 ms)`)
    expect(say(`timer:${leader.id}`).label).toContain('a leader runs no election timer')
    expect(say('leader').label).toBe(`the leader (node ${leader.id}, elected for term ${leader.term} with ${leader.votes.length} of 5 votes)`)
    expect(say('leader').values.nextIndex).toBe(model.nodes.map((x) => (x === leader ? '–' : leader.nextIndex[x.id - 1])).join(' '))
    expect(say('term').label).toBe(`the current term (the highest is ${leader.term}; nodes 1 to 5 are in terms ${model.nodes.map((x) => x.term).join(', ')})`)
    expect(say('commit').label).toBe('the commit index (the highest is 1; nodes 1 to 5 have 1, 1, 1, 1, 1)')
    expect(say('messages').label).toContain(`the messages in flight (${model.messages.length} at ${model.now} ms`)
    expect(say('network').label).toContain('whole')
    expect(say('clock').values).toMatchObject({ 'time ms': model.now, 'heartbeat ms': 50 })
    const m = model.messages.find((x) => x.body.type === 'AppendEntries' && x.body.entries.length)!
    expect(say(`message:${m.id}`).label).toBe(`the AppendEntries from node ${m.from} to node ${m.to} (term ${leader.term}, prevLogIndex 1, prevLogTerm ${leader.term}, 1 entry, leaderCommit 1)`)
    for (const name of ['node:1', 'log:1', 'entry:1:1', 'timer:1', 'leader', 'term', 'commit', 'messages', 'network', 'clock']) {
      const info = say(name)
      expect(info.label).toMatch(/^[a-z]/)
      expect(info.label.endsWith('.')).toBe(false)
      expect(Object.keys(info.values).length).toBeGreaterThan(0)
      expect(Object.keys(info.values).length).toBeLessThanOrEqual(7)
    }
  })

  it('describes stopped nodes, a missing leader, two leaders and a cut network', () => {
    const model = busy()
    const leader = model.leader() as RaftNode
    const say = (name: string) => describeRaftPart(model, parseRaftPart(name, model)!)
    model.isolate(leader.id)
    expect(say('network').label).toContain('cut into')
    expect(say('network').values.state).toBe('partitioned')
    runUntil(model, () => model.leaders().length === 2, 3000)
    expect(say('leader').label).toContain(`node ${leader.id} still believes it leads term ${leader.term}`)
    model.stop(leader.id)
    expect(say(`node:${leader.id}`).label).toBe(`node ${leader.id} (stopped; on disk it keeps term ${leader.term}, its vote for itself and 2 entries)`)
    expect(say(`timer:${leader.id}`).label).toContain('not running')
    const fresh = make()
    expect(describeRaftPart(fresh, { type: 'leader' }).label).toBe('the leader (there is none at the moment; the highest term is 0)')
    expect(describeRaftPart(fresh, { type: 'log', n: 1 }).label).toBe("node 1's log (empty; committed up to index 0)")
    expect(describeRaftPart(fresh, { type: 'messages' }).label).toBe('the messages in flight (none at 0 ms)')
  })
})
