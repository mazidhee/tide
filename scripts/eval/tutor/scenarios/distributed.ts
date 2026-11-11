/**
 * Distributed systems: one scenario for each kind of situation. Tutor turns in a history are
 * written the way the lesson's rules ask (tags, hidden <solution>), since they are what the model
 * saw. The vector clock trace, the quorum and failure-count arithmetic and the ring lookup's
 * behaviour were all worked by running them.
 */
import type { Scenario } from '../types'

const r = String.raw

export const DISTRIBUTED: Scenario[] = [
  {
    id: 'distributed-open-cap-partition',
    subject: 'distributed',
    situation: 'open',
    setup: { mode: 'teach', topic: 'The CAP theorem and what a partition forces', options: { why: true } },
    history: [],
    expect: { ends: 'ask', askTypes: ['short', 'predict', 'choice', 'explain'], heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'] },
    good: r`**Why this matters**

Any system that keeps copies of data on more than one machine has to decide what to do when those machines cannot reach each other. The CAP theorem is the exact statement of what that decision costs, and every replicated store has taken a side: etcd and ZooKeeper behave one way when the network splits, Cassandra and Dynamo-style stores the other. Their consistency settings, and the outages and anomalies each is prone to, follow from that choice. Once you can derive the trade yourself, a new database's documentation reads as a position on it.

<ask type="predict">Two replicas of a key-value store both hold x = 1. The link between them fails, but clients can still reach each replica. One client writes x = 2 to replica A; then another client asks replica B for x. List everything B could do, and say what is wrong with each.</ask>`,
    bad: [
      {
        reply: r`Hello! The CAP theorem is a great topic. It says you can only pick two of consistency, availability and partition tolerance.

Have you come across CAP before? Which two would you pick for a bank?`,
        fails: ['no-preamble', 'heading'],
        repaired: ['ask']
      }
    ],
    judge: 'In Why mode the opening must not hand over the theorem as "pick two of three"; it says where the trade shows up in real stores and asks a question the learner can reason out.'
  },
  {
    id: 'distributed-after-correct-quorum-overlap',
    subject: 'distributed',
    situation: 'after-correct',
    setup: { mode: 'quiz', topic: 'Quorum reads and writes in replicated stores' },
    history: [
      {
        tutor: r`**Question 1 of 8**

<ask type="choice" options="R + W > N|R + W = N|W > R|R = N - W">A store keeps N replicas of each key. A write waits for W acknowledgements and a read asks R replicas. Which condition guarantees that every read quorum shares at least one replica with every write quorum?</ask>`
      },
      { learner: { answer: 'R + W > N', confidence: 'sure' } },
      {
        tutor: r`<grade verdict="correct" score="1">"R + W > N" is the condition: R replicas and W replicas chosen from N must share one when together they number more than N.</grade>

**Question 2 of 8**

A store has N = 5 and W = 4. What is the smallest R for which every read reaches at least one replica holding the latest acknowledged write, and how many unreachable replicas can a read then tolerate?

<solution>R + 4 > 5 gives R >= 2, so R = 2. A read needs 2 of the 5 replicas to answer, so it tolerates 3 unreachable replicas.</solution>

<ask type="problem">R, and the number of failures a read survives, with your reasoning.</ask>`
      },
      { learner: { answer: 'R = 2. A write is on at least 4 of the 5 replicas, so at most one replica is missing it, and any two replicas must include one that has it: 2 + 4 = 6 > 5. A read needs only 2 of the 5 to answer, so it survives 3 replicas being down.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', must: ['Question 3 of 8'], mustNot: ['Question 2 of 8'] },
    good: r`<grade verdict="correct" score="1">"at most one replica is missing it, and any two replicas must include one that has it" is the overlap argument, and R = 2 leaves 3 replicas a read can do without.</grade>

**Question 3 of 8**

<solution>The flaw is treating overlap as mutual exclusion. With N = 3 and W = 2 any two write quorums share a replica, but that replica simply receives both writes; each client can still collect 2 acknowledgements. Both writes succeed and the store holds conflicting versions that have to be resolved (by version vectors, last write wins, or the application).</solution>

<ask type="error">Find the flaw in this claim about a leaderless store with N = 3, W = 2, R = 2: "Two clients that write the same key at the same moment cannot both succeed, because any two write quorums overlap in at least one replica."</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">R = 2 is right, but you did not state the formula R + W > N.</grade>

**Question 2 of 8**

<ask type="short">What does W stand for?</ask>`,
        fails: ['verdict', 'must', 'must-not']
      }
    ],
    judge: 'It marks the overlap argument correct, numbers the next question "Question 3 of 8", and makes it harder than the last.'
  },
  {
    id: 'distributed-after-wrong-exactly-once-acks',
    subject: 'distributed',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Delivery guarantees and idempotency', options: { strategy: 'dialogue' } },
    history: [
      {
        tutor: r`**Why this matters**

Every queue consumer, webhook handler and retried RPC in a payments or orders system rests on a delivery guarantee. Misjudging which one you have shows up as double charges or lost orders, and it is the first thing to check when a ledger does not reconcile.

<ask type="short">A consumer takes a "charge the card £40" message from a queue, charges the card, then acknowledges the message. The broker redelivers any message not acknowledged within 30 seconds. Can the card be charged twice? Say how, or why not.</ask>`
      },
      { learner: { answer: 'No. The broker only redelivers messages that were not acknowledged, and the consumer acknowledges every message it processes, so each message is processed exactly once. Acknowledgements are what give you exactly-once delivery.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      askTypes: ['short', 'explain'],
      verdict: 'wrong',
      names: ['at[- ]least[- ]once|duplicate|redeliver|second time|twice|again', 'crash|dies|fail|lost|slow|timeout|before (the|its|it) ack'],
      need: ['card']
    },
    good: r`<grade verdict="wrong" score="0">"the consumer acknowledges every message it processes" is the step that fails: charging and acknowledging are two separate actions, and the consumer can crash, or the acknowledgement can be lost, between them.</grade>

If the consumer charges the card and dies before its acknowledgement reaches the broker, the broker sees an unacknowledged message, redelivers it after 30 seconds, and the card is charged a second time. Acknowledging after processing gives at-least-once delivery. Acknowledging before processing gives at-most-once: a crash then loses the charge instead. No ordering of the two steps gives exactly once.

<card>Why does acknowledging after processing not give exactly-once? :: The consumer can crash, or the ack be lost, after the side effect and before the ack arrives; the broker redelivers, so the guarantee is at-least-once.</card>

<ask type="explain">Keep acknowledging after processing, so duplicates will arrive. What would you change in the consumer or in the charge request so that a redelivered message does not charge the card again?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, acknowledgements tell the broker the message is done, so it is handled exactly once.</grade>

<ask type="short">What is a message broker?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure that acknowledgements give exactly-once. The reply must name the gap between the side effect and the ack, call the guarantee at-least-once, and probe towards idempotency without setting a problem.'
  },
  {
    id: 'distributed-idk-two-phase-commit-blocking',
    subject: 'distributed',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Two-phase commit' },
    history: [
      {
        tutor: r`**Why this matters**

Two-phase commit is how a transaction that spans several databases or shards commits everywhere or nowhere. XA transactions, and the cross-shard commits of distributed SQL stores, are built on it. Its failure behaviour is the reason those systems put the coordinator's decision in a replicated log.

<ask type="short">In two-phase commit every participant has voted yes and is waiting for the outcome. The coordinator crashes before sending it. What can a participant safely do on its own?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', must: ['coordinator', 'block|wait|stuck'], forbid: ['grade'], words: { max: 200 } },
    good: r`Nothing: it has to wait. A participant that has voted yes has promised to commit if told to, and it does not know the decision. It cannot abort, because the coordinator may have decided commit and already told another participant, which has committed. It cannot commit, because another participant may have voted no, in which case the decision was abort. Either move could leave the participants disagreeing, so it holds its locks until the coordinator recovers and reads the decision from its log. This is the blocking problem of two-phase commit.

<ask type="choice" options="Abort, because no commit can happen without its yes vote|Commit, because the other participants have probably voted yes|Wait for the coordinator, as a participant must after voting yes|Ask another participant to take over as coordinator">A different case: the coordinator crashes before one participant has voted at all. What can that participant safely do on its own?</ask>`,
    judge: 'It teaches why a prepared participant can neither commit nor abort, briefly, and the next question is easier than the one that drew "I don\'t know".'
  },
  {
    id: 'distributed-show-me-raft-states',
    subject: 'distributed',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'Raft leader election' },
    history: [
      {
        tutor: r`A Raft server is always in one of three states. It starts as a follower, which only answers requests from others. If a follower's election timeout passes with no heartbeat from a leader, it becomes a candidate: it increments its term, votes for itself and asks the others for their votes. A candidate that collects votes from a majority becomes leader. A candidate that hears from a leader whose term is at least its own, or sees any higher term, goes back to follower. A candidate whose timeout passes with no winner, as after a split vote, starts a new election in a new term. A leader that sees a higher term steps down to follower.

<note>Raft states: follower → candidate on election timeout (term + 1, votes for itself); candidate → leader on votes from a majority; candidate → follower on hearing a current leader or a higher term; candidate → candidate on another timeout (new term); leader → follower on seeing a higher term.</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: { kind: 'mermaid', diagram: ['stateDiagram'] }, forbid: ['grade'], must: ['follower', 'candidate', 'leader'] },
    good: r`~~~mermaid
stateDiagram-v2
    [*] --> Follower
    Follower --> Candidate: election timeout, no heartbeat
    Candidate --> Candidate: timeout with no winner, new term
    Candidate --> Leader: votes from a majority
    Candidate --> Follower: hears a current leader or a higher term
    Leader --> Follower: sees a higher term
~~~

Look at the arrows into Follower: both Candidate and Leader return there on seeing a higher term, and there is no arrow from Follower straight to Leader.`.replace(/~~~/g, '```'),
    bad: [
      {
        reply: r`A Raft server moves from follower to candidate when its timer runs out, and from candidate to leader when it wins a majority of votes.

<ask type="short">What makes a leader step down?</ask>`,
        fails: ['ends', 'visual']
      },
      {
        reply: r`~~~mermaid
flowchart LR
    F["Follower"] --> C["Candidate"]
    C --> L["Leader"]
    L --> F
~~~

Look at the loop from Leader back to Follower.`.replace(/~~~/g, '```'),
        fails: ['visual']
      }
    ],
    judge: 'A state diagram with exactly the transitions taught (including candidate to candidate and both returns to follower), labelled with their triggers, and one line on what to look at.'
  },
  {
    id: 'distributed-mark-planted-error-vector-clock-merge',
    subject: 'distributed',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'Vector clocks' },
    history: [
      {
        tutor: r`**Problem 2 · same level**

Three processes P1, P2 and P3 keep vector clocks [P1, P2, P3], all starting at [0, 0, 0]. Sending and receiving each count as an event. These happen in order:

1. P1 has a local event a.
2. P1 sends message m1 to P2 (event b).
3. P3 has a local event c.
4. P2 receives m1 (event d).
5. P2 sends message m2 to P3 (event e).
6. P3 receives m2 (event f).

Give the vector clock of each event, and say whether c and d are concurrent.

<solution>a = [1,0,0]. b = [2,0,0], and m1 carries [2,0,0]. c = [0,0,1]. d: element-wise max of [0,0,0] and [2,0,0] is [2,0,0], then P2 increments its own entry: [2,1,0]. e = [2,2,0], and m2 carries [2,2,0]. f: element-wise max of [0,0,1] and [2,2,0] is [2,2,1], then P3 increments its own entry: [2,2,2]. c = [0,0,1] and d = [2,1,0]: neither is less than or equal to the other in every entry, so they are concurrent.</solution>

<ask type="problem">The six clocks, and whether c and d are concurrent, with your working.</ask>`
      },
      { learner: { answer: 'a = [1,0,0]. b = [2,0,0], so m1 carries [2,0,0]. c = [0,0,1]. d: P2 merges [0,0,0] with [2,0,0] to get [2,0,0] and increments its own entry, so d = [2,1,0]. e = [2,2,0], so m2 carries [2,2,0]. f: P3 takes the clock on the message, [2,2,0], and increments its own entry, so f = [2,2,1]. c = [0,0,1] and d = [2,1,0]: c is bigger in the third entry and d is bigger in the first two, so neither happened before the other and they are concurrent.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'partial', accept: ['wrong'], names: [r`2\s*,\s*2\s*,\s*2|\bmax|overwr|cop(y|ie[sd])|discard|los[te]s?\b|replac`] },
    good: r`<grade verdict="partial" score="0.7">Clocks a to e and the concurrency argument are right. The step that fails is "P3 takes the clock on the message, [2,2,0], and increments its own entry": a receive takes the element-wise max of the receiver's clock and the message's, and P3 already held [0,0,1]. The max is [2,2,1], and the increment makes f = [2,2,2]. Copying the message's clock loses P3's own event c.</grade>

<card>What does a process do to its vector clock on receiving a message? :: Take the element-wise max of its own clock and the message's clock, then increment its own entry. It never just copies the message's clock.</card>

**Problem 3 · same level**

P1's clock is [3, 1, 0]. It receives a message stamped [1, 4, 2]. What is P1's clock after the receive event?

<solution>Element-wise max of [3,1,0] and [1,4,2] is [3,4,2]. P1 increments its own entry: [4,4,2].</solution>

<ask type="problem">The clock after the receive, with both steps shown.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Every step follows the vector clock rules, and "they are concurrent" is right for c and d.</grade>

**Problem 3 · harder**

Add a fourth process P4 that sends a message to P1 after event f. What is the new clock at P1?

<ask type="problem">Your answer.</ask>`,
        fails: ['verdict', 'names'],
        repaired: ['solution']
      }
    ],
    judge: 'Five of six clocks and the concurrency claim are right; the receive at f copies the message clock instead of merging. The reply must point at that step and give [2,2,2], not mark the whole answer correct.'
  },
  {
    id: 'distributed-mark-unusual-correct-failure-counts',
    subject: 'distributed',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Fault tolerance: crash and Byzantine failure counts' },
    history: [
      {
        tutor: r`**Problem 1 · warm-up**

A cluster has 7 nodes. (a) How many crash failures can a majority-quorum protocol such as Raft tolerate and still make progress? (b) How many Byzantine nodes can a protocol such as PBFT tolerate?

<solution>(a) Crash faults need n >= 2f + 1: 7 >= 2f + 1 gives f = 3. (b) Byzantine faults need n >= 3f + 1: 7 >= 3f + 1 gives f = 2.</solution>

<ask type="problem">Both numbers, with how you got them.</ask>`
      },
      { learner: { answer: 'I could not remember the formulas so I worked from quorums. (a) 3: progress needs a majority, 4 of 7, still alive, so 7 - f >= 4. (b) 2: a quorum can have at most 7 - f nodes, because f of them might never answer. Two quorums of that size share at least 2(7 - f) - 7 = 7 - 2f nodes. The shared part has to contain at least one honest node, so it must be bigger than f: 7 - 2f >= f + 1, so 3f <= 6 and f is at most 2.' } }
    ],
    expect: { ends: 'ask', verdict: 'correct' },
    good: r`<grade verdict="correct" score="1">"7 - f >= 4" gives 3 and "7 - 2f >= f + 1, so 3f <= 6" gives 2: both right, and your overlap argument is where n >= 3f + 1 comes from, since quorums of n - f overlap in n - 2f nodes and that must exceed f.</grade>

**Problem 2 · harder**

A system must tolerate 3 Byzantine nodes. What is the smallest cluster that can do it, what quorum size does it use, and in how many nodes do two quorums overlap at the least?

<solution>n = 3f + 1 = 10. Quorum size n - f = 7 (which is 2f + 1). Two quorums overlap in at least 2 × 7 - 10 = 4 nodes, which is f + 1, so at least one is honest.</solution>

<ask type="problem">Cluster size, quorum size and minimum overlap, with your working.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Your numbers match, but the expected method is the formulas n = 2f + 1 and n = 3f + 1, which you did not use.</grade>

<ask type="short">State the formula for the Byzantine case.</ask>`,
        fails: ['verdict']
      }
    ],
    judge: 'The learner derived both bounds from quorum overlap instead of quoting 2f+1 and 3f+1. The derivation is sound, so the only fair verdict is correct.'
  },
  {
    id: 'distributed-tangent-linearizable-vs-serializable',
    subject: 'distributed',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'Linearizability', options: { strategy: 'dialogue' } },
    history: [
      {
        tutor: r`**Why this matters**

Linearizability is the guarantee behind locks, leader election and unique-username checks: the things that break if two clients see different versions of the truth. etcd, ZooKeeper and Spanner promise it; many replicated stores do not by default, and the difference decides whether a "read after write" can be trusted.

<ask type="short">A client writes x = 5 to a replicated register and gets back OK. Just afterwards a second client reads x from another replica and gets 3, the old value. Does a linearizable system allow that? Say why.</ask>`
      },
      { learner: { question: 'Is linearizable the same thing as serializable? I see both words used about databases.' } }
    ],
    expect: { ends: 'ask', askTypes: ['short', 'explain', 'predict'], forbid: ['grade'], must: ['transaction', 'real[- ]time|wall[- ]clock|single (object|operation|register|key)|one (object|operation|register|key)|individual operation'], words: { max: 170 } },
    good: r`No. They are guarantees about different things. Serializability is about transactions, each a group of operations over several objects: the outcome must equal that of running the transactions one at a time in some order, and that order need not match the order in which they ran in real time. Linearizability is about single operations on one object: each must appear to take effect at one instant between its call and its return, so real-time order is respected. A database can give either without the other; one that gives both is called strictly serializable.

That real-time requirement is what the pending question turns on.

<ask type="short">One client's write of x = 5 has returned OK. After that, a second client reads x from a different replica and sees 3. Is that permitted under linearizability, and why?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="wrong" score="0">You did not answer the question about x = 5.</grade>

Yes, they mean the same thing: both say the system behaves as if operations ran one after another.

<ask type="short">Does a linearizable system allow the stale read?</ask>`,
        fails: ['forbid:grade', 'must']
      }
    ],
    judge: 'It says they differ (transactions over many objects with any serial order, against single operations in real-time order), briefly, then returns to the stale-read question without answering it.'
  },
  {
    id: 'distributed-recall-open-crdts',
    subject: 'distributed',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'CRDTs (conflict-free replicated data types)' },
    history: [],
    expect: { ends: 'ask', askTypes: ['explain'], forbid: ['grade', 'summary', 'card'], mustNot: ['commutativ|associativ|idempoten', 'G-?Counter|PN-?Counter|OR-?Set|LWW|last[- ]write', 'converge'], words: { max: 60 } },
    good: r`<ask type="explain">Explain CRDTs from memory, as fully as you can: what problem they solve, what makes one work, and an example.</ask>`,
    bad: [
      {
        reply: r`A CRDT is a data type whose merge is commutative, associative and idempotent, so replicas converge without coordination. A G-Counter is the simplest one.

<ask type="short">How does a G-Counter merge two states?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'distributed-code-bug-hash-ring-wraparound',
    subject: 'distributed',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'Consistent hashing' },
    history: [
      {
        tutor: r`**Problem 2 · harder**

A consistent-hash ring is stored as a list of (position, node) pairs sorted by position. A key belongs to the first node at or after the key's hash going clockwise, and the ring wraps: past the last position you arrive back at the first node.

<solution>import bisect

def lookup(ring, key_hash):
    positions = [pos for pos, _ in ring]
    i = bisect.bisect_left(positions, key_hash)
    return ring[i % len(ring)][1]

With ring = [(100, "a"), (200, "b"), (300, "c")]: lookup(ring, 150) is "b", lookup(ring, 300) is "c", lookup(ring, 350) wraps to "a".</solution>

<ask type="code" lang="python">Write lookup(ring, key_hash) that returns the node owning key_hash. Test it on ring = [(100, "a"), (200, "b"), (300, "c")].</ask>`
      },
      {
        learner: {
          answer: r`~~~python
import bisect

def lookup(ring, key_hash):
    positions = [pos for pos, _ in ring]
    i = bisect.bisect_left(positions, key_hash)
    return ring[i][1]

ring = [(100, "a"), (200, "b"), (300, "c")]
print(lookup(ring, 50), lookup(ring, 150), lookup(ring, 300))
~~~`.replace(/~~~/g, '```'),
          confidence: 'sure'
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`wrap|%\s*len|modul|IndexError|out of range|(past|after|beyond|above|greater than|larger than) (the )?(last|end|300|highest|largest)`], need: ['card'] },
    good: r`<grade verdict="partial" score="0.5">bisect_left finds the right node for every hash up to the last position, and your three tests print a b c. The line that fails is "return ring[i][1]": for a hash beyond the last position, such as 350, i is 3 and ring[3] raises IndexError. The ring wraps, so that key belongs to the first node: index with i % len(ring).</grade>

<card>In a consistent-hash ring lookup, which node owns a key whose hash is past the last node position? :: The first node: the ring wraps, so use ring[i % len(ring)] after the bisect.</card>

<ask type="code" lang="python">Fix lookup so that a hash past the last position wraps to the first node, and add a test with key_hash = 350 that shows it.</ask>

<solution>import bisect

def lookup(ring, key_hash):
    positions = [pos for pos, _ in ring]
    i = bisect.bisect_left(positions, key_hash)
    return ring[i % len(ring)][1]

assert lookup([(100, "a"), (200, "b"), (300, "c")], 350) == "a"</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your lookup uses bisect to find the successor node, and the tests print a b c as expected.</grade>

<ask type="short">Why is the list kept sorted?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The submitted tests pass, but no test has a hash past the last node. The reply must find the missing wrap-around (IndexError at 350) rather than trust the three passing cases.'
  }
]
