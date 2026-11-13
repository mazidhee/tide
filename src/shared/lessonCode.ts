/**
 * Coding lessons with the IDE's Claude tools. A lesson learnt by writing code has a folder of its
 * own (main/ide/lesson): each code question's answer is a file in it, and on Claude the tutor
 * reads, runs and reviews those files with the IDE's confined tools, proposing edits the learner
 * keeps or undoes hunk by hunk. Pure, so the lesson screen, main and the tests agree.
 */
import type { SessionSetup } from './session'
import { profileSubject } from './subjects'

/** A lesson the tutor can work on the learner's code in: a teach session on something learnt by building */
export function isCodingLesson(setup: Pick<SessionSetup, 'mode' | 'topic' | 'options'>): boolean {
  if (setup.mode !== 'teach') return false
  const o = setup.options
  if (o?.codeRoot || o?.strategy === 'code') return true
  if (o?.curiosity || o?.placement || o?.check || o?.review) return false
  const p = o?.subject ?? profileSubject(setup.topic)
  return !!p.hands && p.kinds.includes('build')
}

const EXT: Record<string, string> = { python: 'py', py: 'py', javascript: 'js', js: 'js', node: 'js', typescript: 'ts', ts: 'ts', c: 'c', cpp: 'cpp', 'c++': 'cpp', rust: 'rs', rs: 'rs', go: 'go', golang: 'go', bash: 'sh', sh: 'sh', zsh: 'sh', shell: 'sh', sql: 'sql', java: 'java', ruby: 'rb', rb: 'rb', swift: 'swift' }

/** The file a lesson's nth code question (from 1) is answered in, e.g. exercise-2.py */
export function exerciseFile(n: number, lang = 'python'): string {
  return `exercise-${Math.max(1, Math.round(n) || 1)}.${EXT[lang.trim().toLowerCase()] ?? 'txt'}`
}

/** Which code question each is, in order of first appearance: the nth is answered in exercise-n */
export function exerciseNumber(seen: string[], identity: string): number {
  const at = seen.indexOf(identity)
  return at >= 0 ? at + 1 : seen.length + 1
}

/**
 * The tutor's rules for a coding lesson on Claude, beside its lesson rules. In the system prompt,
 * the same for the whole lesson, so it stays in the prompt cache: keep it short.
 */
export const CLAUDE_CODE_LESSON_NOTE = `This is a coding lesson with its own folder of files. Each code question's answer is saved there as exercise-N (each message says which file their editor shows). Tide's code tools work on that folder only:
- See their code with read_file, list_files, search_code and get_diagnostics. Run it yourself with run_tests or run_command (a sandboxed copy, no network) before you judge it: every time you mark, review or are asked to check or run it, in that same turn. Go by what it printed. A mark or test summary from Tide is a second opinion, never a reason to skip the run.
- Review, don't rewrite: put each point on its line with add_review_comment (issue, suggestion, question or praise) and give a hint or a question; open_in_editor shows them a line.
- propose_edit or write_file only when they ask for code, or after a real attempt that is still stuck. Keep it small and say in a sentence what each change does and why; they keep or undo each change, so don't paste the same code in your reply.
- For a find-the-bug exercise, plant_bug writes one realistic bug into a file without showing them. Then give the symptom, never where it is.`

/** The learner asks for their code to be run, checked or reviewed, in so many words */
export const asksToRunCode = (said: string) =>
  /\b(run|re-?run|execute|tests|check|review|mark|grade|debug)\b|\b(look (at|over)|does (it|this|my code) work|is (it|this|my (code|answer|solution)) (right|correct|ok|okay)|what['’]?s wrong|why (does|doesn['’]?t|isn['’]?t|won['’]?t))\b/i.test(said)

/** Said with a coding lesson's message when the tutor must run the code before it judges (main/claudeEngine) */
export const RUN_FIRST_NOTE = '(Tide: run their code yourself now with run_tests or run_command, before you judge it, and go by what it prints. Any mark or test summary above is a second opinion.)'

/** Said when a turn that had to run the code judged it without running it: the tutor runs it and corrects itself */
export const RAN_NOTHING_NOTE = '(Tide: you judged their code without running it. Run it now with run_tests or run_command, then say in a sentence or two whether the run agrees with what you said, and correct anything it contradicts.)'

/** The tool calls that count as running the learner's code */
export const RUN_TOOLS = /(^|__)(run_tests|run_command|run_code)$/

/** The same rules for Claude in the IDE, when the folder open there is a lesson's */
export const IDE_LESSON_NOTE = `This folder is the learner's coding lesson. Teach as their tutor does: run their code before judging it, review with add_review_comment and hints rather than rewriting it, and propose edits only when they ask or after a real attempt, explaining each change.`

/** What the tutor is told with each message of a coding lesson: the file on screen, and what became of its proposals */
export function codeTurnNote(file: string | undefined, notes: string[]): string {
  const parts = [file ? `their editor shows ${file}` : '', ...notes.map((n) => n.replace(/\.$/, ''))].filter(Boolean)
  return parts.length ? `(Tide: ${parts.join('; ')}.)` : ''
}
