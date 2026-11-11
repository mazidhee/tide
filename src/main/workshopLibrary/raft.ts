import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts.

const STARTER = String.raw`"""A Raft node, run against a simulated network. Built in four stages; see STAGE-1.md.

A node never sends anything itself: handle() and tick() return the messages to send, and the
network (the tests' simulator) delivers them. Messages are dicts; STAGE-1.md lists their fields.
"""


class RaftNode:
    def __init__(self, node_id, peers, election_timeout=10, heartbeat_interval=3):
        self.id = node_id
        self.peers = sorted(peers)  # the other nodes' ids
        self.election_timeout = election_timeout  # ticks without a leader before standing (stage 2)
        self.heartbeat_interval = heartbeat_interval  # ticks between a leader's heartbeats (stage 2)
        self.state = "follower"  # "follower", "candidate" or "leader"
        self.current_term = 0
        self.voted_for = None
        self.log = []  # (term, command) pairs; log index 1 is self.log[0] (stage 3)
        self.commit_index = 0  # stage 4
        self.applied = []  # commands applied, in order (stage 4)

    def handle(self, msg):
        """One message in; the list of messages to send in reply."""
        raise NotImplementedError("stage 1: handle RequestVote")

    def tick(self):
        """One unit of time passes; the list of messages to send."""
        return []

    def propose(self, command):
        """A client asks the leader to add a command to the log. True if this node is the leader."""
        return False
`

const SOLUTION = String.raw`"""A Raft node: elections, log replication and commitment, run against a simulated network."""

FOLLOWER, CANDIDATE, LEADER = "follower", "candidate", "leader"


class RaftNode:
    def __init__(self, node_id, peers, election_timeout=10, heartbeat_interval=3):
        self.id = node_id
        self.peers = sorted(peers)
        self.election_timeout = election_timeout
        self.heartbeat_interval = heartbeat_interval
        self.state = FOLLOWER
        self.current_term = 0
        self.voted_for = None
        self.log = []
        self.commit_index = 0
        self.applied = []
        self.leader_id = None
        self._elapsed = 0
        self._votes = set()
        self.next_index = {}
        self.match_index = {}

    # ---------- helpers ----------

    def _last(self):
        return len(self.log), (self.log[-1][0] if self.log else 0)

    def _term_at(self, index):
        return self.log[index - 1][0] if 0 < index <= len(self.log) else 0

    def _majority(self):
        return (len(self.peers) + 1) // 2 + 1

    def _msg(self, kind, dst, **fields):
        m = {"type": kind, "term": self.current_term, "src": self.id, "dst": dst}
        m.update(fields)
        return m

    def _apply(self):
        while len(self.applied) < self.commit_index:
            self.applied.append(self.log[len(self.applied)][1])

    # ---------- messages ----------

    def handle(self, msg):
        if msg["term"] > self.current_term:
            self.current_term = msg["term"]
            self.voted_for = None
            self.state = FOLLOWER
            self._votes = set()
        kind = msg["type"]
        if kind == "RequestVote":
            return [self._on_request_vote(msg)]
        if kind == "VoteReply":
            return self._on_vote_reply(msg)
        if kind == "AppendEntries":
            return [self._on_append(msg)]
        if kind == "AppendReply":
            return self._on_append_reply(msg)
        return []

    def _on_request_vote(self, m):
        last_index, last_term = self._last()
        up_to_date = m["last_log_term"] > last_term or (m["last_log_term"] == last_term and m["last_log_index"] >= last_index)
        grant = m["term"] == self.current_term and self.voted_for in (None, m["src"]) and up_to_date
        if grant:
            self.voted_for = m["src"]
            self._elapsed = 0
        return self._msg("VoteReply", m["src"], granted=grant)

    def _on_vote_reply(self, m):
        if self.state != CANDIDATE or m["term"] != self.current_term or not m["granted"]:
            return []
        self._votes.add(m["src"])
        return self._become_leader() if len(self._votes) >= self._majority() else []

    def _on_append(self, m):
        if m["term"] < self.current_term:
            return self._msg("AppendReply", m["src"], success=False, match=0)
        self.state = FOLLOWER
        self.leader_id = m["src"]
        self._elapsed = 0
        prev = m["prev_index"]
        if prev > len(self.log) or self._term_at(prev) != m["prev_term"]:
            return self._msg("AppendReply", m["src"], success=False, match=0)
        for k, (term, command) in enumerate(m["entries"]):
            i = prev + 1 + k
            if i <= len(self.log):
                if self.log[i - 1][0] == term:
                    continue
                del self.log[i - 1:]
            self.log.append((term, command))
        last_new = prev + len(m["entries"])
        commit = min(m["commit"], last_new)
        if commit > self.commit_index:
            self.commit_index = commit
            self._apply()
        return self._msg("AppendReply", m["src"], success=True, match=last_new)

    def _on_append_reply(self, m):
        if self.state != LEADER or m["term"] != self.current_term:
            return []
        p = m["src"]
        if m["success"]:
            self.match_index[p] = max(self.match_index[p], m["match"])
            self.next_index[p] = self.match_index[p] + 1
            self._advance_commit()
        else:
            self.next_index[p] = max(1, self.next_index[p] - 1)
        return []

    def _advance_commit(self):
        for n in range(len(self.log), self.commit_index, -1):
            # Entries of earlier terms are committed only by committing one of this term after them
            if self.log[n - 1][0] != self.current_term:
                break
            if 1 + sum(1 for p in self.peers if self.match_index[p] >= n) >= self._majority():
                self.commit_index = n
                self._apply()
                break

    # ---------- time ----------

    def _start_election(self):
        self.state = CANDIDATE
        self.current_term += 1
        self.voted_for = self.id
        self._votes = {self.id}
        self._elapsed = 0
        if len(self._votes) >= self._majority():
            return self._become_leader()
        last_index, last_term = self._last()
        return [self._msg("RequestVote", p, last_log_index=last_index, last_log_term=last_term) for p in self.peers]

    def _become_leader(self):
        self.state = LEADER
        self.leader_id = self.id
        self.next_index = {p: len(self.log) + 1 for p in self.peers}
        self.match_index = {p: 0 for p in self.peers}
        return self._heartbeat()

    def _heartbeat(self):
        self._elapsed = 0
        out = []
        for p in self.peers:
            prev = self.next_index[p] - 1
            out.append(self._msg("AppendEntries", p, prev_index=prev, prev_term=self._term_at(prev), entries=[[t, c] for t, c in self.log[prev:]], commit=self.commit_index))
        return out

    def tick(self):
        self._elapsed += 1
        if self.state == LEADER:
            return self._heartbeat() if self._elapsed >= self.heartbeat_interval else []
        if self._elapsed >= self.election_timeout:
            return self._start_election()
        return []

    def propose(self, command):
        if self.state != LEADER:
            return False
        self.log.append((self.current_term, command))
        if not self.peers:
            self.commit_index = len(self.log)
            self._apply()
        return True
`

const HELPERS = String.raw`from raft import RaftNode

def vote(term, src, dst, last_log_index=0, last_log_term=0):
    return {"type": "RequestVote", "term": term, "src": src, "dst": dst, "last_log_index": last_log_index, "last_log_term": last_log_term}

def one(replies, what):
    assert isinstance(replies, list) and len(replies) == 1, "%s should return a list of one reply, got %r" % (what, replies)
    return replies[0]

def logs(node):
    return [tuple(e) for e in node.log]
`

const SIMULATOR = String.raw`class Cluster:
    """The network: nodes in id order tick, then every message in flight is delivered, replies included, first in first out."""

    def __init__(self, timeouts, heartbeat=2):
        ids = sorted(timeouts)
        self.nodes = {i: RaftNode(i, [p for p in ids if p != i], election_timeout=timeouts[i], heartbeat_interval=heartbeat) for i in ids}
        self.group = {i: 0 for i in ids}
        self.leaders = {}

    def split(self, *groups):
        """Only nodes in the same group can reach each other; a node in no group is on its own."""
        self.group = {i: ("alone", i) for i in self.nodes}
        for g, members in enumerate(groups):
            for i in members:
                self.group[i] = g

    def heal(self):
        self.group = {i: 0 for i in self.nodes}

    def deliver(self, msgs):
        queue = list(msgs or [])
        count = 0
        while queue:
            m = queue.pop(0)
            count += 1
            assert count < 200000, "the messages never stopped: over 200000 in one tick"
            assert isinstance(m, dict) and m.get("dst") in self.nodes and m.get("src") in self.nodes, "a message must be a dict with src and dst set to node ids, got %r" % (m,)
            if self.group[m["src"]] != self.group[m["dst"]]:
                continue
            queue.extend(self.nodes[m["dst"]].handle(m) or [])
            self.note()

    def note(self):
        for n in self.nodes.values():
            if n.state == "leader":
                self.leaders.setdefault(n.current_term, set()).add(n.id)

    def tick(self, k=1):
        for _ in range(k):
            out = []
            for i in sorted(self.nodes):
                out.extend(self.nodes[i].tick() or [])
            self.note()
            self.deliver(out)

    def leader(self):
        """The leader of the highest term among the nodes, or None."""
        ls = [n for n in self.nodes.values() if n.state == "leader"]
        return max(ls, key=lambda n: n.current_term) if ls else None

    def states(self):
        return {i: (n.state, n.current_term) for i, n in sorted(self.nodes.items())}

def append(term, src, dst, prev_index, prev_term, entries, commit=0):
    return {"type": "AppendEntries", "term": term, "src": src, "dst": dst, "prev_index": prev_index, "prev_term": prev_term, "entries": [list(e) for e in entries], "commit": commit}

def elected(c, ticks=40):
    c.tick(ticks)
    l = c.leader()
    assert l is not None, "no leader after %d ticks; states: %r" % (ticks, c.states())
    return l
`

export const raft: WorkshopProject = {
  id: 'raft',
  title: 'A Raft node against a simulated network',
  outcome: 'A working Raft consensus node in Python, tested against a deterministic simulated network that cuts and heals connections: terms and votes with the election restriction, leader election with heartbeats, log replication that repairs a diverged follower, and commitment that never loses an entry a majority acknowledged.',
  area: 'distributed',
  prerequisites: ['Message passing', 'Python classes and dictionaries'],
  languages: ['python'],
  stages: [
    {
      id: 'votes',
      title: 'Terms and votes',
      goal: 'Answer RequestVote by Raft’s rules: one vote per term, and only for a candidate whose log is at least as up to date.',
      brief: `In \`raft.py\`, a node never sends anything itself: \`handle(msg)\` receives one message and **returns the list of messages to send**. A message is a dict with \`"type"\`, \`"term"\` (the sender's current term), \`"src"\` and \`"dst"\` (node ids), plus fields of its type. In this stage, two types:

- \`RequestVote\`: \`last_log_index\`, \`last_log_term\` (of the candidate's log; 0 and 0 when it is empty). The candidate is \`src\`.
- \`VoteReply\`: \`granted\` (\`True\` or \`False\`).

Write \`handle\` for \`RequestVote\`; it returns exactly one \`VoteReply\` to the candidate, carrying the node's current term (after any update below).

1. **Any** message whose term is higher than \`current_term\` first sets \`current_term\` to it, clears \`voted_for\`, and makes the node a \`"follower"\` (a leader or candidate steps down).
2. The vote is granted only if the request's term equals \`current_term\` (a stale term is refused), \`voted_for\` is \`None\` or already this candidate, and the candidate's log is **at least as up to date** as the node's: its last term is higher, or the last terms are equal and its last index is at least as large. The node's log is \`self.log\`, a list of \`(term, command)\` pairs; empty, its last index and term are 0.
3. When granted, \`voted_for\` becomes the candidate.`,
      read: { concept: 'Raft leader election', source: 'Ongaro and Ousterhout, “In Search of an Understandable Consensus Algorithm (Extended Version)”, sections 5.1, 5.2 and 5.4.1, and Figure 2 (RequestVote RPC)' },
      files: [{ path: 'raft.py', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'the first candidate of a term gets the vote',
          code: String.raw`n = RaftNode(1, [2, 3])
r = one(n.handle(vote(1, 2, 1)), "handle(RequestVote)")
want = {"type": "VoteReply", "term": 1, "src": 1, "dst": 2, "granted": True}
assert r == want, "node 1 at term 0 asked by node 2 for a vote in term 1 should reply %r, got %r" % (want, r)
assert n.current_term == 1 and n.voted_for == 2, "after voting for 2 in term 1, current_term should be 1 and voted_for 2; got %r and %r" % (n.current_term, n.voted_for)`
        },
        {
          name: 'one vote per term, though the same candidate may ask again',
          code: String.raw`n = RaftNode(1, [2, 3])
n.handle(vote(1, 2, 1))
r = one(n.handle(vote(1, 3, 1)), "handle(RequestVote)")
assert r.get("granted") is False, "node 1 already voted for 2 in term 1, so node 3 must be refused; the reply was %r" % (r,)
r = one(n.handle(vote(1, 2, 1)), "handle(RequestVote)")
assert r.get("granted") is True, "node 2 asking again in the same term (its first request may have been lost) should be granted; the reply was %r" % (r,)`
        },
        {
          name: 'a higher term clears the vote',
          code: String.raw`n = RaftNode(1, [2, 3])
n.handle(vote(1, 2, 1))
r = one(n.handle(vote(2, 3, 1)), "handle(RequestVote)")
assert r.get("granted") is True and r.get("term") == 2, "a request in term 2 starts a new term with no vote cast: node 3 should be granted with reply term 2; got %r" % (r,)
assert n.voted_for == 3, "voted_for should now be 3, got %r" % (n.voted_for,)`
        },
        {
          name: 'a stale term is refused, with the current term in the reply',
          code: String.raw`n = RaftNode(1, [2, 3])
n.current_term = 5
r = one(n.handle(vote(3, 2, 1)), "handle(RequestVote)")
assert r.get("granted") is False and r.get("term") == 5, "a request from term 3 to a node in term 5 should be refused with term 5 in the reply, so the candidate learns it is behind; got %r" % (r,)
assert n.current_term == 5 and n.voted_for is None, "a stale request must change nothing; current_term is %r and voted_for %r" % (n.current_term, n.voted_for)`
        },
        {
          name: 'a candidate whose log is behind is refused',
          code: String.raw`n = RaftNode(1, [2, 3])
n.log = [(1, "a"), (2, "b")]
r = one(n.handle(vote(3, 2, 1, last_log_index=5, last_log_term=1)), "handle(RequestVote)")
assert r.get("granted") is False, "node 1's last entry is from term 2; a candidate whose last entry is from term 1 is behind, however long its log; got %r" % (r,)
r = one(n.handle(vote(3, 3, 1, last_log_index=1, last_log_term=2)), "handle(RequestVote)")
assert r.get("granted") is False, "same last term (2) but a shorter log (1 entry against 2) is behind; got %r" % (r,)
r = one(n.handle(vote(3, 3, 1, last_log_index=2, last_log_term=2)), "handle(RequestVote)")
assert r.get("granted") is True, "the same last term and the same length is up to date: refusing before must not have used up the vote; got %r" % (r,)
m = RaftNode(1, [2, 3])
m.log = [(1, "a"), (1, "b"), (1, "c")]
r = one(m.handle(vote(4, 2, 1, last_log_index=1, last_log_term=3)), "handle(RequestVote)")
assert r.get("granted") is True, "a later last term (3 against 1) is more up to date even with a shorter log; got %r" % (r,)`
        },
        {
          name: 'a leader that hears a higher term steps down',
          code: String.raw`n = RaftNode(1, [2, 3])
n.state = "leader"
n.current_term = 2
n.voted_for = 1
n.handle(vote(3, 2, 1))
assert n.state == "follower" and n.current_term == 3, "a leader in term 2 receiving a term 3 message should become a follower in term 3; it is %r in term %r" % (n.state, n.current_term)`
        }
      ],
      hints: [
        'Two separate decisions: whether this message moves the node to a newer term, and then whether this particular candidate deserves the vote. Do the first for every message before anything else.',
        'Compare logs by their last entry: the last term decides, and only when the last terms are equal does length decide. A refused vote must leave voted_for unchanged, so the node can still vote for someone else in that term.',
        'handle: if msg["term"] > current_term: set it, voted_for = None, state = "follower". For RequestVote: compute your last index and term (0, 0 for an empty log); up_to_date = their_last_term > mine or (equal and their_last_index >= mine); grant = msg term == current_term and voted_for in (None, src) and up_to_date; if grant set voted_for = src; return [{"type": "VoteReply", "term": current_term, "src": self.id, "dst": src, "granted": grant}].'
      ],
      teaches: ['Raft leader election', 'Logical clocks (terms)'],
      recall: 'Why does Raft refuse a vote to a candidate whose log is behind, and what could be lost if it didn’t?'
    },
    {
      id: 'elections',
      title: 'Elections and heartbeats',
      goal: 'Stand for election when no leader is heard, win with a majority, and hold leadership with heartbeats.',
      brief: `Time arrives through \`tick()\`, which returns messages like \`handle\`. The tests run a simulated network: every tick, each node ticks (in id order) and then all messages are delivered first in, first out, replies included. The network can cut nodes off from each other.

**Followers and candidates.** Count ticks since you last heard from a leader or granted a vote. When the count reaches \`election_timeout\`, start an election: become \`"candidate"\`, add 1 to \`current_term\`, vote for yourself, reset the count, and return a \`RequestVote\` to every peer (in \`self.peers\` order). A candidate whose election times out starts another. A node with no peers wins at once.

**Votes.** A candidate counts \`VoteReply\`s with \`granted\` and its own term. With votes from a majority of the cluster (itself included) it becomes \`"leader"\`, and **immediately** returns an \`AppendEntries\` heartbeat to every peer.

**Leaders.** Every \`heartbeat_interval\` ticks a leader returns an \`AppendEntries\` to every peer. Its fields (they matter from stage 3): \`prev_index\`, \`prev_term\`, \`entries\` (a list of \`[term, command]\`), \`commit\`; for now \`0\`, \`0\`, \`[]\`, \`0\` will do.

**Hearing a leader.** On an \`AppendEntries\` whose term is at least \`current_term\`: become (or stay) a follower and reset the count. Reply with an \`AppendReply\` (\`success\`, \`match\`): for now \`success\` \`True\` and \`match\` \`0\`. On one with a stale term, reply \`success\` \`False\` with your term, and reset nothing.

The term rule of stage 1 applies to every message, replies included.`,
      read: { concept: 'Heartbeats and election timeouts', source: 'Ongaro and Ousterhout, “In Search of an Understandable Consensus Algorithm (Extended Version)”, section 5.2 “Leader election”; the Raft visualisation at raft.github.io' },
      files: [],
      setup: SIMULATOR,
      tests: [
        {
          name: 'a follower that hears nothing stands for election',
          code: String.raw`n = RaftNode(1, [2, 3], election_timeout=3)
assert n.tick() == [] and n.tick() == [], "nothing should be sent before the election timeout of 3 ticks"
out = n.tick()
want = [vote(1, 1, 2), vote(1, 1, 3)]
assert out == want, "on the third tick node 1 should stand in term 1, sending %r; it sent %r" % (want, out)
assert n.state == "candidate" and n.voted_for == 1, "node 1 should be a candidate that voted for itself; it is %r with voted_for %r" % (n.state, n.voted_for)`
        },
        {
          name: 'a majority of votes makes a leader, which sends heartbeats at once',
          code: String.raw`n = RaftNode(1, [2, 3], election_timeout=1)
n.tick()
out = n.handle({"type": "VoteReply", "term": 1, "src": 2, "dst": 1, "granted": True})
assert n.state == "leader", "with its own vote and node 2's, node 1 has 2 of 3: it should be leader, it is %r" % (n.state,)
kinds = [(m.get("type"), m.get("dst"), m.get("term")) for m in (out or [])]
assert kinds == [("AppendEntries", 2, 1), ("AppendEntries", 3, 1)], "a new leader should at once send AppendEntries in term 1 to 2 and 3; it sent %r" % (kinds,)`
        },
        {
          name: 'in a cluster of three, the node that times out first leads, and stays leader',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
c.tick(6)
assert c.states() == {1: ("leader", 1), 2: ("follower", 1), 3: ("follower", 1)}, "after 6 ticks node 1 (timeout 5) should lead in term 1 with 2 and 3 following; the states are %r" % (c.states(),)
c.tick(100)
assert c.states() == {1: ("leader", 1), 2: ("follower", 1), 3: ("follower", 1)}, "heartbeats every 2 ticks should keep node 1 leader in term 1 for 100 more ticks; the states are %r" % (c.states(),)`
        },
        {
          name: 'a refused or stale vote does not count',
          code: String.raw`n = RaftNode(1, [2, 3, 4, 5], election_timeout=1)
n.tick()
n.handle({"type": "VoteReply", "term": 1, "src": 2, "dst": 1, "granted": False})
n.handle({"type": "VoteReply", "term": 1, "src": 3, "dst": 1, "granted": True})
n.handle({"type": "VoteReply", "term": 1, "src": 3, "dst": 1, "granted": True})
assert n.state == "candidate", "in a cluster of 5, its own vote, one refusal and node 3 twice is 2 votes, not a majority; node 1 is %r" % (n.state,)
n.tick()
n.handle({"type": "VoteReply", "term": 1, "src": 4, "dst": 1, "granted": True})
n.handle({"type": "VoteReply", "term": 2, "src": 5, "dst": 1, "granted": True})
assert n.state == "candidate", "in term 2, a vote from term 1 must not count; node 1 has only 2 votes for term 2 and is %r" % (n.state,)`
        },
        {
          name: 'when the leader is cut off, the others elect a new one, and it rejoins as a follower',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
c.tick(6)
c.split([1], [2, 3])
c.tick(30)
new = [i for i in (2, 3) if c.nodes[i].state == "leader"]
assert len(new) == 1 and c.nodes[new[0]].current_term > 1, "with node 1 cut off, nodes 2 and 3 should elect one of them in a later term; the states are %r" % (c.states(),)
c.heal()
c.tick(10)
leaders = [i for i, n in c.nodes.items() if n.state == "leader"]
assert leaders == new, "after healing, node 1 should step down and only node %d lead; the states are %r" % (new[0], c.states())`
        },
        {
          name: 'never two leaders in one term',
          code: String.raw`c = Cluster({1: 5, 2: 7, 3: 9, 4: 11, 5: 13})
for groups in [([1, 2], [3, 4, 5]), ([1, 3, 5], [2, 4]), ([4], [1, 2, 3, 5]), ([2, 5], [1, 3, 4]), ()]:
    c.split(*groups) if groups else c.heal()
    c.tick(40)
twice = {t: sorted(ids) for t, ids in c.leaders.items() if len(ids) > 1}
assert not twice, "two nodes were leader in the same term: %r" % (twice,)
assert c.leaders, "no node was ever leader"`
        },
        {
          name: 'a cluster of one elects itself',
          code: String.raw`n = RaftNode(1, [], election_timeout=2)
n.tick(); n.tick()
assert n.state == "leader" and n.current_term == 1, "a node with no peers is a majority of one: after its timeout it should lead in term 1; it is %r in term %r" % (n.state, n.current_term)`
        }
      ],
      hints: [
        'One counter does all the timing. The only questions are when to add to it, when to reset it, and what happens when it reaches the limit, which differ by state.',
        'Reset the counter when you start an election, when you grant a vote, and when an AppendEntries of a current term arrives. Keep the set of voters for this term so a duplicate reply cannot count twice, and ignore replies whose term isn’t yours. Majority of n nodes is n // 2 + 1.',
        'tick(): add 1; a leader sends AppendEntries to every peer when the counter reaches heartbeat_interval (and resets it); anyone else starts an election at election_timeout: state candidate, term + 1, voted_for self, votes = {self}, counter 0, RequestVote to each peer with your last log index and term (or straight to leader if alone). On VoteReply: if candidate, same term and granted, add src; at a majority become leader and return heartbeats. On AppendEntries with term >= yours: state follower, counter 0, reply success True; stale: reply success False.'
      ],
      teaches: ['Heartbeats and election timeouts', 'Quorums'],
      recall: 'Why can two nodes never both be elected leader in the same term?'
    },
    {
      id: 'replication',
      title: 'Replicating the log',
      goal: 'Copy the leader’s log to followers, refusing entries that don’t follow on and repairing a follower that diverged.',
      brief: `Now the log moves. Logs are 1-indexed as in the paper: entry \`i\` is \`self.log[i - 1]\`, a \`(term, command)\` pair.

**\`propose(command)\`** on the leader appends \`(current_term, command)\` and returns \`True\`; on any other node it returns \`False\` and changes nothing. The entry travels with the next heartbeat.

**The leader** keeps, per peer, \`next_index\` (set to the log's length + 1 on becoming leader). Each \`AppendEntries\` to a peer has \`prev_index = next_index − 1\`, \`prev_term\` the term of that entry (0 for index 0), \`entries\` every entry from \`next_index\` on, as \`[term, command]\` lists, and \`commit\` (stage 4; send the commit index, 0 for now).

**A follower** given an \`AppendEntries\` of a current term:
1. If it has no entry at \`prev_index\`, or that entry's term is not \`prev_term\`, reply \`success\` \`False\` (\`match\` 0).
2. Otherwise, for each entry sent: if the follower has an entry at that index **with a different term**, delete it and everything after it; then append any entries it doesn't have. Entries that already match are kept as they are, so an old, delayed message never shortens the log.
3. Reply \`success\` \`True\` with \`match = prev_index + len(entries)\`.

**On an \`AppendReply\`** of its term, the leader sets that peer's \`next_index\` to \`match + 1\` on success (never moving it backwards), or lowers it by one (not below 1) on failure, and tries again with the next heartbeat.`,
      read: { concept: 'Log replication', source: 'Ongaro and Ousterhout, “In Search of an Understandable Consensus Algorithm (Extended Version)”, section 5.3 “Log replication”, Figure 2 (AppendEntries RPC) and Figure 7' },
      files: [],
      tests: [
        {
          name: 'a follower appends entries that follow on from its log',
          code: String.raw`n = RaftNode(2, [1, 3])
r = one(n.handle(append(1, 1, 2, 0, 0, [(1, "x"), (1, "y")])), "handle(AppendEntries)")
assert r.get("type") == "AppendReply" and r.get("success") is True and r.get("match") == 2, "two entries after index 0 should be accepted with match 2; the reply was %r" % (r,)
assert logs(n) == [(1, "x"), (1, "y")], "the log should be [(1, 'x'), (1, 'y')], got %r" % (logs(n),)`
        },
        {
          name: 'entries that don’t follow on are refused',
          code: String.raw`n = RaftNode(2, [1, 3])
n.log = [(1, "a"), (1, "b")]
r = one(n.handle(append(2, 1, 2, 4, 1, [(2, "z")])), "handle(AppendEntries)")
assert r.get("success") is False, "prev_index 4 is past the end of a 2-entry log: the entries must be refused; the reply was %r" % (r,)
r = one(n.handle(append(2, 1, 2, 2, 2, [(2, "z")])), "handle(AppendEntries)")
assert r.get("success") is False, "the entry at index 2 has term 1, not prev_term 2: refuse; the reply was %r" % (r,)
assert logs(n) == [(1, "a"), (1, "b")], "a refused AppendEntries must leave the log alone; it is %r" % (logs(n),)`
        },
        {
          name: 'a conflicting entry and all after it are replaced; matching ones are kept',
          code: String.raw`n = RaftNode(2, [1, 3])
n.log = [(1, "a"), (1, "b"), (2, "c"), (2, "d")]
r = one(n.handle(append(3, 1, 2, 1, 1, [(1, "b"), (3, "e")])), "handle(AppendEntries)")
assert r.get("success") is True and r.get("match") == 3, "the reply should be success with match 3, got %r" % (r,)
assert logs(n) == [(1, "a"), (1, "b"), (3, "e")], "entry 3 conflicts (term 2 against 3), so it and entry 4 go: the log should be [(1, 'a'), (1, 'b'), (3, 'e')], got %r" % (logs(n),)`
        },
        {
          name: 'a delayed, shorter message never shortens the log',
          code: String.raw`n = RaftNode(2, [1, 3])
n.log = [(1, "a"), (1, "b"), (1, "c")]
r = one(n.handle(append(1, 1, 2, 0, 0, [(1, "a")])), "handle(AppendEntries)")
assert r.get("success") is True and r.get("match") == 1, "the reply should be success with match 1, got %r" % (r,)
assert logs(n) == [(1, "a"), (1, "b"), (1, "c")], "an old message carrying only entry 1 matches and must not truncate the log; it is now %r" % (logs(n),)`
        },
        {
          name: 'only the leader takes proposals, and every follower gets them',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
l = elected(c)
other = c.nodes[2 if l.id != 2 else 3]
assert other.propose("nope") is False and logs(other) == [], "a follower should refuse a proposal and keep its log empty"
for cmd in ["set x 1", "set y 2", "del x"]:
    assert l.propose(cmd) is True, "the leader should accept %r" % cmd
c.tick(10)
want = [(l.current_term, "set x 1"), (l.current_term, "set y 2"), (l.current_term, "del x")]
for i, n in sorted(c.nodes.items()):
    assert logs(n) == want, "node %d's log should be %r, got %r" % (i, want, logs(n))`
        },
        {
          name: 'a follower that missed entries is brought up to date',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
l = elected(c)
behind = [i for i in c.nodes if i != l.id][-1]
c.split([i for i in c.nodes if i != behind], [behind])
for k in range(5):
    l.propose("cmd %d" % k)
    c.tick(2)
assert len(c.nodes[behind].log) == 0, "the cut-off node should have received nothing yet"
c.heal()
c.tick(30)
assert logs(c.nodes[behind]) == logs(l), "after healing, node %d's log should match the leader's %r, got %r" % (behind, logs(l), logs(c.nodes[behind]))`
        },
        {
          name: 'a stale leader’s entries are replaced by the new leader’s',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
l = elected(c)
assert l.id == 1, "node 1 should have been elected first; the states are %r" % (c.states(),)
c.split([1], [2, 3])
c.nodes[1].propose("lost")
c.tick(30)
new = c.leader()
assert new is not None and new.id != 1, "nodes 2 and 3 should have elected a new leader; the states are %r" % (c.states(),)
new.propose("kept")
c.tick(4)
c.heal()
c.tick(30)
assert logs(c.nodes[1]) == logs(new), "after healing, node 1's log should be the new leader's %r, got %r" % (logs(new), logs(c.nodes[1]))
assert "lost" not in [cmd for _, cmd in logs(c.nodes[1])], "the entry proposed to the cut-off leader was never on a majority and should be gone"`
        }
      ],
      hints: [
        'The follower’s check is the whole trick: if its log matches the leader’s at prev_index, then by induction it matches everywhere before that too. The leader only has to find the point where they agree.',
        'Refuse unless prev_index is 0 or you have an entry there with term prev_term. When accepting, walk the entries with their index: skip ones you have with the same term, cut the log at the first one whose term differs, and append the rest. The leader steps next_index back by one per refusal until the check passes.',
        'propose: if not leader return False; append (term, command). Heartbeat for peer p: prev = next_index[p] − 1, prev_term = term of entry prev (0 if 0), entries = log[prev:] as [term, command], commit. Follower: refuse if prev > len(log) or term_at(prev) != prev_term; else for k, (t, cmd) in enumerate(entries): i = prev + 1 + k; if i <= len(log) and log[i−1] term == t: continue; if i <= len(log): del log[i−1:]; append. Reply success, match = prev + len(entries). Leader on reply: success → match_index[p] = max(old, match), next_index[p] = match_index[p] + 1; failure → next_index[p] = max(1, next_index[p] − 1).'
      ],
      teaches: ['Log replication', 'The Log Matching Property'],
      recall: 'Why can a follower trust its whole log up to prev_index after checking only the single entry at prev_index?'
    },
    {
      id: 'commit',
      title: 'Commitment',
      goal: 'Commit an entry once a majority holds it, apply committed commands in order everywhere, and never lose one.',
      brief: `An entry is **committed** once it can never be lost; then every node applies its command, in log order, by appending it to \`self.applied\`.

**The leader** tracks \`match_index\` per peer (0 on becoming leader; on a successful \`AppendReply\`, \`max(old, match)\`). After each success, it advances \`commit_index\` to the highest \`N\` such that a majority of the cluster (itself included) has \`match_index >= N\` **and** \`log[N]\`'s term is the **current term**. An entry from an earlier term is never committed by counting replicas: it becomes committed when an entry of the current term after it is (Figure 8 of the paper shows why).

**Followers** learn the commit index from \`AppendEntries\`' \`commit\`: after accepting a message, if \`commit\` is beyond their own \`commit_index\`, they raise it to \`min(commit, prev_index + len(entries))\` (never past what this message proved they hold).

**Everyone**, whenever \`commit_index\` rises, appends the newly committed commands to \`applied\` in order. \`applied\` only ever grows, and never differs from another node's \`applied\` at any position.

A node with no peers commits a proposal at once.`,
      read: { concept: 'Commitment and state machine safety', source: 'Ongaro and Ousterhout, “In Search of an Understandable Consensus Algorithm (Extended Version)”, sections 5.3, 5.4.2 “Committing entries from previous terms” (Figure 8) and 5.4.3 “Safety argument”' },
      files: [],
      tests: [
        {
          name: 'an entry on a majority is committed and applied by the leader',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
l = elected(c)
l.propose("a"); l.propose("b")
c.tick(4)
assert l.commit_index == 2 and l.applied == ["a", "b"], "once both entries are on a majority, the leader should have commit_index 2 and applied ['a', 'b']; it has %r and %r" % (l.commit_index, l.applied)`
        },
        {
          name: 'followers apply what the leader committed, in the same order',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
l = elected(c)
for cmd in ["a", "b", "c"]:
    l.propose(cmd)
    c.tick(1)
c.tick(10)
for i, n in sorted(c.nodes.items()):
    assert n.applied == ["a", "b", "c"], "node %d should have applied ['a', 'b', 'c'], got %r" % (i, n.applied)`
        },
        {
          name: 'a leader cut off from the majority commits nothing',
          code: String.raw`c = Cluster({1: 5, 2: 8, 3: 11})
l = elected(c)
before = l.commit_index
c.split([l.id], [i for i in c.nodes if i != l.id])
l.propose("x")
c.tick(4)
assert l.commit_index == before and "x" not in l.applied, "a leader that cannot reach a majority must not commit: commit_index went from %r to %r, applied %r" % (before, l.commit_index, l.applied)`
        },
        {
          name: 'a follower commits no further than this message proved it holds',
          code: String.raw`n = RaftNode(2, [1, 3])
n.handle(append(1, 1, 2, 0, 0, [(1, "a"), (1, "b")], commit=0))
n.handle(append(1, 1, 2, 1, 1, [], commit=2))
assert n.commit_index == 1 and n.applied == ["a"], "a heartbeat after index 1 with commit 2 proves only entry 1 matches the leader: commit_index should be 1 and applied ['a'], got %r and %r" % (n.commit_index, n.applied)
n.handle(append(1, 1, 2, 2, 1, [], commit=2))
assert n.commit_index == 2 and n.applied == ["a", "b"], "a heartbeat after index 2 with commit 2 should commit and apply 'b'; got %r and %r" % (n.commit_index, n.applied)`
        },
        {
          name: 'an entry from an earlier term is not committed by counting replicas',
          code: String.raw`n = RaftNode(1, [2, 3], election_timeout=1)
n.current_term = 2
n.log = [(2, "old")]
n.tick()
n.handle({"type": "VoteReply", "term": 3, "src": 2, "dst": 1, "granted": True})
assert n.state == "leader" and n.current_term == 3, "node 1 should now lead in term 3; it is %r in term %r" % (n.state, n.current_term)
n.handle({"type": "AppendReply", "term": 3, "src": 2, "dst": 1, "success": True, "match": 1})
assert n.commit_index == 0, "entry 1 is from term 2; counting replicas must not commit it in term 3 (Figure 8). commit_index is %r" % (n.commit_index,)
n.propose("new")
n.handle({"type": "AppendReply", "term": 3, "src": 2, "dst": 1, "success": True, "match": 2})
assert n.commit_index == 2 and n.applied == ["old", "new"], "committing the term 3 entry at index 2 commits entry 1 with it: commit_index 2 and applied ['old', 'new'], got %r and %r" % (n.commit_index, n.applied)`
        },
        {
          name: 'through partitions and new leaders, no two nodes ever apply different commands',
          code: String.raw`import random
rng = random.Random(4)
c = Cluster({1: 6, 2: 9, 3: 12, 4: 15, 5: 18})
cuts = [([1, 2], [3, 4, 5]), ([1, 2, 3], [4, 5]), ([1], [2, 3, 4, 5]), ([1, 3, 5], [2, 4]), ([2, 3], [1, 4, 5])]
committed = []
for step in range(300):
    r = rng.random()
    if r < 0.05:
        c.split(*rng.choice(cuts))
    elif r < 0.1:
        c.heal()
    elif r < 0.5:
        for n in sorted(c.nodes.values(), key=lambda n: -n.current_term):
            if n.state == "leader":
                n.propose("cmd-%d" % step)
                break
    c.tick()
    seqs = [n.applied for n in c.nodes.values()]
    longest = max(seqs, key=len)
    for i, s in sorted((i, n.applied) for i, n in c.nodes.items()):
        assert s == longest[:len(s)], "at step %d node %d has applied %r, which disagrees with %r" % (step, i, s[-3:], longest[len(s) - 3:len(s)])
    assert longest[:len(committed)] == committed, "at step %d a command that had been applied was lost" % step
    committed = list(longest)
c.heal()
c.tick(400)
final = [n.applied for n in c.nodes.values()]
assert len(committed) > 20, "only %d commands were committed in 300 steps; the cluster should make progress between partitions" % len(committed)
assert all(f == final[0] for f in final), "after healing and 400 ticks every node should have applied the same %d commands; their counts are %r" % (len(final[0]), [len(f) for f in final])`
        }
      ],
      hints: [
        'Commitment is a question only the leader can answer, by counting; followers just follow the number it sends, with care. Applying is the same loop on every node.',
        'After every successful reply, the leader looks for the highest index held by a majority (counting itself) whose entry has the current term. A follower may raise its commit index only as far as the last entry this message proved it holds, since entries beyond it may still be stale. Keep applied in step with commit_index with one small function.',
        'Leader, on success: update match_index; then for N from len(log) down to commit_index + 1: stop if log[N−1] term != current_term; if 1 + (peers with match_index >= N) >= majority: commit_index = N, apply, stop. Follower, after accepting: last_new = prev_index + len(entries); c = min(msg commit, last_new); if c > commit_index: commit_index = c and apply. apply(): while len(applied) < commit_index: applied.append(log[len(applied)] command). propose with no peers: commit at once.'
      ],
      teaches: ['Commitment and state machine safety', 'Quorums'],
      recall: 'Why may a new leader not commit an entry from an earlier term just because a majority of nodes hold it?'
    }
  ],
  solution: [{ path: 'raft.py', content: SOLUTION }]
}
