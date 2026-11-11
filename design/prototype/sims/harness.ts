/**
 * Harness for the live simulations: writes sample ```sim blocks with the markup the app's
 * Markdown renderer produces, then lets the app's own hydration (startSims) turn them into
 * simulations. Not part of the app.
 */
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../../src/renderer/src/styles/theme.css'
import '../../../src/renderer/src/styles/app.css'
import '../../../src/renderer/src/styles/prose.css'
import '../../../src/renderer/src/styles/sims.css'
import '../../../src/renderer/src/styles/simkinds/shared.css'
import '../../../src/renderer/src/styles/simkinds/raft.css'
import '../../../src/renderer/src/styles/simkinds/bTree.css'
import '../../../src/renderer/src/styles/simkinds/hashTable.css'
import '../../../src/renderer/src/styles/simkinds/cpu.css'
import '../../../src/renderer/src/styles/simkinds/tokeniser.css'
import '../../../src/renderer/src/styles/simkinds/blockchain.css'
import '../../../src/renderer/src/styles/simkinds/plot.css'
import { samples as raftSamples } from './samples/raft'
import { samples as bTreeSamples } from './samples/bTree'
import { samples as hashTableSamples } from './samples/hashTable'
import { samples as cpuSamples } from './samples/cpu'
import { samples as tokeniserSamples } from './samples/tokeniser'
import { samples as blockchainSamples } from './samples/blockchain'
import { samples as plotSamples } from './samples/plot'
import { startSims } from '../../../src/renderer/src/lib/sims'

const query = new URLSearchParams(location.search)
document.documentElement.dataset.theme = query.get('theme') ?? 'light'
if (query.get('busy')) document.documentElement.dataset.modelBusy = '1'

const SAMPLES: [string, string, string][] = [
  ['neural-net', 'neural-net: training', '{"kind":"neural-net","layers":[2,4,4,1],"data":"xor","activation":"tanh","rate":0.3,"title":"A small network learning XOR"}'],
  ['spiral', 'neural-net: spiral, ReLU', '{"kind":"neural-net","layers":[2,8,8,8,1],"data":"spiral","activation":"relu","rate":0.1,"title":"Three hidden layers on a spiral"}'],
  ['forward', 'neural-net: forward pass', '{"kind":"neural-net","layers":[2,3,1],"data":"circle","activation":"tanh","mode":"forward","title":"One sample, layer by layer"}'],
  ['backward', 'neural-net: backward pass', '{"kind":"neural-net","layers":[2,4,3,1],"data":"two-moons","activation":"tanh","mode":"backward","title":"Gradients flowing back"}'],
  [
    'tour',
    'neural-net: with a tour',
    JSON.stringify({
      kind: 'neural-net',
      layers: [2, 4, 1],
      data: 'circle',
      rate: 0.3,
      title: 'What a hidden neuron does',
      tour: [
        { at: 'surface', say: 'Before training the output is nearly flat: the network cannot tell the two classes apart yet.' },
        { at: 'loss', say: 'Train for 300 batches. The loss falls as the weights move against their gradients.', do: { run: 300 } },
        { at: 'neuron:1:2', say: 'Each hidden neuron draws one soft line across the plane. Hover it to see its side.' },
        { at: 'edge:0:1:2', say: 'This weight sets how strongly x₁ pushes that neuron.' }
      ]
    })
  ],
  ['attention', 'attention', '{"kind":"attention","tokens":["The","cat","sat","on","the","mat"],"heads":2,"title":"Who attends to whom","select":3}'],
  ['attention-long', 'attention: 12 tokens, causal', '{"kind":"attention","tokens":["When","the","animal","crossed","the","street","it","was","too","tired","to","stop"],"heads":4,"causal":true,"select":7,"tour":[{"at":"row:7","say":"Row 7 is the query \\"it\\": with a causal mask it can only look at itself and the six tokens before it."}]}'],
  ['gradient-descent', 'gradient-descent: ravine, momentum', '{"kind":"gradient-descent","surface":"ravine","optimiser":"momentum","rate":0.05,"momentum":0.8,"title":"Momentum in a ravine"}'],
  ['two-minima', 'gradient-descent: two minima, Adam', '{"kind":"gradient-descent","surface":"two-minima","optimiser":"adam","rate":0.1,"title":"Which minimum?","tour":[{"at":"gradient","say":"The orange arrow is the plain gradient step; the blue one is what Adam will actually do."}]}'],
  ['softmax', 'softmax', '{"kind":"softmax","logits":[2.0,1.0,0.1,-1.5],"labels":["cat","dog","bird","fish"],"temperature":1,"title":"From logits to probabilities","tour":[{"at":"logit:1","say":"Drag this logit up and every other probability falls, because they share one total."}]}'],
  ...raftSamples, ...bTreeSamples, ...hashTableSamples, ...cpuSamples, ...tokeniserSamples, ...blockchainSamples, ...plotSamples,
  ['bad', 'left alone: half-written, unknown kind', '{"kind":"neural-net","layers":[2,4,'],
  ['bad', '', '{"kind":"quantum-foam","qubits":3}']
]

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const only = query.get('only')
const column = document.getElementById('column')!
column.style.maxWidth = `${query.get('w') ?? 900}px`
for (const [key, heading, source] of SAMPLES) {
  if (only && only !== key) continue
  if (heading) column.insertAdjacentHTML('beforeend', `<h2>${heading}</h2>`)
  column.insertAdjacentHTML('beforeend', `<pre class="code-block" data-lang="sim"><button class="copy-code" type="button">Copy</button><code class="hljs">${escapeHtml(source)}</code></pre>`)
}

document.addEventListener('tide:ask-about', (e) => console.log('tide:ask-about', JSON.stringify((e as CustomEvent).detail)))
startSims()

// ?press=Next,Next clicks buttons by their text once things are mounted; ?select=<css> clicks an element
const press = (query.get('press') ?? '').split(',').filter(Boolean)
const select = query.get('select')
setTimeout(() => {
  press.forEach((name, i) =>
    setTimeout(() => Array.from(document.querySelectorAll<HTMLElement>('.sim button')).find((b) => b.textContent === name)?.click(), i * 150)
  )
  // ?steps=N presses S (one step) N times on each simulation: headless Chrome gives few animation frames
  const steps = Number(query.get('steps') ?? 0)
  document.querySelectorAll<HTMLElement>('.sim').forEach((sim) => {
    for (let i = 0; i < steps; i++) sim.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
  })
  if (select) setTimeout(() => document.querySelector(select)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), 50)
}, 600)
