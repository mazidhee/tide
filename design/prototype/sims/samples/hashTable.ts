/** Harness samples for "hash-table": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['hash-table', 'hash-table: default (linear probing)', '{"kind":"hash-table"}'],
  ['hash-table-chain', 'hash-table: chaining with words', '{"kind":"hash-table","strategy":"chaining","capacity":7,"keys":["cat","dog","owl","fox","bee"],"insert":["ant","act","hen","eel"],"search":"fox","delete":"dog","title":"Chains of words"}'],
  [
    'hash-table-tour',
    'hash-table: with a tour',
    JSON.stringify({
      kind: 'hash-table',
      strategy: 'double',
      capacity: 11,
      keys: [15, 26, 136, 8, 20],
      title: 'Collisions, tombstones and a rebuild',
      tour: [
        { at: 'hash', say: 'Every key is hashed to a slot: h(k) = k mod 11. Double hashing also gives each key its own step, used only after a collision.' },
        { at: 'probe', say: 'Insert 48. It hashes to slot 4, which is taken, so it moves on by its own step of 9 and finds slot 2 empty.', do: { insert: 48, run: 3 } },
        { at: 'key:26', say: 'Delete 26. Its slot becomes a tombstone rather than an empty slot.', do: { delete: 26, run: 3 } },
        { at: 'bucket:0', say: 'Search for 136, which was placed after probing past 26. The search meets the tombstone at slot 0 and keeps going; an empty slot there would have ended it too soon.', do: { search: 136, run: 4 } },
        { at: 'load', say: 'Two more inserts take the table over its load limit. It is rebuilt with 23 slots and every key is hashed again.', do: { insert: [59, 70], run: 24 } },
        { at: 'strategy', say: 'The same keys under linear probing: compare the collisions and the longest probe.', do: { strategy: 'linear' } }
      ]
    })
  ],
  ['hash-table-edge', 'hash-table: quadratic, loose input, negative and long keys', '{"kind":"hashtable","method":"Quadratic Probing","size":"5","load":0.99,"keys":[-7, 21, "13", 4.5, null, "elephant", "a b", 29, 5, 37, -3],"ops":["insert 45","delete 21",["find",29],{"op":"add","key":"zebra"},61, 77, 93],"title":"Quadratic probing from five slots"}']
]
