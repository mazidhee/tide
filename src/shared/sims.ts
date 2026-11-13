/**
 * What the tutor is told about live simulations (```sim blocks, drawn by
 * src/renderer/src/lib/sims). The whole guide sits in the system prompt of every chat turn. A
 * lesson gets only the kinds its topic can use, with its instructions (simLesson), and nothing at
 * all when none fits: most lessons, which were reading some 580 words about simulations they could
 * never show.
 */
/** Every kind of simulation, by the name a block's "kind" carries */
export const SIM_KINDS = ['neural-net', 'attention', 'gradient-descent', 'softmax', 'raft', 'b-tree', 'hash-table', 'cpu', 'tokeniser', 'blockchain', 'plot', 'physics', 'geometry', 'regex', 'chess', 'ledger', 'payments', 'stablecoin', 'risk'] as const
export type SimKind = (typeof SIM_KINDS)[number]

// A small model often labels the block "json" (or nothing) and gets everything else right:
// what makes it a simulation is its "kind", not the label on the fence
const KIND_AT_START = new RegExp(`^\\s*\\{\\s*"kind"\\s*:\\s*"(${SIM_KINDS.join('|')})"`)

/** Whether a fenced block is a simulation, from its label and what it holds */
export const isSimSource = (lang: string, code: string) => {
  const l = lang.toLowerCase()
  return l === 'sim' || ((l === 'json' || l === '') && KIND_AT_START.test(code))
}

export const SIM_GUIDE = `- For how a model, algorithm, protocol or machine works, show it running: a fenced code block whose language is sim (never json), holding one JSON object. The app turns it into a live simulation the student can play, step and change; every number in it is computed. Kinds:
  - neural-net, a small network learning by backpropagation: {"kind":"neural-net","layers":[2,4,4,1],"data":"xor","activation":"tanh","rate":0.3}. data: xor, circle, two-moons, spiral, linear. activation: tanh, relu, sigmoid. Up to 3 hidden layers of up to 8 neurons. Add "mode":"forward" or "mode":"backward" to walk one sample through layer by layer, with each value or gradient. Spiral needs relu and [2,8,8,8,1].
  - attention, self-attention on a sentence: {"kind":"attention","tokens":["the","cat","sat"],"heads":2}. Up to 12 tokens, 1 to 4 heads, optional "temperature" and "causal":true. Its weights are seeded random numbers: use it for the mechanism, and never say the pattern means anything.
  - gradient-descent, a point going down a loss surface: {"kind":"gradient-descent","surface":"ravine","optimiser":"momentum","rate":0.05,"momentum":0.9}. surface: bowl, ravine, saddle, two-minima. optimiser: sgd, momentum, adam.
  - softmax, logits to probabilities: {"kind":"softmax","logits":[2,1,0.1],"labels":["cat","dog","bird"],"temperature":1}.
  - raft, leader election and log replication on 3 or 5 nodes: {"kind":"raft","nodes":5,"commands":["x=1","y=2"]}. do: {"stop":2}, {"start":2}, {"isolate":"leader"}, {"partition":[[1,2],[3,4,5]]}, {"heal":true}, {"command":"z=3"}.
  - b-tree, insert, search and delete with splits, borrows and merges: {"kind":"b-tree","order":4,"keys":[50,20,70,10,30,60,80],"ops":[{"insert":42},{"delete":70}]}. order (most children) 3 to 7. do: {"insert":42}, {"delete":20}, {"search":30}.
  - hash-table, collisions, probing and resizing: {"kind":"hash-table","strategy":"linear","capacity":11,"keys":[15,26,37],"insert":[48,59]}. strategy: chaining, linear, quadratic, double. do: as b-tree.
  - cpu, a register machine stepping through fetch, decode, execute: {"kind":"cpu","program":"LOADI R0, 3\\nLOADI R1, 1\\nloop: SUB R0, R1\\nJZ done\\nJMP loop\\ndone: STORE R0, out\\nHALT\\nout: DATA 9"}. Only these instructions: LOADI r, n; LOAD r, a; STORE r, a; ADD r, s; SUB r, s; JMP a; JZ a; JN a; HALT; "name: DATA n" for a memory cell. R0 to R3, 8-bit words, 32 cells. {"run":3} is one instruction.
  - tokeniser, byte-pair encoding learnt from a short text, merge by merge: {"kind":"tokeniser","text":"the cat sat on the mat. the cat ate the rat.","sentence":"the hat sat","merges":20}. It is a tiny tokeniser trained on that text only: say so.
  - blockchain, real SHA-256 proof of work, tampering and a fork: {"kind":"blockchain","difficulty":2,"blocks":["Genesis","Ada pays Bo 5"]}. difficulty 1 to 4. do: {"mine":1}, {"tamper":2}, {"repair":2}, {"fork":true}.
  - plot, exact graphs of up to 4 functions of x: {"kind":"plot","functions":["a*x^2 + b","sin(x)"],"params":{"a":1,"b":0},"x":[-5,5],"point":1}. Allowed: + - * / ^, brackets, sin cos tan exp ln log sqrt abs, pi, e; any other single letter is a slider. The point shows the value and the tangent's slope. do: {"set":{"a":2}}, {"x":1.5}.
  - physics, a rigid-body engine (Box2D) running a scene, measured beside the formula: {"kind":"physics","scene":"projectile","speed":15,"angle":45,"height":0,"g":9.81}. Scenes and settings: projectile (speed, angle, height, g), pendulum (length, angle, mass, g, damping), spring (k, mass, stretch, damping), incline (angle, friction, mass, g), collision (m1, m2, u1, u2, e). do: {"set":{"angle":30}} restarts it.
  - geometry, draggable points with lengths, angles and areas measured live: {"kind":"geometry","points":{"A":[0,0],"B":[4,0],"C":[1,3]},"draw":["polygon A B C","angle B A C","circle A B"]}. draw: polygon, segment, line, ray, vector, circle (centre, a point on it), angle (vertex in the middle). A linear map instead: "matrix":[[1,1],[0,1]], optional "vectors":{"v":[1,2]}; parts matrix, det, basis, square, eigen. do: {"move":["C",2,3]}, {"matrix":[[2,0],[0,1]]}, {"t":0.5}.
  - regex, a JavaScript pattern as a railroad diagram, matches and groups marked in test strings: {"kind":"regex","pattern":"(\\\\d{3})-(\\\\d{4})","flags":"g","tests":["call 555-1234","none here"]}. do: {"pattern":"\\\\d+"}, {"flags":"gi"}, {"test":"another"}.
  - chess, a position and a minimax or alpha-beta search: its pick, each move's score, positions visited: {"kind":"chess","moves":["e4","e5","Nf3"],"depth":2,"search":"alphabeta"}. Optional "fen"; depth 1 to 4. do: {"move":"Nc6"}, {"depth":3}, {"search":"minimax"}, {"undo":true}.
  - Finance (ledger, payments, stablecoin, risk): a finance lesson is told how to write them; anywhere else {"kind":"ledger"}, {"kind":"payments","mode":"net"}, {"kind":"stablecoin","scenario":"run"} or {"kind":"risk","mode":"option"} draws one with its defaults.
  Any kind takes "title" and an optional "tour" that points at parts as you explain: up to 12 steps like {"at":"loss","say":"one or two plain sentences","do":{"run":200}}. "do" is optional: {"run":n} advances n steps, {"pause":true}, {"sample":n}, or one of the kind's own listed above. Parts to point at: neural-net input, layer:1, neuron:1:2 (layer, neuron), edge:0:1:2 (from layer, from neuron, to neuron), output, surface, loss; attention token:3, row:3, scores, weights, mix; gradient-descent point, gradient, path, minimum; softmax logit:2, probabilities, temperature; raft node:2, log:2, entry:2:1 (node, index), timer:2, leader, term, commit, messages, network; b-tree root, node:2:1 (level, index), key:42, path, height, fill; hash-table bucket:4 (from 0), key:48, load, probe, hash; cpu pc, ir, register:1, flag:z, memory:7, line:3, phase; tokeniser text, pairs, pair:1, merge:2, vocabulary, token:2; blockchain block:2, hash:2, nonce:2, link:2, difficulty, tip, fork, miner:a; plot function:1, point, tangent, param:a, axes; physics body, velocity, energy, prediction, param:angle; geometry point:A, angle:BAC, polygon:ABC, circle:A; regex pattern, flags, diagram, test:2, match:1, group:1; chess board, square:e4, best, eval, nodes, search, turn, move:2. Counting starts at 1; layer 0 is the input.
  One simulation per answer, valid JSON, and a sentence on what to watch or try. The student can select a part and ask about it; the question names the part and its current values, so answer about exactly that.`

/** The finance kinds, written out only for a lesson whose topic fits them (the chat guide names them in one line) */
export const FINANCE_SIM_KINDS: readonly SimKind[] = ['ledger', 'payments', 'stablecoin', 'risk']
const FINANCE_LINES = `  - ledger, a bank's double-entry books, with balance sheet, journal and trial balance live: {"kind":"ledger","capital":500000,"customers":["Ada","Bo"],"ops":[{"deposit":["Ada",2000]},{"transfer":["Ada","Bo",500]},{"loan":["Bo",3000,0.08]}]}. Dollars; ops play one per step. do: {"deposit":["Ada",100]}, {"withdraw":["Ada",50]}, {"transfer":["Ada","Bo",20]}, {"loan":["Bo",1000,0.05]}, {"repay":["Bo",200]}, {"fee":["Ada",5]}, {"payout":["Ada",300]} (to another bank), {"payin":["Bo",300]}, {"eod":1} (a day's interest), {"broken":true} (an unbalanced entry, refused).
  - payments, money between banks: {"kind":"payments","mode":"rtgs","banks":{"A":30,"B":20,"C":10},"payments":[["A","B",80],["B","C",120],["C","A",60]]}. mode: rtgs (gross, queued without reserves: gridlock), net (multilateral netting), instant (prefunded, rejected not queued; "limit"), card ("amount"; authorisation to payout with interchange, scheme and acquirer fees), iso20022 (pain.001, pacs.008 and camt.053 with a field to break). A step submits the next payment. do: {"pay":["A","B",40]}, {"fund":["B",50]}, {"mode":"net"}, {"settle":true}, {"break":"iban"} (iban, bic, sum, decimals, count, none).
  - stablecoin, a coin day by day (price, backing, reserves, redemptions): {"kind":"stablecoin","scenario":"bank-failure"}. scenario: calm, bank-failure (USDC and SVB, March 2023), run (fire sales), algorithmic (UST and LUNA, May 2022). Optional "panic" 0 to 3, "capacity", "cashShare", "fee". A step is a day. do: {"scenario":"run"}, {"mint":50}, {"redeem":50} (millions), {"set":{"panic":2}}.
  - risk, on synthetic prices made by Tide (say so): {"kind":"risk","mode":"var","method":"historical","level":0.99}. mode var (historical, parametric, Monte Carlo VaR and ES on a histogram; "ticker" TIDX, PAYX, LEDG, STBL, UTIL), option (Monte Carlo converging on Black-Scholes: "spot", "strike", "years", "rate", "vol", "type", "antithetic"), backtest (moving-average crossover against buy and hold: "fast", "slow", "cost"). do: {"method":"parametric"}, {"level":0.95}, {"paths":5000}, {"set":{"vol":0.3}}, {"mode":"backtest"}.
`
const FINANCE_PARTS = "ledger account:reserves (or loans, cash, capital, a customer's name), entry:3, balance-sheet, journal, trial-balance, equation; payments bank:A, payment:2, queue, net, gross, saving, step:3, field, problems; stablecoin price, backing, reserves, supply, redemptions, day:3, token; risk histogram, var, es, method, path, estimate, exact, band, equity, hold, drawdown"

/** The whole guide, every kind written out (what simGuide filters) */
export const FULL_SIM_GUIDE = SIM_GUIDE.replace(/^ {2}- Finance \(.*\n/m, FINANCE_LINES).replace('. Counting starts at 1', `; ${FINANCE_PARTS}. Counting starts at 1`)

/** The topics each kind can show, read off a lesson's topic */
const TOPIC: Record<SimKind, RegExp> = {
  'neural-net': /\b(neural|backprop\w*|perceptrons?|hidden layers?|activation functions?|multi-?layer|mlp|deep learning|vanishing gradients?)\b/i,
  attention: /\b(attention|transformers?)\b/i,
  'gradient-descent': /\b(gradient descent|optimi[sz]ers?|momentum|adam|sgd|learning rates?|loss (surface|landscape)s?)\b/i,
  softmax: /\b(softmax|logits?|cross[- ]entropy|sampling temperature)\b/i,
  raft: /\b(raft|consensus|leader election|log replication|paxos)\b/i,
  'b-tree': /\bb\+?[- ]?trees?\b|\bindex(es|ing)?\b/i,
  'hash-table': /\bhash[- ]?(tables?|maps?|sets?)\b|\b(open addressing|linear probing|collision resolution|chaining)\b/i,
  cpu: /\b(cpu|register machine|fetch|instruction cycle|assembly|machine code|program counter|instruction set)\b/i,
  tokeniser: /\b(tokeni[sz]\w*|byte[- ]pair|bpe)\b/i,
  blockchain: /\b(blockchains?|proof of work|mining|bitcoin)\b/i,
  plot: /\b(graphs? of|plot(ting)?|derivatives?|differentiation|calculus|limits?|polynomials?|quadratics?|exponentials?|logarithms?|trigonometr\w*|sine|cosine|parabolas?|slope|tangent lines?|taylor)\b/i,
  physics: /\b(projectiles?|pendulums?|springs?|hooke\W?s law|simple harmonic|harmonic (motion|oscillators?)|inclined planes?|friction|(elastic|inelastic) collisions?|conservation of (energy|momentum)|linear momentum|restitution|kinematics|newton\W?s (laws?|second law)|free fall|physics engines?|rigid[- ]bod(y|ies))\b/i,
  geometry: /\b(geometry|triangles?|circles?|polygons?|pythagor\w*|linear (maps?|transformations?)|matri(x|ces)|determinants?|eigen\w*|basis vectors?|shears?|rotation matri\w*|similar triangles|congruen\w*|vectors? (addition|in 2d|in the plane))\b/i,
  regex: /\b(regex(es|ps?)?|regular expressions?|lookaheads?|lookbehinds?|capture groups?|backreferences?)\b/i,
  chess: /\b(chess|minimax|alpha[- ]beta|game[- ]trees?|adversarial search|negamax|evaluation functions?)\b/i,
  ledger: /\b(double[- ]entry|ledgers?|general ledger|journal entr\w*|debits? and credits?|trial balance|core banking|core bank\w*|bank'?s balance sheet|accounting equation|interest accrual|money creation|bookkeeping)\b/i,
  payments: /\b(settlement|clearing|rtgs|real[- ]time gross|deferred net|netting|payment rails?|payment systems?|payment infrastructure|instant payments?|faster payments|fednow|ach|chaps|fedwire|target2|card (payments?|schemes?)|interchange|acquir\w+|gridlock|iso ?20022|pain\.001|pacs\.008|camt\.053|swift mx|ibans?)\b/i,
  stablecoin: /\b(stablecoins?|usdc|usdt|tether|peg|depeg\w*|de-peg\w*|algorithmic stablecoins?|terra|ust|bank runs?|mint and redeem|redemptions?)\b/i,
  risk: /\b(value[- ]at[- ]risk|expected shortfall|market risk|stress tests?|options? pricing|black[- ]?scholes|monte carlo|backtest\w*|trading strateg\w*|moving average crossover|sharpe ratio|drawdowns?|european options?|geometric brownian motion|put[- ]call parity)\b/i
}

/** The kinds of simulation a lesson on this topic could show */
export const simKindsFor = (topic: string): SimKind[] => SIM_KINDS.filter((k) => TOPIC[k].test(topic))

/** The guide for some kinds only: their own lines, and their parts in the line about tours */
export function simGuide(kinds: readonly SimKind[]): string {
  const [from, to] = ['Parts to point at: ', '. Counting starts at 1']
  return FULL_SIM_GUIDE.split('\n')
    .filter((line) => {
      const kind = /^\s+- ([a-z-]+),/.exec(line)?.[1]
      return !kind || (kinds as readonly string[]).includes(kind)
    })
    .map((line) => {
      const [a, b] = [line.indexOf(from), line.indexOf(to)]
      if (a < 0 || b < 0) return line
      const parts = line.slice(a + from.length, b).split('; ').filter((p) => (kinds as readonly string[]).includes(p.split(' ')[0]))
      return `${line.slice(0, a + from.length)}${parts.join('; ')}${line.slice(b)}`
    })
    .join('\n')
}

/** What a lesson is told about simulations: how to write the kinds its topic can use, or nothing when none fits */
export function simLesson(topic: string): string {
  const kinds = simKindsFor(topic)
  if (!kinds.length) return ''
  return `A live simulation fits this topic (${kinds.join(', ')}). Use one rather than a diagram where it shows the idea running, with a short tour pointing at what to look at, then ask them to change one thing and predict what happens.\n${simGuide(kinds)}`
}
