/**
 * Breadth, humanities, arts and a physical skill: philosophy, world history, linguistics, music
 * theory, UI design critique and the piano. Facts were checked against the sources named in the
 * replies (the Groundwork's wording, WCAG 2.2's contrast ratios, the July Crisis dates); where a
 * question has no single answer, the judge rubric carries what a good reply does.
 */
import type { Scenario } from '../types'

const r = String.raw
const code = (s: string) => s.replace(/~~~/g, '```')

export const BREADTH_HUMANITIES: Scenario[] = [
  // ---------- Philosophy ----------
  {
    id: 'philosophy-open-categorical-imperative',
    subject: 'philosophy',
    situation: 'open',
    kinds: ['interpret'],
    setup: { mode: 'teach', topic: "Kant's categorical imperative" },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'], must: [r`universal law`, r`Groundwork`], mustNot: [r`"kind"\s*:`, r`run_code|run_sql`] },
    good: r`**Why this matters**

Kant's categorical imperative is the most influential attempt to ground morality in reason alone rather than in consequences or feelings. It sits behind the modern language of human dignity and rights, and every debate between duty-based and outcome-based ethics, from medical consent to AI alignment, is partly a debate with it.

Read the first formulation as Kant gives it in the *Groundwork of the Metaphysics of Morals* (1785, Gregor's translation): "act only in accordance with that maxim through which you can at the same time will that it become a universal law."

<ask type="explain">Before we interpret it: in your own words, what does this sentence ask you to do before you act? Point to the words in it that tell you.</ask>`,
    judge: 'Reads first: quotes the formulation exactly with its source and asks what the text says before what it means, tied to its words.'
  },
  {
    id: 'philosophy-after-wrong-jtb',
    subject: 'philosophy',
    situation: 'after-wrong',
    kinds: ['interpret'],
    setup: { mode: 'teach', topic: 'Epistemology: the Gettier problem' },
    history: [
      {
        tutor: r`Smith has strong evidence that Jones will get the job and that Jones has ten coins in his pocket. He infers: "the man who will get the job has ten coins in his pocket". Unknown to him, Smith himself gets the job, and Smith also happens to have ten coins.

<ask type="explain">Is Smith's belief justified, is it true, and does he know it?</ask>`
      },
      { learner: { answer: 'It is justified and true, so yes, he knows it. Knowledge just is justified true belief.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`luck|by accident|coinciden|happens to be true`, r`justified true belief|JTB`], must: [r`Gettier`] },
    good: r`<grade verdict="partial" score="0.4">"justified and true" is right, but "so yes, he knows it" is exactly the step Gettier's 1963 paper challenges.</grade>

Smith's belief is true only by luck: the evidence was about Jones, and it is true because of facts about Smith he knew nothing of. Most readers judge that he does not know, which means justified true belief is not sufficient for knowledge. Responses differ, and none is settled: add a no-false-lemmas condition, require reliability, or require that the belief be safe from easily being false.

<card>Gettier's challenge to the justified-true-belief analysis :: A belief can be justified and true by luck (Smith and the ten coins), and then it seems not to be knowledge, so JTB is not sufficient.</card>

<ask type="explain">Set the argument out as numbered premises and a conclusion, then say which premise someone defending JTB would reject.</ask>`
  },

  // ---------- World history ----------
  {
    id: 'world-history-open-ww1-causes',
    subject: 'world-history',
    situation: 'open',
    kinds: ['narrative'],
    setup: { mode: 'teach', topic: 'The causes of the First World War' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'], must: [r`1914`], mustNot: [r`"kind"\s*:`, r`run_code|run_sql`] },
    good: r`**Why this matters**

The First World War killed some 15 to 20 million people, ended four empires and set up the conditions for the Second World War, so how it started is one of the most argued questions in modern history. It is also the classic case for how historians weigh causes: long-term structures (alliances, arms races, empire) against a short crisis of decisions made in the summer of 1914.

<ask type="predict">On 28 June 1914 Archduke Franz Ferdinand was assassinated in Sarajevo, and Britain was at war by 4 August. Before we look at the evidence, which do you expect mattered more for turning a murder into a European war: the alliances that existed beforehand, or the decisions taken in those five weeks?</ask>`,
    judge: 'Anchors in dates and frames the question as a weighing of causes, inviting a reasoned prediction without settling it.'
  },
  {
    id: 'world-history-show-me-july-crisis',
    subject: 'world-history',
    situation: 'show-me',
    kinds: ['narrative'],
    setup: { mode: 'teach', topic: 'The First World War: the July Crisis' },
    history: [
      {
        tutor: r`In five weeks after the assassination in Sarajevo, Austria-Hungary obtained German backing, sent Serbia an ultimatum, and declared war; Russia mobilised in support of Serbia; Germany declared war on Russia and then France, and invaded Belgium, which brought Britain in.

<note>July Crisis: assassination (28 June), German backing (5 to 6 July), ultimatum (23 July), Austria-Hungary declares war on Serbia (28 July), Russian general mobilisation (30 July), Germany declares war on Russia (1 August) and France (3 August), Britain declares war (4 August).</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: [{ kind: 'table' }, { kind: 'mermaid' }], forbid: ['grade'], must: [r`23 July`, r`4 August`] },
    good: r`| Date (1914) | Event | Consequence |
|---|---|---|
| 28 June | Franz Ferdinand assassinated in Sarajevo | Austria-Hungary resolves to act against Serbia |
| 5 to 6 July | Germany promises backing (the "blank cheque") | Austria-Hungary can risk war with Russia |
| 23 July | Ultimatum to Serbia | Serbia accepts most terms, not all |
| 28 July | Austria-Hungary declares war on Serbia | Russia moves to support Serbia |
| 30 July | Russian general mobilisation | Germany's war plan requires speed |
| 1 to 3 August | Germany declares war on Russia, then France | Invasion of Belgium begins |
| 4 August | Britain declares war on Germany | A European war |

Read the last column top to bottom: each step narrowed the choices of the next government.`
  },
  {
    id: 'world-history-after-wrong-single-cause',
    subject: 'world-history',
    situation: 'after-wrong',
    kinds: ['narrative'],
    setup: { mode: 'teach', topic: 'The causes of the First World War' },
    history: [
      {
        tutor: r`<ask type="explain">Why did the assassination of one archduke lead to a war between the great powers?</ask>`
      },
      { learner: { answer: 'Because the assassination caused it. Without the assassination there would have been no war.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`trigger|spark|immediate cause|short-term`, r`alliance|mobilis|militar|blank cheque|decisions`], must: [r`historians|debate|contested|Fischer|Clark`] },
    good: r`<grade verdict="partial" score="0.3">"the assassination caused it" names the trigger, but a trigger explains when a war starts, not why it became a war between the great powers.</grade>

Earlier assassinations and Balkan crises had not escalated. What turned this one into a general war were decisions in July (Germany's "blank cheque", the ultimatum, Russian mobilisation) taken inside long-term conditions: rival alliances, war plans that rewarded mobilising first, and an arms race. How to weigh them is contested: Fritz Fischer put the main responsibility on Germany; Christopher Clark's *The Sleepwalkers* (2012) spreads it across all the powers.

<ask type="short">Name one long-term condition and one decision in July 1914 that you think mattered most, and say what would have had to be different for the crisis to stay local.</ask>`
  },

  // ---------- Linguistics ----------
  {
    id: 'linguistics-after-wrong-minimal-pairs',
    subject: 'linguistics',
    situation: 'after-wrong',
    kinds: ['interpret', 'quant'],
    setup: { mode: 'teach', topic: 'Phonology: phonemes and minimal pairs' },
    history: [
      {
        tutor: r`<ask type="short">In English, are /p/ and /b/ separate phonemes? Give the evidence that decides it.</ask>`
      },
      { learner: { answer: 'No, they are the same phoneme, because they are both made with the lips.', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`minimal pair`, r`place of articulation|both (made )?with the lips|bilabial`], must: [r`pat.{0,20}bat|pin.{0,20}bin|cap.{0,20}cab`] },
    good: r`<grade verdict="wrong" score="0">"both made with the lips" describes their place of articulation (both are bilabial), but sharing a place doesn't make sounds one phoneme.</grade>

The test is a minimal pair: two words that differ in only that one sound and mean different things. "pat" and "bat", or "cap" and "cab", differ only in /p/ versus /b/, so in English the difference changes meaning and they are separate phonemes. What separates them phonetically is voicing: /b/ is voiced, /p/ is not.

<card>How do you show two sounds are separate phonemes in a language? :: Find a minimal pair: two words differing only in those sounds with different meanings (pat / bat).</card>

<ask type="short">In English, the [pʰ] in "pin" is aspirated and the [p] in "spin" is not. Can you find a minimal pair for them, and what does that tell you?</ask>`
  },
  {
    id: 'linguistics-idk-allophones',
    subject: 'linguistics',
    situation: 'idk',
    kinds: ['interpret', 'quant'],
    setup: { mode: 'teach', topic: 'Phonology: allophones' },
    history: [
      {
        tutor: r`<ask type="short">English has aspirated [pʰ] in "pin" and unaspirated [p] in "spin", but no pair of words differs only in that. What is the relationship between [pʰ] and [p] in English called?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], mustNot: [r`\ballophones? of\b`] },
    good: r`Start from what you know: two sounds are separate phonemes when swapping them changes a word's meaning. Here no swap changes meaning, and each sound has its own position: [pʰ] at the start of a stressed syllable, [p] after /s/. Sounds like that are variants of one phoneme, chosen by their surroundings, which is called complementary distribution.

<ask type="short">Given that, what term do linguists use for two such variants of a single phoneme?</ask>`
  },

  // ---------- Music theory ----------
  {
    id: 'music-theory-open-cadences',
    subject: 'music-theory',
    situation: 'open',
    kinds: ['creative', 'quant'],
    setup: { mode: 'teach', topic: 'Music theory: cadences' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'] },
    good: r`**Why this matters**

Cadences are how music punctuates itself: the chord pairs at the ends of phrases that sound like a full stop, a comma or a question. Composers from Bach to film scorers, and songwriters writing a chorus that lands, choose them deliberately, and recognising them is the first step to hearing form rather than just a stream of chords.

Two endings in C major: phrase A ends G major to C major (V–I); phrase B ends C major to G major (I–V).

<ask type="predict">Without the names yet: which of the two endings sounds finished, and which sounds as if the music must go on? Say what you think makes the difference.</ask>`,
    judge: 'Starts from two concrete examples side by side and asks what makes the difference before naming the principle.'
  },
  {
    id: 'music-theory-after-wrong-plagal',
    subject: 'music-theory',
    situation: 'after-wrong',
    kinds: ['creative', 'quant'],
    setup: { mode: 'teach', topic: 'Music theory: cadences and harmonic function' },
    history: [
      {
        tutor: r`<ask type="short">In C major, a phrase ends G major → C major. What is that cadence called?</ask>`
      },
      { learner: { answer: 'A plagal cadence.', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`plagal.{0,40}(IV|subdominant|F major|amen)|(IV|subdominant).{0,40}plagal`], must: [r`perfect|authentic`] },
    good: r`<grade verdict="wrong" score="0">"plagal" is the IV–I cadence; G → C in C major is V–I.</grade>

G is built on the fifth degree of C major, the dominant, so G → C is V–I: a perfect cadence (an authentic cadence in American usage), the strongest close. The plagal cadence is IV–I, F → C in C major, the "Amen" at the end of hymns, softer because there is no leading note (B) rising to C.

<card>Perfect vs plagal cadence :: Perfect (authentic): V–I, e.g. G → C in C major. Plagal: IV–I, e.g. F → C, the "Amen" cadence.</card>

<ask type="short">In G major, which two chords make a perfect cadence, and which two make a plagal one?</ask>`
  },

  // ---------- UI design critique ----------
  {
    id: 'ui-design-open-visual-hierarchy',
    subject: 'ui-design',
    situation: 'open',
    kinds: ['creative', 'domain'],
    setup: { mode: 'teach', topic: 'UI design critique: visual hierarchy' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary'] },
    good: r`**Why this matters**

Visual hierarchy decides what a person sees first, second and never on a screen, so it decides whether they find the one action that matters. A checkout where "Pay" and "Cancel" look identical, or a dashboard where every number is bold, fails on hierarchy before anything else. Designers at Stripe, Linear and Apple spend most of a critique on it, using size, weight, colour, contrast and space.

Two versions of a sign-up card: in A, the heading, the email field and the "Create account" button are all 16 px regular grey text on white; in B, the heading is 24 px bold, the field has a visible border, and the button is a solid dark block with white text.

<ask type="explain">Which version tells you faster what to do, and which two differences between them do the most to cause that?</ask>`
  },
  {
    id: 'ui-design-after-wrong-contrast-ratio',
    subject: 'ui-design',
    situation: 'after-wrong',
    kinds: ['creative', 'domain'],
    setup: { mode: 'teach', topic: 'UI design critique: contrast and accessibility' },
    history: [
      {
        tutor: r`<ask type="short">A design uses light grey body text at 14 px on white, with a contrast ratio of 3:1. Does it meet WCAG 2.2 level AA?</ask>`
      },
      { learner: { answer: 'Yes, 3:1 is the AA requirement for text.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: [r`large text|18\s*pt|24\s*px|14\s*pt bold|non-text`], must: [r`4\.5\s*:\s*1`] },
    good: r`<grade verdict="wrong" score="0">"3:1 is the AA requirement for text" holds only for large text (WCAG's 18 pt, or 14 pt bold); 14 px body text needs 4.5:1.</grade>

WCAG 2.2 success criterion 1.4.3 (Contrast, Minimum) asks for at least 4.5:1 for normal text and 3:1 for large text at level AA; 1.4.11 asks 3:1 for non-text parts such as input borders. At 3:1 this body text fails. Darken the grey until the ratio reaches 4.5:1, for example #767676 on white.

<card>WCAG 2.2 AA contrast for text :: 4.5:1 for normal text; 3:1 for large text (18 pt, or 14 pt bold); 3:1 for UI components and graphics.</card>

<ask type="short">A 16 px grey placeholder inside an input has 2.8:1 contrast. Name the problem with it beyond the ratio, and what you would do instead.</ask>`
  },

  // ---------- A physical skill ----------
  {
    id: 'physical-skill-open-piano-hand-position',
    subject: 'physical-skill',
    situation: 'open',
    kinds: ['physical', 'creative'],
    setup: { mode: 'teach', topic: 'Learn the piano: hand position and posture' },
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade'], must: [r`can(no|')t be practi[cs]ed|cannot (be )?practi[cs]e|away from the (app|screen)|at the (piano|keyboard)`], mustNot: [r`run_code|"kind"\s*:`] },
    good: r`**Why this matters**

Hand position decides how fast, evenly and safely you can play for the rest of your life: a collapsed wrist or flat fingers limit speed and are the usual cause of strain in pianists. Every method, from beginner books to conservatory technique, starts here because faults set early are slow to undo.

This is a physical skill, so it can't be practised in Tide: we will cover the technique and the faults to watch for, and you'll do the drills at the piano with a practice plan.

<ask type="predict">Rest your hand on a table as if holding a tennis ball. Where do you think your wrist should be relative to the keys when you play: above them, level with them, or below them?</ask>`,
    judge: 'Says once and plainly that the skill cannot be practised in the app, then teaches technique with a question the learner can check on their own hand.'
  },
  {
    id: 'physical-skill-show-me-practice-plan',
    subject: 'physical-skill',
    situation: 'show-me',
    kinds: ['physical', 'creative'],
    setup: { mode: 'teach', topic: 'Learn the piano: practising scales' },
    history: [
      {
        tutor: r`Scales are practised slowly and hands separately first, with the thumb passing under smoothly, then together, then faster with a metronome, never faster than you can play evenly.

<note>Scales: slow, hands separate, even tone; thumb under; then hands together; raise the metronome by 4 bpm only when three clean runs in a row.</note>

<continue/>`
      },
      { learner: { question: 'Show me a weekly practice plan for C, G and F major as a table.' } }
    ],
    expect: { ends: 'either', visual: { kind: 'table' }, forbid: ['grade'], must: [r`metronome|bpm`] },
    good: code(r`| Day | Drill | Time | Checkpoint |
|---|---|---|---|
| Mon | C major, hands separate, 60 bpm | 10 min | three even runs in a row |
| Tue | G major, hands separate, 60 bpm | 10 min | thumb passes without a bump |
| Wed | F major, hands separate (right-hand fingering starts 1-2-3-4) | 10 min | correct fingering every time |
| Thu | C and G, hands together, 56 bpm | 15 min | hands land together |
| Fri | F, hands together, 56 bpm | 15 min | no tension in the wrist |
| Sat | All three, +4 bpm where clean | 15 min | record one run of each |
| Sun | Rest, or listen back to Saturday's recording | 5 min | note one uneven spot |

Record Saturday's runs and listen for uneven notes; describe what you hear next lesson and we will work on it.

<continue/>`)
  }
]
