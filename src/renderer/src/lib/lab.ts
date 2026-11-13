/**
 * The data lab in tutor text, anywhere it renders (threads, lessons, notes), the way mermaid.ts
 * does diagrams. A ```sql block becomes a query you can edit and run (Cmd+Enter), with its result
 * under it as a table or a chart. A ```chart block (JSON: {"sql", "type"?, "x"?, "y"?, "title"?})
 * is run and drawn straight away, with its query a click away.
 *
 * Queries run on the lab of the conversation or lesson the block sits in: the nearest ancestor
 * with a data-lab attribute names it. Blocks still streaming in are left as code until they
 * settle.
 */
import { tidySql } from './sqlFormat'
import hljs from 'highlight.js/lib/common'
import { parseChartRequest, resultSummary, type ChartRequest, type LabResult } from '@shared/lab'
import { chooseChart, columnKinds, fullNumber, isIdColumn, type ChartType } from '@shared/labChart'
import { drawChart, drawFigure } from './labChart'
import { createKeeper, watchBlocks } from './liveBlocks'
import { offerPack } from './runBlocks'

/** Rows the table shows; the rest are counted in a line under it */
const TABLE_ROWS = 200
const TYPE_LABEL: Record<ChartType, string> = { bar: 'Bars', line: 'Line', scatter: 'Scatter' }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

function button(className: string, text: string, title?: string): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  if (title) b.title = title
  return b
}

/** A row of choices where one is on: Table | Chart, Bars | Line | Scatter */
function choice<T extends string>(label: string, options: [T, string][], value: T, onPick: (v: T) => void): HTMLElement {
  const group = el('div', 'segmented text lab-choice')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', label)
  for (const [key, text] of options) {
    const b = button(key === value ? 'on' : '', text)
    b.setAttribute('aria-pressed', String(key === value))
    b.addEventListener('click', () => key !== value && onPick(key))
    group.append(b)
  }
  return group
}

export function resultTable(r: LabResult): HTMLElement {
  const wrap = el('div', 'lab-table-wrap')
  wrap.tabIndex = 0
  wrap.setAttribute('role', 'region')
  wrap.setAttribute('aria-label', `Result: ${resultSummary(r)}`)
  const kinds = columnKinds(r)
  const table = el('table', 'lab-table')
  const head = el('tr')
  r.columns.forEach((name, c) => {
    const th = el('th', kinds[c] === 'number' ? 'num' : '', name)
    th.scope = 'col'
    if (r.types[c]) th.title = r.types[c]
    head.append(th)
  })
  const thead = el('thead')
  thead.append(head)
  const body = el('tbody')
  const plain = r.columns.map(isIdColumn)
  for (const row of r.rows.slice(0, TABLE_ROWS)) {
    const tr = el('tr')
    row.forEach((v, c) => {
      // A missing value in a column of numbers sits where the numbers do
      const td = el('td', [v === null ? 'null' : '', kinds[c] === 'number' ? 'num' : ''].join(' ').trim(), v === null ? 'null' : typeof v === 'number' ? fullNumber(v, !plain[c]) : v)
      // A cell on its own may be long; the whole of it is a hover away
      if (typeof v === 'string' && v.length > 60) td.title = v.slice(0, 600)
      tr.append(td)
    })
    body.append(tr)
  }
  table.append(thead, body)
  wrap.append(table)
  return wrap
}

interface Block {
  root: HTMLElement
  run(): Promise<void>
  /** Stops the chart and lets go of the result; a query still running is ignored when it answers */
  destroy(): void
}

/**
 * Builds the editor and its result. `ask` is set for a chart block: it opens on the chart, with the
 * query folded away. `postgres` runs it on the lesson's Postgres database (the Postgres pack)
 * instead of SQLite; a first line of -- session: B runs it in the second session.
 */
export function labBlock(sql: string, ask?: ChartRequest, postgres = false): Block {
  const charting = !!ask
  const root = el('div', `lab-block${charting ? ' lab-chart-block' : ''}${postgres ? ' lab-pg' : ''}`)
  let view: 'table' | 'chart' = charting ? 'chart' : 'table'
  let type: ChartType | undefined = ask?.type
  let result: LabResult | null = null
  let stopChart: (() => void) | null = null
  let turn = 0

  // The query: highlighted code with a plain textarea laid exactly over it, so it is edited in place
  const editor = el('div', 'lab-editor')
  const code = el('div', 'lab-code')
  const shown = el('pre', 'lab-hl')
  shown.setAttribute('aria-hidden', 'true')
  const shownCode = el('code', 'hljs')
  shown.append(shownCode)
  const input = el('textarea', 'lab-sql')
  input.value = sql
  input.spellcheck = false
  input.autocapitalize = 'off'
  input.setAttribute('autocorrect', 'off')
  input.setAttribute('aria-label', 'SQL query. Command and Enter runs it.')
  input.rows = 1
  const paint = () => {
    // The trailing space keeps a last empty line as tall in the copy as in the textarea
    shownCode.innerHTML = hljs.highlight(input.value, { language: 'sql', ignoreIllegals: true }).value + ' '
  }
  paint()
  input.addEventListener('input', paint)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void run()
    }
  })
  code.append(shown, input)

  const actions = el('div', 'lab-actions')
  const lang = el('span', 'lab-lang', 'SQL')
  lang.title = postgres ? 'Runs on PostgreSQL 18, in this lesson’s own database with the sample data' : 'Runs on SQLite, on the sample data kept for this conversation'
  const session = () => (/^\s*--\s*session\s*:?\s*b\b/im.test(input.value.split('\n').slice(0, 3).join('\n')) ? 'B' : 'A')
  const engine = el('span', 'lab-engine', postgres ? `PostgreSQL 18 · session ${session()}` : 'SQLite · sample data')
  if (postgres) input.addEventListener('input', () => (engine.textContent = `PostgreSQL 18 · session ${session()}`))
  const copy = button('lab-quiet', 'Copy', 'Copy the query')
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(input.value)
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy'), 1200)
  })
  const tidy = button('lab-quiet', 'Tidy', 'Lay the query out one clause to a line (Shift+Alt+F)')
  const tidyNow = async () => {
    const out = await tidySql(input.value)
    if (out === null) {
      tidy.textContent = 'Cannot tidy'
      setTimeout(() => (tidy.textContent = 'Tidy'), 1400)
      return
    }
    if (out === input.value) return
    input.value = out
    paint()
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  tidy.addEventListener('click', () => void tidyNow())
  input.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.altKey && e.code === 'KeyF') {
      e.preventDefault()
      void tidyNow()
    }
  })
  const runButton = button('lab-run', '', 'Run the query (Cmd+Enter)')
  const runLabel = el('span', '', 'Run')
  const keys = el('kbd', 'lab-kbd', '⌘↵')
  keys.setAttribute('aria-hidden', 'true')
  runButton.append(runLabel, keys)
  runButton.addEventListener('click', () => void run())
  actions.append(lang, engine, el('span', 'lab-space'), tidy, copy, runButton)
  editor.append(actions, code)

  // A chart block leads with its title and the picture; the query is a click away
  const out = el('div', 'lab-result')
  out.setAttribute('aria-live', 'polite')
  out.hidden = true
  let disclose: HTMLButtonElement | null = null
  const openQuery = (open: boolean) => {
    editor.hidden = !open
    disclose?.setAttribute('aria-expanded', String(open))
    if (disclose) disclose.textContent = open ? 'Hide the query' : 'Show the query'
  }
  if (charting) {
    const head = el('div', 'lab-head')
    head.append(el('div', 'lab-title', ask.title ?? ''))
    disclose = button('lab-quiet lab-disclose', 'Show the query')
    disclose.addEventListener('click', () => openQuery(editor.hidden))
    head.append(disclose)
    openQuery(false)
    root.append(head, out, editor)
  } else {
    root.append(editor, out)
  }

  const labId = () => root.closest<HTMLElement>('[data-lab]')?.dataset.lab || 'scratch'

  const render = () => {
    stopChart?.()
    stopChart = null
    out.textContent = ''
    out.hidden = !result
    if (!result) return
    const r = result
    if (r.error) {
      const box = el('div', 'lab-error')
      box.setAttribute('role', 'alert')
      box.append(el('span', 'lab-error-label', postgres ? 'Postgres says' : 'SQLite says'), el('code', 'lab-error-text', r.error))
      out.append(box)
      // Postgres not installed yet: the install is offered right here
      if (postgres) offerPack(box, r.error)
      // The query is what needs fixing, so it is put in front of you
      if (charting) openQuery(true)
      return
    }
    const bar = el('div', 'lab-result-bar')
    const meta = el('span', 'lab-meta', resultSummary(r))
    if (!r.columns.length) {
      // A write or a CREATE: nothing to show but that it happened, and a way back
      const reset = button('lab-quiet', 'Reset data', 'Put the sample data back as it was')
      reset.addEventListener('click', async () => {
        reset.disabled = true
        await (postgres ? window.tide.lab.pgReset(labId()) : window.tide.lab.reset(labId()))
        meta.textContent = 'The sample data is back as it was'
        reset.remove()
      })
      bar.append(meta, el('span', 'lab-space'), reset)
      out.append(bar)
      return
    }
    // A query plan reads as the indented tree Postgres prints, not as a table
    if (r.columns.length === 1 && r.columns[0] === 'QUERY PLAN') {
      bar.append(el('span', 'lab-meta', 'Query plan'), el('span', 'lab-space'), meta)
      out.append(bar, el('pre', 'lab-plan', r.rows.map((row) => String(row[0] ?? '')).join('\n')))
      return
    }
    const picture = chooseChart(r, { type, x: ask?.x, y: ask?.y })
    bar.append(choice('Show the result as', [['table', 'Table'], ['chart', 'Chart']], view, (v) => ((view = v), render())))
    if (view === 'chart' && picture.kind === 'chart' && picture.types.length > 1) {
      bar.append(choice('Chart form', picture.types.map((t) => [t, TYPE_LABEL[t]] as [ChartType, string]), picture.type, (t) => ((type = t), render())))
    }
    bar.append(el('span', 'lab-space'), meta)
    out.append(bar)
    if (view === 'table') {
      out.append(resultTable(r))
      const hidden = r.rowCount - Math.min(r.rows.length, TABLE_ROWS)
      if (hidden > 0) out.append(el('p', 'lab-note', `${hidden.toLocaleString('en-GB')} more ${hidden === 1 ? 'row' : 'rows'} not shown. Add a LIMIT or a WHERE to see the ones you want.`))
      return
    }
    const host = el('div', 'lab-view')
    out.append(host)
    if (picture.kind === 'none') host.append(el('p', 'lab-empty', picture.reason))
    else if (picture.kind === 'number') drawFigure(host, picture.label, picture.value)
    else {
      stopChart = drawChart(host, picture, ask?.title)
      if (r.truncated) out.append(el('p', 'lab-note', `Drawn from the first ${r.rows.length.toLocaleString('en-GB')} of ${r.rowCount.toLocaleString('en-GB')} rows.`))
    }
  }

  async function run() {
    const mine = ++turn
    runButton.disabled = true
    runLabel.textContent = 'Running'
    root.classList.add('running')
    let r: LabResult
    try {
      if (postgres) {
        const pg = await window.tide.lab.pgQuery(labId(), input.value, session())
        r = pg
        // A transaction left open is worth seeing: the other session's queries depend on it
        engine.textContent = `PostgreSQL 18 · session ${pg.session}${pg.transaction === 'open' ? ' · in a transaction' : pg.transaction === 'failed' ? ' · transaction failed' : ''}`
      } else r = await window.tide.lab.query(labId(), input.value)
    } catch (e) {
      r = { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0, error: (e as Error).message }
    }
    if (mine !== turn) return
    runButton.disabled = false
    runLabel.textContent = 'Run'
    root.classList.remove('running')
    result = r
    render()
  }

  function destroy() {
    turn++
    stopChart?.()
    stopChart = null
    result = null
    out.textContent = ''
  }

  return { root, run, destroy }
}

const DONE = 'labDone'

const bodyOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''

// A chart labelled "json" by mistake is still a chart: a JSON object that opens with its query
function blockKind(pre: HTMLElement): 'chart' | 'sql' | 'postgres' | null {
  const lang = (pre.dataset.lang ?? '').toLowerCase()
  if (lang === 'chart' || (lang === 'json' && /^\s*\{\s*"sql"\s*:/.test(bodyOf(pre)))) return 'chart'
  if (lang === 'postgres' || lang === 'postgresql' || lang === 'pgsql' || lang === 'psql') return 'postgres'
  return lang === 'sql' || lang === 'sqlite' ? 'sql' : null
}

/** Queries and charts survive the text around them being replaced (see liveBlocks): edits, results and the chosen view stay */
const keeper = createKeeper({ widget: '.lab-block', isSource: (pre) => blockKind(pre) !== null, sourceOf: (pre) => bodyOf(pre).replace(/\s+$/, '') })

function mountSql(pre: HTMLElement, postgres = false) {
  const code = bodyOf(pre).replace(/\s+$/, '')
  pre.dataset[DONE] = '1'
  if (!code.trim()) return
  const slot = keeper.slot(pre)
  const block = labBlock(code, undefined, postgres)
  pre.replaceWith(block.root)
  keeper.keep(slot, block.root, block.destroy)
}

/** A chart block that doesn't parse stays a code block; once it has stopped changing, what is wrong is said under it */
function mountChart(pre: HTMLElement) {
  const body = bodyOf(pre)
  if (!body.trim()) return
  const ask = parseChartRequest(body)
  if ('error' in ask) {
    if (pre.dataset.labTried === body) {
      pre.dataset[DONE] = '1'
      const note = el('div', 'lab-error lab-under-code')
      note.setAttribute('role', 'alert')
      note.append(el('span', 'lab-error-label', 'Chart'), el('code', 'lab-error-text', ask.error))
      pre.after(note)
    } else {
      // Probably still being written: look again shortly, and only then call it wrong
      pre.dataset.labTried = body
      setTimeout(scan, 2500)
    }
    return
  }
  pre.dataset[DONE] = '1'
  const slot = keeper.slot(pre)
  const block = labBlock(ask.sql.trim(), ask)
  pre.replaceWith(block.root)
  keeper.keep(slot, block.root, block.destroy)
  void block.run()
}

function scan() {
  keeper.reclaim()
  document.querySelectorAll<HTMLElement>('pre.code-block[data-lang]').forEach((pre) => {
    if (pre.dataset[DONE] || !pre.isConnected) return
    const kind = blockKind(pre)
    if (kind === 'chart') mountChart(pre)
    else if (kind === 'sql') mountSql(pre)
    else if (kind === 'postgres') mountSql(pre, true)
  })
}

/** Watches the whole document; call once at startup */
export function startLab() {
  watchBlocks(keeper, scan)
  scan()
}
