/**
 * The daily algorithm problem's bank: short Python problems for someone still learning the core
 * language, each tagged with the parts of core Python it needs (shared/algoPractice maps those to
 * the python-core module's topics) and a step, 1 to 3, within what it needs. Each has a starter, a
 * reference and pytest-style tests, checked in code (test/algoPractice.test.ts runs every reference
 * against its tests, and every starter fails them).
 *
 * The tests are not hidden: they go into the day's folder beside the starter, so the learner can
 * run them in the IDE. Tide's own check runs the bank's copy, so editing the file changes nothing.
 */

/** Parts of core Python, in the order the python-core module teaches them */
export type AlgoNeed = 'basics' | 'lists' | 'control' | 'strings' | 'tuples' | 'dicts' | 'functions' | 'recursion' | 'exceptions' | 'classes' | 'comprehensions'

/** 1 a first go, 2 needs a moment's thought, 3 a real little algorithm */
export type AlgoStep = 1 | 2 | 3

export interface AlgoProblem {
  id: string
  title: string
  needs: AlgoNeed[]
  step: AlgoStep
  /** The statement (Markdown, inline code only) */
  prompt: string
  examples: string[]
  /** The function the learner writes, as the starter defines it */
  entry: string
  starter: string
  reference: string
  /** pytest-style test functions; the answer's names are imported above them */
  tests: string
  /** One nudge, never the answer */
  hint: string
}

export const ALGO_BANK: AlgoProblem[] = [
  // ---------- Names, values and expressions ----------
  {
    id: 'last-digit',
    title: 'Last digit',
    needs: ['basics'],
    step: 1,
    prompt: 'Return the last digit of a whole number `n` that is 0 or more.',
    examples: ['last_digit(1234) == 4', 'last_digit(7) == 7'],
    entry: 'last_digit',
    starter: 'def last_digit(n):\n    pass\n',
    reference: 'def last_digit(n):\n    return n % 10\n',
    tests: `def test_several_digits():
    assert last_digit(1234) == 4

def test_one_digit():
    assert last_digit(7) == 7

def test_zero():
    assert last_digit(0) == 0

def test_ends_in_zero():
    assert last_digit(90) == 0
`,
    hint: 'What is left over when you divide by 10?'
  },
  {
    id: 'whole-hours',
    title: 'Whole hours',
    needs: ['basics'],
    step: 1,
    prompt: 'Given a number of `seconds`, return how many whole hours it contains.',
    examples: ['whole_hours(7200) == 2', 'whole_hours(3599) == 0'],
    entry: 'whole_hours',
    starter: 'def whole_hours(seconds):\n    pass\n',
    reference: 'def whole_hours(seconds):\n    return seconds // 3600\n',
    tests: `def test_exact():
    assert whole_hours(7200) == 2

def test_just_under():
    assert whole_hours(3599) == 0

def test_with_leftover():
    assert whole_hours(10000) == 2

def test_zero():
    assert whole_hours(0) == 0
`,
    hint: 'An hour is 3600 seconds. Which division operator throws the remainder away?'
  },
  {
    id: 'distance',
    title: 'Distance on a line',
    needs: ['basics'],
    step: 1,
    prompt: 'Return how far apart two numbers `a` and `b` are on the number line. The answer is never negative.',
    examples: ['distance(3, 10) == 7', 'distance(10, 3) == 7'],
    entry: 'distance',
    starter: 'def distance(a, b):\n    pass\n',
    reference: 'def distance(a, b):\n    return abs(a - b)\n',
    tests: `def test_forwards():
    assert distance(3, 10) == 7

def test_backwards():
    assert distance(10, 3) == 7

def test_negatives():
    assert distance(-4, 2) == 6

def test_same():
    assert distance(5, 5) == 0
`,
    hint: 'Subtract, then make the result positive: there is a built-in for that.'
  },
  {
    id: 'digit-sum-three',
    title: 'Digit sum of a three-digit number',
    needs: ['basics'],
    step: 2,
    prompt: 'Given a three-digit number `n` (100 to 999), return the sum of its three digits. Use arithmetic, not strings.',
    examples: ['digit_sum(123) == 6', 'digit_sum(909) == 18'],
    entry: 'digit_sum',
    starter: 'def digit_sum(n):\n    pass\n',
    reference: 'def digit_sum(n):\n    return n // 100 + n // 10 % 10 + n % 10\n',
    tests: `def test_counting_up():
    assert digit_sum(123) == 6

def test_zero_in_middle():
    assert digit_sum(909) == 18

def test_smallest():
    assert digit_sum(100) == 1

def test_largest():
    assert digit_sum(999) == 27
`,
    hint: '`n // 100` is the hundreds digit and `n % 10` the units. How do you get the tens?'
  },
  {
    id: 'is-leap',
    title: 'Leap year',
    needs: ['basics'],
    step: 2,
    prompt: 'Return `True` if `year` is a leap year, else `False`. A leap year divides by 4, except years that divide by 100, which are leap years only if they also divide by 400. Write it as one boolean expression.',
    examples: ['is_leap(2024) is True', 'is_leap(1900) is False', 'is_leap(2000) is True'],
    entry: 'is_leap',
    starter: 'def is_leap(year):\n    pass\n',
    reference: 'def is_leap(year):\n    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)\n',
    tests: `def test_ordinary_leap():
    assert is_leap(2024) is True

def test_ordinary_year():
    assert is_leap(2023) is False

def test_century():
    assert is_leap(1900) is False

def test_four_hundred():
    assert is_leap(2000) is True
`,
    hint: 'Combine three remainder checks with `and` and `or`; brackets decide which goes first.'
  },
  {
    id: 'round-up-to',
    title: 'Round up to a multiple',
    needs: ['basics'],
    step: 3,
    prompt: 'Return the smallest multiple of `k` that is at least `n` (both positive whole numbers). No `if`, no loops, no `math`.',
    examples: ['round_up(7, 5) == 10', 'round_up(10, 5) == 10'],
    entry: 'round_up',
    starter: 'def round_up(n, k):\n    pass\n',
    reference: 'def round_up(n, k):\n    return (n + k - 1) // k * k\n',
    tests: `def test_rounds_up():
    assert round_up(7, 5) == 10

def test_already_a_multiple():
    assert round_up(10, 5) == 10

def test_one_over():
    assert round_up(11, 5) == 15

def test_k_is_one():
    assert round_up(13, 1) == 13
`,
    hint: '`n // k * k` rounds down. What could you add to `n` first so that rounding down lands on the right multiple?'
  },

  // ---------- Lists: indexing and slicing ----------
  {
    id: 'first-and-last',
    title: 'First and last',
    needs: ['basics', 'lists'],
    step: 1,
    prompt: 'Given a non-empty list `xs`, return a new list holding its first and last items.',
    examples: ['first_and_last([4, 8, 15, 16]) == [4, 16]', 'first_and_last([9]) == [9, 9]'],
    entry: 'first_and_last',
    starter: 'def first_and_last(xs):\n    pass\n',
    reference: 'def first_and_last(xs):\n    return [xs[0], xs[-1]]\n',
    tests: `def test_several():
    assert first_and_last([4, 8, 15, 16]) == [4, 16]

def test_one_item():
    assert first_and_last([9]) == [9, 9]

def test_two_items():
    assert first_and_last([1, 2]) == [1, 2]

def test_strings():
    assert first_and_last(["a", "b", "c"]) == ["a", "c"]
`,
    hint: 'A negative index counts from the end.'
  },
  {
    id: 'middle-item',
    title: 'The middle item',
    needs: ['basics', 'lists'],
    step: 1,
    prompt: 'Given a list `xs` with an odd number of items, return the one in the middle.',
    examples: ['middle([1, 2, 3]) == 2', 'middle([5, 1, 9, 7, 3]) == 9'],
    entry: 'middle',
    starter: 'def middle(xs):\n    pass\n',
    reference: 'def middle(xs):\n    return xs[len(xs) // 2]\n',
    tests: `def test_three():
    assert middle([1, 2, 3]) == 2

def test_five():
    assert middle([5, 1, 9, 7, 3]) == 9

def test_one():
    assert middle([42]) == 42

def test_seven():
    assert middle(list(range(10, 17))) == 13
`,
    hint: 'For 5 items the middle is index 2. How do you get 2 from 5?'
  },
  {
    id: 'rotate-left',
    title: 'Rotate left',
    needs: ['basics', 'lists'],
    step: 2,
    prompt: 'Return a new list with the first item of `xs` moved to the end. An empty list stays empty.',
    examples: ['rotate_left([1, 2, 3]) == [2, 3, 1]', 'rotate_left([]) == []'],
    entry: 'rotate_left',
    starter: 'def rotate_left(xs):\n    pass\n',
    reference: 'def rotate_left(xs):\n    return xs[1:] + xs[:1]\n',
    tests: `def test_three():
    assert rotate_left([1, 2, 3]) == [2, 3, 1]

def test_empty():
    assert rotate_left([]) == []

def test_one():
    assert rotate_left([7]) == [7]

def test_leaves_the_original():
    xs = [1, 2, 3]
    assert rotate_left(xs) == [2, 3, 1]
    assert xs == [1, 2, 3]
`,
    hint: 'Two slices joined with `+`. Slices never raise on an empty list.'
  },
  {
    id: 'swap-ends',
    title: 'Swap the ends, safely',
    needs: ['basics', 'lists'],
    step: 3,
    prompt: 'Return a new list like `xs` with its first and last items swapped. The list passed in must not change: remember that two names can point at one list.',
    examples: ['swap_ends([1, 2, 3, 4]) == [4, 2, 3, 1]'],
    entry: 'swap_ends',
    starter: 'def swap_ends(xs):\n    pass\n',
    reference: 'def swap_ends(xs):\n    ys = xs[:]\n    ys[0], ys[-1] = ys[-1], ys[0]\n    return ys\n',
    tests: `def test_swaps():
    assert swap_ends([1, 2, 3, 4]) == [4, 2, 3, 1]

def test_two():
    assert swap_ends(["a", "b"]) == ["b", "a"]

def test_one():
    assert swap_ends([5]) == [5]

def test_original_unchanged():
    xs = [1, 2, 3]
    ys = swap_ends(xs)
    assert ys == [3, 2, 1]
    assert xs == [1, 2, 3]
    assert ys is not xs
`,
    hint: '`ys = xs` gives the same list a second name. Make a copy first, then swap in the copy.'
  },

  // ---------- Control flow ----------
  {
    id: 'sum-to',
    title: 'Sum to n',
    needs: ['basics', 'control'],
    step: 1,
    prompt: 'Return 1 + 2 + … + `n` using a loop (`n` is 0 or more).',
    examples: ['sum_to(4) == 10', 'sum_to(0) == 0'],
    entry: 'sum_to',
    starter: 'def sum_to(n):\n    pass\n',
    reference: 'def sum_to(n):\n    total = 0\n    for i in range(1, n + 1):\n        total += i\n    return total\n',
    tests: `def test_four():
    assert sum_to(4) == 10

def test_zero():
    assert sum_to(0) == 0

def test_one():
    assert sum_to(1) == 1

def test_hundred():
    assert sum_to(100) == 5050
`,
    hint: 'Keep a running total and add each number from 1 to n. `range` stops before its end.'
  },
  {
    id: 'factorial-loop',
    title: 'Factorial',
    needs: ['basics', 'control'],
    step: 1,
    prompt: 'Return `n!` (1 × 2 × … × `n`) with a loop. `0!` is 1.',
    examples: ['factorial(5) == 120', 'factorial(0) == 1'],
    entry: 'factorial',
    starter: 'def factorial(n):\n    pass\n',
    reference: 'def factorial(n):\n    out = 1\n    for i in range(2, n + 1):\n        out *= i\n    return out\n',
    tests: `def test_five():
    assert factorial(5) == 120

def test_zero():
    assert factorial(0) == 1

def test_one():
    assert factorial(1) == 1

def test_big():
    assert factorial(20) == 2432902008176640000
`,
    hint: 'Like a running total, but start at 1 and multiply.'
  },
  {
    id: 'count-digits',
    title: 'Count the digits',
    needs: ['basics', 'control'],
    step: 2,
    prompt: 'Return how many digits a whole number `n` (0 or more) has, using a `while` loop and no strings.',
    examples: ['count_digits(2024) == 4', 'count_digits(0) == 1'],
    entry: 'count_digits',
    starter: 'def count_digits(n):\n    pass\n',
    reference: 'def count_digits(n):\n    count = 1\n    while n >= 10:\n        n //= 10\n        count += 1\n    return count\n',
    tests: `def test_four():
    assert count_digits(2024) == 4

def test_zero():
    assert count_digits(0) == 1

def test_one_digit():
    assert count_digits(9) == 1

def test_power_of_ten():
    assert count_digits(1000) == 4

def test_huge():
    assert count_digits(2 ** 100) == 31
`,
    hint: 'Each `n // 10` drops one digit. Careful with 0: it still has one digit.'
  },
  {
    id: 'is-prime',
    title: 'Is it prime?',
    needs: ['basics', 'control'],
    step: 2,
    prompt: 'Return `True` if `n` is prime, else `False`. Numbers below 2 are not prime. Only try divisors up to the square root of `n`.',
    examples: ['is_prime(7) is True', 'is_prime(9) is False', 'is_prime(1) is False'],
    entry: 'is_prime',
    starter: 'def is_prime(n):\n    pass\n',
    reference: 'def is_prime(n):\n    if n < 2:\n        return False\n    d = 2\n    while d * d <= n:\n        if n % d == 0:\n            return False\n        d += 1\n    return True\n',
    tests: `def test_small_primes():
    assert [n for n in range(20) if is_prime(n) is True] == [2, 3, 5, 7, 11, 13, 17, 19]

def test_square():
    assert is_prime(49) is False

def test_below_two():
    assert is_prime(1) is False
    assert is_prime(0) is False

def test_large_prime():
    assert is_prime(1_000_003) is True
`,
    hint: 'If `n` has a divisor bigger than its square root, it also has one smaller. Loop while `d * d <= n`.'
  },
  {
    id: 'collatz-steps',
    title: 'Collatz steps',
    needs: ['basics', 'control'],
    step: 2,
    prompt: 'Starting from `n` (1 or more): if it is even halve it, if odd make it `3n + 1`. Return how many steps it takes to reach 1.',
    examples: ['collatz_steps(6) == 8', 'collatz_steps(1) == 0'],
    entry: 'collatz_steps',
    starter: 'def collatz_steps(n):\n    pass\n',
    reference: 'def collatz_steps(n):\n    steps = 0\n    while n != 1:\n        n = n // 2 if n % 2 == 0 else 3 * n + 1\n        steps += 1\n    return steps\n',
    tests: `def test_six():
    assert collatz_steps(6) == 8

def test_one():
    assert collatz_steps(1) == 0

def test_power_of_two():
    assert collatz_steps(16) == 4

def test_twenty_seven():
    assert collatz_steps(27) == 111
`,
    hint: 'A `while n != 1` loop with an `if` inside, counting as you go.'
  },
  {
    id: 'gcd',
    title: 'Greatest common divisor',
    needs: ['basics', 'control'],
    step: 3,
    prompt: 'Return the greatest common divisor of two positive whole numbers with Euclid\'s algorithm: replace `(a, b)` by `(b, a % b)` until `b` is 0. No `math.gcd`.',
    examples: ['gcd(12, 18) == 6', 'gcd(17, 5) == 1'],
    entry: 'gcd',
    starter: 'def gcd(a, b):\n    pass\n',
    reference: 'def gcd(a, b):\n    while b:\n        a, b = b, a % b\n    return a\n',
    tests: `def test_common():
    assert gcd(12, 18) == 6

def test_coprime():
    assert gcd(17, 5) == 1

def test_one_divides_other():
    assert gcd(21, 7) == 7

def test_order_does_not_matter():
    assert gcd(7, 21) == 7

def test_large():
    assert gcd(1071, 462) == 21
`,
    hint: 'Python can swap and update two names at once: `a, b = b, a % b`.'
  },

  // ---------- Lists with loops ----------
  {
    id: 'largest',
    title: 'Largest, by hand',
    needs: ['basics', 'lists', 'control'],
    step: 1,
    prompt: 'Return the largest number in a non-empty list `xs` without using `max` or `sorted`.',
    examples: ['largest([3, 9, 2]) == 9', 'largest([-5, -2, -8]) == -2'],
    entry: 'largest',
    starter: 'def largest(xs):\n    pass\n',
    reference: 'def largest(xs):\n    best = xs[0]\n    for x in xs:\n        if x > best:\n            best = x\n    return best\n',
    tests: `def test_middle():
    assert largest([3, 9, 2]) == 9

def test_negatives():
    assert largest([-5, -2, -8]) == -2

def test_one():
    assert largest([4]) == 4

def test_last():
    assert largest([1, 2, 3, 4, 50]) == 50
`,
    hint: 'Start with the first item as the best so far (not 0: think of negative lists).'
  },
  {
    id: 'count-evens',
    title: 'Count the evens',
    needs: ['basics', 'lists', 'control'],
    step: 1,
    prompt: 'Return how many numbers in `xs` are even.',
    examples: ['count_evens([1, 2, 4, 7]) == 2', 'count_evens([]) == 0'],
    entry: 'count_evens',
    starter: 'def count_evens(xs):\n    pass\n',
    reference: 'def count_evens(xs):\n    n = 0\n    for x in xs:\n        if x % 2 == 0:\n            n += 1\n    return n\n',
    tests: `def test_some():
    assert count_evens([1, 2, 4, 7]) == 2

def test_empty():
    assert count_evens([]) == 0

def test_none_even():
    assert count_evens([1, 3, 5]) == 0

def test_zero_and_negatives():
    assert count_evens([0, -2, -3]) == 2
`,
    hint: 'A counter that goes up by one when `x % 2 == 0`.'
  },
  {
    id: 'running-sum',
    title: 'Running sum',
    needs: ['basics', 'lists', 'control'],
    step: 2,
    prompt: 'Return a new list where item `i` is the sum of `xs[0]` to `xs[i]`.',
    examples: ['running_sum([1, 2, 3, 4]) == [1, 3, 6, 10]'],
    entry: 'running_sum',
    starter: 'def running_sum(xs):\n    pass\n',
    reference: 'def running_sum(xs):\n    out = []\n    total = 0\n    for x in xs:\n        total += x\n        out.append(total)\n    return out\n',
    tests: `def test_counting():
    assert running_sum([1, 2, 3, 4]) == [1, 3, 6, 10]

def test_empty():
    assert running_sum([]) == []

def test_negatives():
    assert running_sum([5, -5, 5]) == [5, 0, 5]

def test_leaves_the_original():
    xs = [1, 1]
    assert running_sum(xs) == [1, 2]
    assert xs == [1, 1]
`,
    hint: 'Keep a total and append it after each addition: one pass, no nested loop.'
  },
  {
    id: 'reverse-in-place',
    title: 'Reverse in place',
    needs: ['basics', 'lists', 'control'],
    step: 2,
    prompt: 'Reverse the list `xs` in place, with two indices walking towards each other. Return nothing. No `reverse()`, `reversed` or `[::-1]`.',
    examples: ['xs = [1, 2, 3]; reverse_in_place(xs); xs == [3, 2, 1]'],
    entry: 'reverse_in_place',
    starter: 'def reverse_in_place(xs):\n    pass\n',
    reference: 'def reverse_in_place(xs):\n    i, j = 0, len(xs) - 1\n    while i < j:\n        xs[i], xs[j] = xs[j], xs[i]\n        i += 1\n        j -= 1\n',
    tests: `def test_odd():
    xs = [1, 2, 3]
    reverse_in_place(xs)
    assert xs == [3, 2, 1]

def test_even():
    xs = [1, 2, 3, 4]
    reverse_in_place(xs)
    assert xs == [4, 3, 2, 1]

def test_same_list_object():
    xs = ["a", "b"]
    alias = xs
    reverse_in_place(xs)
    assert alias == ["b", "a"]

def test_long():
    xs = list(range(9))
    reverse_in_place(xs)
    assert xs == [8, 7, 6, 5, 4, 3, 2, 1, 0]
`,
    hint: 'Start `i` at 0 and `j` at the last index; swap and step inwards while `i < j`.'
  },
  {
    id: 'second-largest',
    title: 'Second largest',
    needs: ['basics', 'lists', 'control'],
    step: 3,
    prompt: 'Return the second largest distinct value in `xs`, in one pass and without sorting. If there is none, return `None`.',
    examples: ['second_largest([3, 9, 2, 9]) == 3', 'second_largest([5, 5]) is None'],
    entry: 'second_largest',
    starter: 'def second_largest(xs):\n    return 0\n',
    reference: 'def second_largest(xs):\n    first = second = None\n    for x in xs:\n        if first is None or x > first:\n            first, second = x, first\n        elif x != first and (second is None or x > second):\n            second = x\n    return second\n',
    tests: `def test_with_repeat():
    assert second_largest([3, 9, 2, 9]) == 3

def test_all_same():
    assert second_largest([5, 5]) is None

def test_negatives():
    assert second_largest([-1, -7, -3]) == -3

def test_largest_first():
    assert second_largest([10, 1, 4]) == 4
`,
    hint: 'Keep the best two so far. When a new best arrives, the old best becomes second.'
  },
  {
    id: 'merge-sorted',
    title: 'Merge two sorted lists',
    needs: ['basics', 'lists', 'control'],
    step: 3,
    prompt: 'Given two lists already sorted from smallest, return one sorted list of all their items. Walk both with an index each; no `sorted` or `sort`.',
    examples: ['merge([1, 4, 6], [2, 3, 7]) == [1, 2, 3, 4, 6, 7]'],
    entry: 'merge',
    starter: 'def merge(a, b):\n    pass\n',
    reference: 'def merge(a, b):\n    i = j = 0\n    out = []\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]:\n            out.append(a[i])\n            i += 1\n        else:\n            out.append(b[j])\n            j += 1\n    return out + a[i:] + b[j:]\n',
    tests: `def test_interleaved():
    assert merge([1, 4, 6], [2, 3, 7]) == [1, 2, 3, 4, 6, 7]

def test_one_empty():
    assert merge([], [1, 2]) == [1, 2]

def test_repeats():
    assert merge([1, 1], [1]) == [1, 1, 1]

def test_one_longer():
    assert merge([5], [1, 2, 3, 9]) == [1, 2, 3, 5, 9]
`,
    hint: 'Take the smaller front item each time. When one list runs out, the rest of the other is already in order.'
  },
  {
    id: 'binary-search',
    title: 'Binary search',
    needs: ['basics', 'lists', 'control'],
    step: 3,
    prompt: 'Given a sorted list `xs`, return the index of `target`, or -1 if it isn\'t there. Halve the range you search each step; no `index` or `in`.',
    examples: ['search([1, 3, 5, 7, 9], 7) == 3', 'search([1, 3, 5], 4) == -1'],
    entry: 'search',
    starter: 'def search(xs, target):\n    pass\n',
    reference: 'def search(xs, target):\n    lo, hi = 0, len(xs) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if xs[mid] == target:\n            return mid\n        if xs[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n',
    tests: `def test_found():
    assert search([1, 3, 5, 7, 9], 7) == 3

def test_missing():
    assert search([1, 3, 5], 4) == -1

def test_ends():
    assert search([2, 4, 6, 8], 2) == 0
    assert search([2, 4, 6, 8], 8) == 3

def test_empty():
    assert search([], 1) == -1

def test_large():
    xs = list(range(0, 2_000_000, 2))
    assert search(xs, 1_234_566) == 617_283
`,
    hint: 'Keep `lo` and `hi`; look at the middle; throw away the half the target can\'t be in. Stop when `lo > hi`.'
  },

  // ---------- Strings ----------
  {
    id: 'count-vowels',
    title: 'Count the vowels',
    needs: ['basics', 'control', 'strings'],
    step: 1,
    prompt: 'Return how many vowels (a, e, i, o, u, either case) are in the string `s`.',
    examples: ['count_vowels("Hello") == 2', 'count_vowels("rhythm") == 0'],
    entry: 'count_vowels',
    starter: 'def count_vowels(s):\n    pass\n',
    reference: 'def count_vowels(s):\n    n = 0\n    for ch in s.lower():\n        if ch in "aeiou":\n            n += 1\n    return n\n',
    tests: `def test_hello():
    assert count_vowels("Hello") == 2

def test_none():
    assert count_vowels("rhythm") == 0

def test_capitals():
    assert count_vowels("AEIOU") == 5

def test_empty():
    assert count_vowels("") == 0
`,
    hint: 'Loop over the characters; `ch in "aeiou"` checks membership. Lower-case first.'
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz, one number',
    needs: ['basics', 'control', 'strings'],
    step: 1,
    prompt: 'Return `"FizzBuzz"` if `n` divides by 3 and 5, `"Fizz"` if only by 3, `"Buzz"` if only by 5, else the number as a string.',
    examples: ['fizzbuzz(15) == "FizzBuzz"', 'fizzbuzz(7) == "7"'],
    entry: 'fizzbuzz',
    starter: 'def fizzbuzz(n):\n    pass\n',
    reference: 'def fizzbuzz(n):\n    if n % 15 == 0:\n        return "FizzBuzz"\n    if n % 3 == 0:\n        return "Fizz"\n    if n % 5 == 0:\n        return "Buzz"\n    return str(n)\n',
    tests: `def test_both():
    assert fizzbuzz(15) == "FizzBuzz"

def test_three():
    assert fizzbuzz(9) == "Fizz"

def test_five():
    assert fizzbuzz(10) == "Buzz"

def test_neither():
    assert fizzbuzz(7) == "7"
`,
    hint: 'Order matters: check the case of both before either alone.'
  },
  {
    id: 'is-palindrome',
    title: 'Palindrome, letters only',
    needs: ['basics', 'control', 'strings'],
    step: 2,
    prompt: 'Return `True` if `s` reads the same both ways once you ignore case and everything that isn\'t a letter, else `False`.',
    examples: ['is_palindrome("Never odd or even") is True', 'is_palindrome("Tide") is False'],
    entry: 'is_palindrome',
    starter: 'def is_palindrome(s):\n    pass\n',
    reference: 'def is_palindrome(s):\n    letters = ""\n    for ch in s.lower():\n        if ch.isalpha():\n            letters += ch\n    return letters == letters[::-1]\n',
    tests: `def test_sentence():
    assert is_palindrome("Never odd or even") is True

def test_not():
    assert is_palindrome("Tide") is False

def test_punctuation():
    assert is_palindrome("A man, a plan, a canal: Panama!") is True

def test_empty():
    assert is_palindrome("") is True
`,
    hint: 'First build the string of lower-case letters only (`ch.isalpha()`), then compare it with its reverse.'
  },
  {
    id: 'reverse-words',
    title: 'Reverse the words',
    needs: ['basics', 'control', 'strings'],
    step: 2,
    prompt: 'Return the words of `s` in reverse order, joined by single spaces. Extra spaces between words disappear.',
    examples: ['reverse_words("the quick fox") == "fox quick the"'],
    entry: 'reverse_words',
    starter: 'def reverse_words(s):\n    pass\n',
    reference: 'def reverse_words(s):\n    return " ".join(s.split()[::-1])\n',
    tests: `def test_three():
    assert reverse_words("the quick fox") == "fox quick the"

def test_extra_spaces():
    assert reverse_words("  hello   world ") == "world hello"

def test_one():
    assert reverse_words("tide") == "tide"

def test_empty():
    assert reverse_words("") == ""
`,
    hint: '`split()` with no argument splits on any run of spaces; `" ".join` puts them back.'
  },
  {
    id: 'compress',
    title: 'Run-length compression',
    needs: ['basics', 'control', 'strings'],
    step: 3,
    prompt: 'Compress runs of the same character: `"aaabcc"` becomes `"a3b1c2"`. An empty string stays empty.',
    examples: ['compress("aaabcc") == "a3b1c2"', 'compress("abc") == "a1b1c1"'],
    entry: 'compress',
    starter: 'def compress(s):\n    pass\n',
    reference: 'def compress(s):\n    out = ""\n    i = 0\n    while i < len(s):\n        j = i\n        while j < len(s) and s[j] == s[i]:\n            j += 1\n        out += s[i] + str(j - i)\n        i = j\n    return out\n',
    tests: `def test_runs():
    assert compress("aaabcc") == "a3b1c2"

def test_no_runs():
    assert compress("abc") == "a1b1c1"

def test_empty():
    assert compress("") == ""

def test_long_run():
    assert compress("z" * 12) == "z12"

def test_same_letter_again_later():
    assert compress("aabaa") == "a2b1a2"
`,
    hint: 'From each position, walk a second index forward while the character stays the same; the gap is the count.'
  },

  // ---------- Tuples ----------
  {
    id: 'min-max',
    title: 'Smallest and largest in one pass',
    needs: ['basics', 'lists', 'control', 'tuples'],
    step: 2,
    prompt: 'Return a tuple `(smallest, largest)` of a non-empty list `xs`, in one loop and without `min`, `max` or sorting.',
    examples: ['min_max([3, 1, 4, 1, 5]) == (1, 5)'],
    entry: 'min_max',
    starter: 'def min_max(xs):\n    pass\n',
    reference: 'def min_max(xs):\n    lo = hi = xs[0]\n    for x in xs:\n        if x < lo:\n            lo = x\n        elif x > hi:\n            hi = x\n    return (lo, hi)\n',
    tests: `def test_mixed():
    assert min_max([3, 1, 4, 1, 5]) == (1, 5)

def test_one():
    assert min_max([7]) == (7, 7)

def test_negatives():
    assert min_max([-3, -9, -1]) == (-9, -1)

def test_is_a_tuple():
    assert isinstance(min_max([1, 2]), tuple)
`,
    hint: 'Two names updated in the same loop; `return lo, hi` makes a tuple.'
  },

  // ---------- Dicts and sets ----------
  {
    id: 'char-counts',
    title: 'Count each character',
    needs: ['basics', 'control', 'strings', 'dicts'],
    step: 1,
    prompt: 'Return a dict mapping each character in `s` to how many times it appears. No `Counter`.',
    examples: ['char_counts("banana") == {"b": 1, "a": 3, "n": 2}'],
    entry: 'char_counts',
    starter: 'def char_counts(s):\n    pass\n',
    reference: 'def char_counts(s):\n    out = {}\n    for ch in s:\n        out[ch] = out.get(ch, 0) + 1\n    return out\n',
    tests: `def test_banana():
    assert char_counts("banana") == {"b": 1, "a": 3, "n": 2}

def test_empty():
    assert char_counts("") == {}

def test_spaces_count():
    assert char_counts("a a") == {"a": 2, " ": 1}

def test_case_matters():
    assert char_counts("Aa") == {"A": 1, "a": 1}
`,
    hint: '`d.get(key, 0)` gives 0 for a key that isn\'t there yet.'
  },
  {
    id: 'has-duplicate',
    title: 'Any repeats?',
    needs: ['basics', 'lists', 'control', 'dicts'],
    step: 1,
    prompt: 'Return `True` if any value appears twice in `xs`, else `False`. Use a set of what you have seen, in one pass.',
    examples: ['has_duplicate([1, 2, 3, 1]) is True', 'has_duplicate([1, 2, 3]) is False'],
    entry: 'has_duplicate',
    starter: 'def has_duplicate(xs):\n    pass\n',
    reference: 'def has_duplicate(xs):\n    seen = set()\n    for x in xs:\n        if x in seen:\n            return True\n        seen.add(x)\n    return False\n',
    tests: `def test_repeat():
    assert has_duplicate([1, 2, 3, 1]) is True

def test_none():
    assert has_duplicate([1, 2, 3]) is False

def test_empty():
    assert has_duplicate([]) is False

def test_large():
    assert has_duplicate(list(range(100_000)) + [99_999]) is True
`,
    hint: 'Checking `x in seen` on a set is fast, whatever its size.'
  },
  {
    id: 'two-sum-easy',
    title: 'Two sum',
    needs: ['basics', 'lists', 'control', 'dicts'],
    step: 2,
    prompt: 'Return the indices `[i, j]` (with `i < j`) of the two numbers in `nums` that add up to `target`. Exactly one pair does. One pass, with a dict from value to index.',
    examples: ['two_sum([2, 7, 11, 15], 9) == [0, 1]'],
    entry: 'two_sum',
    starter: 'def two_sum(nums, target):\n    pass\n',
    reference: 'def two_sum(nums, target):\n    seen = {}\n    for j, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], j]\n        seen[x] = j\n    return []\n',
    tests: `def test_first_pair():
    assert two_sum([2, 7, 11, 15], 9) == [0, 1]

def test_middle():
    assert two_sum([3, 2, 4], 6) == [1, 2]

def test_same_value():
    assert two_sum([3, 3], 6) == [0, 1]

def test_negatives():
    assert two_sum([-4, 10, 1, 8], 4) == [0, 3]
`,
    hint: 'For each number, the partner you need is `target - x`. Have you seen it already?'
  },
  {
    id: 'is-anagram',
    title: 'Anagrams',
    needs: ['basics', 'control', 'strings', 'dicts'],
    step: 2,
    prompt: 'Return `True` if `a` and `b` use exactly the same letters the same number of times, else `False`. No sorting.',
    examples: ['is_anagram("listen", "silent") is True', 'is_anagram("aab", "abb") is False'],
    entry: 'is_anagram',
    starter: 'def is_anagram(a, b):\n    pass\n',
    reference: 'def is_anagram(a, b):\n    counts = {}\n    for ch in a:\n        counts[ch] = counts.get(ch, 0) + 1\n    for ch in b:\n        counts[ch] = counts.get(ch, 0) - 1\n    for n in counts.values():\n        if n != 0:\n            return False\n    return True\n',
    tests: `def test_yes():
    assert is_anagram("listen", "silent") is True

def test_counts_differ():
    assert is_anagram("aab", "abb") is False

def test_lengths_differ():
    assert is_anagram("ab", "abc") is False

def test_empty():
    assert is_anagram("", "") is True
`,
    hint: 'Count up for one word and down for the other; every count should end at zero.'
  },
  {
    id: 'first-unique',
    title: 'First unique character',
    needs: ['basics', 'control', 'strings', 'dicts'],
    step: 3,
    prompt: 'Return the index of the first character in `s` that appears only once, or -1 if every character repeats. Two passes, no nested loops.',
    examples: ['first_unique("leetcode") == 0', 'first_unique("aabb") == -1'],
    entry: 'first_unique',
    starter: 'def first_unique(s):\n    pass\n',
    reference: 'def first_unique(s):\n    counts = {}\n    for ch in s:\n        counts[ch] = counts.get(ch, 0) + 1\n    for i, ch in enumerate(s):\n        if counts[ch] == 1:\n            return i\n    return -1\n',
    tests: `def test_first():
    assert first_unique("leetcode") == 0

def test_later():
    assert first_unique("loveleetcode") == 2

def test_none():
    assert first_unique("aabb") == -1

def test_empty():
    assert first_unique("") == -1
`,
    hint: 'Count everything first, then walk the string again and stop at the first count of 1.'
  },

  // ---------- Functions and scope ----------
  {
    id: 'apply-n',
    title: 'Apply a function n times',
    needs: ['basics', 'control', 'functions'],
    step: 2,
    prompt: 'Return the result of calling `f` on `x`, then on that result, `n` times in all. `n` is 0 or more.',
    examples: ['apply_n(lambda v: v * 2, 3, 1) == 8'],
    entry: 'apply_n',
    starter: 'def apply_n(f, n, x):\n    pass\n',
    reference: 'def apply_n(f, n, x):\n    for _ in range(n):\n        x = f(x)\n    return x\n',
    tests: `def double(v):
    return v * 2

def test_double():
    assert apply_n(double, 3, 1) == 8

def test_zero_times():
    assert apply_n(double, 0, 5) == 5

def test_lambda():
    assert apply_n(lambda s: s + "!", 2, "hi") == "hi!!"

def test_once():
    assert apply_n(abs, 1, -3) == 3
`,
    hint: 'A function is a value: you can pass it in and call it like any other name.'
  },
  {
    id: 'make-counter',
    title: 'A counter with a closure',
    needs: ['basics', 'functions'],
    step: 3,
    prompt: 'Write `make_counter()`, which returns a function. Each call of that function returns the next number: 1, then 2, then 3. Two counters count separately.',
    examples: ['c = make_counter(); c() == 1; c() == 2'],
    entry: 'make_counter',
    starter: 'def make_counter():\n    pass\n',
    reference: 'def make_counter():\n    count = 0\n    def step():\n        nonlocal count\n        count += 1\n        return count\n    return step\n',
    tests: `def test_counts_up():
    c = make_counter()
    assert c() == 1
    assert c() == 2
    assert c() == 3

def test_separate():
    a = make_counter()
    b = make_counter()
    a()
    a()
    assert b() == 1
    assert a() == 3

def test_returns_a_function():
    assert callable(make_counter())
`,
    hint: 'The inner function changes a name in the enclosing one: that needs `nonlocal`.'
  },

  // ---------- Recursion ----------
  {
    id: 'power-recursive',
    title: 'Power, recursively',
    needs: ['basics', 'control', 'functions', 'recursion'],
    step: 1,
    prompt: 'Return `b` to the power `e` (`e` is 0 or more) by recursion: no `**`, `pow` or loops.',
    examples: ['power(2, 10) == 1024', 'power(5, 0) == 1'],
    entry: 'power',
    starter: 'def power(b, e):\n    pass\n',
    reference: 'def power(b, e):\n    if e == 0:\n        return 1\n    return b * power(b, e - 1)\n',
    tests: `def test_two():
    assert power(2, 10) == 1024

def test_zero():
    assert power(5, 0) == 1

def test_one():
    assert power(7, 1) == 7

def test_negative_base():
    assert power(-3, 3) == -27
`,
    hint: 'The base case is `e == 0`. Otherwise `b ** e` is `b` times `b ** (e - 1)`.'
  },
  {
    id: 'sum-digits-recursive',
    title: 'Digit sum, recursively',
    needs: ['basics', 'control', 'functions', 'recursion'],
    step: 2,
    prompt: 'Return the sum of the digits of `n` (0 or more) by recursion: no loops or strings.',
    examples: ['sum_digits(2024) == 8'],
    entry: 'sum_digits',
    starter: 'def sum_digits(n):\n    pass\n',
    reference: 'def sum_digits(n):\n    if n < 10:\n        return n\n    return n % 10 + sum_digits(n // 10)\n',
    tests: `def test_year():
    assert sum_digits(2024) == 8

def test_one_digit():
    assert sum_digits(7) == 7

def test_zero():
    assert sum_digits(0) == 0

def test_nines():
    assert sum_digits(99999) == 45
`,
    hint: 'The last digit plus the digit sum of everything before it.'
  },
  {
    id: 'flatten',
    title: 'Flatten a nested list',
    needs: ['basics', 'lists', 'control', 'functions', 'recursion'],
    step: 3,
    prompt: 'Lists may hold numbers or more lists, nested to any depth. Return one flat list of all the numbers, in order.',
    examples: ['flatten([1, [2, [3, 4]], 5]) == [1, 2, 3, 4, 5]'],
    entry: 'flatten',
    starter: 'def flatten(xs):\n    pass\n',
    reference: 'def flatten(xs):\n    out = []\n    for x in xs:\n        if isinstance(x, list):\n            out.extend(flatten(x))\n        else:\n            out.append(x)\n    return out\n',
    tests: `def test_nested():
    assert flatten([1, [2, [3, 4]], 5]) == [1, 2, 3, 4, 5]

def test_flat_already():
    assert flatten([1, 2]) == [1, 2]

def test_empty_lists():
    assert flatten([[], [[]], 1]) == [1]

def test_deep():
    assert flatten([[[[[7]]]]]) == [7]
`,
    hint: 'For each item: a list gets flattened (the same function), a number goes straight in.'
  },

  // ---------- Errors and exceptions ----------
  {
    id: 'safe-int',
    title: 'Safe int',
    needs: ['basics', 'strings', 'exceptions'],
    step: 1,
    prompt: 'Return `int(s)`, or `default` when `s` isn\'t a whole number. Catch only the error `int` raises for bad text.',
    examples: ['safe_int("42", 0) == 42', 'safe_int("4x", -1) == -1'],
    entry: 'safe_int',
    starter: 'def safe_int(s, default):\n    pass\n',
    reference: 'def safe_int(s, default):\n    try:\n        return int(s)\n    except ValueError:\n        return default\n',
    tests: `def test_good():
    assert safe_int("42", 0) == 42

def test_bad():
    assert safe_int("4x", -1) == -1

def test_spaces_are_fine():
    assert safe_int(" 7 ", 0) == 7

def test_float_text():
    assert safe_int("3.5", 99) == 99
`,
    hint: '`try` the conversion; the error for bad text is `ValueError`.'
  },

  // ---------- Classes ----------
  {
    id: 'stack-class',
    title: 'A stack',
    needs: ['basics', 'lists', 'control', 'functions', 'exceptions', 'classes'],
    step: 2,
    prompt: 'Write a class `Stack` with `push(x)`, `pop()` (returns the top item, and raises `IndexError` when empty), `peek()` (the top, without removing it) and `__len__`.',
    examples: ['s = Stack(); s.push(1); s.push(2); s.pop() == 2; len(s) == 1'],
    entry: 'Stack',
    starter: 'class Stack:\n    pass\n',
    reference: 'class Stack:\n    def __init__(self):\n        self._items = []\n\n    def push(self, x):\n        self._items.append(x)\n\n    def pop(self):\n        if not self._items:\n            raise IndexError("pop from an empty stack")\n        return self._items.pop()\n\n    def peek(self):\n        return self._items[-1]\n\n    def __len__(self):\n        return len(self._items)\n',
    tests: `def test_last_in_first_out():
    s = Stack()
    s.push(1)
    s.push(2)
    assert s.pop() == 2
    assert s.pop() == 1

def test_peek_keeps():
    s = Stack()
    s.push("a")
    assert s.peek() == "a"
    assert len(s) == 1

def test_empty_pop_raises():
    s = Stack()
    try:
        s.pop()
    except IndexError:
        return
    raise AssertionError("pop on an empty stack should raise IndexError")

def test_separate_stacks():
    a, b = Stack(), Stack()
    a.push(1)
    assert len(b) == 0
`,
    hint: 'Keep a list in `self` (made in `__init__`, so each stack has its own). The list\'s end is the top.'
  },

  // ---------- Comprehensions ----------
  {
    id: 'squares-of-odds',
    title: 'Squares of the odd numbers',
    needs: ['basics', 'lists', 'control', 'comprehensions'],
    step: 1,
    prompt: 'Return a list of the squares of the odd numbers in `xs`, in order, as one list comprehension.',
    examples: ['odd_squares([1, 2, 3, 4, 5]) == [1, 9, 25]'],
    entry: 'odd_squares',
    starter: 'def odd_squares(xs):\n    pass\n',
    reference: 'def odd_squares(xs):\n    return [x * x for x in xs if x % 2 == 1]\n',
    tests: `def test_counting():
    assert odd_squares([1, 2, 3, 4, 5]) == [1, 9, 25]

def test_none_odd():
    assert odd_squares([2, 4]) == []

def test_negatives():
    assert odd_squares([-3, -2]) == [9]

def test_empty():
    assert odd_squares([]) == []
`,
    hint: '`[expression for x in xs if condition]`.'
  },
  {
    id: 'invert-dict',
    title: 'Invert a dict',
    needs: ['basics', 'control', 'dicts', 'comprehensions'],
    step: 2,
    prompt: 'Given a dict whose values are all different, return a new dict with keys and values swapped, as one dict comprehension.',
    examples: ['invert({"a": 1, "b": 2}) == {1: "a", 2: "b"}'],
    entry: 'invert',
    starter: 'def invert(d):\n    pass\n',
    reference: 'def invert(d):\n    return {v: k for k, v in d.items()}\n',
    tests: `def test_two():
    assert invert({"a": 1, "b": 2}) == {1: "a", 2: "b"}

def test_empty():
    assert invert({}) == {}

def test_original_unchanged():
    d = {"x": 9}
    assert invert(d) == {9: "x"}
    assert d == {"x": 9}

def test_round_trip():
    d = {"a": 1, "b": 2, "c": 3}
    assert invert(invert(d)) == d
`,
    hint: '`d.items()` gives `(key, value)` pairs; put them back the other way round.'
  }
]

export const algoProblem = (id: string) => ALGO_BANK.find((p) => p.id === id)

/** The day's test file: the bank's tests, importing the answer from solution.py */
export const testFile = (p: AlgoProblem) => `# Today's tests. Run them from the Tests view, or press Check.\nfrom solution import *\n\n${p.tests}`

/** The day's README: the problem as the learner reads it */
export const readme = (p: AlgoProblem) => `# ${p.title}\n\n${p.prompt}\n\n## Examples\n\n${p.examples.map((e) => `- \`${e}\``).join('\n')}\n\nWrite your answer in \`solution.py\`. The tests are in \`test_solution.py\`.\n`
