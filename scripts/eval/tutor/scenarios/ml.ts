/**
 * Machine learning and neural networks: one scenario for each kind of situation. Every number here
 * was worked out by running it (NumPy for the code and the arithmetic, the simulation's own update
 * rule for what the gradient descent picture shows).
 */
import type { Scenario } from '../types'

const r = String.raw

export const ML: Scenario[] = [
  {
    id: 'ml-open-self-attention',
    subject: 'ml',
    situation: 'open',
    setup: { mode: 'teach', topic: 'Self-attention' },
    history: [],
    expect: { ends: 'ask', askTypes: ['short', 'predict', 'choice', 'explain'], heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'] },
    good: r`**Why this matters**

Self-attention is the operation at the centre of every transformer: the language models behind chat assistants and code completion, and the vision transformers used on images. It lets each token build its new representation from every other token in the sequence in one step, where a recurrent network has to pass information along one position at a time. The rest of the architecture follows from it: positional encodings, multiple heads, causal masks and the cost that grows with the square of the sequence length. It is the part you will read most closely when you implement or debug one of these models.

<ask type="short">A self-attention layer takes in n token vectors. What does it put out for each token, and what is that output computed from? Say as much as you know.</ask>`,
    bad: [
      {
        reply: r`Hi! Self-attention is a really exciting topic and I'm glad we're covering it today.

Have you come across queries, keys and values before? And do you know what a dot product is?`,
        fails: ['no-preamble', 'heading'],
        repaired: ['ask']
      }
    ],
    judge: 'The opening names concrete uses of self-attention and its question finds out what the learner already knows instead of teaching the mechanism.'
  },
  {
    id: 'ml-after-correct-backprop-chain-rule',
    subject: 'ml',
    situation: 'after-correct',
    setup: { mode: 'teach', topic: 'Backpropagation and the chain rule', options: { strategy: 'maths' } },
    history: [
      {
        tutor: r`Backpropagation is the chain rule applied from the loss backwards: the gradient at each node is the gradient of the node after it times one local derivative.

<note>Backpropagation on a chain $w \to z \to a \to L$: $\frac{\partial L}{\partial w} = \frac{\partial L}{\partial a}\cdot\frac{\partial a}{\partial z}\cdot\frac{\partial z}{\partial w}$. Each factor is local to one node. For a sigmoid, $\frac{\partial a}{\partial z} = a(1-a)$.</note>

**Problem 1 · warm-up**

One sigmoid neuron: $z = wx + b$, $a = \sigma(z)$, with loss $L = \tfrac12 (a - y)^2$. Take $x = 2$, $w = 0.5$, $b = -1$, $y = 1$. Find $\partial L/\partial w$.

<solution>z = 0.5 × 2 − 1 = 0, a = σ(0) = 0.5. dL/da = a − y = −0.5. da/dz = a(1 − a) = 0.25. dz/dw = x = 2. dL/dw = −0.5 × 0.25 × 2 = −0.25.</solution>

<ask type="problem">The value of $\partial L/\partial w$, showing each factor of the chain rule.</ask>`
      },
      { learner: { answer: 'z = 0.5 × 2 − 1 = 0, so a = σ(0) = 0.5. The three factors: dL/da = a − y = −0.5, da/dz = a(1 − a) = 0.25, dz/dw = x = 2. Their product is −0.5 × 0.25 × 2 = −0.25.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'error', 'explain'] },
    good: r`<grade verdict="correct" score="1">"dL/da = a − y = −0.5, da/dz = a(1 − a) = 0.25, dz/dw = x = 2" are the three local derivatives, and their product −0.25 is the gradient.</grade>

**Problem 2 · harder**

Now two layers, with a ReLU in the middle: $h = \mathrm{ReLU}(w_1 x + b_1)$, $\hat{y} = w_2 h$, and $L = \tfrac12(\hat{y} - y)^2$. Take $x = 2$, $w_1 = 1.5$, $b_1 = -1$, $w_2 = 2$, $y = 3$. Find $\partial L/\partial w_2$ and $\partial L/\partial w_1$.

<solution>Forward: w1·x + b1 = 3 − 1 = 2, h = ReLU(2) = 2, ŷ = 2 × 2 = 4, dL/dŷ = ŷ − y = 1. dL/dw2 = dL/dŷ × h = 1 × 2 = 2. dL/dh = dL/dŷ × w2 = 2; the ReLU's derivative is 1 because its input 2 is positive; dL/dw1 = 2 × 1 × x = 4.</solution>

<ask type="problem">Both gradients, with the forward values and each factor you multiplied.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">You are on the right track with the chain rule, keep going.</grade>

**Problem 2 · harder**

Two layers: $h = \mathrm{ReLU}(w_1 x + b_1)$, $\hat{y} = w_2 h$, $L = \tfrac12(\hat{y} - y)^2$, with $x = 2$, $w_1 = 1.5$, $b_1 = -1$, $w_2 = 2$, $y = 3$. Find both gradients.

<ask type="problem">Your answer.</ask>`,
        fails: ['verdict'],
        repaired: ['solution']
      }
    ]
  },
  {
    id: 'ml-after-wrong-test-set-leakage',
    subject: 'ml',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Train, validation and test splits' },
    history: [
      {
        tutor: r`**Why this matters**

A model is only worth what it does on data it has not seen, and the split of a dataset is the one tool for estimating that before deployment. Most inflated results in practice, from benchmark tables to a fraud model that looked fine offline and failed in production, come from information about the held-out data leaking into the choices made while building the model.

<ask type="predict">You try 50 hyperparameter settings. Each is trained on the training set and scored on the test set. You keep the setting with the best test score, 94%, and report 94% as the accuracy to expect on new data. Is that a fair estimate, and why?</ask>`
      },
      { learner: { answer: 'Yes, it is fair. The weights were only ever fitted on the training set, so the model has never seen the test examples, and that makes 94% an unbiased estimate of its accuracy on new data.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: ['validation', 'optimis|bias|leak|inflat|too high|overestimat'], need: ['card'], must: ['validation'] },
    good: r`<grade verdict="wrong" score="0">"the model has never seen the test examples" is true of the weights but not of your choice: you picked the best of 50 settings by their test scores, so the test set took part in building the model.</grade>

Each setting's test score is its true accuracy plus noise from the particular examples in the test set. Taking the maximum of 50 noisy scores favours whichever setting was luckiest on those examples, so the winning score is biased upwards: 94% is optimistic. The fix is a third split. Choose hyperparameters on a validation set, then score the one chosen model once on a test set that played no part in any decision.

<card>Why is a test score biased when hyperparameters were chosen on the test set? :: Picking the best of many settings by test score selects for luck on those examples, so the score is optimistic. Select on a validation set and use the test set once.</card>

<ask type="short">Suppose all 50 settings have the same true accuracy of 90%, and each measured test score is 90% plus random noise. Is the best of the 50 measured scores above, below or about equal to 90%, and why?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, the test examples were never used for training, so the estimate is fair.</grade>

<ask type="short">What is a hyperparameter?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure that a test set is clean so long as no weights were fitted on it. The reply must name selection on the test set as the leak and give the validation set as the fix.'
  },
  {
    id: 'ml-idk-vanishing-gradients',
    subject: 'ml',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Vanishing gradients and the choice of activation', options: { why: true } },
    history: [
      {
        tutor: r`**Why this matters**

Deep networks were close to untrainable until this problem was understood. The fixes for it are in every modern architecture: ReLU-family activations, residual connections in ResNets and transformers, careful initialisation and normalisation layers. Knowing where the problem comes from tells you what each of those is for.

<ask type="short">A 10-layer network uses a sigmoid after every layer. In training, the last layer's weights change quickly and the first layer's barely move. What could cause that?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', must: [r`0\.25|1/4|\\frac\{1\}\{4\}|a quarter`, 'product|multipl'], forbid: ['grade'], words: { max: 220 } },
    good: r`Start from what backpropagation does. The gradient that reaches the first layer is a product: one factor for each layer it passes through on the way back from the loss, and each factor contains the slope of that layer's activation. So the size of those slopes decides what arrives.

The sigmoid's slope is $\sigma'(z) = \sigma(z)\,(1 - \sigma(z))$. It is largest at $z = 0$, where $\sigma = 0.5$ and the slope is $0.5 \times 0.5 = 0.25$. Everywhere else it is smaller. Every sigmoid the gradient passes through therefore multiplies it by at most 0.25.

<note>Backpropagation multiplies one activation slope per layer. The sigmoid's slope $\sigma(z)(1-\sigma(z))$ is at most 0.25 (at $z = 0$), so each sigmoid layer scales the gradient by 0.25 or less.</note>

<ask type="short">To reach the first layer the gradient passes back through 9 later sigmoids, each scaling it by at most 0.25. Taking the weights as about 1, roughly how large can the product of those 9 factors be, and what does that do to the first layer's updates?</ask>`,
    judge: 'It gives the next step of the reasoning (a product of slopes, each at most 0.25) and leaves the conclusion for the learner to reach, rather than stating that gradients vanish.'
  },
  {
    id: 'ml-show-me-momentum-ravine',
    subject: 'ml',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'Momentum in gradient descent' },
    history: [
      {
        tutor: r`Plain gradient descent updates $\theta \leftarrow \theta - \eta \nabla L$. A ravine is a surface that is steep across and shallow along. The rate has to be small enough for the steep direction, or the steps bounce between the walls and grow; at that rate the gradient along the shallow floor is tiny, so progress there is slow. Momentum keeps a running velocity: $v \leftarrow \beta v + \nabla L$, then $\theta \leftarrow \theta - \eta v$. Along the floor the gradients keep the same sign from step to step, so they add up in $v$ and the steps lengthen.

<note>Momentum: $v \leftarrow \beta v + \nabla L$, then $\theta \leftarrow \theta - \eta v$. A gradient component that keeps its sign accumulates in $v$; one that flips sign cancels.</note>

<ask type="short">With $\beta = 0.9$ and a gradient component that stays constant at $g$, what value does $v$ settle at?</ask>`
      },
      { learner: { question: 'Before I answer, I would like to see this actually running: gradient descent with momentum on a ravine.' } }
    ],
    expect: { ends: 'either', visual: { kind: 'sim', sim: 'gradient-descent' }, forbid: ['grade'] },
    good: r`~~~sim
{"kind":"gradient-descent","title":"Momentum on a ravine","surface":"ravine","optimiser":"momentum","rate":0.05,"momentum":0.9,"tour":[{"at":"gradient","say":"The surface is f = 0.1x² + 2y². Its gradient is 0.2x along the valley and 4y across it, so at the start it points almost straight across.","do":{"pause":true}},{"at":"path","say":"The velocity keeps nine tenths of itself each step. Along the floor every gradient has the same sign, so the steps there lengthen.","do":{"run":20}},{"at":"minimum","say":"The point overshoots, swings back and settles on the minimum.","do":{"run":100}}]}
~~~

Watch the path: it swings across the valley a few times while the velocity builds along the floor, and it is at the minimum in about 60 steps.

<ask type="predict">Switch the optimiser to sgd and keep the rate at 0.05. Before you run it, predict two things: does it get to the minimum sooner or later than momentum did, and does it still swing across the valley?</ask>`.replace(/~~~/g, '```'),
    bad: [
      {
        reply: r`Here is gradient descent with momentum on a ravine:

~~~sim
{kind: 'gradient-descent', surface: 'ravine', optimiser: 'momentum', rate: 0.05, momentum: 0.9}  // ravine with momentum
~~~

<ask type="predict">What happens to the path if the momentum is set to 0?</ask>`.replace(/~~~/g, '```'),
        fails: ['visual']
      },
      {
        reply: r`Picture a ball rolling down a long narrow valley. With momentum it builds up speed along the valley floor, so it reaches the bottom much sooner than plain gradient descent, which takes small careful steps.

<ask type="short">Why does momentum help along the floor?</ask>`,
        fails: ['visual']
      }
    ],
    judge: 'The simulation is the ravine with momentum, the sentence says what to watch, and the one question asks for a single change and a prediction.'
  },
  {
    id: 'ml-mark-planted-error-conv-output-size',
    subject: 'ml',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'Convolution output sizes', options: { difficulty: 'hard' } },
    history: [
      {
        tutor: r`**Problem 3 · harder**

A 64 × 64 RGB image goes through three layers in order: a 5 × 5 convolution with 32 filters, stride 2 and padding 2; a 2 × 2 max pool with stride 2; a 3 × 3 convolution with 32 filters, stride 1 and no padding. How many values are in the final output volume?

<solution>Output size is floor((n + 2p − k)/s) + 1. Conv 1: floor((64 + 4 − 5)/2) + 1 = 31 + 1 = 32. Pool: floor((32 − 2)/2) + 1 = 16. Conv 2: (16 − 3)/1 + 1 = 14. Volume: 14 × 14 × 32 = 6272.</solution>

<ask type="problem">The number of values, with the size after each layer.</ask>`
      },
      {
        learner: {
          answer: 'I used floor((n + p − k)/s) + 1 at each layer. Conv 1: floor((64 + 2 − 5)/2) + 1 = floor(30.5) + 1 = 31. Pool: floor((31 − 2)/2) + 1 = 14 + 1 = 15. Conv 2: (15 − 3)/1 + 1 = 13. With 32 filters the output is 13 × 13 × 32 = 5408 values.',
          confidence: 'sure'
        }
      }
    ],
    expect: {
      ends: 'ask',
      verdict: 'partial',
      accept: ['wrong'],
      names: [r`2\s*p\b|2\s*[×x*·]\s*p\b|2\s*\\(times|cdot)\s*p\b|both sides|each side|either side|every side|two sides|twice|64\s*\+\s*4|64\s*\+\s*2\s*[×x*·]\s*2`],
      mustNot: [r`5408 (is|are) (right|correct)`]
    },
    good: r`<grade verdict="partial" score="0.5">The formula is the step that fails: "floor((n + p − k)/s) + 1" counts the padding once, but padding 2 is added on both sides of the image, so the term is 2p. Conv 1 is floor((64 + 4 − 5)/2) + 1 = 32, not 31. Your pool and second convolution are worked correctly, on the wrong input size.</grade>

<card>Output size of a convolution with input n, kernel k, padding p and stride s? :: floor((n + 2p − k)/s) + 1. The padding is on both sides, hence 2p.</card>

**Problem 4 · easier**

A 96 × 96 greyscale image goes through a 7 × 7 convolution with 16 filters, stride 2 and padding 3, then a 3 × 3 max pool with stride 2 and padding 1. How many values are in the output volume?

<solution>Conv: floor((96 + 6 − 7)/2) + 1 = 47 + 1 = 48. Pool: floor((48 + 2 − 3)/2) + 1 = 23 + 1 = 24. Volume: 24 × 24 × 16 = 9216.</solution>

<ask type="problem">The number of values, with the size after each layer.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your sizes "31", "15" and "13" follow the formula at each layer, and 13 × 13 × 32 = 5408 is right.</grade>

<ask type="short">What would change if the first convolution used stride 1?</ask>`,
        fails: ['verdict', 'names', 'must-not']
      }
    ],
    judge: 'The only error is padding counted once instead of on both sides in the first convolution (32, not 31); the later steps are right given that input and should be said to be.'
  },
  {
    id: 'ml-mark-unusual-correct-f1-direct',
    subject: 'ml',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Precision, recall and F1 on imbalanced data' },
    history: [
      {
        tutor: r`**Problem 2 · same level**

A fraud detector is run on 10,000 transactions, of which 50 are fraudulent. It flags 40 transactions, and 30 of the flagged ones really are fraud. Compute its F1 score.

<solution>TP = 30, FP = 40 − 30 = 10, FN = 50 − 30 = 20. Precision = 30/40 = 0.75. Recall = 30/50 = 0.6. F1 = 2 × 0.75 × 0.6 / (0.75 + 0.6) = 0.9/1.35 = 0.667.</solution>

<ask type="problem">The F1 score, with your working.</ask>`
      },
      { learner: { answer: 'I skipped precision and recall and went straight from the counts. TP = 30, FP = 40 − 30 = 10, FN = 50 − 30 = 20. F1 = 2TP / (2TP + FP + FN) = 60 / (60 + 10 + 20) = 60/90 = 2/3.' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', mustNot: [r`(must|need to|have to|should have) (first )?(comput|calculat|work out|find)\w* precision`] },
    good: r`<grade verdict="correct" score="1">"F1 = 2TP / (2TP + FP + FN) = 60/90 = 2/3" is right. It is the harmonic mean of precision 0.75 and recall 0.6 with TP/(TP + FP) and TP/(TP + FN) substituted and simplified, and 2/3 is the same 0.667.</grade>

<ask type="explain">Your formula has no TN in it, though the detector also got 9,940 legitimate transactions right. What does leaving TN out say about what F1 measures, and why does that suit data where 99.5% of the cases are negative?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.4">Your counts are right, but F1 is defined as 2PR/(P + R), so you need to compute precision and recall first. The expected answer is 0.667.</grade>

<ask type="problem">Compute precision and recall for this detector, then F1.</ask>`,
        fails: ['verdict', 'must-not']
      }
    ],
    judge: 'F1 = 2TP/(2TP + FP + FN) is an exact identity, and 2/3 equals 0.667; a marker comparing the working with its own solution would wrongly mark it down.'
  },
  {
    id: 'ml-tangent-logistic-linear-model',
    subject: 'ml',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'Logistic regression and log-odds' },
    history: [
      {
        tutor: r`**Why this matters**

Logistic regression is still the default model for credit scoring, medical risk and click prediction, because its coefficients can be read and defended. It is also the last layer of every neural classifier: a sigmoid or softmax over a weighted sum. Reading a coefficient correctly is the skill the whole topic turns on.

<ask type="predict">A logistic regression model for loan default has a coefficient of 0.7 on the feature "number of missed payments". When that feature goes up by one, what exactly changes by 0.7: the probability, the odds or the log-odds?</ask>`
      },
      { learner: { question: 'Before I answer: is logistic regression really a linear model? The sigmoid in it is not linear.' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: [r`boundary|hyperplane|weighted sum|linear (function|combination)|w\^?\\?(top|T)? ?x`], words: { max: 170 } },
    good: r`Yes, in the sense that matters. The only thing the model computes from the features is a weighted sum, $z = w^\top x + b$; the sigmoid then squashes that one number into a probability. So the probability is not a linear function of $x$, but the set of points where the model is undecided, $p = 0.5$, is exactly where $z = 0$, and that is a flat hyperplane. A logistic regression can never draw a curved decision boundary unless you hand it extra features such as $x_1^2$ or $x_1 x_2$.

Keep $z$ in mind for the question still open, which is about what a coefficient inside $z$ does.

<ask type="predict">The coefficient on "number of missed payments" is 0.7. When that feature goes up by one, which of the probability, the odds and the log-odds changes by exactly 0.7?</ask>`,
    judge: 'It answers the tangent exactly (linear in the weighted sum, so a flat decision boundary) without giving away the pending question about log-odds, then returns to that question.'
  },
  {
    id: 'ml-recall-open-batch-normalisation',
    subject: 'ml',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'Batch normalisation' },
    history: [],
    expect: { ends: 'ask', askTypes: ['explain'], forbid: ['grade', 'summary', 'card'], mustNot: [r`\bmeans?\b`, 'varian|standard deviation', r`gamma|\\gamma|running|moving average`], words: { max: 60 } },
    good: r`<ask type="explain">Explain batch normalisation from memory, as fully as you can.</ask>`,
    bad: [
      {
        reply: r`Batch normalisation subtracts the batch mean from each activation and divides by the standard deviation, then applies a learned scale gamma and shift beta.

<ask type="short">What does it use in place of batch statistics at inference?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'ml-code-bug-softmax-batch-axis',
    subject: 'ml',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'Softmax over a batch in NumPy', options: { strategy: 'code' } },
    history: [
      {
        tutor: r`Softmax turns each row of logits into probabilities: exponentiate, then divide by that row's total. Subtracting the row's maximum first leaves the result unchanged and stops np.exp overflowing on large logits.

<solution>def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)
On [[1, 2, 3], [1, 1, 1]] the rows are [0.090, 0.245, 0.665] and [0.333, 0.333, 0.333]; each sums to 1.</solution>

<ask type="code" lang="python">Write softmax(z) for a 2-D array z of shape (batch, classes), so that each row of the result sums to 1. Keep it stable for large logits, and print it on [[1, 2, 3], [1, 1, 1]].</ask>`
      },
      {
        learner: {
          answer: r`~~~python
import numpy as np

def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=0, keepdims=True)

print(softmax(np.array([[1.0, 2.0, 3.0], [1.0, 1.0, 1.0]])))
~~~`.replace(/~~~/g, '```'),
          confidence: 'sure'
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`axis\s*=?\s*0|columns?|(across|over|down) the batch`, r`axis\s*=?\s*-?1\b|\brows?\b|classes`], need: ['card'] },
    good: r`<grade verdict="wrong" score="0.3">Subtracting the row maximum is right, but "e.sum(axis=0, keepdims=True)" adds down each column, across the batch, so every value is divided by a total taken over different examples. On your own test input it prints [[0.119, 0.269, 0.5], [0.881, 0.731, 0.5]], whose rows sum to 0.888 and 2.112. The total has to be taken along each row: axis=1.</grade>

<card>In softmax over an array of shape (batch, classes), which axis is summed? :: axis=1, the classes, with keepdims=True, so each row is divided by its own total. axis=0 mixes different examples in the batch.</card>

<ask type="code" lang="python">Fix softmax so that each row sums to 1, and add an assert with np.allclose that checks the row sums on [[1, 2, 3], [1, 1, 1]].</ask>

<solution>The last line becomes return e / e.sum(axis=1, keepdims=True). Then p = softmax(np.array([[1.0, 2.0, 3.0], [1.0, 1.0, 1.0]])) and assert np.allclose(p.sum(axis=1), 1.0) passes; the rows are [0.090, 0.245, 0.665] and [0.333, 0.333, 0.333].</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your softmax subtracts the maximum for stability and normalises the exponentials, so it is right.</grade>

<ask type="short">Why does subtracting the maximum not change the result?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The code normalises over axis 0, the batch, so rows do not sum to 1 (0.888 and 2.112 on the test input); the stability step is right and the reply should say both.'
  }
]
