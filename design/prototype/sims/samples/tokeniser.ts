/** Harness samples for "tokeniser": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['tokeniser', 'tokeniser: the classic example', '{"kind":"tokeniser","title":"Learning merges from a few words"}'],
  [
    'tokeniser-tour',
    'tokeniser: a guided tour',
    JSON.stringify({
      kind: 'tokeniser',
      title: 'How a tokeniser learns its vocabulary',
      text: 'the cat sat on the mat. the cat ate the rat. the rat sat on the cat.',
      sentence: 'the hat sat',
      merges: 20,
      tour: [
        { at: 'text', say: 'At the start every character is its own token, and each word ends with the mark _.' },
        { at: 'pair:1', say: 'Count every adjacent pair. The most frequent one is merged next.' },
        { at: 'merge:1', say: 'One step: that pair becomes a single new token everywhere in the text.', do: { run: 1 } },
        { at: 'length', say: 'Five more merges. The vocabulary grows by one each time and the text gets shorter.', do: { run: 5 } },
        { at: 'token:2', say: 'Your sentence is split with the same merges. "hat" was never in the text, so it is spelt from smaller pieces: h, then at_.' },
        { at: 'sentence', say: 'A sentence close to the training text needs far fewer tokens.', do: { sentence: 'the cat sat on the mat.' } }
      ]
    })
  ],
  [
    'tokeniser-odd',
    'tokeniser: accents, emoji, capitals kept, and characters never seen',
    '{"kind":"tokeniser","text":"Café café naïve 🙂 🙂 🙂 déjà déjà vu vu Zoë Zoë","sentence":"café Zoë xyz 🙃","lowercase":false,"merges":60,"start":8}'
  ]
]
