/**
 * The coding mock's problem bank: curated problems, tagged by pattern and level, each with a
 * Python starter, a reference solution, hidden pytest tests, the complexity a strong answer
 * reaches, and a ladder of hints. Hand-written and checked in code (test/mocks.test.ts runs every
 * reference against its tests, and every starter fails them), so a mock works the same with or
 * without Claude: Claude picks and interviews, the bank and the sandbox decide what passes.
 *
 * The hidden tests never reach the window: main/mocks runs them in Tide's sandbox and sends back
 * only which passed and which failed, by name.
 */

export type BankTag = 'arrays' | 'hashing' | 'strings' | 'sliding window' | 'sorting' | 'binary search' | 'graphs' | 'dp' | 'heaps' | 'system' | 'payments'

/** 1 warm-up, 2 interview standard, 3 hard */
export type BankLevel = 1 | 2 | 3

export interface BankProblem {
  id: string
  title: string
  tags: BankTag[]
  level: BankLevel
  /** The statement as the candidate reads it (Markdown) */
  prompt: string
  /** Examples shown with the statement */
  examples: string[]
  starter: string
  /** Hidden from the window */
  reference: string
  /** Hidden from the window: pytest-style test functions, run against the answer */
  tests: string
  complexity: { time: string; space: string }
  /** From a nudge to most of the way there; each one taken costs points */
  hints: string[]
  /** What a real interviewer would ask once it works */
  followUps: string[]
}

export const BANK: BankProblem[] = [
  {
    id: 'two-sum',
    title: 'Two sum',
    tags: ['arrays', 'hashing'],
    level: 1,
    prompt: 'Given a list of integers `nums` and an integer `target`, return the indices `[i, j]` (with `i < j`) of the two numbers that add up to `target`. Exactly one pair does.',
    examples: ['two_sum([2, 7, 11, 15], 9) == [0, 1]', 'two_sum([3, 2, 4], 6) == [1, 2]'],
    starter: 'def two_sum(nums: list[int], target: int) -> list[int]:\n    pass\n',
    reference: 'def two_sum(nums, target):\n    seen = {}\n    for j, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], j]\n        seen[x] = j\n    return []\n',
    tests: `def test_first_pair():
    assert two_sum([2, 7, 11, 15], 9) == [0, 1]

def test_pair_in_the_middle():
    assert two_sum([3, 2, 4], 6) == [1, 2]

def test_same_value_twice():
    assert two_sum([3, 3], 6) == [0, 1]

def test_negative_numbers():
    assert two_sum([-4, 10, 1, 8], 4) == [0, 3]

def test_long_list():
    nums = list(range(10000))
    assert two_sum(nums, 19997) == [9998, 9999]
`,
    complexity: { time: 'O(n)', space: 'O(n)' },
    hints: ['What do you need to know about the numbers you have already passed?', 'For each number x, you are looking for target - x. Where could you look it up in O(1)?', 'Keep a dict from value to index; check for target - x before you store x.'],
    followUps: ['What if the list were sorted?', 'What if there could be several pairs and you had to return all of them?']
  },
  {
    id: 'group-anagrams',
    title: 'Group anagrams',
    tags: ['hashing', 'strings'],
    level: 1,
    prompt: 'Given a list of lowercase words, group the words that are anagrams of each other. Return the groups in any order; words inside a group in the order they appeared.',
    examples: ['group_anagrams(["eat", "tea", "tan", "ate", "nat", "bat"]) -> [["eat", "tea", "ate"], ["tan", "nat"], ["bat"]]'],
    starter: 'def group_anagrams(words: list[str]) -> list[list[str]]:\n    pass\n',
    reference: 'def group_anagrams(words):\n    groups = {}\n    for w in words:\n        groups.setdefault("".join(sorted(w)), []).append(w)\n    return list(groups.values())\n',
    tests: `def _norm(groups):
    return sorted(sorted(g) for g in groups)

def test_classic_example():
    assert _norm(group_anagrams(["eat", "tea", "tan", "ate", "nat", "bat"])) == [["ate", "eat", "tea"], ["bat"], ["nat", "tan"]]

def test_empty_word():
    assert _norm(group_anagrams([""])) == [[""]]

def test_no_anagrams():
    assert _norm(group_anagrams(["abc", "def"])) == [["abc"], ["def"]]

def test_keeps_order_inside_a_group():
    out = group_anagrams(["ab", "ba", "ab"])
    assert out == [["ab", "ba", "ab"]]

def test_empty_list():
    assert group_anagrams([]) == []
`,
    complexity: { time: 'O(n·k log k)', space: 'O(n·k)' },
    hints: ['What do two anagrams have in common that you could use as a key?', 'Sorting the letters of a word gives the same string for all its anagrams.', 'Use a dict from the sorted letters to the list of words.'],
    followUps: ['Can you avoid the sort? (Count letters instead.)', 'What changes for Unicode words?']
  },
  {
    id: 'top-k-frequent',
    title: 'Top k frequent',
    tags: ['hashing', 'heaps', 'sorting'],
    level: 2,
    prompt: 'Return the `k` most frequent values in `nums`, most frequent first. Frequencies are all different, so the answer is unique.',
    examples: ['top_k_frequent([1, 1, 1, 2, 2, 3], 2) == [1, 2]'],
    starter: 'def top_k_frequent(nums: list[int], k: int) -> list[int]:\n    pass\n',
    reference: 'from collections import Counter\nimport heapq\n\ndef top_k_frequent(nums, k):\n    counts = Counter(nums)\n    return [x for x, _ in heapq.nlargest(k, counts.items(), key=lambda kv: kv[1])]\n',
    tests: `def test_example():
    assert top_k_frequent([1, 1, 1, 2, 2, 3], 2) == [1, 2]

def test_single():
    assert top_k_frequent([7], 1) == [7]

def test_order_is_by_frequency():
    assert top_k_frequent([4, 4, 5, 5, 5, 6, 6, 6, 6], 3) == [6, 5, 4]

def test_negatives():
    assert top_k_frequent([-1, -1, -2, -2, -2, 3], 1) == [-2]
`,
    complexity: { time: 'O(n log k)', space: 'O(n)' },
    hints: ['Start by counting. What structure gives counts in one pass?', 'Once you have counts, you need the k biggest: a full sort works, but what keeps only k?', 'A min-heap of size k (or heapq.nlargest) over the counts.'],
    followUps: ['Can you do it in O(n)? (Bucket sort by frequency.)', 'What if nums is a stream too big for memory?']
  },
  {
    id: 'longest-consecutive',
    title: 'Longest consecutive run',
    tags: ['arrays', 'hashing'],
    level: 2,
    prompt: 'Given an unsorted list of integers, return the length of the longest run of consecutive values (in value, not position). Aim for O(n).',
    examples: ['longest_consecutive([100, 4, 200, 1, 3, 2]) == 4  # 1, 2, 3, 4'],
    starter: 'def longest_consecutive(nums: list[int]) -> int:\n    pass\n',
    reference: 'def longest_consecutive(nums):\n    s = set(nums)\n    best = 0\n    for x in s:\n        if x - 1 not in s:\n            y = x\n            while y + 1 in s:\n                y += 1\n            best = max(best, y - x + 1)\n    return best\n',
    tests: `def test_example():
    assert longest_consecutive([100, 4, 200, 1, 3, 2]) == 4

def test_empty():
    assert longest_consecutive([]) == 0

def test_duplicates():
    assert longest_consecutive([1, 2, 2, 3]) == 3

def test_negatives():
    assert longest_consecutive([-1, -2, 0, 5]) == 3

def test_large_is_fast():
    nums = list(range(200000, 0, -1))
    assert longest_consecutive(nums) == 200000
`,
    complexity: { time: 'O(n)', space: 'O(n)' },
    hints: ['Sorting gives O(n log n). What lets you ask "is x + 1 here?" in O(1)?', 'Put everything in a set. Which numbers are the start of a run?', 'Only start counting from x when x - 1 is not in the set, then walk up.'],
    followUps: ['Why is this O(n) even with the inner while loop?', 'How would you return the run itself?']
  },
  {
    id: 'product-except-self',
    title: 'Product of everything else',
    tags: ['arrays'],
    level: 2,
    prompt: 'Return a list where element `i` is the product of every element of `nums` except `nums[i]`, without using division.',
    examples: ['product_except_self([1, 2, 3, 4]) == [24, 12, 8, 6]'],
    starter: 'def product_except_self(nums: list[int]) -> list[int]:\n    pass\n',
    reference: 'def product_except_self(nums):\n    n = len(nums)\n    out = [1] * n\n    left = 1\n    for i in range(n):\n        out[i] = left\n        left *= nums[i]\n    right = 1\n    for i in range(n - 1, -1, -1):\n        out[i] *= right\n        right *= nums[i]\n    return out\n',
    tests: `def test_example():
    assert product_except_self([1, 2, 3, 4]) == [24, 12, 8, 6]

def test_one_zero():
    assert product_except_self([2, 0, 3]) == [0, 6, 0]

def test_two_zeros():
    assert product_except_self([0, 4, 0]) == [0, 0, 0]

def test_negatives():
    assert product_except_self([-1, 2, -3]) == [-6, 3, -2]

def test_two_elements():
    assert product_except_self([5, 7]) == [7, 5]
`,
    complexity: { time: 'O(n)', space: 'O(1) extra' },
    hints: ['Element i is (product of everything left of i) × (product of everything right of i).', 'Make one pass left to right for the left products.', 'Then a pass right to left, multiplying in a running right product.'],
    followUps: ['Why not divide the total product by nums[i]?', 'Could this overflow in another language? What would you do?']
  },
  {
    id: 'longest-unique-substring',
    title: 'Longest substring without repeats',
    tags: ['strings', 'sliding window', 'hashing'],
    level: 2,
    prompt: 'Return the length of the longest substring of `s` with no repeated characters.',
    examples: ['longest_unique("abcabcbb") == 3  # "abc"', 'longest_unique("pwwkew") == 3  # "wke"'],
    starter: 'def longest_unique(s: str) -> int:\n    pass\n',
    reference: 'def longest_unique(s):\n    last = {}\n    start = best = 0\n    for i, c in enumerate(s):\n        if c in last and last[c] >= start:\n            start = last[c] + 1\n        last[c] = i\n        best = max(best, i - start + 1)\n    return best\n',
    tests: `def test_example():
    assert longest_unique("abcabcbb") == 3

def test_all_same():
    assert longest_unique("bbbbb") == 1

def test_middle():
    assert longest_unique("pwwkew") == 3

def test_empty():
    assert longest_unique("") == 0

def test_jump_back():
    assert longest_unique("abba") == 2

def test_spaces_count():
    assert longest_unique("a b c") == 3
`,
    complexity: { time: 'O(n)', space: 'O(min(n, alphabet))' },
    hints: ['Think of a window [start, i] that never holds a repeat.', 'When s[i] is already in the window, where must the window start next?', 'Remember the last index of each character; move start past it only if it is inside the window.'],
    followUps: ['Why does "abba" catch a common bug?', 'How would you return the substring itself?']
  },
  {
    id: 'merge-settlement-windows',
    title: 'Merge settlement windows',
    tags: ['arrays', 'sorting', 'payments'],
    level: 1,
    prompt: 'A payments team has settlement windows as `[start, end]` minute pairs (inclusive). Merge every overlapping or touching pair and return the merged windows sorted by start. `[1, 3]` and `[3, 5]` touch and merge to `[1, 5]`.',
    examples: ['merge_windows([[1, 3], [2, 6], [8, 10]]) == [[1, 6], [8, 10]]'],
    starter: 'def merge_windows(windows: list[list[int]]) -> list[list[int]]:\n    pass\n',
    reference: 'def merge_windows(windows):\n    out = []\n    for s, e in sorted(windows):\n        if out and s <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], e)\n        else:\n            out.append([s, e])\n    return out\n',
    tests: `def test_example():
    assert merge_windows([[1, 3], [2, 6], [8, 10]]) == [[1, 6], [8, 10]]

def test_touching():
    assert merge_windows([[1, 3], [3, 5]]) == [[1, 5]]

def test_unsorted_input():
    assert merge_windows([[8, 10], [1, 2]]) == [[1, 2], [8, 10]]

def test_contained():
    assert merge_windows([[1, 10], [2, 3]]) == [[1, 10]]

def test_empty():
    assert merge_windows([]) == []
`,
    complexity: { time: 'O(n log n)', space: 'O(n)' },
    hints: ['Would it help to look at them in order of start?', 'After sorting, a window either extends the last merged one or starts a new one.', 'Compare start with the last merged end; extend with max(end, last end).'],
    followUps: ['What if windows arrive one at a time and you must keep them merged?', 'How would you find the gaps between windows?']
  },
  {
    id: 'search-rotated',
    title: 'Search a rotated sorted list',
    tags: ['arrays', 'binary search'],
    level: 2,
    prompt: 'A sorted list of distinct integers has been rotated at an unknown point (`[4, 5, 6, 7, 0, 1, 2]`). Return the index of `target`, or `-1`. Aim for O(log n).',
    examples: ['search_rotated([4, 5, 6, 7, 0, 1, 2], 0) == 4'],
    starter: 'def search_rotated(nums: list[int], target: int) -> int:\n    pass\n',
    reference: 'def search_rotated(nums, target):\n    lo, hi = 0, len(nums) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[lo] <= nums[mid]:\n            if nums[lo] <= target < nums[mid]:\n                hi = mid - 1\n            else:\n                lo = mid + 1\n        else:\n            if nums[mid] < target <= nums[hi]:\n                lo = mid + 1\n            else:\n                hi = mid - 1\n    return -1\n',
    tests: `def test_found_after_pivot():
    assert search_rotated([4, 5, 6, 7, 0, 1, 2], 0) == 4

def test_missing():
    assert search_rotated([4, 5, 6, 7, 0, 1, 2], 3) == -1

def test_not_rotated():
    assert search_rotated([1, 2, 3, 4, 5], 4) == 3

def test_single():
    assert search_rotated([1], 1) == 0

def test_empty():
    assert search_rotated([], 5) == -1

def test_before_pivot():
    assert search_rotated([6, 7, 1, 2, 3, 4, 5], 7) == 1
`,
    complexity: { time: 'O(log n)', space: 'O(1)' },
    hints: ['Binary search still works if, at each step, you know which half is sorted.', 'Compare nums[lo] with nums[mid]: if nums[lo] <= nums[mid], the left half is sorted.', 'Check whether the target lies inside the sorted half; if so search there, otherwise the other half.'],
    followUps: ['What breaks if values can repeat?', 'How would you find the rotation point itself?']
  },
  {
    id: 'number-of-islands',
    title: 'Number of islands',
    tags: ['graphs'],
    level: 2,
    prompt: 'Given a grid of `"1"` (land) and `"0"` (water), count the islands. Land joins up, down, left and right, not diagonally.',
    examples: ['num_islands([["1","1","0"],["0","1","0"],["0","0","1"]]) == 2'],
    starter: 'def num_islands(grid: list[list[str]]) -> int:\n    pass\n',
    reference: 'from collections import deque\n\ndef num_islands(grid):\n    if not grid:\n        return 0\n    rows, cols = len(grid), len(grid[0])\n    seen = set()\n    count = 0\n    for r in range(rows):\n        for c in range(cols):\n            if grid[r][c] == "1" and (r, c) not in seen:\n                count += 1\n                q = deque([(r, c)])\n                seen.add((r, c))\n                while q:\n                    y, x = q.popleft()\n                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n                        ny, nx = y + dy, x + dx\n                        if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == "1" and (ny, nx) not in seen:\n                            seen.add((ny, nx))\n                            q.append((ny, nx))\n    return count\n',
    tests: `def test_example():
    assert num_islands([["1", "1", "0"], ["0", "1", "0"], ["0", "0", "1"]]) == 2

def test_all_water():
    assert num_islands([["0", "0"], ["0", "0"]]) == 0

def test_diagonal_is_separate():
    assert num_islands([["1", "0"], ["0", "1"]]) == 2

def test_empty_grid():
    assert num_islands([]) == 0

def test_big_island_no_recursion_limit():
    grid = [["1"] * 120 for _ in range(120)]
    assert num_islands(grid) == 1
`,
    complexity: { time: 'O(rows·cols)', space: 'O(rows·cols)' },
    hints: ['Each island is a connected group of cells. How do you visit a whole group from one cell?', 'Scan the grid; when you meet unvisited land, count one and flood-fill from it.', 'BFS with a queue avoids Python\'s recursion limit on big islands.'],
    followUps: ['Why might recursive DFS fail on a 1000×1000 grid?', 'How would you count islands that change as cells are added (union-find)?']
  },
  {
    id: 'course-schedule',
    title: 'Can every course be finished?',
    tags: ['graphs'],
    level: 2,
    prompt: 'There are `n` courses, `0` to `n - 1`. Each pair `[a, b]` in `prereqs` means you must take `b` before `a`. Return whether all courses can be finished.',
    examples: ['can_finish(2, [[1, 0]]) is True', 'can_finish(2, [[1, 0], [0, 1]]) is False'],
    starter: 'def can_finish(n: int, prereqs: list[list[int]]) -> bool:\n    pass\n',
    reference: 'from collections import deque\n\ndef can_finish(n, prereqs):\n    indeg = [0] * n\n    after = [[] for _ in range(n)]\n    for a, b in prereqs:\n        after[b].append(a)\n        indeg[a] += 1\n    q = deque(i for i in range(n) if indeg[i] == 0)\n    done = 0\n    while q:\n        x = q.popleft()\n        done += 1\n        for y in after[x]:\n            indeg[y] -= 1\n            if indeg[y] == 0:\n                q.append(y)\n    return done == n\n',
    tests: `def test_simple_chain():
    assert can_finish(2, [[1, 0]]) is True

def test_two_cycle():
    assert can_finish(2, [[1, 0], [0, 1]]) is False

def test_no_prereqs():
    assert can_finish(3, []) is True

def test_longer_cycle():
    assert can_finish(4, [[1, 0], [2, 1], [3, 2], [1, 3]]) is False

def test_self_loop():
    assert can_finish(1, [[0, 0]]) is False

def test_diamond():
    assert can_finish(4, [[1, 0], [2, 0], [3, 1], [3, 2]]) is True
`,
    complexity: { time: 'O(n + e)', space: 'O(n + e)' },
    hints: ['Model it as a directed graph. What would make finishing impossible?', 'A cycle. Courses with no prerequisites left can be taken right away.', 'Kahn\'s algorithm: count in-degrees, repeatedly take courses with in-degree 0, check you took all n.'],
    followUps: ['Return an order to take them in.', 'How would you report which courses are in the cycle?']
  },
  {
    id: 'network-delay',
    title: 'Payment network delay',
    tags: ['graphs', 'heaps', 'payments'],
    level: 3,
    prompt: 'A message about a payment starts at node `k` of a network of `n` nodes (`1` to `n`). `times[i] = [u, v, w]` means it takes `w` ms to go from `u` to `v`. Return how long until every node has heard, or `-1` if some never will.',
    examples: ['network_delay([[2, 1, 1], [2, 3, 1], [3, 4, 1]], 4, 2) == 2'],
    starter: 'def network_delay(times: list[list[int]], n: int, k: int) -> int:\n    pass\n',
    reference: 'import heapq\n\ndef network_delay(times, n, k):\n    graph = {}\n    for u, v, w in times:\n        graph.setdefault(u, []).append((v, w))\n    best = {}\n    heap = [(0, k)]\n    while heap:\n        d, u = heapq.heappop(heap)\n        if u in best:\n            continue\n        best[u] = d\n        for v, w in graph.get(u, []):\n            if v not in best:\n                heapq.heappush(heap, (d + w, v))\n    return max(best.values()) if len(best) == n else -1\n',
    tests: `def test_example():
    assert network_delay([[2, 1, 1], [2, 3, 1], [3, 4, 1]], 4, 2) == 2

def test_unreachable():
    assert network_delay([[1, 2, 1]], 2, 2) == -1

def test_single_node():
    assert network_delay([], 1, 1) == 0

def test_shorter_path_through_more_hops():
    assert network_delay([[1, 2, 10], [1, 3, 1], [3, 2, 1]], 3, 1) == 2

def test_parallel_edges():
    assert network_delay([[1, 2, 5], [1, 2, 2]], 2, 1) == 2
`,
    complexity: { time: 'O(e log n)', space: 'O(n + e)' },
    hints: ['You want the shortest time to each node, then the largest of those.', 'Weights are positive: which shortest-path algorithm fits?', 'Dijkstra with a min-heap of (time, node); skip a node once it is settled.'],
    followUps: ['What if some delays could be negative?', 'How would you also return the path to the slowest node?']
  },
  {
    id: 'coin-change',
    title: 'Fewest coins',
    tags: ['dp'],
    level: 2,
    prompt: 'Given coin values and an `amount`, return the fewest coins that make up the amount (unlimited coins of each value), or `-1` if it cannot be made.',
    examples: ['coin_change([1, 2, 5], 11) == 3  # 5 + 5 + 1'],
    starter: 'def coin_change(coins: list[int], amount: int) -> int:\n    pass\n',
    reference: 'def coin_change(coins, amount):\n    INF = amount + 1\n    best = [0] + [INF] * amount\n    for a in range(1, amount + 1):\n        for c in coins:\n            if c <= a and best[a - c] + 1 < best[a]:\n                best[a] = best[a - c] + 1\n    return best[amount] if best[amount] != INF else -1\n',
    tests: `def test_example():
    assert coin_change([1, 2, 5], 11) == 3

def test_impossible():
    assert coin_change([2], 3) == -1

def test_zero_amount():
    assert coin_change([1], 0) == 0

def test_greedy_fails():
    assert coin_change([1, 3, 4], 6) == 2

def test_larger_amount():
    assert coin_change([186, 419, 83, 408], 6249) == 20
`,
    complexity: { time: 'O(amount·coins)', space: 'O(amount)' },
    hints: ['Why does always taking the biggest coin fail for [1, 3, 4] and 6?', 'Let best[a] be the fewest coins for amount a. How does best[a] relate to smaller amounts?', 'best[a] = 1 + min(best[a - c]) over coins c <= a; start from best[0] = 0.'],
    followUps: ['Count the number of ways instead.', 'What does this look like for currency with 1p, 2p, 5p… (a canonical system)?']
  },
  {
    id: 'house-robber',
    title: 'Non-adjacent maximum',
    tags: ['dp'],
    level: 1,
    prompt: 'Given non-negative amounts in a row, pick amounts with no two next to each other so that the total is as large as possible. Return that total.',
    examples: ['max_non_adjacent([2, 7, 9, 3, 1]) == 12  # 2 + 9 + 1'],
    starter: 'def max_non_adjacent(nums: list[int]) -> int:\n    pass\n',
    reference: 'def max_non_adjacent(nums):\n    take, skip = 0, 0\n    for x in nums:\n        take, skip = skip + x, max(take, skip)\n    return max(take, skip)\n',
    tests: `def test_example():
    assert max_non_adjacent([2, 7, 9, 3, 1]) == 12

def test_empty():
    assert max_non_adjacent([]) == 0

def test_one():
    assert max_non_adjacent([5]) == 5

def test_two_big_apart():
    assert max_non_adjacent([2, 1, 1, 2]) == 4

def test_long():
    assert max_non_adjacent([1] * 1001) == 501
`,
    complexity: { time: 'O(n)', space: 'O(1)' },
    hints: ['At each amount you either take it or skip it.', 'If you take nums[i], you must have skipped nums[i-1].', 'Keep two running totals: best ending with a take, best ending with a skip.'],
    followUps: ['What if the row were a circle (first and last adjacent)?', 'Return which amounts you picked.']
  },
  {
    id: 'edit-distance',
    title: 'Edit distance',
    tags: ['dp', 'strings'],
    level: 3,
    prompt: 'Return the fewest single-character inserts, deletes or substitutions that turn `a` into `b`. (Used to match a payee name against a sanctions list.)',
    examples: ['edit_distance("horse", "ros") == 3'],
    starter: 'def edit_distance(a: str, b: str) -> int:\n    pass\n',
    reference: 'def edit_distance(a, b):\n    prev = list(range(len(b) + 1))\n    for i in range(1, len(a) + 1):\n        cur = [i] + [0] * len(b)\n        for j in range(1, len(b) + 1):\n            if a[i - 1] == b[j - 1]:\n                cur[j] = prev[j - 1]\n            else:\n                cur[j] = 1 + min(prev[j], cur[j - 1], prev[j - 1])\n        prev = cur\n    return prev[len(b)]\n',
    tests: `def test_example():
    assert edit_distance("horse", "ros") == 3

def test_identical():
    assert edit_distance("ledger", "ledger") == 0

def test_from_empty():
    assert edit_distance("", "abc") == 3

def test_to_empty():
    assert edit_distance("abc", "") == 3

def test_classic():
    assert edit_distance("intention", "execution") == 5
`,
    complexity: { time: 'O(m·n)', space: 'O(min(m, n)) with two rows' },
    hints: ['Think about the last characters of both strings.', 'If they match, the answer is the distance of the prefixes; if not, try each of the three edits.', 'dp[i][j] = dp[i-1][j-1] if a[i-1] == b[j-1] else 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]).'],
    followUps: ['Can you keep only two rows?', 'How would you allow a swap of adjacent letters to count as one edit?']
  },
  {
    id: 'lru-cache',
    title: 'LRU cache',
    tags: ['system', 'hashing'],
    level: 2,
    prompt: 'Build `LRUCache(capacity)` with `get(key)` (the value, or `-1`) and `put(key, value)`. When it is full, `put` evicts the least recently used key. Both in O(1). Reading a key counts as using it.',
    examples: ['c = LRUCache(2); c.put(1, 1); c.put(2, 2); c.get(1) == 1; c.put(3, 3)  # evicts 2'],
    starter: 'class LRUCache:\n    def __init__(self, capacity: int):\n        pass\n\n    def get(self, key: int) -> int:\n        pass\n\n    def put(self, key: int, value: int) -> None:\n        pass\n',
    reference: 'from collections import OrderedDict\n\nclass LRUCache:\n    def __init__(self, capacity):\n        self.capacity = capacity\n        self.data = OrderedDict()\n\n    def get(self, key):\n        if key not in self.data:\n            return -1\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key, value):\n        if key in self.data:\n            self.data.move_to_end(key)\n        self.data[key] = value\n        if len(self.data) > self.capacity:\n            self.data.popitem(last=False)\n',
    tests: `def test_evicts_least_recent():
    c = LRUCache(2)
    c.put(1, 1)
    c.put(2, 2)
    assert c.get(1) == 1
    c.put(3, 3)
    assert c.get(2) == -1
    assert c.get(3) == 3

def test_update_refreshes():
    c = LRUCache(2)
    c.put(1, 1)
    c.put(2, 2)
    c.put(1, 10)
    c.put(3, 3)
    assert c.get(1) == 10
    assert c.get(2) == -1

def test_capacity_one():
    c = LRUCache(1)
    c.put(1, 1)
    c.put(2, 2)
    assert c.get(1) == -1
    assert c.get(2) == 2

def test_missing_key():
    assert LRUCache(3).get(42) == -1
`,
    complexity: { time: 'O(1) per operation', space: 'O(capacity)' },
    hints: ['You need O(1) lookup and O(1) "move to most recent". Which two structures give you each?', 'A dict for lookup plus a doubly linked list (or OrderedDict) for recency.', 'On get and put, move the key to the end; when over capacity, pop from the front.'],
    followUps: ['How would you make it safe for many threads?', 'How would you add a time-to-live per key?']
  },
  {
    id: 'token-bucket',
    title: 'Token bucket rate limiter',
    tags: ['system'],
    level: 2,
    prompt: 'Build `TokenBucket(capacity, rate)` for an API gateway. It starts full with `capacity` tokens and refills at `rate` tokens per second, never above `capacity`. `allow(now)` is called with the time in seconds (never decreasing): it spends one token and returns `True`, or returns `False` if there is less than one token.',
    examples: ['b = TokenBucket(2, 1); b.allow(0) is True; b.allow(0) is True; b.allow(0) is False; b.allow(1) is True'],
    starter: 'class TokenBucket:\n    def __init__(self, capacity: int, rate: float):\n        pass\n\n    def allow(self, now: float) -> bool:\n        pass\n',
    reference: 'class TokenBucket:\n    def __init__(self, capacity, rate):\n        self.capacity = capacity\n        self.rate = rate\n        self.tokens = float(capacity)\n        self.last = None\n\n    def allow(self, now):\n        if self.last is not None:\n            self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)\n        self.last = now\n        if self.tokens >= 1:\n            self.tokens -= 1\n            return True\n        return False\n',
    tests: `def test_burst_then_refuse():
    b = TokenBucket(2, 1)
    assert b.allow(0) is True
    assert b.allow(0) is True
    assert b.allow(0) is False

def test_refills_over_time():
    b = TokenBucket(1, 2)
    assert b.allow(0) is True
    assert b.allow(0.25) is False
    assert b.allow(0.5) is True

def test_never_above_capacity():
    b = TokenBucket(2, 10)
    assert b.allow(0) is True
    assert b.allow(100) is True
    assert b.allow(100) is True
    assert b.allow(100) is False

def test_fractional_tokens_accumulate():
    b = TokenBucket(1, 0.5)
    assert b.allow(0) is True
    assert b.allow(1) is False
    assert b.allow(2) is True
`,
    complexity: { time: 'O(1) per call', space: 'O(1)' },
    hints: ['You don\'t need a timer: work out the refill from the time since the last call.', 'tokens = min(capacity, tokens + elapsed × rate), then spend one if you can.', 'Keep tokens as a float and remember the last time you were called.'],
    followUps: ['How would this work across many gateway servers?', 'Compare it with a sliding-window log. Which is fairer at window edges?']
  },
  {
    id: 'ledger',
    title: 'Double-entry ledger with idempotency',
    tags: ['system', 'payments', 'hashing'],
    level: 2,
    prompt: 'Build `Ledger()` with `transfer(key, src, dst, amount)` and `balance(account)`. Amounts are integer pence and must be positive. Accounts start at 0. Every transfer debits `src` and credits `dst`. Only the account `"world"` (money from outside) may go below zero: any other transfer that would overdraw returns `False` and posts nothing. `key` is an idempotency key: retrying the same key with the same details returns the first result without posting again; the same key with different details raises `ValueError`.',
    examples: ['l = Ledger(); l.transfer("k1", "world", "alice", 500) is True; l.balance("alice") == 500'],
    starter: 'class Ledger:\n    def __init__(self):\n        pass\n\n    def transfer(self, key: str, src: str, dst: str, amount: int) -> bool:\n        pass\n\n    def balance(self, account: str) -> int:\n        pass\n',
    reference: 'class Ledger:\n    def __init__(self):\n        self.balances = {}\n        self.seen = {}\n\n    def transfer(self, key, src, dst, amount):\n        details = (src, dst, amount)\n        if key in self.seen:\n            first, result = self.seen[key]\n            if first != details:\n                raise ValueError("idempotency key reused with different details")\n            return result\n        if not isinstance(amount, int) or amount <= 0:\n            raise ValueError("amount must be a positive integer")\n        ok = src == "world" or self.balance(src) >= amount\n        if ok:\n            self.balances[src] = self.balance(src) - amount\n            self.balances[dst] = self.balance(dst) + amount\n        self.seen[key] = (details, ok)\n        return ok\n\n    def balance(self, account):\n        return self.balances.get(account, 0)\n',
    tests: `def test_funding_from_world():
    l = Ledger()
    assert l.transfer("k1", "world", "alice", 500) is True
    assert l.balance("alice") == 500
    assert l.balance("world") == -500

def test_no_overdraft():
    l = Ledger()
    l.transfer("k1", "world", "alice", 100)
    assert l.transfer("k2", "alice", "bob", 150) is False
    assert l.balance("alice") == 100
    assert l.balance("bob") == 0

def test_retry_posts_once():
    l = Ledger()
    l.transfer("k1", "world", "alice", 100)
    assert l.transfer("k2", "alice", "bob", 60) is True
    assert l.transfer("k2", "alice", "bob", 60) is True
    assert l.balance("alice") == 40
    assert l.balance("bob") == 60

def test_key_reuse_with_other_details():
    l = Ledger()
    l.transfer("k1", "world", "alice", 100)
    try:
        l.transfer("k1", "world", "alice", 200)
    except ValueError:
        return
    assert False, "expected ValueError"

def test_books_balance():
    l = Ledger()
    l.transfer("a", "world", "alice", 1000)
    l.transfer("b", "alice", "bob", 300)
    l.transfer("c", "bob", "carol", 100)
    assert sum(l.balance(x) for x in ["world", "alice", "bob", "carol"]) == 0

def test_refused_transfer_is_also_idempotent():
    l = Ledger()
    assert l.transfer("k9", "alice", "bob", 10) is False
    l.transfer("k1", "world", "alice", 100)
    assert l.transfer("k9", "alice", "bob", 10) is False
    assert l.balance("bob") == 0
`,
    complexity: { time: 'O(1) per transfer', space: 'O(accounts + keys)' },
    hints: ['Keep two maps: balances, and what each idempotency key did.', 'Check the key first: a retry must return the stored result before any balance check.', 'Store (details, result) per key; compare details on a retry and raise if they differ.'],
    followUps: ['How would you make the transfer atomic across two database rows?', 'How long do you keep idempotency keys, and what happens after?', 'Why store amounts as integer pence, not floats?']
  },
  {
    id: 'reconcile',
    title: 'Reconcile ledger against bank statement',
    tags: ['payments', 'hashing', 'system'],
    level: 2,
    prompt: 'Given `ledger` and `bank`, two lists of `{"id": str, "amount": int}` entries (ids unique within each list), return a dict with four sorted id lists: `"matched"` (in both, same amount), `"amount_mismatch"` (in both, different amounts), `"missing_in_bank"` and `"missing_in_ledger"`.',
    examples: ['reconcile([{"id": "a", "amount": 5}], [{"id": "a", "amount": 5}])["matched"] == ["a"]'],
    starter: 'def reconcile(ledger: list[dict], bank: list[dict]) -> dict:\n    pass\n',
    reference: 'def reconcile(ledger, bank):\n    l = {e["id"]: e["amount"] for e in ledger}\n    b = {e["id"]: e["amount"] for e in bank}\n    return {\n        "matched": sorted(i for i in l if i in b and l[i] == b[i]),\n        "amount_mismatch": sorted(i for i in l if i in b and l[i] != b[i]),\n        "missing_in_bank": sorted(i for i in l if i not in b),\n        "missing_in_ledger": sorted(i for i in b if i not in l),\n    }\n',
    tests: `def test_all_cases():
    ledger = [{"id": "p1", "amount": 100}, {"id": "p2", "amount": 250}, {"id": "p3", "amount": 75}]
    bank = [{"id": "p1", "amount": 100}, {"id": "p2", "amount": 205}, {"id": "p4", "amount": 30}]
    out = reconcile(ledger, bank)
    assert out["matched"] == ["p1"]
    assert out["amount_mismatch"] == ["p2"]
    assert out["missing_in_bank"] == ["p3"]
    assert out["missing_in_ledger"] == ["p4"]

def test_empty():
    out = reconcile([], [])
    assert out == {"matched": [], "amount_mismatch": [], "missing_in_bank": [], "missing_in_ledger": []}

def test_sorted_output():
    ledger = [{"id": "b", "amount": 1}, {"id": "a", "amount": 1}]
    out = reconcile(ledger, ledger)
    assert out["matched"] == ["a", "b"]

def test_large_is_fast():
    ledger = [{"id": str(i), "amount": i} for i in range(50000)]
    bank = [{"id": str(i), "amount": i} for i in range(1, 50001)]
    out = reconcile(ledger, bank)
    assert out["missing_in_bank"] == ["0"]
    assert out["missing_in_ledger"] == ["50000"]
`,
    complexity: { time: 'O(n log n) for the sorted output', space: 'O(n)' },
    hints: ['Comparing every entry with every other is O(n²). How can you look an id up quickly?', 'Build a dict from id to amount for each side.', 'Walk the ledger dict to sort into matched, mismatch and missing-in-bank; then walk the bank dict for missing-in-ledger.'],
    followUps: ['What if the bank batches several ledger payments into one line?', 'How do you handle timing differences (a payment settles the next day)?']
  }
]

export const BANK_TAGS: BankTag[] = ['arrays', 'hashing', 'strings', 'sliding window', 'sorting', 'binary search', 'graphs', 'dp', 'heaps', 'system', 'payments']

export const bankProblem = (id: string) => BANK.find((p) => p.id === id)

/**
 * The learner's level from their last coding mocks (0..1 scores, oldest first): start at 2,
 * step up after two strong results in a row, down after two weak ones.
 */
export function levelFrom(scores: number[]): BankLevel {
  if (!scores.length) return 2
  const last = scores.slice(-2)
  const avg = scores.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, scores.length)
  if (last.length === 2 && last.every((s) => s >= 0.8)) return 3
  if (last.length === 2 && last.every((s) => s < 0.45)) return 1
  return avg >= 0.85 ? 3 : avg < 0.35 ? 1 : 2
}

/**
 * Picks a problem: at the level, on one of the tags when any are asked for, one not done
 * recently first. The seed makes it repeatable (tests; a "same again").
 */
export function pickProblem(o: { level: BankLevel; tags?: BankTag[]; recent?: string[]; seed?: number }, bank: BankProblem[] = BANK): BankProblem {
  const recent = new Set(o.recent ?? [])
  const tagged = o.tags?.length ? bank.filter((p) => p.tags.some((t) => o.tags!.includes(t))) : bank
  const pool = tagged.length ? tagged : bank
  const byDistance = (d: number) => pool.filter((p) => Math.abs(p.level - o.level) === d)
  for (const d of [0, 1, 2]) {
    const at = byDistance(d)
    const fresh = at.filter((p) => !recent.has(p.id))
    const from = fresh.length ? fresh : d === 2 || !pool.some((p) => !recent.has(p.id)) ? at : []
    if (from.length) {
      const seed = Math.abs(Math.floor(o.seed ?? Date.now()))
      return from[seed % from.length]
    }
  }
  return pool[0]
}

/** The statement as shown: the prompt, then the examples */
export const problemText = (p: BankProblem) => `${p.prompt}\n\n${p.examples.map((e) => `\`${e}\``).join('\n\n')}`

/** What the window gets of a problem: never the reference or the tests */
export type PublicProblem = Omit<BankProblem, 'reference' | 'tests' | 'hints'> & { hintCount: number; testNames: string[] }

export function publicProblem(p: BankProblem): PublicProblem {
  const { reference: _r, tests, hints, ...rest } = p
  void _r
  return { ...rest, hintCount: hints.length, testNames: [...tests.matchAll(/^def\s+test_?(\w*)\s*\(/gm)].map((m) => m[1].replace(/_/g, ' ')) }
}
