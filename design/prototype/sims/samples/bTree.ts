/** Harness samples for "b-tree": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['b-tree', 'b-tree: default', '{"kind":"b-tree"}'],
  ['b-tree-own', 'b-tree: order 4, about 18 keys, a queue', '{"kind":"b-tree","order":4,"keys":[50,20,70,10,30,60,80,5,15,25,35,55,65,75,85,40,45],"ops":[{"insert":42},{"delete":70},{"search":35}],"title":"Insert, delete and search at order 4"}'],
  [
    'b-tree-tour',
    'b-tree: with a tour',
    JSON.stringify({
      kind: 'b-tree',
      order: 3,
      keys: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140],
      title: 'How a B-tree grows and shrinks',
      tour: [
        { at: 'order', say: 'Order 3: a node holds one or two keys and has two or three children. Every leaf is on the same level.' },
        { at: 'path', say: 'Insert 150. The search compares at each node and goes down one child at a time, then puts the key in a leaf, which now has one key too many.', do: { insert: 150, run: 2 } },
        { at: 'height', say: 'The leaf splits and its median moves up. That overflows the parent, which splits too, and finally the root splits: the only way the tree gets taller.', do: { run: 3 } },
        { at: 'key:80', say: 'Now delete 80, which sits in the root. A key in an internal node is replaced by its predecessor, taken from a leaf.', do: { delete: 80, run: 1 } },
        { at: 'step', say: 'That leaf is left empty and no sibling can spare a key, so nodes merge all the way up and the root disappears: the tree gets shorter again.', do: { run: 4 } },
        { at: 'fill', say: 'A search changes nothing. It reads one node per level, so its cost is the height of the tree.', do: { search: 100, run: 4 } }
      ]
    })
  ],
  ['b-tree-edge', 'b-tree: order 7, loose input, wide keys', '{"kind":"btree","m":"7","keys":"5, 9000, -250, 17, x, 4.5, 1200, 33, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 3, 7, 11, 13, 19, 23, 29, 31, 37, 41, 43, 47","operations":["insert 9999","delete 5",["search",-250],{"op":"remove","key":17},12],"title":"Order 7 with large keys"}']
]
