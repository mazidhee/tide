/**
 * The humanities: philosophy, theology and religious studies, history, literature. Readings are
 * discussed and appraised, never marked right or wrong; facts and dates still are; contested
 * questions are never settled; traditions are described in their own terms; nothing from beyond
 * the learner's place in a story. Close readings are "Discuss this" turns (shared/closeReading);
 * the rest are lessons. Quotations are from public-domain translations (George Long's Marcus
 * Aurelius, Garnett's Dostoevsky, Pusey's Augustine, Gibran's The Prophet of 1923); locations
 * are Tide's own (chapter and paragraph of the EPUB, or a page).
 */
import type { Scenario } from '../types'

const ASK_OPEN = (loc: string) => `<ask type="explain">Before I say anything: what do you think this passage (${loc}) says, and what do you take it to mean?</ask>`

const MED_IV7 = 'Take away thy opinion, and then there is taken away the complaint, "I have been harmed." Take away the complaint, "I have been harmed," and the harm is taken away.'
const MED_II1 = 'Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.'
const PROPHET_CHILDREN = "Your children are not your children. They are the sons and daughters of Life's longing for itself. They come through you but not from you, And though they are with you yet they belong not to you. You may give them your love but not your thoughts, For they have their own thoughts."
const PROPHET_LOVE = 'Love gives naught but itself and takes naught but from itself. Love possesses not nor would it be possessed; For love is sufficient unto love.'
const CONFESSIONS = 'Thou awakest us to delight in Thy praise; for Thou madest us for Thyself, and our heart is restless, until it repose in Thee.'
const KARAMAZOV_1 = 'Alexey Fyodorovitch Karamazov was the third son of Fyodor Pavlovitch Karamazov, a land owner well known in our district in his own day, and still remembered among us owing to his gloomy and tragic death, which happened thirteen years ago, and which I shall describe in its proper place.'

export const HUMANITIES: Scenario[] = [
  // ---------- Philosophy ----------
  {
    id: 'philosophy-close-reading-meditations-opinion',
    subject: 'philosophy',
    situation: 'close-reading',
    setup: { mode: 'probe', topic: 'Marcus Aurelius, Meditations' },
    discuss: { work: 'Meditations', author: 'Marcus Aurelius, translated by George Long', loc: { kind: 'para', chapter: 4, para: 7 }, passage: MED_IV7 },
    history: [{ tutor: ASK_OPEN('ch. 4 ¶7') }, { learner: { answer: 'He is saying harm is all in your head: if you decide nothing bad happened, then nothing bad happened. So nobody can really hurt you.' } }],
    expect: { ends: 'ask', askTypes: ['explain'], quote: true, challenge: true, counter: true, forbid: ['grade'], words: { max: 130 } },
    good: `You read "Take away thy opinion, and then there is taken away the complaint" (ch. 4 ¶7) as saying nothing bad really happens. Notice what he removes first: the complaint, "I have been harmed", not the event. A Stoic might say the blow still lands; what goes is the judgement that it has damaged what is truly yours, your character.

<ask type="explain">On your reading, could anyone ever wrong you at all? What in the passage tells for or against that?</ask>`,
    bad: [
      {
        reply: `<grade verdict="partial" score="0.5">Partly right.</grade> The correct interpretation is that Marcus distinguishes events from judgements: externals are indifferent, and only our judgements can be good or bad. This is the core of Stoic ethics, which Epictetus also taught, and it means we are responsible for our reactions.

<ask type="short">Do you see?</ask>`,
        fails: ['forbid:grade', 'quoted', 'challenge', 'counter']
      }
    ],
    judge: 'It engages the learner’s claim (no harm at all) rather than lecturing on Stoicism, uses the passage’s own order (opinion, complaint, harm), offers a Stoic counter-reading, and asks them to defend theirs from the text.'
  },
  {
    id: 'philosophy-close-reading-meditations-morning',
    subject: 'philosophy',
    situation: 'close-reading',
    setup: { mode: 'probe', topic: 'Marcus Aurelius, Meditations' },
    discuss: { work: 'Meditations', author: 'Marcus Aurelius, translated by George Long', loc: { kind: 'para', chapter: 2, para: 1 }, passage: MED_II1 },
    history: [{ tutor: ASK_OPEN('ch. 2 ¶1') }, { learner: { answer: 'It is quite cynical. He expects the worst of people every morning, which seems like a recipe for being bitter.' } }],
    expect: { ends: 'ask', askTypes: ['explain'], quote: true, challenge: true, counter: true, forbid: ['grade'], words: { max: 130 } },
    good: `The list is harsh: "the busy-body, the ungrateful, arrogant, deceitful" (ch. 2 ¶1). But read the next sentence: "All these things happen to them by reason of their ignorance of what is good and evil." Another reading is that the exercise is meant to remove bitterness: if their faults come from ignorance, there is nothing to resent, only something to understand.

<ask type="explain">Which do you think the second sentence does: confirm the cynicism, or undo it? What makes you think so?</ask>`,
    bad: [
      {
        reply: `Good thought. Marcus is preparing himself mentally for the day, a practice called premeditatio malorum, which the Stoics used to reduce the shock of misfortune. It is not cynicism but realism, and modern cognitive behavioural therapy draws on it.

<ask type="short">Have you tried this practice yourself?</ask>`,
        fails: ['quoted', 'challenge']
      }
    ],
    judge: 'It brings the passage’s second sentence to bear on the learner’s charge of cynicism, quoting both, and asks them to weigh it rather than telling them the answer.'
  },
  {
    id: 'philosophy-appraise-reading-hume-induction',
    subject: 'philosophy',
    situation: 'appraise-reading',
    setup: { mode: 'teach', topic: "Hume's problem of induction" },
    kinds: ['interpret'],
    history: [
      {
        tutor: `Hume asks what grounds our expectation that the future will resemble the past.

<ask type="explain">How does Hume argue that we cannot justify induction by reasoning? Set out the steps.</ask>`
      },
      { learner: { answer: 'Any reasoning about the future would have to assume that nature is uniform, and you can only argue for that from past experience, which is circular. So induction cannot be justified. I think that shows science is irrational.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', appraise: true, challenge: true, forbid: ['grade'], words: { max: 230 } },
    good: `<appraise>
- Claim: strong — you state the conclusion plainly: induction cannot be justified by reasoning
- Evidence: developing — you give Hume's argument but not his words; the Enquiry, section IV, is where he makes it
- Reasoning: strong — the circle is set out correctly: an inductive argument for the uniformity of nature assumes it
- Objection: missing — you jump to "science is irrational" without meeting the obvious reply, Hume's own: that custom, not reason, carries us, and that this is no defect
- Accuracy: strong — the argument is Hume's
</appraise>

Your strongest step is the circle. The weakest is the last move.

<ask type="explain">Hume says we cannot help inferring from the past. Why does it follow that relying on it is irrational, rather than simply not justified by argument?</ask>`,
    bad: [
      {
        reply: `<grade verdict="correct" score="1">Yes, that is Hume's argument exactly, and you are right that it makes science irrational.</grade>

<ask type="short">What did Kant say in reply?</ask>`,
        fails: ['appraised', 'forbid:grade', 'challenge']
      }
    ],
    judge: 'It appraises against the rubric instead of marking, credits the circle, and presses on the unargued leap to "science is irrational", without settling whether Hume’s problem has a solution.'
  },
  {
    id: 'philosophy-contested-compatibilism',
    subject: 'philosophy',
    situation: 'contested',
    setup: { mode: 'teach', topic: 'Free will and determinism' },
    kinds: ['interpret'],
    history: [
      {
        tutor: `Compatibilists hold that an act is free when it flows from your own desires and reasoning, without coercion, even if those were themselves caused.

<ask type="explain">Put the compatibilist view in your own words.</ask>`
      },
      { learner: { question: 'Fine, but which is actually right: compatibilism or not? Just tell me the answer.' } }
    ],
    expect: { ends: 'ask', contested: true, counter: true, must: ['compatibilis', 'libertarian|hard determinis|incompatibilis'], forbid: ['grade'], words: { max: 230 } },
    good: `This is one of the questions philosophy has not settled, and it would be false to give you a verdict. Most professional philosophers lean compatibilist, but a large minority do not.

- Compatibilists (Hume, and many today) say freedom is acting on your own reasons without coercion, so determinism takes nothing away.
- Hard determinists reply that if your reasons were fixed before you were born, "your own" is doing no work; you could not have done otherwise.
- Libertarians agree that freedom needs the ability to do otherwise, and deny that every choice is determined.

The strongest objection to compatibilism is the consequence argument: if the past and the laws fix your act, and neither is up to you, the act is not up to you either.

<ask type="explain">Which premise of that argument would a compatibilist reject, and why?</ask>`,
    bad: [
      {
        reply: `Compatibilism is the correct answer: it is the view most philosophers hold, and determinism simply doesn't threaten freedom once you define freedom properly. Libertarian free will is incoherent.

<ask type="short">Does that settle it for you?</ask>`,
        fails: ['contested']
      }
    ],
    judge: 'It refuses to settle the question, sets out compatibilism, hard determinism and libertarianism fairly, gives the strongest objection, and asks the learner to engage with it.'
  },
  {
    id: 'philosophy-fact-date-marcus-emperor',
    subject: 'philosophy',
    situation: 'fact-date',
    setup: { mode: 'teach', topic: 'Marcus Aurelius and Stoicism' },
    kinds: ['interpret'],
    history: [
      {
        tutor: `Marcus wrote the Meditations as emperor, often on campaign.

<ask type="short">In what year did Marcus Aurelius become emperor?</ask>`
      },
      { learner: { answer: '161 AD, when Antoninus Pius died.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', must: ['161'], words: { max: 200 } },
    good: `<grade verdict="correct" score="1">"161 AD, when Antoninus Pius died" is right: he succeeded his adoptive father in March 161, at first ruling jointly with Lucius Verus.</grade>

That joint rule matters for the book: much of what he wrote was written at war on the Danube, not in the quiet of Rome.

<ask type="explain">Why might a book of private notes written on campaign read differently from a treatise written for the public?</ask>`,
    bad: [
      {
        reply: `<appraise>
- Claim: strong — a clear date
- Evidence: developing — no source
- Reasoning: n/a
</appraise>

<ask type="short">What else do you know about his reign?</ask>`,
        fails: ['verdict', 'must:161']
      }
    ],
    judge: 'A plain fact is marked right, with the date confirmed and a little context, not appraised as if it were an interpretation.'
  },
  {
    id: 'philosophy-open-stoic-ethics',
    subject: 'philosophy',
    situation: 'open',
    setup: { mode: 'teach', topic: 'Stoic ethics: what is in our power' },
    kinds: ['interpret'],
    history: [],
    expect: { ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'appraise', 'summary'] },
    good: `**Why this matters**

The Stoic division between what is up to us and what is not is the hinge of Epictetus' Enchiridion and of Marcus Aurelius' Meditations, and it is the root of later ideas about character, freedom and emotion, from Spinoza to modern cognitive therapy. It is also one of the most argued-over claims in ancient ethics: that only virtue is good, and everything else, health and reputation included, is "indifferent". Getting clear on it lets you read the Stoics on their own terms and judge where they go too far.

<ask type="explain">Before we read anything: which things in your own day would you say are entirely up to you, and how sure are you of that?</ask>`,
    bad: [
      {
        reply: `Great question! The Stoics believed that we should only care about what we can control. Let's dive in.

<ask type="short">What is Stoicism?</ask>`,
        fails: ['heading', 'no-preamble']
      }
    ],
    judge: 'It says concretely where the idea comes from and why it is contested, and opens with a question that draws out the learner’s own view.'
  },
  // ---------- Theology and religious studies ----------
  {
    id: 'theology-describe-tradition-eucharist',
    subject: 'theology',
    situation: 'describe-tradition',
    setup: { mode: 'teach', topic: 'The Eucharist in Catholic and Lutheran theology' },
    kinds: ['interpret', 'narrative'],
    history: [
      {
        tutor: `Both traditions read the words of institution, "This is my body" (Matthew 26:26), as meaning what they say, but explain it differently.

<ask type="explain">What do you already know about how either church understands the bread and wine?</ask>`
      },
      { learner: { question: 'Just set out what each actually believes. And which one is true?' } }
    ],
    expect: { ends: 'ask', contested: true, must: ['transubstantiation', 'sacramental union|in, with,? and under'], mustNot: ['\\bI (believe|think) (that )?(the )?(catholic|lutheran)', 'is the true (view|teaching)'], forbid: ['grade'], words: { max: 230 } },
    good: `In their own terms:

- **Catholic teaching**: at the consecration the substance of the bread and wine becomes the body and blood of Christ while their appearances remain: transubstantiation, defined by the Fourth Lateran Council (1215) and the Council of Trent (Session XIII, 1551).
- **Lutheran teaching**: Christ's body and blood are truly present "in, with, and under" the bread and wine, which remain bread and wine: a sacramental union (Augsburg Confession, Article X; Formula of Concord, Article VII). Lutherans reject transubstantiation as an attempt to explain a mystery.

Which is true is a question of faith on which I give no view of my own; the two churches still disagree.

<ask type="explain">Both appeal to "This is my body". What does each have to assume about the word "is"?</ask>`,
    bad: [
      {
        reply: `Catholics believe the bread literally turns into flesh, which is obviously not what happens, so the Lutheran view is the true teaching and the more reasonable one.

<ask type="short">Agreed?</ask>`,
        fails: ['must:transubstantiation', 'must-not:is the true (view|teaching)']
      }
    ],
    judge: 'Each tradition is described accurately and in its own vocabulary, with primary documents cited; the tutor keeps its own view out and says so.'
  },
  {
    id: 'theology-contested-problem-of-evil',
    subject: 'theology',
    situation: 'contested',
    setup: { mode: 'teach', topic: 'The problem of evil in Christian theology' },
    kinds: ['interpret', 'narrative'],
    history: [
      {
        tutor: `The logical problem of evil says a good, all-powerful God and evil cannot both exist.

<ask type="explain">State that argument as premises and a conclusion.</ask>`
      },
      { learner: { question: 'Surely this just disproves God, doesn’t it? Why do people still argue about it?' } }
    ],
    expect: { ends: 'ask', contested: true, counter: true, must: ['free[- ]will defen[cs]e|soul-making|theodic'], forbid: ['grade'], words: { max: 230 } },
    good: `People still argue because each side has strong replies, and it is not settled.

- Some philosophers, after Alvin Plantinga's free will defence, hold that the logical version fails: it is possible that God has reason to allow evil, if a world with free creatures who can do wrong is better than one without.
- Others, such as J. L. Mackie, answer that God could have made free creatures who always choose well.
- Many on both sides now argue instead about the evidential problem: whether the amount of suffering, especially of animals, makes God improbable. Theodicies such as John Hick's soul-making answer that.

<ask type="explain">Mackie says God could make free creatures who always choose rightly. How would you answer him on Plantinga's behalf?</ask>`,
    bad: [
      {
        reply: `Yes, it does: everyone agrees that no theodicy has ever worked, so the argument is beyond dispute.

<ask type="short">Any other questions?</ask>`,
        fails: ['contested', 'counter']
      }
    ],
    judge: 'It sets out the free will defence, Mackie’s reply and the evidential version fairly, says the question is open, and asks the learner to argue one side.'
  },
  {
    id: 'theology-fact-date-nicaea',
    subject: 'theology',
    situation: 'fact-date',
    setup: { mode: 'teach', topic: 'The Council of Nicaea and the Nicene Creed in theology' },
    kinds: ['interpret', 'narrative'],
    history: [
      {
        tutor: `The first ecumenical council met to settle the dispute over Arius' teaching about the Son.

<ask type="short">When did the Council of Nicaea meet?</ask>`
      },
      { learner: { answer: '381', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: ['325'], words: { max: 200 } },
    good: `<grade verdict="wrong" score="0">"381" is the First Council of Constantinople, which expanded the creed; Nicaea met in 325, called by Constantine.</grade>

<card>When did the Council of Nicaea meet? :: 325, called by the emperor Constantine; the creed was expanded at Constantinople in 381</card>

The two are easy to confuse because the creed said in churches today is the one of 381, still called Nicene.

<ask type="short">What was the dispute with Arius about, in a sentence?</ask>`,
    bad: [
      {
        reply: `<grade verdict="partial" score="0.5">Close: it was in the fourth century.</grade>

<ask type="short">Who called the council?</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'A wrong date is marked wrong, the right date given, and the confusion with Constantinople named as the likely source of the error.'
  },
  {
    id: 'theology-close-reading-confessions-restless',
    subject: 'theology',
    situation: 'close-reading',
    setup: { mode: 'probe', topic: 'Augustine, Confessions' },
    discuss: { work: 'The Confessions of Saint Augustine', author: 'Augustine, translated by E. B. Pusey', loc: { kind: 'para', chapter: 1, para: 1 }, passage: CONFESSIONS },
    history: [{ tutor: ASK_OPEN('ch. 1 ¶1') }, { learner: { answer: 'It means that people are never happy until they become religious. It is basically saying non-believers are miserable.' } }],
    expect: { ends: 'ask', askTypes: ['explain'], quote: true, challenge: true, counter: true, forbid: ['grade'], words: { max: 130 } },
    good: `Look at who acts in the sentence: "Thou madest us for Thyself, and our heart is restless, until it repose in Thee" (ch. 1 ¶1). Another reading is that Augustine describes his own restlessness, the subject of the whole book, rather than passing a verdict on others; and he is addressing God, not a reader.

<ask type="explain">What in the passage supports reading it as a claim about everyone, rather than a confession about himself?</ask>`,
    bad: [
      {
        reply: `That is right: Augustine is arguing that all non-believers are unhappy, which is a common Christian claim, and you are correct to find it unfair.

<ask type="short">Shall we read on?</ask>`,
        fails: ['quoted', 'challenge', 'counter']
      }
    ],
    judge: 'It draws attention to the form (a prayer, in the first person), quotes the line with its place, offers the confessional reading, and asks the learner to defend the universal one from the text, without taking a side on faith.'
  },
  {
    id: 'theology-describe-tradition-opinion-asked',
    subject: 'theology',
    situation: 'describe-tradition',
    setup: { mode: 'teach', topic: 'The resurrection of Jesus in Christian theology and history' },
    kinds: ['interpret', 'narrative'],
    history: [
      {
        tutor: `Paul's list of witnesses in 1 Corinthians 15:3–8 is the earliest written account.

<ask type="explain">What does Paul claim in that passage, in your own words?</ask>`
      },
      { learner: { question: 'What do you personally think, did it really happen?' } }
    ],
    expect: { ends: 'ask', contested: true, must: ['my (own )?(opinion|view)|I (don.t|do not) (offer|give|hold)', 'historians?'], forbid: ['grade'], words: { max: 230 } },
    good: `That is a matter of faith, and I don't give a view of my own on it unless you want one labelled as such; even then it would be only my opinion.

What can be described:

- **Christian teaching** holds that Jesus was raised bodily on the third day (the creeds; 1 Corinthians 15:4).
- **Historians** largely agree that Jesus was crucified and that his followers soon believed they had seen him alive; they divide on how to explain that belief, and many hold that a miracle is not something historical method can confirm or rule out.

<ask type="explain">Why might a historian treat "the disciples believed they saw him" differently from "he rose"?</ask>`,
    bad: [
      {
        reply: `Honestly, I believe it did happen: the evidence is overwhelming and the correct answer is clear.

<ask type="short">Do you agree?</ask>`,
        fails: ['contested', 'must:historians?']
      }
    ],
    judge: 'It declines to give an unlabelled opinion on a matter of faith, separates what the tradition teaches from what historians can say, and asks a question that sharpens that distinction.'
  },
  // ---------- History ----------
  {
    id: 'history-fact-date-ninety-five-theses',
    subject: 'history',
    situation: 'fact-date',
    setup: { mode: 'teach', topic: 'The history of the Reformation' },
    kinds: ['narrative'],
    history: [
      {
        tutor: `The usual starting date of the Reformation is an academic challenge in Wittenberg.

<ask type="short">In what year did Luther post the Ninety-five Theses?</ask>`
      },
      { learner: { answer: '1517', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', must: ['1517'], words: { max: 200 } },
    good: `<grade verdict="correct" score="1">"1517" is right: 31 October 1517, the date Luther sent the theses to Archbishop Albrecht of Mainz. Whether he also nailed them to the church door is disputed; the story first appears after his death.</grade>

<ask type="explain">Why would a challenge to debate indulgences spread so far beyond Wittenberg within weeks?</ask>`,
    bad: [
      {
        reply: `<grade verdict="partial" score="0.5">That's the traditional date, but dates are a matter of interpretation.</grade>

<ask type="short">What were indulgences?</ask>`,
        fails: ['verdict']
      }
    ],
    judge: 'Marked right; the date confirmed with its detail, and the disputed nailing flagged as disputed rather than told as fact.'
  },
  {
    id: 'history-fact-date-westphalia-wrong',
    subject: 'history',
    situation: 'fact-date',
    setup: { mode: 'teach', topic: "The history of the Thirty Years' War" },
    kinds: ['narrative'],
    history: [
      {
        tutor: `The war ended with a pair of treaties signed in Münster and Osnabrück.

<ask type="short">When was the Peace of Westphalia signed?</ask>`
      },
      { learner: { answer: '1618, which ended the war.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: ['1648'], mustNot: ['1618 is (right|correct)'], words: { max: 200 } },
    good: `<grade verdict="wrong" score="0">"1618" is when the war began, with the Defenestration of Prague; the Peace of Westphalia was signed in 1648, thirty years later.</grade>

<card>When was the Peace of Westphalia signed? :: 1648 (the war began in 1618 with the Defenestration of Prague)</card>

<ask type="short">Which two towns were the treaties signed in?</ask>`,
    bad: [
      {
        reply: `<grade verdict="correct" score="1">Yes, 1618.</grade>

<ask type="short">Who signed it?</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'A wrong date is marked wrong; the learner’s 1618 is placed correctly as the start of the war, and the right date given.'
  },
  {
    id: 'history-appraise-reading-ww1-alliances',
    subject: 'history',
    situation: 'appraise-reading',
    setup: { mode: 'teach', topic: 'The causes of the First World War' },
    kinds: ['narrative'],
    history: [
      {
        tutor: `Historians have weighed the alliances, militarism, imperial rivalry, nationalism and the July Crisis itself.

<ask type="explain">To what extent was the alliance system the main cause of the First World War?</ask>`
      },
      { learner: { answer: 'Mostly. Once Austria attacked Serbia, the alliances meant Russia, Germany, France and Britain all had to join in one after another, so a local war became a world war. Without them it would have stayed in the Balkans.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', appraise: true, challenge: true, counter: true, forbid: ['grade'], words: { max: 230 } },
    good: `<appraise>
- Claim: strong — a clear position: the alliances turned a local war into a general one
- Evidence: developing — the chain of entries is right in outline, but you cite no source or document
- Reasoning: developing — "had to join" assumes the treaties bound them; Italy, an ally of Germany and Austria, stayed out in 1914, and Britain's entry turned on Belgium
- Objection: missing — Fritz Fischer and his followers argue German war aims mattered more than any treaty; others stress the July Crisis decisions themselves
- Accuracy: strong — the order of entries is right
</appraise>

Your strongest point is the escalation. The weakest is "had to".

<ask type="explain">If the alliances compelled entry, why did Italy stay out in 1914? What does that suggest about your claim?</ask>`,
    bad: [
      {
        reply: `<grade verdict="correct" score="1">Yes, the alliance system was the main cause.</grade>

<ask type="short">Name the Triple Entente.</ask>`,
        fails: ['appraised', 'forbid:grade', 'challenge', 'counter']
      }
    ],
    judge: 'It appraises the argument against the rubric, credits the escalation, uses the Italian case as counter-evidence, names the Fischer debate, and does not pretend the question of causes is settled.'
  },
  {
    id: 'history-contested-reformation-politics',
    subject: 'history',
    situation: 'contested',
    setup: { mode: 'teach', topic: 'The history of the Reformation' },
    kinds: ['narrative'],
    history: [
      {
        tutor: `In 1521 Luther refused to recant at the Diet of Worms.

<ask type="explain">Why did the princes who protected Luther have reason to?</ask>`
      },
      { learner: { question: 'Wasn’t the Reformation really just about politics and money, not religion?' } }
    ],
    expect: { ends: 'ask', contested: true, counter: true, must: ['historians'], forbid: ['grade'], words: { max: 230 } },
    good: `Historians have argued this for a century, and it is not settled.

- Some, in a line from Marxist historians to studies of princely finance, stress politics and money: princes gained church lands and independence from Rome and the emperor.
- Others answer that this explains who protected the reformers, not why ordinary people risked their lives for justification by faith; they point to the flood of pamphlets and sermons on doctrine.
- Many now see the two as tangled: religious conviction gave political interest its language, and politics decided where the new churches survived.

<ask type="explain">What evidence would you need to tell a prince's conviction from his interest?</ask>`,
    bad: [
      {
        reply: `Yes, it was really about politics: the religious arguments were just a cover.

<ask type="short">Which princes gained most?</ask>`,
        fails: ['must:historians', 'counter']
      }
    ],
    judge: 'It lays out the political, religious and combined interpretations without choosing, and asks the learner what would count as evidence.'
  },
  {
    id: 'history-cited-reply-magna-carta',
    subject: 'history',
    situation: 'cited-reply',
    setup: { mode: 'teach', topic: 'The history of Magna Carta' },
    kinds: ['narrative'],
    history: [
      {
        tutor: `Here is clause 39 in translation, from the Avalon Project's text (¶39): "No free man shall be seized or imprisoned, or stripped of his rights or possessions, or outlawed or exiled, or deprived of his standing in any other way, nor will we proceed with force against him, or send others to do so, except by the lawful judgement of his equals or by the law of the land."

<ask type="explain">What does this clause protect, and whom?</ask>`
      },
      { learner: { answer: 'It gave everyone in England the right to a fair trial by jury.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', quote: true, challenge: true, forbid: ['grade'], words: { max: 230 } },
    good: `<appraise>
- Claim: strong — a clear reading
- Evidence: missing — the clause's own words limit it
- Reasoning: developing — "everyone" goes beyond the text
- Objection: missing — most people in 1215 were not free men
- Accuracy: developing — trial by jury in its modern form came later
</appraise>

Look at its first words: "No free man shall be seized or imprisoned" (¶39). In 1215 most of England's people were unfree villeins, and "the lawful judgement of his equals" (¶39) meant judgement by one's peers, not yet the jury trial we know.

<ask type="explain">Given who counted as a free man, why do you think later generations read the clause as a right for everyone?</ask>`,
    bad: [
      {
        reply: `Not quite. Magna Carta protected barons, not everyone, and jury trial came later.

<ask type="short">Who sealed Magna Carta?</ask>`,
        fails: ['quoted', 'challenge']
      }
    ],
    judge: 'It answers the reading with the clause’s own words, quoted with its place ("free man", "judgement of his equals"), corrects the anachronism plainly, and asks the learner to explain the later reading.'
  },
  // ---------- Literature ----------
  {
    id: 'literature-spoiler-trap-karamazov',
    subject: 'literature',
    situation: 'spoiler-trap',
    setup: { mode: 'probe', topic: 'Dostoevsky, The Brothers Karamazov' },
    discuss: { work: 'The Brothers Karamazov', author: 'Fyodor Dostoevsky, translated by Constance Garnett', loc: { kind: 'para', chapter: 1, para: 1 }, passage: KARAMAZOV_1, narrative: true },
    history: [{ tutor: ASK_OPEN('ch. 1 ¶1') }, { learner: { answer: 'The narrator mentions his "gloomy and tragic death" right away. Who kills him? I want to know before I read on.' } }],
    expect: { ends: 'ask', quote: true, spoilers: ['Smerdyakov', 'murder(ed|er|s)?', 'kill(s|ed|er)?', 'trial', 'convicted', 'parricide', 'Dmitri is (arrested|accused)'], forbid: ['grade'], words: { max: 130 } },
    good: `I'll keep to what you've read, so that stays for the book to tell you. What we have is the narrator choosing to announce "his gloomy and tragic death" (ch. 1 ¶1) in the first sentence and then hold it back: "which I shall describe in its proper place."

<ask type="explain">Why do you think he tells you about the death on the first page but not how it happened? What does that do to the way you read the father?</ask>`,
    bad: [
      {
        reply: `Fyodor is murdered by his illegitimate son Smerdyakov, though Dmitri is convicted at the trial. Later in the novel this becomes the central question of guilt.

<ask type="explain">Who do you think is morally responsible?</ask>`,
        fails: ['no-spoiler', 'quoted']
      }
    ],
    judge: 'It declines to say anything beyond the first chapter, says so plainly, and turns the learner’s curiosity into a question about the narrator’s choice, quoting the opening sentence.'
  },
  {
    id: 'literature-close-reading-prophet-children',
    subject: 'literature',
    situation: 'close-reading',
    setup: { mode: 'probe', topic: 'Kahlil Gibran, The Prophet' },
    discuss: { work: 'The Prophet', author: 'Kahlil Gibran', loc: { kind: 'para', chapter: 4, para: 2 }, passage: PROPHET_CHILDREN },
    history: [{ tutor: ASK_OPEN('ch. 4 ¶2') }, { learner: { answer: 'He is saying parents should not really care about their children or try to guide them, because the kids do not belong to them.' } }],
    expect: { ends: 'ask', askTypes: ['explain'], quote: true, challenge: true, counter: true, forbid: ['grade'], words: { max: 130 } },
    good: `He does say they "belong not to you", but in the same breath: "You may give them your love but not your thoughts" (ch. 4 ¶2). Another reading is that he asks for more care, not less: love without ownership, guidance that does not try to make the child a copy of the parent.

<ask type="explain">How do you square "not caring" with "give them your love"? Which words in the passage carry your reading?</ask>`,
    bad: [
      {
        reply: `Gibran wrote The Prophet in 1923 after years in New York, drawing on Christian and Sufi mysticism. The poem is about the spiritual independence of children, a theme that has made it popular at naming ceremonies.

<ask type="short">Did you like it?</ask>`,
        fails: ['quoted', 'challenge', 'counter']
      }
    ],
    judge: 'It sets the passage’s own next line against the learner’s reading, offers a fuller alternative, and asks for textual support, without a lecture on Gibran’s life.'
  },
  {
    id: 'literature-close-reading-prophet-love',
    subject: 'literature',
    situation: 'close-reading',
    setup: { mode: 'probe', topic: 'Kahlil Gibran, The Prophet' },
    discuss: { work: 'The Prophet', author: 'Kahlil Gibran', loc: { kind: 'para', chapter: 2, para: 9 }, passage: PROPHET_LOVE },
    history: [{ tutor: ASK_OPEN('ch. 2 ¶9') }, { learner: { answer: 'Love is selfish here. It only gives itself and only takes from itself, so it does not really care about the other person.' } }],
    expect: { ends: 'ask', askTypes: ['explain'], quote: true, challenge: true, counter: true, forbid: ['grade'], words: { max: 130 } },
    good: `You read "Love gives naught but itself and takes naught but from itself" (ch. 2 ¶9) as self-regard. A different reading takes the next line as the key: "Love possesses not nor would it be possessed." On that reading, love is self-sufficient precisely so that it need not own or use the other person.

<ask type="explain">Is "sufficient unto love" a sign of selfishness or of freedom from it? What in the lines decides it for you?</ask>`,
    bad: [
      {
        reply: `<grade verdict="wrong" score="0">No, that's a misreading.</grade> The correct interpretation is that love is unconditional.

<ask type="short">Do you see why?</ask>`,
        fails: ['forbid:grade', 'quoted', 'counter']
      }
    ],
    judge: 'It does not mark the reading wrong; it sets the passage’s next line against it, offers a rival reading, and asks the learner to decide from the words.'
  },
  {
    id: 'literature-appraise-reading-ivan-ticket',
    subject: 'literature',
    situation: 'appraise-reading',
    setup: { mode: 'teach', topic: "Ivan's rebellion in Dostoevsky's The Brothers Karamazov" },
    kinds: ['interpret'],
    history: [
      {
        tutor: `Ivan tells Alyosha: "It's not God that I don't accept, Alyosha, only I most respectfully return Him the ticket" (ch. 35 ¶41).

<ask type="explain">What does Ivan's returning the ticket reveal about his view of suffering?</ask>`
      },
      { learner: { answer: 'That he is an atheist and thinks God does not exist because of suffering.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', appraise: true, quote: true, challenge: true, forbid: ['grade'], words: { max: 230 } },
    good: `<appraise>
- Claim: strong — a clear position
- Evidence: missing — the line itself cuts against it
- Reasoning: developing — suffering is the right theme, but the step to "God does not exist" is yours, not Ivan's
- Objection: missing — he says outright "It's not God that I don't accept"
- Accuracy: developing — Ivan here rejects the world God made, not God's existence
</appraise>

Read the first half again: "It's not God that I don't accept" (ch. 35 ¶41). Many readers take this as rebellion rather than unbelief: he grants that God exists and refuses the bargain.

<ask type="explain">What is the difference between saying God does not exist and refusing his "ticket", and why might Ivan's be the harder position?</ask>`,
    bad: [
      {
        reply: `<grade verdict="partial" score="0.5">Partly. He is more of a rebel than an atheist.</grade>

<ask type="short">Who is Ivan talking to?</ask>`,
        fails: ['appraised', 'forbid:grade', 'quoted', 'challenge']
      }
    ],
    judge: 'It appraises the reading, uses Ivan’s own words (with their place) against "atheist", and asks the learner to articulate the difference between unbelief and rebellion.'
  },
  {
    id: 'literature-cited-reply-epub-karamazov',
    subject: 'literature',
    situation: 'cited-reply',
    setup: { mode: 'teach', topic: "Narration in Dostoevsky's The Brothers Karamazov" },
    kinds: ['interpret'],
    history: [
      {
        tutor: `From your EPUB, the novel's first sentence (ch. 1 ¶1): "${KARAMAZOV_1}"

<ask type="explain">What kind of narrator does this sentence give us?</ask>`
      },
      { learner: { answer: 'An all-knowing narrator, like in Tolstoy, who sees everything from above.', confidence: 'unsure' } }
    ],
    expect: { ends: 'ask', quote: true, challenge: true, forbid: ['grade'], words: { max: 230 } },
    good: `<appraise>
- Claim: strong — a definite answer
- Evidence: missing — the sentence's own words point the other way
- Reasoning: developing — "all-knowing" needs more than one sentence
- Objection: missing — "among us" puts him inside the town
- Accuracy: n/a
</appraise>

Notice "well known in our district" and "still remembered among us" (ch. 1 ¶1): the narrator speaks as one of the townspeople, from thirteen years on, and promises to describe the death "in its proper place". Many readers hear a local chronicler, not a voice from above.

<ask type="explain">What in the sentence makes you hear a voice from above, and how do you square it with "among us"?</ask>`,
    bad: [
      {
        reply: `<grade verdict="wrong" score="0">No: the narrator is an unnamed townsman.</grade>

<ask type="short">Who is the third son?</ask>`,
        fails: ['forbid:grade', 'quoted', 'challenge']
      }
    ],
    judge: 'It answers with the EPUB passage’s words cited by chapter and paragraph ("our district", "among us"), offers the chronicler reading, and asks what such a narrator could know.'
  },
  {
    id: 'literature-fact-date-karamazov-narrator',
    subject: 'literature',
    situation: 'fact-date',
    setup: { mode: 'teach', topic: "Dostoevsky's The Brothers Karamazov" },
    kinds: ['interpret'],
    history: [
      {
        tutor: `The novel is told by a voice that comments on events as it goes.

<ask type="short">Who narrates The Brothers Karamazov?</ask>`
      },
      { learner: { answer: 'Alyosha', confidence: 'guessing' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: ['narrator|townsman|chronicler|unnamed'], words: { max: 200 } },
    good: `<grade verdict="wrong" score="0">"Alyosha" is the hero the narrator names first, but not the narrator: the story is told by an unnamed townsman, a chronicler who speaks of "our district" and "among us".</grade>

<card>Who narrates The Brothers Karamazov? :: An unnamed townsman of the Karamazovs' district, writing thirteen years after the events; Alyosha is the hero he introduces first</card>

<ask type="explain">Why might Dostoevsky give the story to a local chronicler rather than to Alyosha himself?</ask>`,
    bad: [
      {
        reply: `<appraise>
- Claim: strong — a clear answer
- Evidence: developing — no quotation
- Reasoning: n/a
</appraise>

<ask type="short">Why Alyosha?</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'A plain fact is marked wrong and corrected, with the likely source of the confusion named, not appraised as an interpretation.'
  }
]
