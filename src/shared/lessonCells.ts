/**
 * A course lesson's code as cells you can run in place (components/LessonCells): which blocks are
 * Python, the lesson turned into a notebook to open whole, a plain-Python stand-in for Jupyter's
 * kernel when its pack isn't installed (each run replays the cells above it, prints the last
 * expression's value, and hands back pandas tables and Matplotlib figures), and what the tutor
 * reads of the cells.
 */
import { codeCell, markdownCell, newNotebook, outputText, stripAnsi, type Notebook, type Output } from './notebook/ipynb'

export const PY_LANG = /^(python[23]?|py|ipython[23]?)$/i

/** A lesson cell as the reader keeps it */
export interface LessonCellState {
  id: string
  source: string
  /** The course's own code, to put it back */
  original: string
  outputs: Output[]
  /** The outputs are the course's own (from its notebook), not from a run here */
  fromCourse: boolean
  /** Added under an example to practise */
  practice?: boolean
  /** Runs here: 0 when it never ran */
  runs: number
  count?: number | null
}

/** Lines that only Jupyter understands (!pip, %matplotlib inline): left out when the plain runner stands in */
export const plainPython = (code: string) =>
  code
    .split('\n')
    .filter((l) => !/^\s*[!%]/.test(l))
    .join('\n')

export const MARKS = { start: '__tide_cell__start__', png: '__tide_cell__png__', html: '__tide_cell__html__', before: '__tide_cell__before__' }

/**
 * A Python program that runs `cells` in one namespace, as Jupyter would have: the cells before
 * the last quietly (their output dropped, an error in one reported as that), then the last one,
 * showing its last expression's value (a table as HTML) and every figure it drew as a PNG.
 */
export function runnerScript(cells: string[], theme?: { ink: string; muted: string; line: string; series: string[] }): string {
  const json = JSON.stringify(cells.map(plainPython))
  // Tide's colours for its charts, as the kernel's helper sets them (main/notebook/tide_nb.py)
  // Only when something may draw: importing Matplotlib costs half a second
  if (!cells.some((c) => /matplotlib|seaborn|plt\.|\.plot\b|\.hist\(/.test(c))) theme = undefined
  const rc = theme
    ? JSON.stringify({ 'figure.facecolor': 'none', 'axes.facecolor': 'none', 'savefig.facecolor': 'none', 'savefig.transparent': true, 'text.color': theme.ink, 'axes.labelcolor': theme.ink, 'axes.titlecolor': theme.ink, 'xtick.color': theme.muted, 'ytick.color': theme.muted, 'axes.edgecolor': theme.line, 'grid.color': theme.line, 'legend.frameon': false })
    : ''
  return `import sys, io, ast, json, os, base64, contextlib, tempfile
os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("MPLCONFIGDIR", tempfile.mkdtemp(dir=os.getcwd()))
${theme ? `try:
    import matplotlib, cycler
    matplotlib.rcParams.update(json.loads(${JSON.stringify(rc)}))
    matplotlib.rcParams["axes.prop_cycle"] = cycler.cycler(color=json.loads(${JSON.stringify(JSON.stringify(theme.series))}))
except Exception:
    pass
` : ''}_cells = json.loads(${JSON.stringify(json)})
_ns = {"__name__": "__main__"}
def _tide_run(src, show):
    tree = ast.parse(src)
    last = None
    if show and tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    exec(compile(tree, "<cell>", "exec"), _ns)
    if last is not None:
        v = eval(compile(last, "<cell>", "eval"), _ns)
        if v is None:
            return
        html = None
        try:
            html = v._repr_html_() if hasattr(v, "_repr_html_") and not isinstance(v, type) else None
        except Exception:
            html = None
        if html:
            print(${JSON.stringify(MARKS.html)} + json.dumps(html))
        else:
            print(repr(v))
def _tide_figs(keep):
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    for n in plt.get_fignums():
        if keep:
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            print(${JSON.stringify(MARKS.png)} + base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
for _i, _src in enumerate(_cells[:-1]):
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            _tide_run(_src, False)
            _tide_figs(False)
    except Exception as _e:
        print(${JSON.stringify(MARKS.before)} + str(_i + 1) + ": " + type(_e).__name__ + ": " + str(_e), file=sys.stderr)
print(${JSON.stringify(MARKS.start)})
sys.stdout.flush()
_tide_run(_cells[-1], True)
_tide_figs(True)
`
}

/** What the plain runner printed, as a cell's outputs */
export function runnerOutputs(r: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }): Output[] {
  const out: Output[] = []
  const at = r.stdout.indexOf(MARKS.start)
  const own = at < 0 ? '' : r.stdout.slice(at + MARKS.start.length).replace(/^\n/, '')
  let text = ''
  const flush = () => {
    if (text) out.push({ output_type: 'stream', name: 'stdout', text })
    text = ''
  }
  for (const line of own.split(/(?<=\n)/)) {
    if (line.startsWith(MARKS.png)) {
      flush()
      out.push({ output_type: 'display_data', data: { 'image/png': line.slice(MARKS.png.length).trim(), 'text/plain': '<Figure>' }, metadata: {} })
    } else if (line.startsWith(MARKS.html)) {
      flush()
      let html = ''
      try {
        html = JSON.parse(line.slice(MARKS.html.length))
      } catch {
        html = ''
      }
      if (html) out.push({ output_type: 'execute_result', data: { 'text/html': html, 'text/plain': '' }, metadata: {}, execution_count: null })
    } else text += line
  }
  flush()
  const before = r.stderr
    .split('\n')
    .filter((l) => l.startsWith(MARKS.before))
    .map((l) => l.slice(MARKS.before.length))
  const lines = r.stderr.split('\n').filter((l) => !l.startsWith(MARKS.before) && !/^Matplotlib is building the font cache/.test(l))
  // The traceback from the cell down: the runner's own frames say nothing about the code
  const from = lines.findIndex((l) => l.includes('File "<cell>"'))
  let err = (from > 0 ? ['Traceback (most recent call last):', ...lines.slice(from)] : lines).join('\n').trim()
  // This cell ran: what the runner said about the cells above (a library they lacked) isn't about it
  if (before.length && at >= 0 && !/Traceback \(most recent call last\)/.test(err)) err = ''
  if (err) {
    const last = err.split('\n').filter(Boolean).pop() ?? ''
    const m = last.match(/^([A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit)):?\s*(.*)$/)
    if (/Traceback \(most recent call last\)/.test(err) && m) out.push({ output_type: 'error', ename: m[1], evalue: m[2], traceback: [err.replace(/File "<cell>"/g, 'In this cell')] })
    else out.push({ output_type: 'stream', name: 'stderr', text: `${err}\n` })
  }
  // Cells above that failed matter only when this one failed too (a name they would have made, say)
  if (before.length && out.some((o) => o.output_type === 'error'))
    out.unshift({ output_type: 'stream', name: 'stderr', text: `${before.length === 1 ? 'A cell above this one' : 'Cells above this one'} stopped with an error (cell ${before.join('; cell ')}).\n` })
  if (r.timedOut) out.push({ output_type: 'stream', name: 'stderr', text: 'Stopped: it ran too long without Jupyter’s kernel. Install the quant pack to run long cells.\n' })
  return out
}

/** The module an import failed for, when that is why a cell stopped */
export function missingModule(outputs: Output[]): string | null {
  for (const o of outputs) {
    const text = o.output_type === 'error' ? `${o.ename}: ${o.evalue}` : o.output_type === 'stream' ? o.text : ''
    const m = stripAnsi(text).match(/(?:ModuleNotFoundError|ImportError): No module named '([\w.]+)'/)
    if (m) return m[1].split('.')[0]
  }
  return null
}

/**
 * The lesson as a notebook: its text between the code as Markdown cells, each Python block as a
 * code cell with the code as it is now and what it last printed, practice cells where they were
 * added, and the course's own ```output blocks left out (the cells' outputs stand for them).
 */
export function lessonNotebook(markdown: string, cells: LessonCellState[], head?: string): Notebook {
  const nb = newNotebook([])
  const own = cells.filter((c) => !c.practice)
  const practiceAfter = new Map<string, LessonCellState[]>()
  let anchor: string | null = null
  for (const c of cells) {
    if (c.practice && anchor) practiceAfter.set(anchor, [...(practiceAfter.get(anchor) ?? []), c])
    else if (!c.practice) anchor = c.id
  }
  const push = (c: LessonCellState) => {
    const cell = codeCell(c.source)
    cell.outputs = c.fromCourse ? [] : c.outputs
    cell.execution_count = c.fromCourse ? null : (c.count ?? null)
    nb.cells.push(cell)
  }
  let text = head ? `${head}\n\n` : ''
  let i = 0
  const lines = markdown.split('\n')
  for (let n = 0; n < lines.length; n++) {
    const f = lines[n].match(/^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/)
    if (!f) {
      text += `${lines[n]}\n`
      continue
    }
    const fence = f[2]
    let end = n + 1
    while (end < lines.length && !new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(lines[end])) end++
    const lang = f[3]
    if (PY_LANG.test(lang) && own[i]) {
      if (text.trim()) nb.cells.push(markdownCell(text.trim()))
      text = ''
      const c = own[i++]
      push(c)
      for (const p of practiceAfter.get(c.id) ?? []) push(p)
    } else if (lang !== 'output') text += `${lines.slice(n, end + 1).join('\n')}\n`
    n = end
  }
  if (text.trim()) nb.cells.push(markdownCell(text.trim()))
  // Cells the text didn't place (an edit to the lesson since): at the end
  for (const c of own.slice(i)) push(c)
  return nb
}

/** The cells as the tutor reads them: each one's code (and whether it is the course's or changed) and what it last gave */
export function cellsText(cells: LessonCellState[]): string {
  const shown = cells.filter((c) => c.runs > 0 || c.practice || c.source !== c.original)
  if (!shown.length) return cells.length ? `${cells.length} code cell${cells.length > 1 ? 's' : ''} in the lesson, none run yet.` : ''
  return shown
    .map((c) => {
      const n = cells.indexOf(c) + 1
      const state = c.practice ? 'a practice cell they added' : c.source !== c.original ? 'the course’s code, edited' : 'the course’s code'
      const outs = c.fromCourse ? '' : c.outputs.map((o) => outputText(o, 600)).join('\n')
      return `Cell ${n} (${state}${c.runs ? `, run ${c.runs}×` : ', not run'}):\n\`\`\`python\n${c.source.slice(0, 1500)}\n\`\`\`${outs ? `\n${outs}` : ''}`
    })
    .join('\n\n')
}
