import { describe, expect, it } from 'vitest'
import { cellsText, lessonNotebook, MARKS, missingModule, plainPython, runnerOutputs, runnerScript, type LessonCellState } from '@shared/lessonCells'

const cell = (id: string, source: string, more: Partial<LessonCellState> = {}): LessonCellState => ({ id, source, original: source, outputs: [], fromCourse: false, runs: 0, ...more })

describe('a lesson’s code as cells', () => {
  it('leaves Jupyter’s own lines out when plain Python stands in, and runs the cells above quietly', () => {
    expect(plainPython('%matplotlib inline\n!pip install x\nx = 1')).toBe('x = 1')
    const s = runnerScript(['a = 1', 'a + 1'])
    expect(s).toContain('_tide_run(_cells[-1], True)')
    expect(s).toContain(JSON.stringify(JSON.stringify(['a = 1', 'a + 1'])))
  })
  it('reads what the runner printed as outputs: text, a table, a figure, an error from the cell down', () => {
    const outs = runnerOutputs({
      stdout: `noise from above\n${MARKS.start}\nhello\n${MARKS.html}"<table></table>"\n${MARKS.png}iVBOR\n`,
      stderr: 'Matplotlib is building the font cache; this may take a moment.\n',
      exitCode: 0,
      timedOut: false
    })
    expect(outs.map((o) => o.output_type)).toEqual(['stream', 'execute_result', 'display_data'])
    expect(JSON.stringify(outs)).not.toContain('noise from above')
    const err = runnerOutputs({ stdout: `${MARKS.start}\n`, stderr: `${MARKS.before}1: NameError: x\nTraceback (most recent call last):\n  File "/tmp/main.py", line 44, in <module>\n  File "<cell>", line 1, in <module>\nModuleNotFoundError: No module named 'sklearn'\n`, exitCode: 1, timedOut: false })
    expect(err[0]).toMatchObject({ output_type: 'stream', name: 'stderr' })
    expect(err[1]).toMatchObject({ output_type: 'error', ename: 'ModuleNotFoundError' })
    expect(JSON.stringify(err[1])).not.toContain('main.py')
    expect(missingModule(err)).toBe('sklearn')
    // A failed cell above is mentioned only when this one fails too
    expect(runnerOutputs({ stdout: `${MARKS.start}\nok\n`, stderr: `${MARKS.before}1: NameError: df\n`, exitCode: 0, timedOut: false })).toEqual([{ output_type: 'stream', name: 'stdout', text: 'ok\n' }])
    expect(missingModule([{ output_type: 'error', ename: 'ModuleNotFoundError', evalue: "No module named 'torch.nn'", traceback: [] }])).toBe('torch')
  })
  it('turns the lesson into a notebook with the code as it is now and the practice cells in place', () => {
    const md = '# Lesson\n\nText one.\n\n```python\nx = 1\n```\n\n```output\n1\n```\n\nText two.\n\n```bash\nls\n```\n\n```python\nprint(x)\n```\n'
    const cells = [cell('a', 'x = 2', { original: 'x = 1', runs: 1, outputs: [{ output_type: 'stream', name: 'stdout', text: '2\n' }] }), cell('p', 'x * 3', { practice: true }), cell('b', 'print(x)')]
    const nb = lessonNotebook(md, cells)
    expect(nb.cells.map((c) => `${c.cell_type}:${c.source.split('\n')[0]}`)).toEqual(['markdown:# Lesson', 'code:x = 2', 'code:x * 3', 'markdown:Text two.', 'code:print(x)'])
    expect(nb.cells[3].source).toContain('```bash')
    expect(nb.cells[1].outputs).toHaveLength(1)
    expect(JSON.stringify(nb)).not.toContain('```output')
  })
  it('tells the tutor about the cells that were run, changed or added', () => {
    const t = cellsText([cell('a', 'x = 2', { original: 'x = 1', runs: 1, outputs: [{ output_type: 'stream', name: 'stdout', text: '2\n' }] }), cell('b', 'print(x)')])
    expect(t).toContain('edited, run 1×')
    expect(t).toContain('[stdout]\n2')
    expect(t).not.toContain('print(x)')
    expect(cellsText([cell('b', 'print(x)')])).toBe('1 code cell in the lesson, none run yet.')
  })
})
