import { existsSync, promises as fs } from 'fs'
import type { ChatScope, PracticeProblem, PracticeStatus } from '@shared/types'
import { absPath, joinRel, writeText } from './vault'

/**
 * Coding practice: problems grouped by pattern, with an interview history per problem.
 * Struggled problems come back sooner, clean solves later, like flashcards for whole problems.
 */

const FILE = joinRel('.tide', 'practice.json')
const DAY = 86_400_000

export const CHALLENGES = 'Topic challenges'

export const PATTERNS = [
  CHALLENGES,
  'Arrays & hashing',
  'Two pointers',
  'Sliding window',
  'Stack',
  'Binary search',
  'Linked list',
  'Trees',
  'Tries',
  'Heap / priority queue',
  'Backtracking',
  'Graphs',
  'Advanced graphs',
  '1-D dynamic programming',
  '2-D dynamic programming',
  'Greedy',
  'Intervals',
  'Math & geometry',
  'Bit manipulation'
]

/** A classic starter set: well-known problems that cover every pattern once or twice */
const STARTER: [string, PracticeProblem['difficulty'], string][] = [
  ['Two Sum', 'easy', 'Arrays & hashing'],
  ['Contains Duplicate', 'easy', 'Arrays & hashing'],
  ['Group Anagrams', 'medium', 'Arrays & hashing'],
  ['Top K Frequent Elements', 'medium', 'Arrays & hashing'],
  ['Product of Array Except Self', 'medium', 'Arrays & hashing'],
  ['Longest Consecutive Sequence', 'medium', 'Arrays & hashing'],
  ['Valid Palindrome', 'easy', 'Two pointers'],
  ['3Sum', 'medium', 'Two pointers'],
  ['Container With Most Water', 'medium', 'Two pointers'],
  ['Trapping Rain Water', 'hard', 'Two pointers'],
  ['Best Time to Buy and Sell Stock', 'easy', 'Sliding window'],
  ['Longest Substring Without Repeating Characters', 'medium', 'Sliding window'],
  ['Minimum Window Substring', 'hard', 'Sliding window'],
  ['Valid Parentheses', 'easy', 'Stack'],
  ['Min Stack', 'medium', 'Stack'],
  ['Daily Temperatures', 'medium', 'Stack'],
  ['Binary Search', 'easy', 'Binary search'],
  ['Search in Rotated Sorted Array', 'medium', 'Binary search'],
  ['Koko Eating Bananas', 'medium', 'Binary search'],
  ['Reverse Linked List', 'easy', 'Linked list'],
  ['Merge Two Sorted Lists', 'easy', 'Linked list'],
  ['Linked List Cycle', 'easy', 'Linked list'],
  ['LRU Cache', 'medium', 'Linked list'],
  ['Invert Binary Tree', 'easy', 'Trees'],
  ['Maximum Depth of Binary Tree', 'easy', 'Trees'],
  ['Binary Tree Level Order Traversal', 'medium', 'Trees'],
  ['Validate Binary Search Tree', 'medium', 'Trees'],
  ['Implement Trie (Prefix Tree)', 'medium', 'Tries'],
  ['Kth Largest Element in an Array', 'medium', 'Heap / priority queue'],
  ['Merge k Sorted Lists', 'hard', 'Heap / priority queue'],
  ['Subsets', 'medium', 'Backtracking'],
  ['Combination Sum', 'medium', 'Backtracking'],
  ['Word Search', 'medium', 'Backtracking'],
  ['Number of Islands', 'medium', 'Graphs'],
  ['Clone Graph', 'medium', 'Graphs'],
  ['Course Schedule', 'medium', 'Graphs'],
  ['Network Delay Time', 'medium', 'Advanced graphs'],
  ['Climbing Stairs', 'easy', '1-D dynamic programming'],
  ['House Robber', 'medium', '1-D dynamic programming'],
  ['Coin Change', 'medium', '1-D dynamic programming'],
  ['Longest Increasing Subsequence', 'medium', '1-D dynamic programming'],
  ['Unique Paths', 'medium', '2-D dynamic programming'],
  ['Longest Common Subsequence', 'medium', '2-D dynamic programming'],
  ['Jump Game', 'medium', 'Greedy'],
  ['Merge Intervals', 'medium', 'Intervals'],
  ['Non-overlapping Intervals', 'medium', 'Intervals'],
  ['Rotate Image', 'medium', 'Math & geometry'],
  ['Single Number', 'easy', 'Bit manipulation'],
  ['Number of 1 Bits', 'easy', 'Bit manipulation']
]

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const leetcodeUrl = (title: string) => `https://leetcode.com/problems/${slug(title)}/`

const SMALL_WORDS = new Set(['of', 'in', 'and', 'to', 'a', 'an', 'the', 'with', 'from', 'by', 'or', 'on', 'at'])

/** "https://leetcode.com/problems/search-in-rotated-sorted-array/" → "Search in Rotated Sorted Array" */
export function titleFromUrl(url: string): string | null {
  const m = url.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i)
  if (!m) return null
  return m[1]
    .split('-')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

async function load(): Promise<PracticeProblem[]> {
  try {
    return existsSync(absPath(FILE)) ? JSON.parse(await fs.readFile(absPath(FILE), 'utf8')) : []
  } catch {
    return []
  }
}

const save = (list: PracticeProblem[]) => writeText(FILE, JSON.stringify(list, null, 1))

/** Status follows the schedule: anything past its due date is ready to redo */
const withDue = (p: PracticeProblem, now = Date.now()): PracticeProblem => (p.due && p.due <= now && p.status !== 'todo' ? { ...p, status: 'redo' } : p)

export async function listProblems(): Promise<PracticeProblem[]> {
  return (await load()).map((p) => withDue(p))
}

export async function addProblem(input: { title?: string; url?: string; difficulty?: PracticeProblem['difficulty']; patterns?: string[] }): Promise<PracticeProblem> {
  const list = await load()
  const title = (input.title?.trim() || (input.url ? titleFromUrl(input.url) : null) || input.url || '').trim()
  if (!title) throw new Error('Give the problem a name or a LeetCode link.')
  const existing = list.find((p) => p.title.toLowerCase() === title.toLowerCase())
  if (existing) return existing
  const problem: PracticeProblem = {
    id: slug(title) || Math.random().toString(36).slice(2, 10),
    title,
    url: input.url?.trim() || leetcodeUrl(title),
    difficulty: input.difficulty ?? 'medium',
    patterns: input.patterns?.length ? input.patterns : ['Arrays & hashing'],
    status: 'todo',
    attempts: [],
    addedAt: Date.now()
  }
  await save([...list, problem])
  return problem
}

/** A challenge Tide invents from something you studied; retrying it gives a fresh challenge on the same material */
export async function addChallenge(input: { title: string; source: ChatScope; difficulty?: PracticeProblem['difficulty'] }): Promise<PracticeProblem> {
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!title) throw new Error('Say what the challenge should be about.')
  const list = await load()
  const existing = list.find((p) => p.kind === 'challenge' && p.title.toLowerCase() === title.toLowerCase())
  if (existing) return existing
  const problem: PracticeProblem = {
    id: `ch-${slug(title) || Math.random().toString(36).slice(2, 10)}`,
    title,
    url: '',
    kind: 'challenge',
    source: input.source,
    difficulty: input.difficulty ?? 'medium',
    patterns: [CHALLENGES],
    status: 'todo',
    attempts: [],
    addedAt: Date.now()
  }
  await save([...list, problem])
  return problem
}

export async function addStarterSet(): Promise<number> {
  const list = await load()
  const have = new Set(list.map((p) => p.title.toLowerCase()))
  const added = STARTER.filter(([t]) => !have.has(t.toLowerCase())).map(
    ([title, difficulty, pattern]): PracticeProblem => ({ id: slug(title), title, url: leetcodeUrl(title), difficulty, patterns: [pattern], status: 'todo', attempts: [], addedAt: Date.now() })
  )
  await save([...list, ...added])
  return added.length
}

export async function updateProblem(id: string, patch: Partial<Pick<PracticeProblem, 'difficulty' | 'patterns' | 'status' | 'notes' | 'title' | 'url'>>) {
  const list = await load()
  await save(list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

export async function removeProblem(id: string) {
  await save((await load()).filter((p) => p.id !== id))
}

/**
 * Records an interview result. A clean solve (>= 80%) is due again in 7, 14, 30, then 60 days as
 * clean solves repeat; anything weaker is marked struggled and comes back in 2 days.
 */
export async function recordInterview(id: string, score: number, summary: string): Promise<PracticeProblem | null> {
  const list = await load()
  const p = list.find((x) => x.id === id)
  if (!p) return null
  const now = Date.now()
  const clean = score >= 0.8
  const streak = clean ? [...p.attempts].reverse().findIndex((a) => a.score < 0.8) : 0
  const cleanRun = clean ? (streak === -1 ? p.attempts.length : streak) + 1 : 0
  const days = clean ? [7, 14, 30, 60].at(Math.min(cleanRun - 1, 3))! : 2
  const status: PracticeStatus = clean ? 'solved' : 'struggled'
  const next = { ...p, status, due: now + days * DAY, attempts: [...p.attempts, { at: now, score, summary: summary.slice(0, 500) }] }
  await save(list.map((x) => (x.id === id ? next : x)))
  return next
}
