/**
 * A miss in a placement check ("What I already know: …") is "not learned yet", not a mistake: it
 * makes no mistake, retest, recall question or card, older ones stay out of Daily practice,
 * retests and recall until what they ask about is taught, and a check only asks about its own
 * topics (no recall tools, nothing due from elsewhere).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-placement-misses-'))
mkdirSync(join(dir, '.tide'), { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, libraryFolder: 'Library', ai: { claude: {} } }), updateSettings: () => {} }))
// What the learner model says has been studied: only binary so far
const studied = vi.hoisted(() => ({ list: [{ name: 'Binary, hexadecimal, number representations' }] as { name: string }[] }))
vi.mock('../src/main/knowledge', async (orig) => ({ ...(await orig<typeof import('../src/main/knowledge')>()), studiedConcepts: async () => studied.list }))

const P = await import('../src/shared/placement')
const G = await import('../src/shared/tutorGuide')
const { buildDaily } = await import('../src/shared/daily')

// The shapes from the learner's own .tide (mistakes.json)
const cpuMistake = {
  id: 'aeabe91a',
  at: 1794482764798,
  topic: 'What I already know: How Computers Work',
  path: 'Software Engineering',
  source: 'quiz' as const,
  question: 'Which sequence best describes how the CPU carries out this instruction?',
  answer: 'i dont know, i literally learning from scratch',
  fix: 'You said you are learning from scratch.',
  status: 'open' as const,
  streak: 0,
  due: '2026-01-01'
}
const binaryMistake = { ...cpuMistake, id: '4fe334ea', topic: 'Binary, hexadecimal, number representations', source: 'lesson' as const, question: 'Convert the decimal number 21 into a binary number.', path: 'Software Engineering/Binary.md' }

describe('a placement miss is not a mistake', () => {
  it('knows a check by its topic, its options or its instructions', () => {
    expect(P.isPlacementTopic('What I already know: How Computers Work')).toBe(true)
    expect(P.isPlacementTopic('what i already know: Python from the ground up')).toBe(true)
    expect(P.isPlacementTopic('How Computers Work')).toBe(false)
    expect(P.isPlacementSession({ topic: 'Python', instructions: P.placementInstructions({ notebook: 'SE', section: 'Python', sectionId: 'x', topics: [{ id: 'a', title: 'Variables' }] }) })).toBe(true)
    expect(P.isPlacementSession({ topic: 'Python', options: { placement: {} } })).toBe(true)
    expect(P.isPlacementSession({ topic: 'Python', instructions: 'Teach it.' })).toBe(false)
  })

  it('leaves a check’s miss out until what it asks about is taught; everything else stays', () => {
    const of = (m: typeof cpuMistake) => m
    expect(P.withoutPlacementMisses([cpuMistake, binaryMistake], of, [])).toEqual([binaryMistake])
    // Binary was taught: a CPU question still is not
    expect(P.withoutPlacementMisses([cpuMistake, binaryMistake], of, [{ name: 'Binary, hexadecimal, number representations' }])).toEqual([binaryMistake])
    // The check's binary question comes back once binary is taught
    const binaryFromCheck = { ...cpuMistake, id: 'b', question: 'What is the binary number 1011 in decimal?' }
    expect(P.withoutPlacementMisses([binaryFromCheck], of, [{ name: 'Binary, hexadecimal, number representations' }])).toEqual([binaryFromCheck])
    // And the CPU one once the CPU is
    expect(P.withoutPlacementMisses([cpuMistake], of, [{ name: 'How a CPU actually executes an instruction' }])).toEqual([cpuMistake])
    // The section's name alone teaches nothing
    expect(P.withoutPlacementMisses([cpuMistake], of, [{ name: 'How Computers Work' }])).toEqual([])
  })

  it('Daily practice built from the filtered journal has no CPU "past mistake"', () => {
    const mistakes = P.withoutPlacementMisses([cpuMistake, binaryMistake], (m) => m, studied.list)
    const daily = buildDaily({ cards: [], mistakes, recall: [], next: [], now: Date.now() })
    expect(daily.map((d) => d.kind === 'mistake' && d.mistake.topic)).toEqual(['Binary, hexadecimal, number representations'])
  })

  it('the journal: a check’s miss is never added, and older ones are left out of what is due but kept in the file', async () => {
    const file = join(dir, '.tide', 'mistakes.json')
    writeFileSync(file, JSON.stringify([cpuMistake, binaryMistake]))
    const M = await import('../src/main/mistakes')
    expect((await M.listMistakes()).map((m) => m.id)).toEqual(['4fe334ea'])
    expect((await M.mistakesDue(10)).map((m) => m.id)).toEqual(['4fe334ea'])
    expect(await M.addMistakes([{ topic: 'What I already know: Python from the ground up', source: 'quiz', question: 'What does ADD R1, R2 do?', fix: 'x' }])).toBe(0)
    expect(await M.addMistakes([{ topic: 'Loops', source: 'quiz', question: 'What does range(3) give?', fix: '0, 1, 2' }])).toBe(1)
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { id: string; topic: string }[]
    // The old CPU miss is still in the learner's file; the Python check's miss never went in
    expect(kept.map((m) => m.topic)).toEqual(['What I already know: How Computers Work', 'Binary, hexadecimal, number representations', 'Loops'])
  })
})

describe('a placement check asks only about its own topics', () => {
  it('gets no recall, mistake or learner-history tools', () => {
    const tools = [...G.packTools(G.toolPacks({ kind: 'lesson', placement: true }))]
    for (const t of ['recall_due', 'schedule_recall', 'learner_profile', 'past_lessons', 'earlier_concepts', 'learner_standing', 'make_flashcards', 'record_answer', 'banked_exercise', 'set_exercise']) expect(tools, t).not.toContain(t)
    expect(tools).toEqual(expect.arrayContaining(['search_notes', 'read_note', 'run_code']))
    expect(G.toolReference(G.toolPacks({ kind: 'lesson', placement: true }))).not.toMatch(/recall_due|schedule_recall/)
    // An ordinary lesson still has them
    expect([...G.packTools(G.toolPacks({ kind: 'lesson' }))]).toContain('recall_due')
  })

  it('a check’s session is shaped as one, from its instructions', async () => {
    const { sessionShape } = await import('../src/main/claudeEngine')
    const instructions = P.placementInstructions({ notebook: 'Software Engineering', section: 'Python from the ground up', sectionId: 's', topics: [{ id: 'a', title: 'Variables' }] })
    const shape = await sessionShape({ session: true, topic: 'What I already know: Python from the ground up', instructions, scope: { kind: 'folder', path: 'Software Engineering' } }, false)
    expect(shape.placement).toBe(true)
    expect([...G.packTools(G.toolPacks(shape))]).not.toContain('recall_due')
    const lesson = await sessionShape({ session: true, topic: 'Python from the ground up', instructions: 'Teach it.', scope: { kind: 'folder', path: 'Software Engineering' } }, false)
    expect(lesson.placement).toBeFalsy()
  })

  it('no recall note opens a check', async () => {
    const R = await import('../src/main/recall')
    expect(R.recallNote('What I already know: Python from the ground up')).toBe('')
  })
})
