import { describe, expect, it } from 'vitest'
import { addTakeaways, createNoteSync, lessonItems, mergeLessonNote, newLessonNote, ownWordsEnd } from '../src/shared/lessonNotes'

const fakeVault = (init: Record<string, string> = {}) => {
  const files = { ...init }
  return {
    files,
    io: {
      read: async (p: string) => {
        await new Promise((r) => setTimeout(r, 1))
        if (!(p in files)) throw new Error('missing')
        return files[p]
      },
      write: async (p: string, t: string) => {
        await new Promise((r) => setTimeout(r, 1))
        files[p] = t
      }
    }
  }
}

const P = 'Software Engineering/Running Python.md'
const base = addTakeaways(newLessonNote('Running Python'), ['Python compiles first.'])
const withMine = base.replace('## In my words\n', '## In my words\nbytecode runs on a stack, my words\n')

describe('lesson note: one writer, learner text never lost', () => {
  it('a takeaway written from a stale copy keeps the words another window wrote', async () => {
    const v = fakeVault({ [P]: base })
    const a = createNoteSync(v.io)
    const b = createNoteSync(v.io)
    await a.read(P)
    await b.read(P)
    // Window B: the learner writes their words
    await b.write(P, withMine, true)
    // Window A (stale, never typed) gets a takeaway and writes
    const out = await a.write(P, addTakeaways(base, ['Bytecode is a list of instructions.']), false)
    expect(out).toContain('bytecode runs on a stack, my words')
    expect(out).toContain('Bytecode is a list of instructions.')
    expect(v.files[P]).toBe(out)
  })

  it('the learner typing while a takeaway lands keeps both', async () => {
    const v = fakeVault({ [P]: base })
    const s = createNoteSync(v.io)
    await s.read(P)
    // Another writer added a takeaway to the file
    v.files[P] = addTakeaways(base, ['dis shows bytecode.'])
    const out = await s.write(P, withMine, true)
    expect(out).toContain('my words')
    expect(out).toContain('dis shows bytecode.')
  })

  it('writes run one at a time and a read waits for them', async () => {
    const v = fakeVault({ [P]: base })
    const s = createNoteSync(v.io)
    await s.read(P)
    const w1 = s.write(P, withMine, true)
    const w2 = s.write(P, withMine + 'more\n', true)
    const r = s.read(P)
    await Promise.all([w1, w2])
    expect(await r).toContain('more')
    expect(v.files[P]).toContain('more')
  })

  it('merge keeps the newest learner text', () => {
    expect(mergeLessonNote(withMine, base, base, true)).toBe(withMine)
    const disk = addTakeaways(withMine, ['x is y.'])
    const stale = addTakeaways(base, ['z is w.'])
    const m = mergeLessonNote(stale, disk, base, false)
    expect(m).toContain('my words')
    expect(m).toContain('x is y.')
    expect(m).toContain('z is w.')
  })

  it('lists lesson items with their continuation lines', () => {
    const n = addTakeaways(newLessonNote('t'), ['A.\nWorked example: b.', 'C.'])
    expect(lessonItems(n)).toEqual(['- A.\n  Worked example: b.', '- C.'])
  })

  it('the caret goes to the end of the learner section', () => {
    expect(withMine.slice(0, ownWordsEnd(withMine)).endsWith('my words')).toBe(true)
    const empty = newLessonNote('t')
    expect(empty.slice(0, ownWordsEnd(empty)).endsWith('## In my words\n')).toBe(true)
  })
})
