/**
 * Hidden tests for a code question the tutor set without any (shared/codeTests): made from its
 * reference solution, and kept only where the reference passes them.
 */
import { fenced, pythonFunctions, referencePrompt, readsStdin, solutionCode, splitTestFunctions, testsPrompt, TESTS_SYSTEM, untestedCodeAsk } from '@shared/codeTests'
import { solutionOf } from '@shared/lessonCheck'
import type { RunResult } from '@shared/types'

export interface TestsIO {
  /** A short separate request to the model */
  ask: (prompt: string, system: string) => Promise<string>
  /** Tide's sandbox (main/runner.runCode) */
  run: (lang: string, code: string, stdin: string, opts?: { tests?: string }) => Promise<RunResult>
}

const MAX = 6

/**
 * Tests for the code question `reply` ends on, as a tests field (pytest functions, or JSON input and
 * output cases), or null when there's no untested code question, no reference code, or nothing the
 * reference passes. Programs that read input: the model gives inputs, the reference gives the
 * expected outputs. Python functions: the model writes pytest functions, the reference must pass
 * each. Anything else: what the reference prints, as one case.
 */
export async function deriveTests(reply: string, io: TestsIO): Promise<string | null> {
  return (await testsFor(reply, io))?.tests ?? null
}

/**
 * As deriveTests, and when the tutor wrote no reference code (seen live: a code question with only a
 * starter in it), the reference is asked for in a short request first and given back as `solution`,
 * to be kept hidden with the reply so the answer is marked against it too.
 */
export async function testsFor(reply: string, io: TestsIO): Promise<{ tests: string; solution?: string } | null> {
  const ask = untestedCodeAsk(reply)
  if (!ask) return null
  let code = solutionCode(solutionOf(reply))
  let solution: string | undefined
  if (!code) {
    const out = await io.ask(referencePrompt(ask.prompt, ask.lang), TESTS_SYSTEM).catch(() => '')
    code = solutionCode(out)
    if (!code) return null
    // Kept only if it runs
    const ran = readsStdin(code) ? null : await io.run(ask.lang, code, '').catch(() => null)
    if (ran && (ran.exitCode !== 0 || ran.timedOut)) return null
    solution = `\`\`\`${ask.lang}\n${code}\n\`\`\``
  }
  const tests = await derive(ask, code, io)
  return tests ? { tests, ...(solution ? { solution } : {}) } : null
}

async function derive(ask: { lang: string; prompt: string }, code: string, io: TestsIO): Promise<string | null> {
  const python = /^(python|py|python3)$/.test(ask.lang)
  const stdin = readsStdin(code)

  if (stdin || !python) {
    let inputs: { name: string; stdin: string }[] = []
    if (stdin) {
      const out = await io.ask(testsPrompt(ask.prompt, code, ask.lang, true), TESTS_SYSTEM).catch(() => '')
      try {
        const raw = JSON.parse(fenced(out, 'json')) as unknown
        if (Array.isArray(raw)) inputs = raw.flatMap((c, i) => (c && typeof c === 'object' ? [{ name: String((c as { name?: unknown }).name ?? `case ${i + 1}`).slice(0, 60), stdin: String((c as { stdin?: unknown; input?: unknown }).stdin ?? (c as { input?: unknown }).input ?? '') }] : []))
      } catch {
        inputs = []
      }
    } else inputs = [{ name: 'prints the expected output', stdin: '' }]
    const cases: { name: string; stdin: string; expect: string }[] = []
    for (const c of inputs.slice(0, MAX)) {
      const r = await io.run(ask.lang, code, c.stdin).catch(() => null)
      if (!r || r.exitCode !== 0 || r.timedOut || !r.stdout.trim()) continue
      if (cases.some((k) => k.stdin === c.stdin)) continue
      cases.push({ name: c.name, stdin: c.stdin, expect: r.stdout.trim() })
    }
    return cases.length ? JSON.stringify(cases) : null
  }

  // A Python function: pytest functions from the model, kept where the reference passes
  if (!pythonFunctions(code).length) return null
  const out = await io.ask(testsPrompt(ask.prompt, code, ask.lang, false), TESTS_SYSTEM).catch(() => '')
  const { preamble, tests } = splitTestFunctions(fenced(out, 'python').replace(/^\s*(from answer import \*|import answer)\s*$/gm, ''))
  if (!tests.length) return null
  const all = [preamble, ...tests.slice(0, MAX).map((t) => t.code)].filter(Boolean).join('\n\n')
  const r = await io.run('python', code, '', { tests: all }).catch(() => null)
  const passed = new Set(r?.tests?.passed ?? [])
  const kept = tests.slice(0, MAX).filter((t) => passed.has(t.name))
  return kept.length ? [preamble, ...kept.map((t) => t.code)].filter(Boolean).join('\n\n') : null
}
