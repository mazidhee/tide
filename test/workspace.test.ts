import { describe, expect, it } from 'vitest'
import { parseBlocks, type Block } from '../src/shared/session'
import { autoReply, commandOutput, errorName, plainText, runCommand, safeFileName, sawLine, sawMessage, sawSummary, stepText, taskOf, worthAReply } from '../src/shared/workspace'

const ask = (text: string) => parseBlocks(text).find((b): b is Extract<Block, { kind: 'ask' }> => b.kind === 'ask')!

describe('a task in the tutor’s ask', () => {
  it('names its file and takes the last code block as the starter', () => {
    const b = ask('See it for yourself.\n<ask type="problem" lang="python" file="r.py">Run the file, then compile it.\n1. Run `r.py`.\n2. `python3 -m py_compile r.py`\n```python\nprint("a")\nprint(1 / 0)\n```</ask>')
    expect(b.file).toBe('r.py')
    const t = taskOf(b)!
    expect(t.file).toBe('r.py')
    expect(t.lang).toBe('python')
    expect(t.starter).toBe('print("a")\nprint(1 / 0)\n')
    expect(t.prompt).not.toContain('print(1 / 0)')
    expect(t.prompt).toContain('py_compile')
  })

  it('shows the file name as code, but not inside code already', () => {
    const t = taskOf({ prompt: 'Put it in first.py and run `python3 first.py`.\n```python\nprint(1)\n```', file: 'first.py' })!
    expect(t.prompt).toBe('Put it in `first.py` and run `python3 first.py`.')
  })

  it('answers a code task in words, not in the answer box’s editor', () => {
    expect(ask('<ask type="code" lang="c" file="hello.c">Build it\n```c\nint main(void){return 0;}\n```</ask>').type).toBe('problem')
    expect(ask('<ask type="code" lang="python">Write it</ask>').type).toBe('code')
  })

  it('a terminal task keeps its commands in the card and makes no file', () => {
    const t = taskOf(ask('<ask type="problem" terminal>List the folder:\n```sh\nls -la\n```</ask>'))!
    expect(t.file).toBeUndefined()
    expect(t.starter).toBe('')
    expect(t.prompt).toContain('ls -la')
  })

  it('an ordinary question is not a task', () => {
    expect(taskOf(ask('<ask type="short">Why?</ask>'))).toBeNull()
  })

  it('a file name with a folder or no extension is made safe', () => {
    expect(safeFileName('../etc/passwd')).toBe('passwd')
    expect(safeFileName('.zshrc')).toBeNull()
    expect(taskOf({ prompt: 'x\n```rust\nfn main(){}\n```', lang: 'rust', file: 'main' })!.file).toBe('main.rs')
  })
})

describe('Run', () => {
  it('types the command you would, per language', () => {
    expect(runCommand('r.py')).toBe('python3 r.py')
    expect(runCommand('hello.c')).toMatch(/^clang -std=c17 .* -o hello hello\.c && \.\/hello$/)
    expect(runCommand('v.cpp')).toMatch(/^clang\+\+ -std=c\+\+20 .*&& \.\/v$/)
    expect(runCommand('m.rs')).toMatch(/^rustc .* -o m m\.rs && \.\/m$/)
    expect(runCommand('s.sh')).toBe('bash s.sh')
    expect(runCommand('q.sql')).toBe('sqlite3 -header -column lesson.db < q.sql')
  })
})

describe('what a command printed', () => {
  it('drops the echo and the prompt that came back', () => {
    const since = plainText('python3 r.py\r\na\r\nTraceback (most recent call last):\r\n  File "r.py", line 2, in <module>\r\nZeroDivisionError: division by zero\r\n\x1b[32mlesson\x1b[0m % ')
    const out = commandOutput(since, 'python3 r.py')
    expect(out.split('\n')[0]).toBe('a')
    expect(out).toContain('ZeroDivisionError')
    expect(out).not.toContain('lesson %')
  })

  it('a letter zsh redraws with a backspace is read once', () => {
    expect(plainText('p\x08\x1b[32mpython3\x1b[0m r.py')).toBe('python3 r.py')
  })

  it('nothing printed is nothing', () => {
    expect(commandOutput('python3 -m py_compile r.py\nlesson % ', 'python3 -m py_compile r.py')).toBe('')
  })

  it('names the error a run ended in', () => {
    expect(errorName('a\nZeroDivisionError: division by zero')).toBe('ZeroDivisionError')
    expect(errorName('  File "r.py", line 2\n    print(1 /)\nSyntaxError: invalid syntax')).toBe('SyntaxError')
    expect(errorName('hello.c:3:5: error: use of undeclared identifier')).toBe('a compile error')
    expect(errorName('a\nb')).toBeNull()
  })

  it('says it in a line', () => {
    expect(sawSummary('python3 r.py', 'a\nZeroDivisionError: division by zero')).toBe('python3 r.py → ZeroDivisionError')
    expect(sawSummary('python3 -m py_compile r.py', '')).toBe('python3 -m py_compile r.py → printed nothing')
    expect(sawSummary('python3 r.py', 'a')).toBe('python3 r.py → a')
  })

  it('the message shows only the Saw line and hides the output in a note', () => {
    const m = sawMessage('python3 r.py', 'a\nZeroDivisionError: division by zero', 'run')
    expect(sawLine(m)).toBe('python3 r.py → ZeroDivisionError')
    expect(m).toContain('(Tide: they pressed Run')
    expect(m).toContain('ZeroDivisionError: division by zero')
    expect(sawLine('Answer: 4')).toBeNull()
  })
})

describe('replying on its own', () => {
  const f = (command: string, output = '', prompt = 'lesson % ' + command, at = 10) => ({ command, output, prompt, at })
  it('replies once per finished command', () => {
    expect(autoReply(f('python3 r.py'), { busy: false, sentAt: 0, enabled: true })).toBe('send')
    expect(autoReply(f('python3 r.py'), { busy: false, sentAt: 10, enabled: true })).toBe('drop')
  })
  it('waits for a reply being written', () => {
    expect(autoReply(f('python3 r.py'), { busy: true, sentAt: 0, enabled: true })).toBe('hold')
  })
  it('not for moving about, nor when the lesson is over', () => {
    expect(autoReply(f('ls'), { busy: false, sentAt: 0, enabled: true })).toBe('drop')
    expect(autoReply(f('cd ..'), { busy: false, sentAt: 0, enabled: true })).toBe('drop')
    expect(autoReply(f(''), { busy: false, sentAt: 0, enabled: true })).toBe('drop')
    expect(autoReply(f('python3 r.py'), { busy: false, sentAt: 0, enabled: false })).toBe('drop')
  })
  it('in a REPL, only a line that raised', () => {
    expect(worthAReply('x = 1', '', '>>> x = 1')).toBe(false)
    expect(worthAReply('1/0', 'ZeroDivisionError: division by zero', '>>> 1/0')).toBe(true)
    expect(worthAReply('python3', 'Python 3.12.4\n>>>')).toBe(false)
  })
})

describe('the header’s step', () => {
  const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `S${i + 1}` })) as never
  it('says which step of how many', () => {
    expect(stepText({ steps: steps(5), current: 1, phase: 'steps' })).toBe('Step 2 of 5 · S2')
    expect(stepText({ steps: steps(5), current: 5, phase: 'recap' })).toBe('Recap')
    expect(stepText({ steps: steps(3), current: 3, phase: 'finished' })).toBe('All 3 steps done')
    expect(stepText({ steps: [], current: 0, phase: 'probe' })).toBe('Finding where to start')
    expect(stepText({ steps: [], current: 0, phase: 'warmup' })).toBe('Warm-up')
  })
})

describe('a run is not an answer', () => {
  it('has nothing to mark', async () => {
    const { nothingToMark } = await import('../src/shared/lessonRepair')
    expect(nothingToMark(sawMessage('python3 r.py', 'ZeroDivisionError: division by zero'))).toBe(true)
  })
})

describe('the Workspace in every hands-on lesson', () => {
  it('is offered in lessons learnt at a keyboard', async () => {
    const { workspaceLesson } = await import('../src/shared/workspace')
    expect(workspaceLesson({ mode: 'teach', topic: 'Running Python' })).toBe(true)
    expect(workspaceLesson({ mode: 'teach', topic: 'Pointers and arrays in C' })).toBe(true)
    expect(workspaceLesson({ mode: 'teach', topic: 'SQL joins' })).toBe(true)
    expect(workspaceLesson({ mode: 'teach', topic: 'Anything', options: { strategy: 'lab' } })).toBe(true)
    expect(workspaceLesson({ mode: 'teach', topic: 'Week 3', options: { course: { id: 'cs50-python' } } })).toBe(true)
    expect(workspaceLesson({ mode: 'teach', topic: 'The causes of the French Revolution' })).toBe(false)
    expect(workspaceLesson({ mode: 'quiz', topic: 'Running Python' })).toBe(false)
  })

  it('makes its scratch file in the lesson’s language', async () => {
    const { lessonLanguage, scratchName } = await import('../src/shared/workspace')
    expect(lessonLanguage({ topic: 'Running Python' })).toBe('python')
    expect(lessonLanguage({ topic: 'Pointers in C' })).toBe('c')
    expect(lessonLanguage({ topic: 'C++ templates' })).toBe('cpp')
    expect(lessonLanguage({ topic: 'Ownership in Rust' })).toBe('rust')
    expect(lessonLanguage({ topic: 'Linux permissions' })).toBe('shell')
    expect(lessonLanguage({ topic: 'x', options: { language: 'cpp' } })).toBe('cpp')
    expect(scratchName('python', [])).toBe('scratch.py')
    expect(scratchName('python', ['scratch.py', 'scratch-2.py'])).toBe('scratch-3.py')
    expect(scratchName('c', ['scratch.py'])).toBe('scratch.c')
  })

  it('opens code blocks as files and pastes shell commands without Enter', async () => {
    const { blockTarget, pasteText } = await import('../src/shared/workspace')
    expect(blockTarget('python')).toEqual({ kind: 'file', lang: 'python' })
    expect(blockTarget('c++')).toEqual({ kind: 'file', lang: 'cpp' })
    expect(blockTarget('bash')).toEqual({ kind: 'paste' })
    expect(blockTarget('output')).toBeNull()
    expect(pasteText('$ ls -la\n$ cd ..\n')).toBe('ls -la\ncd ..')
  })
})

describe('following the shell in main', () => {
  it('knows the command typed, and when to read it off the screen', async () => {
    const { followKeys, commandOnScreen, NEW_LINE } = await import('../src/shared/workspace')
    let r = followKeys(NEW_LINE, 'pythn')
    r = followKeys(r.line, '\x7f\x7fhon3 r.py\r')
    expect(r.entered).toEqual(['python3 r.py'])
    expect(followKeys(NEW_LINE, '\x1b[A\r').entered).toEqual([null])
    expect(commandOnScreen('me@mac lesson % python3 -m py_compile r.py')).toBe('python3 -m py_compile r.py')
    expect(commandOnScreen('>>> 1/0')).toBe('1/0')
  })

  it('a workspace pops out into a window of its own kind, one per folder', async () => {
    const { popInfoOf } = await import('../src/shared/popout')
    expect(popInfoOf({ kind: 'workspace', root: '/x/lesson', title: 'Running Python: workspace' })).toEqual({ key: 'workspace:/x/lesson', kind: 'workspace', title: 'Running Python: workspace — Tide' })
    expect(popInfoOf({ kind: 'workspace', title: 'Scratchpad' })?.key).toBe('workspace:')
  })
})

describe('the fixes from a real lesson', () => {
  it('Enter on an empty line, or a line that is only the prompt, is no command', async () => {
    const { autoReply, cleanCommand, commandOnScreen, worthAReply } = await import('../src/shared/workspace')
    const prompt = 'divineuzoukwu@Divines-MacBook-Pro running-python-the-interpreter-the-repl--n61kl1 %'
    expect(commandOnScreen(prompt)).toBe('')
    expect(commandOnScreen(`${prompt} `)).toBe('')
    expect(cleanCommand(prompt)).toBe('')
    expect(cleanCommand(`${prompt} python3 r.py`)).toBe('python3 r.py')
    expect(cleanCommand('r % python3 r.py')).toBe('python3 r.py')
    expect(cleanCommand('…ng-cdede92ff4 % python3 r.py')).toBe('python3 r.py')
    expect(cleanCommand('python3 r.py')).toBe('python3 r.py')
    expect(cleanCommand('echo $HOME')).toBe('echo $HOME')
    expect(worthAReply(prompt, '')).toBe(false)
    expect(worthAReply('   ', '')).toBe(false)
    expect(autoReply({ command: prompt, output: '', prompt, at: 5 }, { busy: false, sentAt: 0, enabled: true })).toBe('drop')
  })

  it('the task, as one line above the editor', async () => {
    const { taskLine } = await import('../src/shared/workspace')
    expect(taskLine('Run `r.py`, then **compile** it:\n```sh\npython3 -m py_compile r.py\n```\nWhat changed?')).toBe('Run r.py, then compile it: What changed?')
    expect(taskLine('word '.repeat(60)).length).toBeLessThanOrEqual(110)
  })

  it('a code block goes in the file its message names', async () => {
    const { fileForBlock } = await import('../src/shared/workspace')
    expect(fileForBlock('Make a file r.py with the three lines above:', '', 'python')).toBe('r.py')
    expect(fileForBlock('Save this as total.py, then run python3 total.py.', '', 'python')).toBe('total.py')
    expect(fileForBlock('First r.py, now a second file b.py:', '', 'python')).toBe('b.py')
    expect(fileForBlock('Put this in a file:', 'Then run python3 sum.py', 'python')).toBe('sum.py')
    expect(fileForBlock('Compile hello.c', '', 'python')).toBeNull()
    expect(fileForBlock('Put it in hello.c', '', 'c')).toBe('hello.c')
    expect(fileForBlock('No name here.', '', 'python')).toBeNull()
  })

  it('the Workspace shell gets a short prompt after your own zsh files, which are never changed', async () => {
    const { shortPromptRc } = await import('../src/shared/workspace')
    const rc = shortPromptRc('/Users/me')
    expect(rc['.zshrc']).toContain('source "/Users/me/.zshrc"')
    expect(rc['.zshrc'].indexOf("PROMPT='%14<…<%1~%<< %# '")).toBeGreaterThan(rc['.zshrc'].indexOf('source'))
    expect(rc['.zprofile']).toContain('/Users/me/.zprofile')
  })
})

describe('an unlabelled command block', () => {
  it('is pasted like a shell block', async () => {
    const { looksLikeCommand } = await import('../src/shared/workspace')
    expect(looksLikeCommand('python3 prices.py\n')).toBe(true)
    expect(looksLikeCommand('$ ls -la')).toBe(true)
    expect(looksLikeCommand('[10, 30, 50]')).toBe(false)
    expect(looksLikeCommand('x = 1\nprint(x)')).toBe(false)
  })
})
