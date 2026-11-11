/** Harness samples for "raft": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['raft', 'raft: five nodes, a client with three commands', '{"kind":"raft","nodes":5,"commands":["x=1","y=2","z=3"],"title":"Leader election and log replication"}'],
  [
    'raft-tour',
    'raft: a tour through a partition',
    JSON.stringify({
      kind: 'raft',
      nodes: 5,
      seed: 4,
      title: 'What a partition does to a leader',
      tour: [
        { at: 'timer:1', say: 'Every node starts as a follower with its own random election timer. The first to run out becomes a candidate and asks for votes.' },
        { at: 'leader', say: 'Run until one node has a majority of votes. It is the leader for this term and keeps the others quiet with heartbeats.', do: { run: 40 } },
        { at: 'commit', say: 'A client command goes to the leader. It is committed once a majority hold it, and the followers hear of that from the next AppendEntries.', do: { command: 'x=1', run: 30 } },
        { at: 'network', say: 'Now cut the leader off. It still believes it leads, and it takes a second command, but it can never reach a majority.', do: { isolate: 'leader', command: 'lost=1', run: 12 } },
        { at: 'term', say: 'On the other side a timer runs out, and three nodes are enough to elect a new leader in a higher term.', do: { run: 110 } },
        { at: 'leader', say: 'Heal the network. The old leader sees the higher term, steps down, and its uncommitted entry is replaced by the new leader\'s log.', do: { heal: true, command: 'y=2', run: 60 } }
      ]
    })
  ],
  ['raft-figure8', 'raft: Figure 8, with odd input', '{"kind":"raft","scenario":"figure 8","nodes":"lots","election":"soon","title":"Why a leader only commits entries from its own term","tour":[{"at":"entry:1:2","say":"y=2 from term 2 is on nodes 1 and 2. Run on: the new leader copies it to a majority, yet does not commit it.","do":{"run":60}}]}'],
  ['raft-three', 'raft: three nodes, lossy network', '{"kind":"raft","nodes":3,"loss":0.2,"latency":[5,60],"commands":["a=1","b=2"],"seed":7}']
]
