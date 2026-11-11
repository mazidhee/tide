import { hideWorking } from './session'

/**
 * Hidden tests for a code question, made by Tide when the tutor wrote none (Gemma never wrote a
 * ```tests block in the rehearsal, so every code answer was marked by eye). They come from the
 * tutor's reference solution: inputs are asked for in a short separate request, and only cases the
 * reference passes are kept (main/codeTests.ts). They ride with the reply as a hidden <tests> tag.
 */

/** The code question a reply ends on, when it has no hidden tests yet. SQL is checked in the lab instead. */
export function untestedCodeAsk(reply: string): { lang: string; prompt: string } | null {
  const asks = [...hideWorking(reply).matchAll(/<ask\b([^>]*)>([\s\S]*?)<\/ask>/gi)]
  const m = asks[asks.length - 1]
  if (!m || !/type\s*=\s*["']?code/i.test(m[1])) return null
  if (/```tests/i.test(m[2]) || /<tests\b/i.test(reply)) return null
  const lang = (/lang\s*=\s*["']?([\w+#-]+)/i.exec(m[1])?.[1] ?? 'python').toLowerCase()
  if (/^(sql|sqlite)$/.test(lang)) return null
  // The task is often said just before the ask, which holds only a starter ("Write a function that…")
  const before = hideWorking(reply).slice(0, m.index).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim().split(/\n\s*\n/).pop()?.trim() ?? ''
  return { lang, prompt: [before.slice(-600), m[2].trim()].filter(Boolean).join('\n\n') }
}

/** The reference solution's code: its last fenced block, or the solution itself when it is code */
export function solutionCode(solution: string): string | null {
  const blocks = [...solution.matchAll(/```[\w+#-]*[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd())
  if (blocks.length) return blocks[blocks.length - 1]
  const t = solution.trim()
  return /^(def |class |import |from |#include|fn |func |function |const |let |public |package |print\(|for |while |if )/m.test(t) && t.split('\n').length >= 1 && !/^\d+\.\s/m.test(t) ? t : null
}

/** A program that reads its input (and so is tested on stdin and stdout), not a function to call */
export const readsStdin = (code: string) => /\binput\s*\(|sys\.stdin|\bscanf\b|\bcin\s*>>|readLine|getline|bufio\.NewScanner|process\.stdin|read_line|gets\b|Scanner\(System\.in\)/.test(code)

/** The definitions a Python reference offers to be called */
export const pythonFunctions = (code: string) => [...code.matchAll(/^def\s+([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]).filter((n) => !n.startsWith('_') && !n.startsWith('test'))

export const TESTS_SYSTEM = 'You write small, exact unit tests. Reply with only what is asked, in one fenced block.'

/** Asked of the model: tests for a function question (pytest functions) or inputs for a program (JSON) */
export function testsPrompt(question: string, code: string, lang: string, io: boolean): string {
  if (io)
    return `A student has been asked:\n${question}\n\nThe reference ${lang} program:\n\`\`\`${lang}\n${code}\n\`\`\`\n\nGive 4 inputs to test an answer with: ordinary ones and edge cases. Reply with only a \`\`\`json block: [{"name": "short description", "stdin": "the input"}]. No expected outputs: Tide runs the reference to get them.`
  return `A student has been asked:\n${question}\n\nThe reference solution:\n\`\`\`python\n${code}\n\`\`\`\n\nWrite 4 pytest test functions that check an answer to exactly this question: ordinary cases and edge cases, each a def test_<what_it_checks>(): with plain asserts, calling ${pythonFunctions(code).join(', ') || 'the function the question asks for'} by name. Don't import the solution (its names are already there). Reply with only a \`\`\`python block.`
}

/** Python test code cut into its preamble and its test functions, each with its name */
export function splitTestFunctions(code: string): { preamble: string; tests: { name: string; code: string }[] } {
  const lines = code.replace(/\r\n?/g, '\n').split('\n')
  const starts = lines.flatMap((l, i) => (/^def\s+test\w*\s*\(/.test(l) ? [i] : []))
  if (!starts.length) return { preamble: code.trim(), tests: [] }
  // A decorator above a test belongs to it
  const begin = starts.map((i) => {
    let j = i
    while (j > 0 && /^@/.test(lines[j - 1])) j--
    return j
  })
  const preamble = lines.slice(0, begin[0]).join('\n').trim()
  const tests = begin.map((b, k) => {
    const end = k + 1 < begin.length ? begin[k + 1] : lines.length
    const body = lines.slice(b, end).join('\n').trimEnd()
    return { name: /def\s+(test\w*)/.exec(lines[starts[k]])![1], code: body }
  })
  return { preamble, tests }
}

/** The fenced block of a reply, by language (json, python), or the whole reply */
export function fenced(out: string, lang: string): string {
  const m = new RegExp('```(?:' + lang + ')?[ \\t]*\\n([\\s\\S]*?)```', 'i').exec(out)
  return (m ? m[1] : out).trim()
}

/** What the learner is shown of the hidden tests: their names, readable ("test_handles_empty_list" → "handles empty list") */
export function testNames(tests: string): string[] {
  const t = tests.trim()
  if (t.startsWith('[')) {
    try {
      const cases = JSON.parse(t) as { name?: string }[]
      if (Array.isArray(cases)) return cases.map((c, i) => (typeof c?.name === 'string' && c.name.trim() ? c.name.trim() : `case ${i + 1}`))
    } catch {
      return []
    }
  }
  return [...t.matchAll(/^def\s+test_?(\w*)\s*\(/gm)].map((m) => m[1].replace(/_/g, ' ').trim() || 'test')
}

/** Asked of the model when a code question came with no reference code: the reference, complete and short */
export const referencePrompt = (question: string, lang: string) =>
  `A student has been asked:\n${question}\n\nWrite the reference solution in ${lang}: complete, short and correct, with no example calls, prints or tests unless the question asks for output. Reply with only a \`\`\`${lang} block.`
