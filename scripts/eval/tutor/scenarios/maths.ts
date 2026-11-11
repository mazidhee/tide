/**
 * Probability and linear algebra: one scenario for each kind of situation, five on each half of
 * the subject. Every value here was worked out with Python (fractions, numpy) before it was
 * written down, and the buggy simulation was run. String.raw keeps LaTeX backslashes as typed.
 */
import type { Scenario } from '../types'

const r = String.raw

export const MATHS: Scenario[] = [
  {
    id: 'maths-open-bayes-base-rate',
    subject: 'maths',
    situation: 'open',
    setup: { mode: 'teach', topic: "Conditional probability and Bayes' theorem", options: { why: true } },
    history: [],
    expect: {
      ends: 'ask',
      askTypes: ['short', 'predict', 'choice', 'explain'],
      heading: 'Why this matters',
      forbid: ['grade', 'summary', 'solution'],
      mustNot: [r`15(\.\d+)?\s*\\?%|0\.15\d*|2/13|\\t?frac\{2\}\{13\}`]
    },
    good: r`**Why this matters**

Bayes' theorem turns "how likely is this evidence if the hypothesis is true" into "how likely is the hypothesis now that I have seen the evidence". Those are different numbers, and confusing them is behind misread medical tests, spam filters that flag too much and fraud alerts nobody trusts. Every classifier you evaluate has the same structure: its precision depends on how rare the thing it detects is, not only on how accurate the detector is. The same rule is how a prior is updated by data, so it sits under naive Bayes, Bayesian inference and most of statistical machine learning.

<ask type="predict">A condition affects 1 person in 100. A test detects it 90% of the time when it is present, and gives a false positive 5% of the time when it is absent. Someone tests positive. Without calculating, is the chance they have the condition about 90%, about 50%, or well under 50%? Say what makes you think so.</ask>`,
    bad: [
      {
        reply: r`Bayes' theorem says $P(A \mid B) = \frac{P(B \mid A)P(A)}{P(B)}$. For a condition with 1% prevalence, a 90% detection rate and a 5% false positive rate, a positive test means only a 15.4% chance of having the condition, because healthy people far outnumber ill ones.

Does that surprise you? What do you think happens if the condition is rarer?`,
        fails: ['heading', 'must-not'],
        repaired: ['ask']
      }
    ],
    judge: "The opening says concretely where Bayes is used, and its question draws out the learner's intuition about base rates without stating the formula or the answer."
  },
  {
    id: 'maths-after-correct-eigenvalues-2x2',
    subject: 'maths',
    situation: 'after-correct',
    setup: { mode: 'teach', topic: 'Eigenvalues and eigenvectors of a 2x2 matrix', options: { strategy: 'maths' } },
    history: [
      {
        tutor: r`An eigenvector of $A$ is a non-zero vector $v$ with $Av = \lambda v$; the eigenvalues $\lambda$ are the roots of $\det(A - \lambda I) = 0$.

<note>Eigenvalues of $A$: solve $\det(A - \lambda I) = 0$. For a 2×2 matrix this is $\lambda^2 - \operatorname{tr}(A)\lambda + \det(A) = 0$. Eigenvectors for $\lambda$: the non-zero solutions of $(A - \lambda I)v = 0$.</note>

**Problem 1 · warm-up**

Find the eigenvalues of $A = \begin{pmatrix} 4 & 1 \\ 2 & 3 \end{pmatrix}$ and an eigenvector for each.

<solution>$\det(A - \lambda I) = (4 - \lambda)(3 - \lambda) - 2 = \lambda^2 - 7\lambda + 10 = (\lambda - 2)(\lambda - 5)$, so $\lambda = 2, 5$. For $\lambda = 2$: $2x + y = 0$, $v = (1, -2)$. For $\lambda = 5$: $-x + y = 0$, $v = (1, 1)$.</solution>

<ask type="problem">Both eigenvalues and an eigenvector for each, with your working.</ask>`
      },
      {
        learner: {
          answer: 'det(A − λI) = (4 − λ)(3 − λ) − 2 = λ² − 7λ + 10 = (λ − 2)(λ − 5), so λ = 2 and λ = 5. For λ = 2, A − 2I has rows (2, 1) and (2, 1), so 2x + y = 0 and v = (1, −2). For λ = 5, A − 5I has rows (−1, 1) and (2, −2), so x = y and v = (1, 1).',
          confidence: 'sure'
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'error', 'explain'] },
    good: r`<grade verdict="correct" score="1">"λ² − 7λ + 10 = (λ − 2)(λ − 5)" is the right characteristic polynomial, and "2x + y = 0 and v = (1, −2)" and "x = y and v = (1, 1)" are eigenvectors for 2 and 5: $A(1, -2) = (2, -4)$ and $A(1, 1) = (5, 5)$.</grade>

**Problem 2 · harder**

Find the eigenvalues of $B = \begin{pmatrix} 3 & 1 \\ -1 & 1 \end{pmatrix}$ and all of its eigenvectors. How many linearly independent eigenvectors does $B$ have?

<solution>$\operatorname{tr}(B) = 4$, $\det(B) = 3 + 1 = 4$, so $\lambda^2 - 4\lambda + 4 = (\lambda - 2)^2$ and $\lambda = 2$ is a repeated root. $B - 2I = \begin{pmatrix} 1 & 1 \\ -1 & -1 \end{pmatrix}$ has rank 1, so $x + y = 0$ and the eigenvectors are the non-zero multiples of $(1, -1)$. Only one linearly independent eigenvector.</solution>

<ask type="problem">The eigenvalues, the eigenvectors, and how many of them are linearly independent, with your working.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Nice work, you are on the right track with the characteristic polynomial.</grade>

**Problem 2 · harder**

Find the eigenvalues and eigenvectors of $B = \begin{pmatrix} 3 & 1 \\ -1 & 1 \end{pmatrix}$.

<ask type="problem">Your answer, with working.</ask>`,
        fails: ['verdict'],
        repaired: ['solution']
      }
    ]
  },
  {
    id: 'maths-after-wrong-exclusive-not-independent',
    subject: 'maths',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Independence and mutually exclusive events' },
    history: [
      {
        tutor: r`**Why this matters**

Independence is the assumption that lets you multiply probabilities: it is what naive Bayes, the likelihood of a data set and most reliability calculations rest on. Assuming it where it does not hold gives answers that are wrong by orders of magnitude, so being able to test for it is the first skill.

<ask type="predict">Roll one fair die. $A$ is "the roll is even" and $B$ is "the roll is 5", so $A$ and $B$ can never both happen. Are $A$ and $B$ independent? Say why.</ask>`
      },
      { learner: { answer: 'Yes, they are independent. They are mutually exclusive, so they have nothing to do with each other: one happening cannot affect the other.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      names: ['exclusive|disjoint', r`1/12|\\t?frac\{1\}\{12\}|=\s*0\b|\bzero\b|\bto 0\b|rules? .{0,12}out|impossible`],
      need: ['card']
    },
    good: r`<grade verdict="wrong" score="0">"one happening cannot affect the other" is the step that fails: if the roll is even it is certainly not 5, so $A$ happening changes the probability of $B$ from $\frac{1}{6}$ to 0.</grade>

Independent means $P(A \cap B) = P(A)P(B)$. Here $P(A)P(B) = \frac{1}{2} \cdot \frac{1}{6} = \frac{1}{12}$, but $P(A \cap B) = 0$. Mutually exclusive is close to the opposite of independent: each event rules the other out, which is the strongest dependence there is.

<note>Independent: $P(A \cap B) = P(A)P(B)$. Mutually exclusive: $P(A \cap B) = 0$. Two events with non-zero probabilities cannot be both.</note>

<card>Can two mutually exclusive events with non-zero probabilities be independent? :: No. $P(A \cap B) = 0$ while $P(A)P(B) > 0$: knowing one happened makes the other impossible.</card>

<ask type="short">Same die. $A$ is "the roll is even" and $C$ is "the roll is 1 or 2". Work out $P(A \cap C)$ and $P(A)P(C)$, and say whether $A$ and $C$ are independent.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, mutually exclusive events do not influence each other.</grade>

<ask type="short">What is the probability of rolling a 5?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure that mutually exclusive means independent. The reply must name that belief and show with the numbers of this die that the product rule fails.'
  },
  {
    id: 'maths-idk-rank-nullity',
    subject: 'maths',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Rank and null space' },
    history: [
      {
        tutor: r`**Why this matters**

Rank says how many independent directions a matrix keeps, and the null space is what it destroys. Together they decide whether $Ax = b$ has no solution, one, or infinitely many, whether a least-squares fit is unique, and how much a low-rank approximation can compress a data set.

<ask type="short">$A$ is a 3×5 matrix of rank 3. What is the dimension of its null space, and what does that tell you about the solutions of $Ax = 0$?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', must: ['null space|nullspace|kernel|nullity', 'free variable|pivot|number of columns|total columns|columns? (minus|−|-) (the )?rank'], words: { max: 200 } },
    good: r`The null space of $A$ is the set of all $x$ with $Ax = 0$. The rank is the number of pivot columns left after elimination. Every column without a pivot gives a free variable, and each free variable gives one independent direction in the null space. So for a matrix with $n$ columns, rank plus the dimension of the null space is $n$.

Example: $\begin{pmatrix} 1 & 2 \\ 2 & 4 \end{pmatrix}$ reduces to one pivot, so its rank is 1 and it has one free variable. Its null space is the line through $(-2, 1)$, of dimension $2 - 1 = 1$.

<note>Rank–nullity: for a matrix with $n$ columns, $\operatorname{rank}(A) + \dim \operatorname{null}(A) = n$. Pivot columns count the rank; free variables count the dimension of the null space.</note>

<ask type="short">A matrix has 4 columns and elimination leaves 3 pivots. How many free variables are there, and what is the dimension of its null space?</ask>`,
    bad: [
      {
        reply: r`No problem, let's try again. Think about the rank–nullity theorem.

<ask type="short">$A$ is a 3×5 matrix of rank 3. What is the dimension of its null space?</ask>`,
        fails: ['must']
      }
    ],
    judge: 'It teaches what the null space is and why free variables count its dimension, then asks something easier than the question that was missed, not the same question again.'
  },
  {
    id: 'maths-show-me-gaussian-elimination',
    subject: 'maths',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'Solving Ax = b by Gaussian elimination' },
    history: [
      {
        tutor: r`Elimination works on the augmented matrix $(A \mid b)$: subtract multiples of one row from the rows below it until everything under the diagonal is zero, then solve from the bottom up. Take

$$x + y + z = 6, \quad 2x + 3y + 4z = 20, \quad x + 3y + 2z = 13.$$

Clear the first column with $R_2 \leftarrow R_2 - 2R_1$ and $R_3 \leftarrow R_3 - R_1$, which leaves $y + 2z = 8$ and $2y + z = 7$. Clear the second column with $R_3 \leftarrow R_3 - 2R_2$, which leaves $-3z = -9$. Back-substitution gives $z = 3$, then $y = 8 - 2 \cdot 3 = 2$, then $x = 6 - 2 - 3 = 1$.

<note>Gaussian elimination: on $(A \mid b)$, use $R_i \leftarrow R_i - mR_j$ to zero each column below its pivot, giving an upper triangular system; then back-substitute from the last row up. Row operations do not change the solution set.</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: { kind: 'table' }, forbid: ['grade'], must: [r`[-−]\s*9`, r`[-−]\s*3`], words: { max: 170 } },
    good: r`| Step | Operation | Row 1 | Row 2 | Row 3 |
|---|---|---|---|---|
| 0 | start | $(1,\ 1,\ 1 \mid 6)$ | $(2,\ 3,\ 4 \mid 20)$ | $(1,\ 3,\ 2 \mid 13)$ |
| 1 | $R_2 \leftarrow R_2 - 2R_1$ | $(1,\ 1,\ 1 \mid 6)$ | $(0,\ 1,\ 2 \mid 8)$ | $(1,\ 3,\ 2 \mid 13)$ |
| 2 | $R_3 \leftarrow R_3 - R_1$ | $(1,\ 1,\ 1 \mid 6)$ | $(0,\ 1,\ 2 \mid 8)$ | $(0,\ 2,\ 1 \mid 7)$ |
| 3 | $R_3 \leftarrow R_3 - 2R_2$ | $(1,\ 1,\ 1 \mid 6)$ | $(0,\ 1,\ 2 \mid 8)$ | $(0,\ 0,\ -3 \mid -9)$ |

Look at how only one row changes at each step, and how the zeros spread down and to the right until Row 3 reads $-3z = -9$.`,
    bad: [
      {
        reply: r`Gaussian elimination clears the first column, then the second, until the matrix is upper triangular, and then you back-substitute to get $z = 3$, $y = 2$ and $x = 1$.

<ask type="short">Which row operation clears the second column?</ask>`,
        fails: ['ends', 'visual', 'must']
      },
      {
        reply: r`~~~mermaid
flowchart TD
    A["Augmented matrix"] --> B["Clear column 1"]
    B --> C["Clear column 2"]
    C --> D["Row 3: -3z = -9"]
    D --> E["Back-substitute"]
~~~

Look at the order of the steps: columns are cleared left to right.`.replace(/~~~/g, '```'),
        fails: ['visual']
      }
    ],
    judge: 'Values change step by step, so the picture is a table with one row per row operation, every entry exact, and no new explanation or question.'
  },
  {
    id: 'maths-mark-planted-error-variance-of-difference',
    subject: 'maths',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'Variance of sums of random variables', options: { refresh: true } },
    history: [
      {
        tutor: r`**Problem 1 · warm-up**

$X$ and $Y$ are independent, with $\operatorname{Var}(X) = 4$ and $\operatorname{Var}(Y) = 9$. Find $\operatorname{Var}(2X - Y)$ and the standard deviation of $2X - Y$.

<solution>For independent $X$ and $Y$, $\operatorname{Var}(aX + bY) = a^2\operatorname{Var}(X) + b^2\operatorname{Var}(Y)$. With $a = 2$, $b = -1$: $4 \cdot 4 + 1 \cdot 9 = 25$. Standard deviation $\sqrt{25} = 5$.</solution>

<ask type="problem">The variance and the standard deviation, with your working.</ask>`
      },
      {
        learner: {
          answer: 'Constants come out squared, so Var(2X) = 2² × 4 = 16. X and Y are independent, so there is no covariance term. Then Var(2X − Y) = Var(2X) − Var(Y) = 16 − 9 = 7, and the standard deviation is √7 ≈ 2.65.',
          confidence: 'sure'
        }
      }
    ],
    expect: {
      ends: 'ask',
      verdict: 'partial',
      accept: ['wrong'],
      names: [r`\b25\b|16\s*\+\s*9|variances? (still |always )?add|add(s|ed|ing)? (the |their )?variances?|sum of (the |their )?(scaled )?variances|subtract\w* (the |their )?variances? instead of adding|\(-1\)\^\{?2`]
    },
    good: r`<grade verdict="partial" score="0.5">"Var(2X) = 2² × 4 = 16" and "no covariance term" are right; the step "Var(2X) − Var(Y) = 16 − 9" is wrong. The coefficient of $Y$ is $-1$ and it comes out squared like any other constant, so the variances add: $16 + (-1)^2 \cdot 9 = 25$, and the standard deviation is 5.</grade>

<card>For independent $X$ and $Y$, what is $\operatorname{Var}(X - Y)$? :: $\operatorname{Var}(X) + \operatorname{Var}(Y)$. The $-1$ is squared, so subtracting a random variable still adds its variance.</card>

**Problem 2 · same level**

$U$ and $V$ are independent, with $\operatorname{Var}(U) = 3$ and $\operatorname{Var}(V) = 2$. Find $\operatorname{Var}(3U - 2V + 5)$.

<solution>The constant 5 shifts the distribution and adds no variance. $\operatorname{Var}(3U - 2V + 5) = 3^2 \cdot 3 + (-2)^2 \cdot 2 = 27 + 8 = 35$.</solution>

<ask type="problem">The variance, with your working.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">"Var(2X) = 16" and "16 − 9 = 7" follow from the rules for constants and independence, and √7 ≈ 2.65 is right.</grade>

**Problem 2 · harder**

$U$ and $V$ are independent, with $\operatorname{Var}(U) = 3$ and $\operatorname{Var}(V) = 2$. Find $\operatorname{Var}(3U - 2V)$.

<solution>$27 - 8 = 19$.</solution>

<ask type="problem">The variance, with your working.</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'Everything is right except subtracting the variance of Y. The reply must point at that one step and say that variances of independent variables add under a difference, giving 25 and 5.'
  },
  {
    id: 'maths-mark-unusual-correct-determinant-row-reduction',
    subject: 'maths',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Determinants and invertibility', options: { strategy: 'maths' } },
    history: [
      {
        tutor: r`**Problem 2 · same level**

Find $\det A$ for $A = \begin{pmatrix} 0 & 2 & 1 \\ 1 & 1 & 2 \\ 2 & 1 & 1 \end{pmatrix}$, and say whether $A$ is invertible.

<solution>Cofactor expansion along the first row: $0 \cdot (1 \cdot 1 - 2 \cdot 1) - 2 \cdot (1 \cdot 1 - 2 \cdot 2) + 1 \cdot (1 \cdot 1 - 1 \cdot 2) = 0 + 6 - 1 = 5$. $\det A = 5 \neq 0$, so $A$ is invertible.</solution>

<ask type="problem">The determinant, with your working, and whether $A$ is invertible.</ask>`
      },
      {
        learner: {
          answer: 'I row reduced instead of expanding. Swap R1 and R2, which flips the sign of the determinant: rows (1, 1, 2), (0, 2, 1), (2, 1, 1). R3 − 2R1 gives (0, −1, −3). Then R3 + ½R2 gives (0, 0, −5/2). The triangular matrix has diagonal product 1 × 2 × (−5/2) = −5, and undoing the one swap gives det A = 5. It is not zero, so A is invertible.'
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'correct', mustNot: [r`det\s*A\s*=\s*[-−]\s*5\b(?!/)`] },
    good: r`<grade verdict="correct" score="1">"diagonal product 1 × 2 × (−5/2) = −5, and undoing the one swap gives det A = 5" is right. Adding a multiple of one row to another leaves the determinant unchanged and one swap flips its sign, so $\det A = -(-5) = 5$, the value cofactor expansion gives, and a non-zero determinant means $A$ is invertible.</grade>

**Problem 3 · harder**

For which real values of $t$ is $M = \begin{pmatrix} t & 1 & 0 \\ 1 & t & 1 \\ 0 & 1 & t \end{pmatrix}$ not invertible?

<solution>Expanding along the first row: $\det M = t(t^2 - 1) - 1 \cdot (t - 0) = t^3 - 2t = t(t^2 - 2)$. $M$ is not invertible exactly when $\det M = 0$: $t = 0$, $t = \sqrt{2}$ or $t = -\sqrt{2}$.</solution>

<ask type="problem">Every value of $t$, with the determinant you used to find them.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">The method asked for was cofactor expansion, and your triangular matrix has the entry −5/2, which does not appear in the solution. Expanding along the first row gives 5.</grade>

<ask type="short">What is the cofactor of the entry in row 1, column 2?</ask>`,
        fails: ['verdict']
      },
      {
        reply: r`<grade verdict="wrong" score="0">Swapping rows changes the matrix, so the diagonal product is the answer: det A = −5.</grade>

<ask type="short">What is the determinant of a triangular matrix?</ask>`,
        fails: ['verdict', 'must-not']
      }
    ],
    judge: 'The learner used row reduction with a row swap and a fractional pivot instead of cofactors and reached the right value. The reply must mark it fully correct and confirm why the method is valid.'
  },
  {
    id: 'maths-tangent-geometric-overdue',
    subject: 'maths',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'The geometric distribution and expected waiting time' },
    history: [
      {
        tutor: r`**Why this matters**

Waiting for the first success is everywhere: retries until a request gets through, draws until a rare item appears, trials until a randomised algorithm succeeds. The geometric distribution gives the expected number of attempts and how long the tail is, which is what you need to set timeouts and retry budgets.

<ask type="predict">You roll a fair die until the first 6 appears. Before any calculation: how many rolls do you expect that to take on average, and which single number of rolls is the most likely?</ask>`
      },
      { learner: { question: 'Before I answer: if I have already rolled ten times with no 6, is a 6 more likely on the next roll because it is overdue?' } }
    ],
    expect: {
      ends: 'ask',
      forbid: ['grade'],
      must: [r`1/6|\\t?frac\{1\}\{6\}|one in six|same (chance|probability)`, 'memoryless|independen|gambler|no memory'],
      askMustNot: [r`\b(is|are|of|takes?) (about |exactly )?(6|six) rolls`, 'most likely (number )?is (1|one)'],
      words: { max: 170 }
    },
    good: r`No. Each roll is independent of the ones before it, so the chance of a 6 on the next roll is still $\frac{1}{6}$, whatever has happened so far. The geometric distribution is memoryless: $P(X > m + n \mid X > m) = P(X > n)$, so after ten rolls without a 6 the wait from here has exactly the same distribution as the wait from the start. Believing a result is "due" is the gambler's fallacy.

That makes your ten rolls irrelevant to the question you still have open.

<ask type="predict">Starting fresh with a fair die, what is your estimate of the average number of rolls until the first 6, and which exact number of rolls has the highest probability?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Good thinking, but not quite.</grade>

In the long run a 6 comes up once every six rolls, so after ten misses the die has some catching up to do and a 6 becomes a little more likely.

<ask type="short">How many rolls do you expect on average?</ask>`,
        fails: ['forbid:grade', 'must']
      }
    ],
    judge: 'It answers exactly (still 1/6, because rolls are independent and the wait is memoryless), briefly, then returns to the pending question without answering it.'
  },
  {
    id: 'maths-recall-open-dot-product-projection',
    subject: 'maths',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'The dot product and projection' },
    history: [],
    expect: {
      ends: 'ask',
      askTypes: ['explain'],
      forbid: ['grade', 'summary', 'card'],
      mustNot: [r`\bcos`, 'perpendicular|orthogonal|right angle', r`\\frac|\\cdot|b\^T|a\^T`],
      words: { max: 60 }
    },
    good: r`<ask type="explain">Explain the dot product and projection from memory, as fully as you can.</ask>`,
    bad: [
      {
        reply: r`The dot product is $a \cdot b = |a||b|\cos\theta$, and the projection of $a$ onto $b$ is $\frac{a \cdot b}{b \cdot b}b$.

<ask type="short">What is the dot product of two perpendicular vectors?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'maths-code-bug-birthday-simulation',
    subject: 'maths',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'The birthday problem' },
    history: [
      {
        tutor: r`**Problem 2 · harder**

With 365 equally likely birthdays, the chance that at least two of 23 people share one is $1 - \frac{365 \cdot 364 \cdots 343}{365^{23}} \approx 0.507$. Check that value by simulation.

<solution>import random; def shared(n, trials): count the trials in which days = [random.randrange(365) for _ in range(n)] has a repeat, tested with len(set(days)) < n, and return count / trials. shared(23, 100000) prints about 0.507.</solution>

<ask type="code" lang="python">Write shared(n, trials) that estimates the probability that at least two of n people share a birthday, and print shared(23, 100000).</ask>`
      },
      {
        learner: {
          answer: r`~~~python
import random

def shared(n, trials):
    hits = 0
    for _ in range(trials):
        days = [random.randrange(365) for _ in range(n)]
        if any(days[i] == days[i + 1] for i in range(n - 1)):
            hits += 1
    return hits / trials

print(shared(23, 100000))
~~~`.replace(/~~~/g, '```')
        }
      }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      accept: ['partial'],
      names: [r`adjacent|neighbou?r|consecutive|next to|i\s*\+\s*1|sort|set\(|every pair|all pairs|any two|each pair`],
      need: ['card']
    },
    good: r`<grade verdict="wrong" score="0.3">The sampling and the counting of trials are right, but the test "days[i] == days[i + 1]" only compares people who are next to each other in the list. A shared birthday between person 0 and person 5 is missed, so the code prints about 0.058, which is $1 - (364/365)^{22}$, instead of about 0.507.</grade>

<card>How do you test a list of n birthdays for any repeat? :: Compare every pair, not just neighbours: len(set(days)) < n, or sort the list first so that equal values become adjacent.</card>

<ask type="code" lang="python">Fix shared(n, trials) so that a match between any two of the n people counts, and print shared(23, 100000) to check that it comes out near 0.507.</ask>

<solution>Replace the test with len(set(days)) < len(days), or sort days before comparing neighbours. With either fix shared(23, 100000) prints about 0.507.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your function samples 23 birthdays per trial and counts the trials with a match, which is the right simulation.</grade>

<ask type="short">Why is the answer above one half with only 23 people?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The code runs and prints about 0.058, not 0.507, because only neighbouring list entries are compared. The reply must point at that comparison, not at the sampling.'
  }
]
