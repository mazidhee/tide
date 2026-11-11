/** Harness samples for "blockchain": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['blockchain', 'blockchain: default', '{"kind":"blockchain"}'],
  [
    'blockchain-tour',
    'blockchain: a tour of tampering and a fork',
    JSON.stringify({
      kind: 'blockchain',
      title: 'Why history is hard to rewrite',
      difficulty: 2,
      blocks: ['Genesis', 'Ada pays Bo 5', 'Bo pays Cy 2', 'Cy pays Di 1'],
      tour: [
        { at: 'hash:3', say: 'Each hash starts with 00 because a miner searched for a nonce that makes it so. The hash covers the previous block’s hash, which is what chains the blocks.' },
        { at: 'block:2', say: 'Change the payment in block 2. Its hash changes and no longer starts with 00, and block 3 still records the old hash.', do: { tamper: 2 } },
        { at: 'link:3', say: 'Block 2 is mined again and is valid, but its new hash is not the one block 3 recorded: that link is now broken.', do: { repair: 2 } },
        { at: 'difficulty', say: 'Each later block has to be mined again in turn. That work is what rewriting history costs.', do: { repair: 4 } },
        { at: 'fork', say: 'Now news of a block is held back, so both miners find block 5 on the same parent.', do: { fork: true } },
        { at: 'tip', say: 'Mining goes on. The first branch to get longer wins, and the other block is orphaned.', do: { mine: 1 } }
      ]
    })
  ],
  [
    'blockchain-edge',
    'blockchain: five starting blocks at difficulty 3, named miners',
    '{"kind":"blockchain","title":"A harder target","difficulty":3,"blocks":["Genesis","Ada pays Bo 5","Bo pays Cy 2","Cy pays Di 1","Di pays Ada 4"],"miners":["Ada","Bo"],"tour":[{"at":"fork","say":"With three zeros a block takes about 4,096 tries. Both miners now look for block 6 without hearing of each other.","do":{"fork":true}}]}'
  ]
]
