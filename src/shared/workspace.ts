/**
 * The lesson's Workspace: an editor for the lesson's file and a real terminal (your own shell, in
 * the lesson's folder) beside the lesson. The tutor hands work over as a task (an ask tag with a
 * file="…" or terminal attribute), Start makes the file, and each command you finish there is
 * sent to the tutor as a hidden note so it replies on its own. Pure, so the lesson screen and the
 * tests agree.
 */
import type { LessonMap } from './lessonMap'
import { profileSubject } from './subjects'

/** A hands-on task from the tutor: the file it names and the code it starts from */
export interface WorkspaceTask {
  /** The file to make in the lesson's folder; none for a terminal-only task */
  file?: string
  lang: string
  /** What goes in the file: the last fenced block of the task, or nothing */
  starter: string
  /** The task as shown, without the starter code (it's in the file) */
  prompt: string
}

const EXT_LANG: Record<string, string> = { py: 'python', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', rs: 'rust', sh: 'shell', bash: 'shell', zsh: 'shell', sql: 'sql', js: 'javascript', mjs: 'javascript', ts: 'typescript', go: 'go', rb: 'ruby', swift: 'swift', java: 'java' }
const LANG_EXT: Record<string, string> = { python: 'py', py: 'py', c: 'c', cpp: 'cpp', 'c++': 'cpp', rust: 'rs', rs: 'rs', shell: 'sh', bash: 'sh', sh: 'sh', zsh: 'sh', sql: 'sql', sqlite: 'sql', javascript: 'js', js: 'js', node: 'js', typescript: 'ts', ts: 'ts', go: 'go', ruby: 'rb', swift: 'swift', java: 'java' }

/** The language a file is written in, by its extension */
export function langOfFile(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}

/** A file name that is safe to make in the lesson's folder: no folders, no dots at the start */
export function safeFileName(name: string): string | null {
  const base = name.trim().replace(/^.*[\\/]/, '')
  if (!base || base.startsWith('.') || !/^[\w.+-]{1,60}$/.test(base)) return null
  return base
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)\n?[ \t]*```/g

/**
 * The task in a tutor's ask: it names a file (file="r.py") or asks for the terminal (terminal).
 * The file's starting contents are the last fenced block in the ask; that block is taken out of
 * what's shown, since Start puts it in the editor. Null for an ordinary question.
 */
export function taskOf(ask: { prompt: string; lang?: string; file?: string; terminal?: boolean } | undefined | null): WorkspaceTask | null {
  if (!ask || (!ask.file && !ask.terminal)) return null
  const blocks = [...ask.prompt.matchAll(FENCE)]
  const last = blocks[blocks.length - 1]
  let file = ask.file ? safeFileName(ask.file) : null
  // A file named without an extension takes the one of the language it's in
  if (file && !file.includes('.')) file = `${file}.${LANG_EXT[(ask.lang || last?.[1] || 'python').trim().toLowerCase()] ?? 'txt'}`
  const lang = (file ? langOfFile(file) : '') || ask.lang || 'shell'
  // The file's name as code, so it isn't read as a web address ("first.py"); code spans and blocks are left as they are
  if (file) {
    const name = new RegExp(`(?<![\\w./])${file.replace(/[.+]/g, '\\$&')}(?![\\w])`, 'g')
    ask = { ...ask, prompt: ask.prompt.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, k) => (k % 2 ? part : part.replace(name, `\`${file}\``))).join('') }
  }
  // (where the starter block is, again, now the names around it may be longer)
  const lastHere = file ? [...ask.prompt.matchAll(FENCE)].pop() : last
  // A terminal task's code block is the commands to type: it stays in the card
  if (!file || !lastHere) return { ...(file ? { file } : {}), lang: file ? lang : ask.lang || 'shell', starter: '', prompt: ask.prompt.trim() }
  const prompt = (ask.prompt.slice(0, lastHere.index) + ask.prompt.slice(lastHere.index! + lastHere[0].length)).replace(/\n{3,}/g, '\n\n').trim()
  return { file, lang, starter: lastHere[2].replace(/\s+$/, '') + '\n', prompt }
}

/** How a language's name reads on the task card */
export const LANG_LABEL: Record<string, string> = { python: 'Python', c: 'C', cpp: 'C++', rust: 'Rust', shell: 'Shell', sql: 'SQL', javascript: 'JavaScript', typescript: 'TypeScript', go: 'Go', ruby: 'Ruby', swift: 'Swift', java: 'Java', plaintext: 'Terminal' }

const q = (s: string) => (/^[\w.+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/**
 * The command Run types into the workspace's shell for a file: the same command you'd type, so
 * you see (and learn) what runs it. C and C++ build with the checks Tide's runner uses (warnings,
 * the undefined-behaviour checker), so mistakes are reported with their line.
 */
export function runCommand(file: string): string {
  const f = q(file)
  const stem = q(file.replace(/\.[^.]+$/, '') || 'prog')
  switch (langOfFile(file)) {
    case 'python':
      return `python3 ${f}`
    case 'c':
      return `clang -std=c17 -Wall -Wextra -g -fsanitize=undefined,bounds -o ${stem} ${f} && ./${stem}`
    case 'cpp':
      return `clang++ -std=c++20 -Wall -Wextra -g -fsanitize=undefined,bounds -o ${stem} ${f} && ./${stem}`
    case 'rust':
      return `rustc --edition 2021 -g -o ${stem} ${f} && ./${stem}`
    case 'shell':
      return `bash ${f}`
    case 'sql':
      return `sqlite3 -header -column lesson.db < ${f}`
    case 'javascript':
      return `node ${f}`
    case 'typescript':
      return `npx --yes tsx ${f}`
    case 'go':
      return `go run ${f}`
    case 'ruby':
      return `ruby ${f}`
    case 'swift':
      return `swift ${f}`
    case 'java':
      return `java ${f}`
    default:
      return `cat ${f}`
  }
}

// ---------- What you ran, for the tutor ----------

/** Escape sequences, carriage-return redraws and bells removed, for a model to read */
export function plainText(raw: string, keepBackspaces = false): string {
  const text = raw
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x07\x00]/g, '')
    .replace(/[^\n]*\r(?!\n)/g, '')
    .replace(/\r\n/g, '\n')
  return keepBackspaces ? text : backspaced(text)
}

/**
 * A backspace takes back the character before it: zsh redraws a typed letter that way (its syntax
 * highlighting), which would otherwise read as "ppython3". Output arriving in pieces keeps its
 * backspaces (plainText's keepBackspaces) until the pieces are joined.
 */
export function backspaced(text: string): string {
  for (let before = ''; before !== text; ) {
    before = text
    text = text.replace(/[^\n\x08]\x08/g, '')
  }
  return text.replace(/^\x08+/, '')
}

/** Starts the hidden message a finished command sends: the lesson shows it as a "Saw:" line, not as you */
export const SAW = '[ran] '

/** Commands that move around or tidy up: nothing for the tutor to reply to */
const QUIET = /^(cd|ls|ll|la|pwd|clear|cls|reset|history|exit|logout|echo|which|type|true|:)(\s|$)/

/** A REPL's prompt at the start of the line a command was typed on (python's >>> and ..., sqlite3's) */
const REPL = /^(>>>|\.\.\.|sqlite>|irb\(|>\s)/

/**
 * Whether a finished command deserves a reply: not an empty line or a cd/ls/clear, and inside a
 * REPL only a line that raised an error (or the tutor would answer every line typed at >>>).
 */
export function worthAReply(command: string, output: string, typedOn = ''): boolean {
  const c = command.trim()
  if (!c) return false
  if (REPL.test(typedOn.trim())) return /Error|Exception|Traceback/.test(output)
  // Opening a REPL or a shell: it's waiting for them, not finished
  if (/^(python3?|ipython|node|irb|bash|zsh|sh|sqlite3(\s+\S+)?)$/.test(c)) return false
  return !QUIET.test(c)
}

/**
 * What a command printed, from the terminal's text since Enter was pressed: the echoed command
 * line and the prompt that came back after it are taken off.
 */
export function commandOutput(since: string, command: string): string {
  const lines = since.replace(/\r\n/g, '\n').split('\n')
  // The echo of what was typed is the first line (it may carry the end of the prompt)
  if (lines.length && (lines[0].trim() === '' || lines[0].includes(command.trim().slice(0, 20)))) lines.shift()
  // The prompt that came back is the last line, with nothing typed after it yet
  if (lines.length) lines.pop()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.join('\n').trim()
}

/** The error a run ended in, if any: ZeroDivisionError, SyntaxError, a C compiler's error, a panic */
export function errorName(output: string): string | null {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const py = lines[i].match(/^([A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit))\b/)
    if (py) return py[1].split('.').pop()!
  }
  if (lines.some((l) => /\berror:/.test(l))) return 'a compile error'
  if (lines.some((l) => /panicked at/.test(l))) return 'a panic'
  if (lines.some((l) => /runtime error:/.test(l))) return 'a runtime error'
  if (lines.some((l) => /command not found/.test(l))) return 'command not found'
  if (lines.some((l) => /Segmentation fault|segmentation fault/.test(l))) return 'a segfault'
  return null
}

/** The short line shown above the tutor's reply: "python3 r.py → ZeroDivisionError" */
export function sawSummary(command: string, output: string): string {
  const cmd = command.trim().length > 60 ? `${command.trim().slice(0, 57)}…` : command.trim()
  const err = errorName(output)
  if (err) return `${cmd} → ${err}`
  if (!output.trim()) return `${cmd} → printed nothing`
  const lines = output.trim().split('\n')
  const first = lines[0].trim()
  return lines.length === 1 && first.length <= 40 ? `${cmd} → ${first}` : `${cmd} → ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`
}

/** Most of what a command printed, for the note: the start and the end of a long run */
export function clip(output: string, max = 3000): string {
  if (output.length <= max) return output
  const head = output.slice(0, Math.floor(max * 0.3))
  const tail = output.slice(-Math.floor(max * 0.7))
  return `${head}\n… (${output.length - head.length - tail.length} characters cut) …\n${tail}`
}

/**
 * The message a finished command sends: shown as a "Saw:" line, with a hidden note giving the
 * tutor the command and its output and telling it to reply to what happened.
 */
export function sawMessage(command: string, output: string, how: 'run' | 'typed' = 'typed'): string {
  const said = `${SAW}${sawSummary(command, output)}`
  const body = output.trim() ? `\`\`\`\n${clip(output)}\n\`\`\`` : '(it printed nothing)'
  return `${said}\n\n(Tide: they ${how === 'run' ? 'pressed Run in' : 'typed this in'} the lesson's Workspace terminal, unprompted:\n$ ${command.trim()}\n${body}\nThis is not an answer to your question: no grade tag. Reply to what it shows in a few sentences: say how it bears on the task, explain the line that matters, and give the next step or one question. Don't paste the output back. A long command can show split over two lines in the terminal: that's the display wrapping, not something they typed. They can keep running things; you'll hear each one.)`
}

/** The "Saw:" line of a message a finished command sent, or null for anything else */
export function sawLine(content: string): string | null {
  if (!content.startsWith(SAW)) return null
  return content.slice(SAW.length).split('\n')[0].trim()
}

// ---------- Following the shell (main/terminal) ----------

/** The command line being typed, as far as the keys say; not exact once history or completion keys were used */
export interface LineState {
  text: string
  exact: boolean
}

export const NEW_LINE: LineState = { text: '', exact: true }

/**
 * Keys typed into a shell, followed: the line so far, and each command Enter sent. A command is
 * null when editing keys (arrows, tab completion, history) mean the screen has to say what it was.
 */
export function followKeys(line: LineState, data: string): { line: LineState; entered: (string | null)[] } {
  let cur = { ...line }
  const entered: (string | null)[] = []
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]
    if (ch === '\r') {
      entered.push(cur.exact ? cur.text : null)
      cur = { ...NEW_LINE }
    } else if (ch === '\x7f' || ch === '\b') cur.text = cur.text.slice(0, -1)
    else if (ch === '\x03' || ch === '\x15') cur = { ...NEW_LINE }
    else if (ch === '\x1b' || ch === '\t' || ch < ' ') {
      cur.exact = false
      // An escape sequence (an arrow key) is skipped whole
      if (ch === '\x1b') i += data.slice(i + 1).match(/^\[[0-9;]*[A-Za-z~]|^O[A-Za-z]/)?.[0].length ?? 0
    } else cur.text += ch
  }
  return { line: cur, entered }
}

/** The command on a line of the screen: what follows the prompt ("… % ", "$ ", ">>> ") */
export const commandOnScreen = (shown: string) => shown.replace(/^.*?(?:[$%#❯➜»]|>>>|\.\.\.)\s+/, '').trim()

// ---------- When to reply on its own ----------

/** Quiet output this long after Enter means the command has finished */
export const QUIET_MS = 1500

export interface Finished {
  command: string
  output: string
  /** The line it was typed on (a shell prompt and the command, or a REPL's >>> and the line) */
  prompt: string
  at: number
  /** Run pressed, or typed in the terminal */
  how?: 'run' | 'typed'
}

/**
 * Whether a finished command is sent to the tutor now, held until the reply being written is done,
 * or dropped. One reply per command: the same finish is never sent twice.
 */
export function autoReply(f: Finished, o: { busy: boolean; sentAt: number; enabled: boolean }): 'send' | 'hold' | 'drop' {
  if (!o.enabled || f.at <= o.sentAt) return 'drop'
  if (!worthAReply(f.command, f.output, f.prompt)) return 'drop'
  return o.busy ? 'hold' : 'send'
}

// ---------- The header's step ----------

/** "Step 2 of 5 · Compile, then run", or where a lesson without steps is */
export function stepText(map: Pick<LessonMap, 'steps' | 'current' | 'phase'>): string {
  const n = map.steps.length
  if (map.phase === 'warmup') return 'Warm-up'
  if (map.phase === 'finished') return n ? `All ${n} steps done` : 'Finished'
  if (map.phase === 'recap') return 'Recap'
  if (!n) return map.phase === 'probe' ? 'Finding where to start' : ''
  const at = Math.min(map.current, n - 1)
  return `Step ${at + 1} of ${n} · ${map.steps[at].title}`
}

// ---------- A Workspace in every hands-on lesson ----------

/** Topics and courses learnt at a keyboard: languages, the shell, databases, systems */
const TECH = /\b(python|py|c\+\+|cpp|c|rust|go(lang)?|java(script)?|typescript|ts|node|sql|sqlite|postgres(ql)?|mysql|bash|shell|zsh|linux|unix|terminal|command line|git|docker|kubernetes|programming|coding|code|algorithms?|data structures?|software|swe|compilers?|operating systems?|os|pointers?|memory|malloc|syscalls?|processes|threads?|regex|scripting|leetcode|numpy|pandas)\b/i

interface LessonLike {
  mode: string
  topic: string
  options?: { language?: string; codeRoot?: string; strategy?: string; course?: { id?: string; lesson?: string }; subject?: { hands?: boolean; kinds?: string[] } } | null
}

/**
 * A lesson the Workspace is always offered in: a teach lesson on something learnt at a keyboard
 * (a language, the shell, SQL, systems), by the lesson's language, folder or way of teaching, its
 * course, or its topic. Other lessons get it only when the tutor hands over a task.
 */
export function workspaceLesson(l: LessonLike): boolean {
  if (l.mode !== 'teach') return false
  const o = l.options ?? {}
  if (o.language || o.codeRoot || o.strategy === 'code' || o.strategy === 'lab') return true
  if (o.course?.id && TECH.test(o.course.id.replace(/[-_]+/g, ' '))) return true
  if (TECH.test(l.topic)) return true
  const p = o.subject ?? profileSubject(l.topic)
  return !!p.hands && !!p.kinds?.includes('build')
}

/** The language a lesson's scratch file is in: the lesson's own, else what its topic names, else Python */
export function lessonLanguage(l: Pick<LessonLike, 'topic' | 'options'>): string {
  const own = l.options?.language?.trim().toLowerCase()
  if (own) return LANG_EXT[own] ? langOfFile(`x.${LANG_EXT[own]}`) : own
  const t = `${l.topic} ${l.options?.course?.id ?? ''}`.toLowerCase().replace(/[-_]+/g, ' ')
  if (/\bc\+\+|\bcpp\b/.test(t)) return 'cpp'
  if (/\brust\b/.test(t)) return 'rust'
  if (/\b(sql|sqlite|postgres|mysql|database)/.test(t)) return 'sql'
  if (/\b(bash|shell|zsh|linux|unix|terminal|command line)\b/.test(t)) return 'shell'
  if (/\bc\b|\bpointers?\b|\bmalloc\b/.test(t)) return 'c'
  if (/\b(javascript|node)\b/.test(t)) return 'javascript'
  return 'python'
}

/** The file extension a language's files take */
export const extOf = (lang: string) => LANG_EXT[lang.trim().toLowerCase()] ?? 'txt'

/** scratch.py, then scratch-2.py, … : the first name not taken */
export function scratchName(lang: string, taken: string[]): string {
  const ext = extOf(lang)
  for (let n = 1; ; n++) {
    const name = n === 1 ? `scratch.${ext}` : `scratch-${n}.${ext}`
    if (!taken.includes(name)) return name
  }
}

/**
 * What "Open in workspace" does with a code block of the tutor's: code goes into a file; shell
 * commands are pasted at the prompt without Enter (you read them and press it yourself). Null for
 * anything else (output, JSON, a diagram).
 */
export function blockTarget(lang: string): { kind: 'file'; lang: string } | { kind: 'paste' } | null {
  const l = lang.trim().toLowerCase()
  if (['bash', 'sh', 'shell', 'zsh', 'console', 'terminal'].includes(l)) return { kind: 'paste' }
  const file: Record<string, string> = { python: 'python', py: 'python', python3: 'python', c: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', rust: 'rust', rs: 'rust', sql: 'sql', sqlite: 'sql', javascript: 'javascript', js: 'javascript', typescript: 'typescript', ts: 'typescript', go: 'go' }
  return file[l] ? { kind: 'file', lang: file[l] } : null
}

/** Shell commands to paste: one line each, the "$ " prompts some blocks show taken off, never a trailing Enter */
export const pasteText = (code: string) =>
  code
    .split('\n')
    .map((l) => l.replace(/^\s*\$\s+/, ''))
    .join('\n')
    .replace(/\s+$/, '')
