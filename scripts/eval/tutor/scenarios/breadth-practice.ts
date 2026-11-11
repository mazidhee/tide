/**
 * Breadth, professions and engineering outside the core set: core banking, accounting, contract
 * law, game loops and game physics, 3-D graphics maths, compilers and operating systems. Every
 * figure was worked out before it was written (postings that balance, matrix products, the frame
 * step), and the code in the game-loop scenario was run.
 */
import type { Scenario } from '../types'

const r = String.raw
const code = (s: string) => s.replace(/~~~/g, '```')

export const BREADTH_PRACTICE: Scenario[] = [
  // ---------- Core banking ----------
  {
    id: 'core-banking-open-double-entry-ledger',
    subject: 'core-banking',
    situation: 'open',
    kinds: ['domain', 'build'],
    setup: { mode: 'teach', topic: 'Core banking: ledgers and double-entry postings' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'], must: [r`debit`, r`credit`] },
    good: r`**Why this matters**

Every balance a bank shows is the sum of postings in its ledger, and every posting is double-entry: each transaction debits one account and credits another by the same amount, so the books always balance. Core banking systems (Thought Machine Vault, Mambu, Temenos) and payment platforms such as Stripe's ledger are built on that invariant, and reconciliation, audit and regulatory reporting all depend on it. Getting it right is the difference between a ledger you can trust and one that drifts.

<ask type="predict">A customer deposits £100 in cash at a branch. The bank's cash account goes up by £100. Which other account must change, by how much, and in which direction, for the books to balance?</ask>`,
    judge: 'Names real systems and the double-entry invariant, then asks for the other side of a concrete posting.'
  },
  {
    id: 'core-banking-show-me-clearing-settlement',
    subject: 'core-banking',
    situation: 'show-me',
    kinds: ['domain', 'build'],
    setup: { mode: 'teach', topic: 'Core banking: clearing and settlement' },
    history: [
      {
        tutor: r`When Alice at Bank A pays Bob at Bank B, three things happen. Bank A debits Alice's account and sends a payment message. Clearing: the payment system checks and records the instruction and works out what Bank A owes Bank B. Settlement: the money actually moves between the banks, on their accounts at the central bank. Bank B then credits Bob.

<note>Clearing is agreeing what is owed; settlement is moving central bank money to pay it.</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: { kind: 'mermaid', diagram: ['sequenceDiagram'] }, forbid: ['grade'], must: [r`clear`, r`settle`] },
    good: code(r`~~~mermaid
sequenceDiagram
    participant Alice
    participant BankA as "Bank A"
    participant PS as "Payment system"
    participant CB as "Central bank"
    participant BankB as "Bank B"
    Alice->>BankA: pay Bob 50
    BankA->>BankA: debit Alice 50
    BankA->>PS: payment message
    PS->>PS: clearing: A owes B 50
    PS->>CB: settle A to B
    CB->>CB: debit A's reserves, credit B's
    CB-->>BankB: settled
    BankB->>BankB: credit Bob 50
~~~

Watch the two lines inside the payment system and the central bank: clearing only records what is owed, and settlement is the step where money moves.`),
    bad: [{ reply: r`Clearing comes first, then settlement at the central bank.

<ask type="short">What is the difference between them?</ask>`, fails: ['ends', 'visual'] }]
  },
  {
    id: 'core-banking-after-wrong-clearing-is-settlement',
    subject: 'core-banking',
    situation: 'after-wrong',
    kinds: ['domain', 'build'],
    setup: { mode: 'teach', topic: 'Core banking: settlement risk in deferred net settlement' },
    history: [
      {
        tutor: r`In a deferred net settlement system, payments are cleared through the day and settled in batches.

<ask type="explain">Bank A has sent 1,000 payments to Bank B, cleared through the morning. At noon Bank A fails before the next settlement cycle. Has Bank B received the money?</ask>`
      },
      { learner: { answer: 'Yes, the payments were cleared, so the money is already with Bank B.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`clear(ed|ing)? (is|only|means|records|was)|not (yet )?settled|until (it is )?settled|settlement (is|moves)`], must: [r`settlement risk|credit risk|exposure|unwind|RTGS|real[- ]time gross`] },
    good: r`<grade verdict="wrong" score="0">"the payments were cleared, so the money is already with Bank B" treats clearing as payment; cleared means agreed and recorded, not yet settled.</grade>

Until the settlement cycle runs, nothing has moved between the banks' central bank accounts. If Bank A fails first, Bank B is left with a claim on a failed bank: that is settlement risk, and in a net system the cleared batch may have to be unwound. Real-time gross settlement (RTGS) systems such as CHAPS and Fedwire settle each payment individually as it is sent, which removes that exposure at the cost of needing more liquidity.

<card>Cleared vs settled :: Cleared: the instruction is checked and what is owed is agreed. Settled: the money has moved, finally and irrevocably, usually in central bank money.</card>

<ask type="short">Name one reason a bank might still prefer deferred net settlement over RTGS.</ask>`
  },

  // ---------- Accounting ----------
  {
    id: 'accounting-after-wrong-cash-basis',
    subject: 'accounting',
    situation: 'after-wrong',
    kinds: ['domain', 'quant'],
    setup: { mode: 'teach', topic: 'Accounting: accruals and revenue recognition' },
    history: [
      {
        tutor: r`A consultancy finishes a £12,000 project for a client in December. The client pays in February. The consultancy's year ends on 31 December.

<ask type="short">Under accrual accounting, in which year is the £12,000 of revenue recognised?</ask>`
      },
      { learner: { answer: 'Next year, in February, when the cash comes in.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`cash basis|when (the )?cash|cash (is )?received`, r`performance obligation|earned|work (is )?(done|performed|completed)|delivered|IFRS 15|ASC 606`], must: [r`receivable`] },
    good: r`<grade verdict="wrong" score="0">"when the cash comes in" is cash-basis accounting; accruals recognise revenue when it is earned, which was December.</grade>

Under IFRS 15 (and ASC 606 in the US) revenue is recognised when the performance obligation is satisfied: the work was completed in December, so the £12,000 is this year's revenue. At year end the entry is Dr Trade receivables £12,000, Cr Revenue £12,000. In February the cash arrives: Dr Cash £12,000, Cr Trade receivables £12,000, with no revenue then.

<card>When is revenue recognised under accrual accounting? :: When it is earned (the performance obligation is satisfied, IFRS 15), not when cash is received.</card>

<ask type="short">The same client pays a £3,000 deposit in November for work to be done in January. What account is credited in November?</ask>`
  },
  {
    id: 'accounting-mark-planted-error-unbalanced-entry',
    subject: 'accounting',
    situation: 'mark-planted-error',
    kinds: ['domain', 'quant'],
    setup: { mode: 'teach', topic: 'Accounting: journal entries' },
    history: [
      {
        tutor: r`**Problem 1**

A business buys a £5,000 machine, paying £2,000 in cash and owing the rest to the supplier. Write the journal entry.

<solution>Dr Equipment 5,000; Cr Cash 2,000; Cr Accounts payable 3,000. Debits 5,000 = credits 5,000.</solution>

<ask type="problem">The journal entry, with each line debit or credit.</ask>`
      },
      { learner: { answer: 'Dr Equipment 5,000\nCr Cash 2,000\nCr Accounts payable 5,000', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'partial', accept: ['wrong'], names: [r`3,?000`, r`balance|7,?000|do not (add|match)|don't (add|match)|unequal`], visual: { kind: 'table' } },
    good: r`<grade verdict="partial" score="0.5">The accounts and sides are right, but "Cr Accounts payable 5,000" is the slip: only £3,000 is owed, and as written the credits total 7,000 against debits of 5,000.</grade>

| Account | Debit | Credit |
|---|---|---|
| Equipment | 5,000 | |
| Cash | | 2,000 |
| Accounts payable | | 3,000 |
| Total | 5,000 | 5,000 |

Check every entry by totalling both columns: they must be equal.

<ask type="problem">A month later the business pays the supplier the £3,000 it owes. Write that journal entry.</ask>

<solution>Dr Accounts payable 3,000; Cr Cash 3,000.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Correct entry.</grade>

<ask type="problem">Now record paying the supplier.</ask>

<solution>Dr Accounts payable 3,000; Cr Cash 3,000.</solution>`,
        fails: ['verdict', 'names', 'visual']
      }
    ]
  },

  // ---------- Contract law ----------
  {
    id: 'contract-law-open-offer-acceptance',
    subject: 'contract-law',
    situation: 'open',
    kinds: ['domain', 'interpret'],
    setup: { mode: 'teach', topic: 'Contract law: offer and acceptance' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'], must: [r`offer`, r`accept`] },
    good: r`**Why this matters**

Whether a contract exists at all turns on offer and acceptance: a firm offer, and an acceptance that matches it exactly. Every sales agreement, software licence and online checkout relies on these rules, and disputes over whether a deal was ever made, from Carlill v Carbolic Smoke Ball Co (1893) to modern click-wrap cases, are decided on them. This is English common law; other jurisdictions differ in the details, and we will say so where they do.

<ask type="predict">A shop displays a jacket in its window priced £20 by mistake; it should be £200. You walk in and say you'll take it at £20. Do you think the shop is bound to sell it to you? Give your reason.</ask>`,
    judge: 'Names the jurisdiction and a real case, then asks a prediction whose answer turns on invitation to treat, without giving it away.'
  },
  {
    id: 'contract-law-after-wrong-advert-is-offer',
    subject: 'contract-law',
    situation: 'after-wrong',
    kinds: ['domain', 'interpret'],
    setup: { mode: 'teach', topic: 'Contract law: invitations to treat' },
    history: [
      {
        tutor: r`<ask type="short">A newspaper advertisement lists bramblefinch cocks at 25s each. A buyer sends money for one. In English law, did the advertisement make an offer the buyer accepted?</ask>`
      },
      { learner: { answer: 'Yes. The advert states the goods and the price, so it is an offer, and sending money accepts it.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`invitation to treat`], must: [r`Partridge v Crittenden|Partridge`] },
    good: r`<grade verdict="wrong" score="0">"it states the goods and the price, so it is an offer" is the step that fails: in English law an advertisement like this is usually an invitation to treat.</grade>

In Partridge v Crittenden (1968) an advert for bramblefinch cocks was held not to be an offer: the seller could not be bound to sell to everyone who replied, since stock is limited. The buyer's letter is the offer, which the seller may accept or refuse. The exception is a unilateral offer, such as the reward in Carlill v Carbolic Smoke Ball Co (1893), where the words show an intention to be bound by anyone who performs.

<card>Is a newspaper advert for goods an offer? :: Usually not: it is an invitation to treat (Partridge v Crittenden, 1968). The customer's response is the offer. Exception: a unilateral offer, as in Carlill.</card>

<ask type="short">A website advertises a TV at £10 instead of £1,000 and sends an automatic order confirmation. What would you need to look at to decide whether a contract was formed?</ask>`
  },

  // ---------- Game loops and game physics ----------
  {
    id: 'game-dev-code-bug-frame-dependent-movement',
    subject: 'game-dev',
    situation: 'code-bug',
    kinds: ['build', 'quant'],
    setup: { mode: 'teach', topic: 'Game loop and frame-rate independent movement', options: { strategy: 'code' } },
    history: [
      {
        tutor: r`<ask type="code" lang="python">Write update(x, speed) that moves a sprite to the right at speed pixels per second, called once per frame from the game loop. Test it: at 60 frames a second for one second with speed 120, x should go from 0 to 120.</ask>

<solution>Pass the frame time: def update(x, speed, dt): return x + speed * dt. At 60 fps, dt = 1/60, and 60 calls move 120 pixels; at 30 fps, 30 calls of dt = 1/30 move the same 120.</solution>`
      },
      {
        learner: {
          answer: code(r`~~~python
def update(x, speed):
    return x + speed / 60

x = 0
for frame in range(60):
    x = update(x, 120)
print(x)  # 120.0
~~~`)
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'partial', accept: ['wrong'], names: [r`/\s*60|hard-?cod|assum\w* 60|fixed 60`, r`\bdt\b|delta time|frame time|elapsed`] },
    good: r`<grade verdict="partial" score="0.5">It passes the test at 60 fps, but "speed / 60" assumes every frame lasts exactly 1/60 s; at 30 fps the sprite moves half as far per second.</grade>

Frames are not equal in length: a slow machine or a busy frame makes them longer. The loop measures the time since the last frame, dt, and passes it in, so distance is speed × time whatever the frame rate. At 30 fps your version gives 30 × 2 = 60 pixels in one second instead of 120.

<card>Frame-rate independent movement :: Multiply by the frame time: x += speed * dt, with dt measured each frame, never a fixed 1/60.</card>

<ask type="code" lang="python">Change update to take dt, and test it at 60 fps and at 30 fps for one second: x should reach 120 both times.</ask>

<solution>def update(x, speed, dt): return x + speed * dt. 60 calls with dt = 1/60 and 30 calls with dt = 1/30 both give 120.0 (to floating-point rounding).</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">It prints 120.0, so it works.</grade>

<ask type="code" lang="python">Now add gravity to make the sprite fall.</ask>

<solution>vy += g * dt; y += vy * dt</solution>`,
        fails: ['verdict', 'names']
      }
    ]
  },
  {
    id: 'game-dev-tangent-run-godot',
    subject: 'game-dev',
    situation: 'tangent',
    kinds: ['build', 'quant'],
    setup: { mode: 'teach', topic: 'Game loop and physics in games' },
    history: [
      {
        tutor: r`A fixed-timestep loop runs physics in steps of exactly 1/60 s, however long each rendered frame takes, and carries the leftover time to the next frame.

<ask type="short">If a frame takes 1/30 s, how many physics steps run in it?</ask>`
      },
      { learner: { question: "Can I just run my Godot project in Tide and you check _physics_process for me?" } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: [r`can(no|')t|cannot|not able`, r`python|javascript|same idea|runs here|not run`], words: { max: 160 } },
    good: r`Tide can't run Godot's editor or a Godot project. What it can do: paste your _physics_process function and I'll read it line by line, and we can run the same fixed-step loop in Python here so every number is checked. GDScript I show will be marked as not run; to try it, open it in Godot 4.

<ask type="short">Back to the loop: if a frame takes 1/30 s and physics steps are 1/60 s, how many physics steps run in that frame?</ask>`,
    judge: 'Says in a line that a Godot project cannot run in Tide, offers the substitutes (reading the code, the same loop in Python), then returns to the question.'
  },

  // ---------- 3-D graphics maths ----------
  {
    id: 'graphics-maths-after-correct-rotation',
    subject: 'graphics-maths',
    situation: 'after-correct',
    kinds: ['build', 'quant'],
    setup: { mode: 'teach', topic: '3-D graphics maths: rotation matrices' },
    history: [
      {
        tutor: r`**Problem 1**

The 2-D rotation by angle $\theta$ is $R = \begin{pmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{pmatrix}$. Rotate the point $(1, 0)$ by 90°.

<solution>$\cos 90° = 0$, $\sin 90° = 1$, so $R(1, 0) = (0, 1)$.</solution>

<ask type="problem">The rotated point, with your working.</ask>`
      },
      { learner: { answer: 'cos 90 = 0 and sin 90 = 1, so R = [[0, −1], [1, 0]] and R(1, 0) = (0, 1).', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true },
    good: r`<grade verdict="correct" score="1">"R(1, 0) = (0, 1)" is right: a quarter turn anticlockwise takes the x-axis to the y-axis.</grade>

**Problem 2**

Rotate the point $(2, 1)$ by 90° and then by another 90°. What single matrix does the same as both, and where does the point end up?

<solution>$R_{90}^2 = \begin{pmatrix} -1 & 0 \\ 0 & -1 \end{pmatrix}$, the 180° rotation. $(2, 1) \to (-1, 2) \to (-2, -1)$.</solution>

<ask type="problem">The combined matrix and the final point, with your working.</ask>`
  },
  {
    id: 'graphics-maths-mark-planted-error-order',
    subject: 'graphics-maths',
    situation: 'mark-planted-error',
    kinds: ['build', 'quant'],
    setup: { mode: 'teach', topic: '3-D graphics maths: composing transformation matrices' },
    history: [
      {
        tutor: r`**Problem 1**

Using column vectors ($p' = Mp$), write the single matrix that first rotates a point by 90° about the origin and then translates it by $(3, 0)$, in 2-D homogeneous coordinates. Apply it to $(1, 0)$.

<solution>$M = T R$. $R(1,0) = (0,1)$, then $T$ gives $(3, 1)$. $M = \begin{pmatrix} 0 & -1 & 3 \\ 1 & 0 & 0 \\ 0 & 0 & 1 \end{pmatrix}$.</solution>

<ask type="problem">The matrix and the transformed point.</ask>`
      },
      { learner: { answer: 'M = R T. Translating (1, 0) first gives (4, 0), then rotating by 90° gives (0, 4).', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`order|right to left|rightmost|first.{0,30}(right|last)|T\s*R`], must: [r`\(3,\s*1\)`] },
    good: r`<grade verdict="wrong" score="0">"M = R T" applies the translation first: with column vectors the matrix nearest the point acts first, so rotate-then-translate is $M = TR$.</grade>

$R(1, 0) = (0, 1)$, and translating by $(3, 0)$ gives $(3, 1)$. Your $(0, 4)$ is what you get by translating first and then rotating about the origin, which swings the moved point round.

<ask type="problem">Write the matrix that rotates by 90° about the point $(3, 0)$ rather than the origin, as a product of three matrices, and apply it to $(4, 0)$.</ask>

<solution>$M = T(3,0)\,R_{90}\,T(-3,0)$. $(4,0) \to (1,0) \to (0,1) \to (3,1)$.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Right, (0, 4).</grade>

<ask type="problem">Now rotate about (3, 0).</ask>

<solution>T R T^-1.</solution>`,
        fails: ['verdict', 'names', 'must']
      }
    ]
  },

  // ---------- Compilers ----------
  {
    id: 'compilers-show-me-ast',
    subject: 'compilers',
    situation: 'show-me',
    kinds: ['build'],
    setup: { mode: 'teach', topic: 'Compilers: parsing expressions into abstract syntax trees' },
    history: [
      {
        tutor: r`A parser turns the tokens of $2 + 3 * 4$ into a tree. Because $*$ binds tighter than $+$, the multiplication sits lower in the tree and is evaluated first; the root is the operator applied last.

<note>In an AST, operators that bind tighter sit deeper; the root is evaluated last.</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: { kind: 'mermaid', diagram: ['flowchart'] }, forbid: ['grade'] },
    good: code(r`~~~mermaid
flowchart TD
    plus["+"] --> two["2"]
    plus --> times["*"]
    times --> three["3"]
    times --> four["4"]
~~~

The root is +, so it runs last: the * node below it is evaluated first, giving 2 + 12 = 14.`)
  },
  {
    id: 'compilers-after-wrong-left-to-right',
    subject: 'compilers',
    situation: 'after-wrong',
    kinds: ['build'],
    setup: { mode: 'teach', topic: 'Compilers: operator precedence in parsers' },
    history: [
      {
        tutor: r`<ask type="short">A recursive-descent parser has one function per precedence level: expr handles + and -, term handles * and /. Parsing 8 - 2 * 3, what does it evaluate to?</ask>`
      },
      { learner: { answer: '18, because the parser reads left to right: 8 − 2 is 6, then 6 × 3 is 18.', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`left to right`, r`term|precedence|binds tighter|deeper|lower level`], must: [r`\b2\b`] },
    good: r`<grade verdict="wrong" score="0">"the parser reads left to right" is true of the tokens, but evaluation follows the tree, and term parses 2 * 3 before expr can use it.</grade>

expr parses a term (8), sees -, then calls term for the right side. That call reads 2, sees *, and keeps going to build 2 * 3 as one subtree. So the tree is 8 - (2 * 3), which is 8 - 6 = 2. Precedence comes from which function calls which: the lower level binds tighter.

<card>How does recursive descent give * precedence over +? :: expr calls term for each operand, and term consumes * and / first, so products become subtrees before + or - joins them.</card>

<ask type="short">With the same parser, what tree does 8 - 2 - 3 produce, and what is its value, if expr loops left to right?</ask>`
  },

  // ---------- Operating systems ----------
  {
    id: 'os-after-wrong-physical-addresses',
    subject: 'os',
    situation: 'after-wrong',
    kinds: ['build'],
    setup: { mode: 'teach', topic: 'Operating systems: virtual memory' },
    history: [
      {
        tutor: r`<ask type="predict">Two processes each print the address of a global variable and both print 0x4000. Do they share that variable?</ask>`
      },
      { learner: { answer: 'Yes, the same address means the same place in RAM, so they share it.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`virtual address`, r`page table|translat|map`] },
    good: r`<grade verdict="wrong" score="0">"the same address means the same place in RAM" fails because 0x4000 is a virtual address, and each process has its own.</grade>

Each process has its own page table, which the MMU uses to translate every virtual address to a physical one. Process A's 0x4000 can map to physical frame 0x9A000 and process B's to 0x2C000, so writing in one never changes the other. They share memory only when the kernel maps both to the same frame, as with shared libraries or mmap with MAP_SHARED.

<card>Do two processes with the same pointer value share memory? :: Not in general: it is a virtual address, translated through each process's own page table to different physical frames.</card>

<ask type="short">After fork(), parent and child have the same virtual addresses and at first the same physical pages. What happens when the child writes to one of them?</ask>`
  },
  {
    id: 'os-idk-page-table-translation',
    subject: 'os',
    situation: 'idk',
    kinds: ['build'],
    setup: { mode: 'teach', topic: 'Operating systems: page tables and address translation' },
    history: [
      {
        tutor: r`Pages are 4 KiB (4096 bytes), and the page table maps virtual page 3 to physical frame 7.

<ask type="short">What physical address does virtual address 0x3010 translate to?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], mustNot: [r`0x7010`] },
    good: r`An address splits into two parts: the page number (the bits above the low 12, since $2^{12} = 4096$) and the offset within the page (the low 12 bits). Translation swaps the page number for the frame number and keeps the offset as it is.

For example, 0x2ABC is page 0x2, offset 0xABC; if page 2 mapped to frame 5, it would become 0x5ABC.

<ask type="short">Split 0x3010 into page and offset the same way. Which page is it, what is the offset, and so what physical address does it become?</ask>`,
    bad: [{ reply: r`It is 0x7010: page 3 becomes frame 7 and the offset 0x010 stays.

<ask type="short">What about 0x3FFF?</ask>`, fails: ['must-not'] }]
  }
]
