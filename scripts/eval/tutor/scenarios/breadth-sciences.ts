/**
 * Breadth, sciences and quantitative subjects: physics, chemistry, genetics, statistics,
 * epidemiology, economics and finance. Each value was worked out before it was written down
 * (projectile range, series resistance, Punnett ratios, odds ratios, discounted cash flows), and
 * each topic must be profiled as the kinds given, so the lesson's request carries that toolkit.
 */
import type { Scenario } from '../types'

const r = String.raw

export const BREADTH_SCIENCES: Scenario[] = [
  // ---------- Classical mechanics ----------
  {
    id: 'mechanics-open-projectile-motion',
    subject: 'mechanics',
    situation: 'open',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Projectile motion' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'], askTypes: ['predict', 'short', 'choice', 'problem'], mustNot: [r`\b45\s*°?\s*(degrees)?\b.{0,40}\b(maximi[sz]es|furthest|greatest range)`] },
    good: r`**Why this matters**

Projectile motion is the first place where you split one motion into two independent ones: steady sideways motion and uniformly accelerated vertical motion. The same split is how a game engine moves a thrown object each frame, how ballistics tables were computed, and how you analyse any motion under constant force. It is also the first real use of vectors in mechanics, which everything later (forces, momentum, orbits) builds on.

<ask type="predict">A ball is rolled off a table at 2 m/s and, at the same instant, a second ball is dropped from the same height. Ignoring air resistance, which one lands first, or do they land together? Say why.</ask>`,
    bad: [
      {
        reply: r`Projectile motion is motion under gravity alone. The horizontal velocity is constant and the vertical acceleration is $g = 9.8\ \text{m/s}^2$, and the range is greatest at 45 degrees, which maximises the range.

What do you think happens if you double the launch speed?`,
        fails: ['heading', 'must-not'],
        repaired: ['ask']
      }
    ],
    judge: 'Opens with where the idea is used and asks a prediction that exposes whether the learner thinks horizontal motion affects fall time, without giving the answer.'
  },
  {
    id: 'mechanics-after-wrong-heavier-falls-faster',
    subject: 'mechanics',
    situation: 'after-wrong',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: "Newton's second law" },
    history: [
      {
        tutor: r`Newton's second law says the net force on a body equals its mass times its acceleration: $F = ma$.

<ask type="predict">In a vacuum, a 1 kg ball and a 10 kg ball are dropped together from the same height. Which reaches the ground first?</ask>`
      },
      { learner: { answer: 'The 10 kg ball, because gravity pulls ten times harder on it, so it accelerates faster.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      names: [r`ten times (the|as much)? ?mass|10 times (the|as much)? ?mass|(more|larger|greater|bigger) mass|inertia|a\s*=\s*F\s*/\s*m|\\frac\{F\}\{m\}`, r`same (acceleration|time)|together|9\.8|\bg\b`],
      must: [r`F\s*=\s*mg|mg|98\s*N|9\.8\s*N`]
    },
    good: r`<grade verdict="wrong" score="0">"gravity pulls ten times harder" is right, but "so it accelerates faster" is the step that fails: the 10 kg ball also has ten times the mass to accelerate.</grade>

Work it through with $a = F/m$. The pull of gravity is $F = mg$: about 9.8 N on the 1 kg ball and 98 N on the 10 kg ball. Dividing each by its own mass gives $a = 9.8\ \text{m/s}^2$ for both, so they fall together. The extra force is exactly cancelled by the extra inertia.

<card>In a vacuum, does a heavier object fall faster? :: No. The force mg grows with mass, but so does the inertia, so a = mg/m = g for every mass.</card>

<ask type="short">On the Moon, $g$ is about 1.6 m/s². A hammer and a feather are dropped together from 1.6 m. Using $h = \tfrac{1}{2} g t^2$, how long does each take to land?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, the heavier ball has more force on it, so it falls faster.</grade>

<ask type="short">What is the force on the 10 kg ball?</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'The learner believes a bigger force means a bigger acceleration regardless of mass. The reply must name that and show with F = mg and a = F/m that the masses cancel.'
  },
  {
    id: 'mechanics-mark-planted-error-units',
    subject: 'mechanics',
    situation: 'mark-planted-error',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Work and energy' },
    history: [
      {
        tutor: r`**Problem 1**

A 2 kg trolley starts from rest and is pushed with a constant 5 N force along a frictionless track for 360 cm. Find its final speed.

<solution>Work done $W = Fd = 5 \times 3.6 = 18$ J. All of it becomes kinetic energy: $\tfrac{1}{2}(2)v^2 = 18$, so $v^2 = 18$ and $v = \sqrt{18} \approx 4.24$ m/s.</solution>

<ask type="problem">The final speed, with your working.</ask>`
      },
      { learner: { answer: 'W = F d = 5 × 360 = 1800 J. Then ½ × 2 × v² = 1800, so v² = 1800 and v = √1800 ≈ 42.4 m/s.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`360|cent[ie]met|\bcm\b|metres|meters|3\.6`], must: [r`4\.2|\\sqrt\{18\}|√18|18\s*J`] },
    good: r`<grade verdict="partial" score="0.5">The method is right, but "5 × 360" uses the distance in centimetres: work in joules needs metres, so $d = 3.6$ m.</grade>

With metres: $W = 5 \times 3.6 = 18$ J, then $\tfrac{1}{2}(2)v^2 = 18$ gives $v = \sqrt{18} \approx 4.2$ m/s. A speed of 42 m/s (about 150 km/h) from a 5 N push over a few metres should have looked wrong: estimating first catches unit slips.

<ask type="problem">The same trolley is pushed with 5 N over 2.5 m, but now friction of 1 N acts against it. Find its final speed.</ask>

<solution>Net work $= (5 - 1) \times 2.5 = 10$ J, so $\tfrac{1}{2}(2)v^2 = 10$, $v = \sqrt{10} \approx 3.16$ m/s.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Good use of the work-energy theorem.</grade>

<ask type="problem">Now add friction of 1 N. What is the final speed?</ask>

<solution>Net work 4 × 3.6 = 14.4 J, v = 3.79 m/s.</solution>`,
        fails: ['verdict', 'names', 'must']
      }
    ]
  },

  // ---------- Electromagnetism ----------
  {
    id: 'electromagnetism-after-wrong-series-current',
    subject: 'electromagnetism',
    situation: 'after-wrong',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: "Ohm's law and resistors in series" },
    history: [
      {
        tutor: r`A 12 V battery is connected to a 2 Ω resistor and a 4 Ω resistor in series.

<ask type="short">What current flows through the 4 Ω resistor?</ask>`
      },
      { learner: { answer: 'I = V/R = 12/4 = 3 A.', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`total|6\s*Ω|6 ohm|whole circuit|both resistors|add`], must: [r`\b2\$?\s*A\b|2 amps`] },
    good: r`<grade verdict="wrong" score="0">"12/4" applies the whole 12 V across the 4 Ω resistor alone, but in series the voltage is shared between both resistors.</grade>

In series the same current passes through each resistor, and their resistances add: $R = 2 + 4 = 6\ \Omega$. So $I = 12 / 6 = 2$ A, through both. The 4 Ω resistor then takes $V = IR = 2 \times 4 = 8$ V and the 2 Ω takes 4 V, which add back to 12 V.

<card>Resistors in series: what is the same, and what adds? :: The current is the same through each; resistances add, and the voltages across them add to the supply voltage.</card>

<ask type="short">Now the same two resistors are connected in parallel across the 12 V battery. What current flows through the 4 Ω resistor?</ask>`,
    judge: 'Names the specific error (the full supply voltage put across one resistor) and corrects it with the series total.'
  },
  {
    id: 'electromagnetism-tangent-build-circuit',
    subject: 'electromagnetism',
    situation: 'tangent',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Charging a capacitor through a resistor' },
    history: [
      {
        tutor: r`When a capacitor charges through a resistor, the voltage across it rises as $V(t) = V_0(1 - e^{-t/RC})$, and $RC$ is the time constant.

<ask type="short">With $R = 10\ \text{k}\Omega$ and $C = 100\ \mu\text{F}$, what is the time constant?</ask>`
      },
      { learner: { question: 'Can we wire this up and measure it with a real oscilloscope in Tide?' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: [r`can(no|')t|cannot|not able|no way to`, r`plot|simulat|python|run_code|calculat|curve`], words: { max: 150 } },
    good: r`Not in Tide: it can't drive real hardware or read an oscilloscope. What it can do is plot the exact charging curve, so you can see what the scope would show, and give you a parts list (a 10 kΩ resistor, a 100 µF capacitor, a 5 V supply) to try it on a breadboard.

~~~sim
{"kind":"plot","functions":["5*(1 - exp(-x/1))"],"x":[0,5],"point":1,"title":"Capacitor voltage, RC = 1 s"}
~~~

At one time constant the voltage has reached about 63% of the supply.

<ask type="short">Back to the numbers: with $R = 10\ \text{k}\Omega$ and $C = 100\ \mu\text{F}$, what is $RC$ in seconds?</ask>`.replace(/~~~/g, '```'),
    judge: 'Says plainly in a line that Tide cannot measure a real circuit, offers the best substitute (an exact plot, a parts list), and returns to the question.'
  },

  // ---------- Quantum basics ----------
  {
    id: 'quantum-open-wave-function',
    subject: 'quantum',
    situation: 'open',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Quantum basics: the wave function' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'] },
    good: r`**Why this matters**

The wave function is how quantum mechanics describes a particle: not a position, but an amplitude for every position. Its square gives the probability of finding the particle there, which is what explains atomic spectra, chemical bonding, how transistors and lasers work, and why qubits can hold superpositions. Everything later in the subject, from the Schrödinger equation to tunnelling, is a statement about how this function behaves.

<ask type="predict">An electron is described by a wave function that is large around $x = 0$ and nearly zero elsewhere. If you measure its position many times on identically prepared electrons, what pattern of results do you expect?</ask>`
  },
  {
    id: 'quantum-idk-born-rule',
    subject: 'quantum',
    situation: 'idk',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Quantum basics: the Born rule' },
    history: [
      {
        tutor: r`A qubit is in the state $|\psi\rangle = \tfrac{3}{5}|0\rangle + \tfrac{4}{5}|1\rangle$.

<ask type="short">If you measure it, what is the probability of getting 1?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], mustNot: [r`16/25|0\.64|64\s*%`] },
    good: r`The rule you need is the Born rule: the probability of an outcome is the square of the magnitude of its amplitude. For $|0\rangle$ here that is $(3/5)^2 = 9/25$.

Notice the two squares must add to 1, because one of the outcomes always happens.

<ask type="short">Using the same rule, what is the probability of measuring 1? Check that it adds to $9/25$ to make 1.</ask>`,
    bad: [{ reply: r`The probability of 1 is $(4/5)^2 = 16/25 = 0.64$.

<ask type="short">What is the probability of 0?</ask>`, fails: ['must-not'] }],
    judge: 'Gives the rule and a worked case on the other amplitude, leaving the asked value for the learner.'
  },

  // ---------- Organic chemistry ----------
  {
    id: 'organic-chem-after-wrong-tertiary-sn2',
    subject: 'organic-chem',
    situation: 'after-wrong',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Organic chemistry: SN1 and SN2 reactions' },
    history: [
      {
        tutor: r`In an SN2 reaction the nucleophile attacks the carbon from the side opposite the leaving group, in one step.

<ask type="choice" options="Methyl bromide|Ethyl bromide|tert-Butyl bromide">Which of these reacts fastest with hydroxide by SN2?</ask>`
      },
      { learner: { answer: 'tert-Butyl bromide, because it has the most carbons pushing electrons, so it is the most reactive.', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`steric|crowd|hinder|block|bulky|backside|back side|opposite side`], must: [r`methyl`] },
    good: r`<grade verdict="wrong" score="0">"the most carbons pushing electrons" is a reason that matters for SN1, where a carbocation forms; in SN2 those three methyl groups block the backside attack.</grade>

SN2 needs the nucleophile to reach the carbon from directly behind the leaving group. In tert-butyl bromide three bulky methyl groups crowd that side, so SN2 is almost impossible. Methyl bromide has only hydrogens there, so it is fastest: the order is methyl > primary > secondary, with tertiary not reacting by SN2.

<card>SN2 rate order by substrate, and why :: Methyl > primary > secondary, tertiary not at all: backside attack is blocked by steric hindrance.</card>

<ask type="choice" options="SN1|SN2">tert-Butyl bromide in water, a weak nucleophile and a polar protic solvent: which mechanism does it follow?</ask>`
  },
  {
    id: 'organic-chem-tangent-do-the-reaction',
    subject: 'organic-chem',
    situation: 'tangent',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Organic chemistry: nucleophilic substitution' },
    history: [
      {
        tutor: r`Bromoethane reacts with aqueous sodium hydroxide to give ethanol and bromide ions.

<ask type="short">Which species is the nucleophile here?</ask>`
      },
      { learner: { question: 'Could we actually run this reaction as a practical in Tide and watch the precipitate with silver nitrate?' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: [r`can(no|')t|cannot|not able`, r`method|procedure|published|data|steps|safety|bench|lab`], words: { max: 150 } },
    good: r`No, Tide can't run a wet-lab practical. The substitute: the method written out step by step (warm bromoethane with aqueous NaOH, acidify with dilute nitric acid, add silver nitrate, and see a cream precipitate of AgBr), with the safety steps, so you can do it at a real bench, plus the published observations to compare against.

<ask type="short">Back to the mechanism: which species is the nucleophile, and which atom of it attacks the carbon?</ask>`,
    judge: 'States in one line that a practical cannot be done in Tide, offers the method and published data as the substitute, then returns to the question.'
  },

  // ---------- Genetics ----------
  {
    id: 'genetics-after-correct-monohybrid',
    subject: 'genetics',
    situation: 'after-correct',
    kinds: ['quant', 'domain'],
    setup: { mode: 'teach', topic: 'Mendelian genetics: monohybrid crosses' },
    history: [
      {
        tutor: r`**Problem 1**

In pea plants, purple flowers (P) are dominant to white (p). Two Pp plants are crossed. What fraction of the offspring are expected to have white flowers?

<solution>The Punnett square gives PP, Pp, Pp, pp: 1/4 are pp, which is white.</solution>

<ask type="problem">The fraction, with your working.</ask>`
      },
      { learner: { answer: 'Pp × Pp: half of each parent’s gametes carry p, and a white flower needs pp, so 1/2 × 1/2 = 1/4 of the offspring.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'short'] },
    good: r`<grade verdict="correct" score="1">"1/2 × 1/2 = 1/4" is right: the two gametes are drawn independently, and each carries p half the time.</grade>

**Problem 2**

A purple-flowered plant of unknown genotype is crossed with a white one. Of 40 offspring, 19 are white. What was the purple parent's genotype, and what ratio did you expect?

<solution>A white parent is pp. If the purple parent were PP, every offspring would be Pp (purple). Getting about half white means the purple parent was Pp: expected ratio 1:1, so 20 of 40; 19 is close.</solution>

<ask type="problem">The genotype and the expected ratio, with your reasoning.</ask>`
  },
  {
    id: 'genetics-mark-planted-error-dihybrid',
    subject: 'genetics',
    situation: 'mark-planted-error',
    kinds: ['quant', 'domain'],
    setup: { mode: 'teach', topic: 'Mendelian genetics: dihybrid crosses' },
    history: [
      {
        tutor: r`**Problem 1**

In peas, round (R) is dominant to wrinkled (r) and yellow (Y) to green (y), on separate chromosomes. Two RrYy plants are crossed. What fraction of the offspring are round and green?

<solution>Round: 3/4. Green (yy): 1/4. Independent, so 3/4 × 1/4 = 3/16.</solution>

<ask type="problem">The fraction, with your working.</ask>`
      },
      { learner: { answer: 'Round is 3/4 and green is 3/4 as well, so round and green is 3/4 × 3/4 = 9/16.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`green.{0,40}(1/4|recessive|yy)|(1/4|recessive|yy).{0,40}green`], must: [r`3/16|\\frac\{3\}\{16\}`] },
    good: r`<grade verdict="wrong" score="0">"green is 3/4" is the slip: green is recessive, so it needs yy, which is 1/4 of offspring.</grade>

Round is right at 3/4. Green needs yy: $1/2 \times 1/2 = 1/4$. The genes are on separate chromosomes, so multiply: $3/4 \times 1/4 = 3/16$, one of the four classes in the 9:3:3:1 ratio.

<ask type="problem">From the same cross, what fraction of offspring are wrinkled and green?</ask>

<solution>Wrinkled rr: 1/4; green yy: 1/4; so 1/16.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Good, 9/16 is the first number of the 9:3:3:1 ratio.</grade>

<ask type="problem">What fraction are wrinkled and green?</ask>

<solution>1/16.</solution>`,
        fails: ['verdict', 'names', 'must']
      }
    ]
  },

  // ---------- Statistics ----------
  {
    id: 'statistics-after-wrong-p-value-meaning',
    subject: 'statistics',
    situation: 'after-wrong',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Hypothesis testing and p-values' },
    history: [
      {
        tutor: r`A test of whether a new checkout page changes conversion gives $p = 0.03$.

<ask type="explain">In one sentence, what does $p = 0.03$ mean here?</ask>`
      },
      { learner: { answer: 'There is a 3% chance that the null hypothesis is true, so 97% that the new page really works.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`if the null (hypothesis )?(is|were) true|assuming the null|given the null`, r`not the probability (that )?the null|isn't the probability|is not the chance`] },
    good: r`<grade verdict="wrong" score="0">"a 3% chance that the null hypothesis is true" reverses the conditional, which is the most common misreading of a p-value.</grade>

A p-value is computed assuming the null is true: if the new page made no difference, a result at least this extreme would turn up 3% of the time. It is not the probability that the null is true; that would need a prior, and Bayes' theorem.

<card>What does p = 0.03 mean? :: If the null hypothesis were true, data at least this extreme would occur 3% of the time. It is not the probability that the null is true.</card>

<ask type="choice" options="Yes|No">A test of 20 page colours with no real effect is run at the 0.05 level. Is it likely that at least one of them comes out significant?</ask>`
  },
  {
    id: 'statistics-mark-planted-error-standard-error',
    subject: 'statistics',
    situation: 'mark-planted-error',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Statistics: confidence intervals' },
    history: [
      {
        tutor: r`**Problem 1**

A sample of 100 sessions has mean duration 12 minutes and standard deviation 5 minutes. Give an approximate 95% confidence interval for the mean.

<solution>Standard error $= 5/\sqrt{100} = 0.5$. Interval $12 \pm 1.96 \times 0.5 = 12 \pm 0.98$, about (11.02, 12.98).</solution>

<ask type="problem">The interval, with your working.</ask>`
      },
      { learner: { answer: 'Standard error = 5/100 = 0.05, so the interval is 12 ± 1.96 × 0.05 = 12 ± 0.098, about (11.90, 12.10).', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`square root|\\sqrt|√`], must: [r`0\.5\b|0\.98|11\.0|12\.98`] },
    good: r`<grade verdict="partial" score="0.5">The method is right, but "5/100" divides by $n$; the standard error divides by $\sqrt{n}$.</grade>

$SE = 5/\sqrt{100} = 0.5$, so the interval is $12 \pm 1.96 \times 0.5 = 12 \pm 0.98$, about (11.02, 12.98). Dividing by $n$ made the interval ten times too narrow.

<ask type="problem">How many sessions would you need for the 95% interval to be ±0.25 minutes wide, with the same standard deviation?</ask>

<solution>$1.96 \times 5/\sqrt{n} = 0.25$, so $\sqrt{n} = 39.2$ and $n \approx 1537$.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Correct interval.</grade>

<ask type="problem">How many sessions for ±0.25?</ask>

<solution>n ≈ 1537.</solution>`,
        fails: ['verdict', 'names', 'must']
      }
    ]
  },

  // ---------- Epidemiology ----------
  {
    id: 'epidemiology-after-correct-odds-ratio',
    subject: 'epidemiology',
    situation: 'after-correct',
    kinds: ['quant', 'domain'],
    setup: { mode: 'teach', topic: 'Epidemiology: odds ratios' },
    history: [
      {
        tutor: r`**Problem 1**

In a case-control study, 40 of 100 cases and 20 of 100 controls were exposed. What is the odds ratio for exposure?

<solution>Odds among cases $40/60$, among controls $20/80$. OR $= (40/60)/(20/80) = 0.667/0.25 \approx 2.67$.</solution>

<ask type="problem">The odds ratio, with your working.</ask>`
      },
      { learner: { answer: 'OR = (40 × 80) / (60 × 20) = 3200 / 1200 ≈ 2.67.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true },
    good: r`<grade verdict="correct" score="1">"(40 × 80) / (60 × 20) ≈ 2.67" is right: the cross-product form is the same ratio of odds.</grade>

**Problem 2**

In a cohort study, 30 of 200 smokers and 10 of 200 non-smokers develop the disease. Give the relative risk and the odds ratio, and say why they differ.

<solution>RR $= (30/200)/(10/200) = 3$. OR $= (30/170)/(10/190) = 0.1765/0.0526 \approx 3.35$. The OR is further from 1 because the outcome is not rare (15% among smokers); for a rare outcome they are close.</solution>

<ask type="problem">Both measures, and why they differ.</ask>`
  },
  {
    id: 'epidemiology-mark-planted-error-risk-vs-odds',
    subject: 'epidemiology',
    situation: 'mark-planted-error',
    kinds: ['quant', 'domain'],
    setup: { mode: 'teach', topic: 'Epidemiology: relative risk and odds ratios' },
    history: [
      {
        tutor: r`**Problem 1**

In a cohort, 50 of 100 exposed and 25 of 100 unexposed people fall ill. Compute the relative risk.

<solution>Risk exposed $0.5$, unexposed $0.25$, RR $= 2$.</solution>

<ask type="problem">The relative risk, with your working.</ask>`
      },
      { learner: { answer: 'Odds exposed = 50/50 = 1, odds unexposed = 25/75 = 1/3, so the relative risk is 1 ÷ 1/3 = 3.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`odds ratio|odds, not risk|risks?, not odds|out of 100|50/100`], must: [r`\b2\b|0\.5\s*/\s*0\.25`] },
    good: r`<grade verdict="wrong" score="0">"Odds exposed = 50/50" computes odds, so "3" is the odds ratio; relative risk divides risks, which are out of everyone in the group.</grade>

Risk exposed $= 50/100 = 0.5$ and risk unexposed $= 25/100 = 0.25$, so RR $= 0.5/0.25 = 2$. Your 3 is a correct odds ratio; it is further from 1 because the illness is common here.

<ask type="problem">In a second cohort, 5 of 1000 exposed and 1 of 1000 unexposed fall ill. Compute both the RR and the OR, and compare them.</ask>

<solution>RR $= 0.005/0.001 = 5$. OR $= (5/995)/(1/999) \approx 5.02$. For a rare outcome they almost agree.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, the relative risk is 3.</grade>

<ask type="problem">Try 5 of 1000 versus 1 of 1000.</ask>

<solution>RR 5.</solution>`,
        fails: ['verdict', 'names', 'must']
      }
    ]
  },

  // ---------- Macroeconomics ----------
  {
    id: 'macro-open-monetary-policy',
    subject: 'macro',
    situation: 'open',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Macroeconomics: monetary policy and inflation' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'] },
    good: r`**Why this matters**

Monetary policy is how a central bank such as the Bank of England or the Federal Reserve steers inflation, mostly by setting a short-term interest rate. That rate feeds into mortgage rates, business borrowing, the exchange rate and asset prices, which is why markets move on every rate decision. Understanding the chain from a policy rate to prices is the base for reading central bank statements, for valuing bonds, and for any work in payments and banking where interest income depends on it.

<ask type="predict">A central bank raises its policy rate by one percentage point. What do you expect to happen to household borrowing over the following year, and why?</ask>`
  },
  {
    id: 'macro-after-wrong-real-rate',
    subject: 'macro',
    situation: 'after-wrong',
    kinds: ['quant'],
    setup: { mode: 'teach', topic: 'Macroeconomics: real and nominal interest rates' },
    history: [
      {
        tutor: r`A savings account pays 5% a year, and inflation over the year is 7%.

<ask type="short">Did the saver's purchasing power go up or down, and by roughly how much?</ask>`
      },
      { learner: { answer: 'Up by 5%, because the balance grew by 5%.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`real|purchasing power|prices rose|inflation`], must: [r`[-−]\s*2\s*%|down.{0,30}2\s*%|about 2\s*%|1\.9\s*%`] },
    good: r`<grade verdict="wrong" score="0">"Up by 5%" counts the nominal growth only; prices rose 7% over the same year.</grade>

What the money buys is what matters. The real rate is roughly nominal minus inflation: $5\% - 7\% = -2\%$. Exactly, $1.05 / 1.07 - 1 \approx -1.9\%$. So the saver can buy about 2% less than a year ago, even though the balance is bigger.

<card>Real interest rate, approximately and exactly :: Approximately nominal minus inflation; exactly (1 + nominal)/(1 + inflation) − 1.</card>

<ask type="short">A loan charges 4% a year while inflation is 6%. In real terms, who gains: the borrower or the lender?</ask>`
  },

  // ---------- Corporate finance ----------
  {
    id: 'corp-finance-mark-planted-error-npv',
    subject: 'corp-finance',
    situation: 'mark-planted-error',
    kinds: ['quant', 'domain'],
    setup: { mode: 'teach', topic: 'Corporate finance: net present value' },
    history: [
      {
        tutor: r`**Problem 1**

A project costs £1,000 today and returns £600 at the end of year 1 and £600 at the end of year 2. The discount rate is 10%. What is its NPV?

<solution>$NPV = -1000 + 600/1.1 + 600/1.1^2 = -1000 + 545.45 + 495.87 = 41.32$.</solution>

<ask type="problem">The NPV, with your working.</ask>`
      },
      { learner: { answer: 'NPV = −1000 + 600/1.1 + 600/1.1 = −1000 + 545.45 + 545.45 = 90.91, so accept it.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'partial', accept: ['wrong'], names: [r`1\.1\s*\^\s*2|1\.1\^\{?2\}?|1\.21|squared|two years|second year|year 2`], must: [r`41\.3|495\.8`] },
    good: r`<grade verdict="partial" score="0.5">The method is right and so is the decision, but "600/1.1" for the second payment discounts it for only one year; it needs $1.1^2$.</grade>

$600/1.1^2 = 600/1.21 = 495.87$, so $NPV = -1000 + 545.45 + 495.87 = 41.32$. Still positive, so accept, but by less than half your figure.

<ask type="problem">At what discount rate does this project's NPV become zero (its IRR)? Give it to one decimal place.</ask>

<solution>Solve $600/(1+r) + 600/(1+r)^2 = 1000$. With $x = 1/(1+r)$: $600x^2 + 600x - 1000 = 0$, $x = 0.8844$, so $r \approx 13.1\%$.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Right, NPV is 90.91 and the project should go ahead.</grade>

<ask type="problem">What is the IRR?</ask>

<solution>About 13.1%.</solution>`,
        fails: ['verdict', 'names', 'must']
      }
    ]
  },
  {
    id: 'corp-finance-after-correct-irr',
    subject: 'corp-finance',
    situation: 'after-correct',
    kinds: ['quant', 'domain'],
    setup: { mode: 'teach', topic: 'Corporate finance: NPV and IRR' },
    history: [
      {
        tutor: r`**Problem 1**

A bond-like project pays £110 in one year for £100 today. What is its IRR?

<solution>$100 = 110/(1+r)$, so $r = 10\%$.</solution>

<ask type="problem">The IRR, with your working.</ask>`
      },
      { learner: { answer: '100 = 110 / (1 + r), so 1 + r = 1.1 and r = 10%.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true },
    good: r`<grade verdict="correct" score="1">"1 + r = 1.1" gives the rate at which the NPV is zero, so the IRR is 10%.</grade>

**Problem 2**

Project A costs £100 and pays £130 in one year. Project B costs £1,000 and pays £1,200 in one year. The discount rate is 8% and you can do only one. Which has the higher IRR, which has the higher NPV, and which should you choose?

<solution>IRR A $= 30\%$, IRR B $= 20\%$. NPV A $= 130/1.08 - 100 = 20.37$; NPV B $= 1200/1.08 - 1000 = 111.11$. Choose B: when projects are mutually exclusive, the higher NPV adds more value, even with the lower IRR.</solution>

<ask type="problem">Both IRRs, both NPVs, and your choice with the reason.</ask>`
  }
]
