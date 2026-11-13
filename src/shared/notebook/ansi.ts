/**
 * ANSI colour codes (IPython's tracebacks, pip, tqdm) as HTML spans with classes, which the
 * notebook's stylesheet maps to Tide's own colour tokens. Text is escaped; nothing else passes.
 */
const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function ansiToHtml(text: string): string {
  let out = ''
  let fg = ''
  let bg = ''
  let bold = false
  let open = false
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g
  let last = 0
  let m: RegExpExecArray | null
  const flush = (chunk: string) => {
    if (!chunk) return
    const cls = [fg && `ansi-${fg}`, bg && `ansi-bg-${bg}`, bold && 'ansi-bold'].filter(Boolean).join(' ')
    out += cls ? `<span class="${cls}">${esc(chunk)}</span>` : esc(chunk)
  }
  while ((m = re.exec(text))) {
    flush(text.slice(last, m.index))
    last = re.lastIndex
    const codes = (m[1] || '0').split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) [fg, bg, bold] = ['', '', false]
      else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c >= 30 && c <= 37) fg = NAMES[c - 30]
      else if (c >= 90 && c <= 97) fg = NAMES[c - 90]
      else if (c === 39) fg = ''
      else if (c >= 40 && c <= 47) bg = NAMES[c - 40]
      else if (c === 49) bg = ''
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) i += 2
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) i += 4
    }
    open = !!(fg || bg || bold)
  }
  flush(text.slice(last))
  void open
  // Any other escape sequence (cursor moves) is dropped
  // eslint-disable-next-line no-control-regex
  return out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}
