/**
 * The real datasets under <Tide data>/datasets (shared/datasets): their sizes and columns for the
 * tutor's catalogue, the UCI archives unpacked once into CSV, and a table read into a lesson's SQL
 * lab the first time a query names it. Parquet is read in JavaScript (hyparquet), a spread-out
 * sample of the rows, so the lab's in-memory SQLite stays small.
 */
import { app } from 'electron'
import { execFile } from 'child_process'
import { promises as fs, existsSync, openSync, readSync, closeSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { DATASET_TABLES, datasetCatalogue, sampleRanges, type DatasetInfo, type DatasetTable } from '@shared/datasets'
import { parseDelimited, cellType, columnNames, sniffDelimiter, type ColumnType } from '@shared/csvTable'
import type { DatasetStatus } from '@shared/reference'
import { datasetsRoot } from './reference'

const run = promisify(execFile)

/** The files a table reads: one, or every month of a monthly set */
function filesOf(t: DatasetTable): string[] {
  const root = datasetsRoot()
  if (!t.file.includes('*')) return existsSync(join(root, t.file)) ? [join(root, t.file)] : []
  const dir = join(root, t.file.slice(0, t.file.lastIndexOf('/')))
  const re = new RegExp('^' + t.file.slice(t.file.lastIndexOf('/') + 1).replace(/[.]/g, '\\.').replace('*', '.*') + '$')
  try {
    return readdirSync(dir).filter((n) => re.test(n)).sort().map((n) => join(dir, n))
  } catch {
    return []
  }
}

// ---------- Reading files ----------

type Col = { name: string; type: ColumnType }

async function parquetMeta(file: string): Promise<{ rows: number; columns: Col[] }> {
  const { asyncBufferFromFile, parquetMetadataAsync, parquetSchema } = await import('hyparquet')
  const meta = await parquetMetadataAsync(await asyncBufferFromFile(file))
  const schema = parquetSchema(meta)
  const columns = schema.children.map((c) => {
    const e = c.element
    const t = e.type
    const logical = (e.logical_type as { type?: string } | undefined)?.type ?? e.converted_type
    const type: ColumnType = /TIMESTAMP|DATE|TIME/i.test(String(logical ?? '')) ? 'text' : t === 'INT32' || t === 'INT64' ? 'integer' : t === 'FLOAT' || t === 'DOUBLE' ? 'real' : 'text'
    return { name: e.name, type }
  })
  return { rows: Number(meta.num_rows), columns }
}

/** The first `bytes` of a file as text, cut at the last full line */
function head(file: string, bytes: number): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(bytes, statSync(file).size))
    const n = readSync(fd, buf, 0, buf.length, 0)
    const text = buf.subarray(0, n).toString('utf8')
    return n < statSync(file).size ? text.slice(0, text.lastIndexOf('\n') + 1) : text
  } finally {
    closeSync(fd)
  }
}

async function countLines(file: string): Promise<number> {
  let n = 0
  const fh = await fs.open(file, 'r')
  try {
    for await (const chunk of fh.createReadStream({ highWaterMark: 1 << 20 })) {
      const b = chunk as Buffer
      for (let i = 0; i < b.length; i++) if (b[i] === 10) n++
    }
  } finally {
    await fh.close()
  }
  return n
}

async function csvMeta(file: string, delimiter?: string): Promise<{ rows: number; columns: Col[] }> {
  const text = head(file, 256 * 1024)
  const rows = parseDelimited(text, delimiter ?? sniffDelimiter(text))
  const names = columnNames(rows[0] ?? [])
  const columns = names.map((name, i) => {
    let type: ColumnType = 'integer'
    for (const r of rows.slice(1, 200)) {
      const c = r[i] == null || r[i] === '' ? null : cellType(r[i])
      if (c === 'text') type = 'text'
      else if (c === 'real' && type === 'integer') type = 'real'
    }
    return { name, type }
  })
  return { rows: Math.max(0, (await countLines(file)) - 1), columns }
}

// ---------- The catalogue ----------

let infoCache: { at: number; tables: DatasetInfo[] } | null = null
export async function datasetInfo(): Promise<DatasetInfo[]> {
  if (infoCache && Date.now() - infoCache.at < 10 * 60_000) return infoCache.tables
  const tables: DatasetInfo[] = []
  for (const t of DATASET_TABLES) {
    const files = filesOf(t)
    if (!files.length) continue
    try {
      const bytes = files.reduce((n, f) => n + statSync(f).size, 0)
      if (files[0].endsWith('.parquet')) {
        const metas = await Promise.all(files.map(parquetMeta))
        tables.push({ ...t, abs: files[0], files, rows: metas.reduce((n, m) => n + m.rows, 0), columns: metas[0].columns, bytes })
      } else {
        const m = await csvMeta(files[0], t.delimiter)
        tables.push({ ...t, abs: files[0], files, rows: m.rows, columns: m.columns, bytes })
      }
    } catch (e) {
      console.warn('[datasets] could not read', t.name, (e as Error).message)
    }
  }
  infoCache = { at: Date.now(), tables }
  return tables
}

/** The tutor's catalogue, or '' when there are no datasets */
export async function datasetCatalogueText(): Promise<string> {
  const tables = await datasetInfo().catch(() => [])
  return datasetCatalogue(tables, { parquet: await pythonReadsParquet() })
}

let parquetOk: boolean | undefined
/** Whether the learner's python3 has pandas with a Parquet engine */
export async function pythonReadsParquet(): Promise<boolean> {
  if (parquetOk !== undefined) return parquetOk
  try {
    await run('python3', ['-c', 'import pandas, pyarrow'], { env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` }, timeout: 15_000 })
    parquetOk = true
  } catch {
    try {
      await run('python3', ['-c', 'import pandas, fastparquet'], { env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` }, timeout: 15_000 })
      parquetOk = true
    } catch {
      parquetOk = false
    }
  }
  return parquetOk
}

export async function datasetStatus(): Promise<DatasetStatus[]> {
  const root = datasetsRoot()
  const tables = await datasetInfo().catch(() => [] as DatasetInfo[])
  const ids = ['nyc-taxi', 'ml-zoomcamp', 'uci']
  return ids.map((id) => {
    const folder = join(root, id)
    let bytes = 0
    const walk = (d: string, depth: number) => {
      if (depth > 3) return
      for (const e of (() => {
        try {
          return readdirSync(d, { withFileTypes: true })
        } catch {
          return []
        }
      })()) {
        if (e.name.startsWith('.')) continue
        if (e.isDirectory()) walk(join(d, e.name), depth + 1)
        else
          try {
            bytes += statSync(join(d, e.name)).size
          } catch {
            // gone
          }
      }
    }
    walk(folder, 0)
    const label = { 'nyc-taxi': 'NYC yellow taxi', 'ml-zoomcamp': 'ML Zoomcamp datasets', uci: 'UCI datasets' }[id] ?? id
    return {
      id,
      label,
      folder,
      exists: existsSync(folder),
      bytes,
      tables: tables.filter((t) => t.dataset === id).map((t) => ({ name: t.name, file: t.file, rows: t.rows, columns: t.columns.map((c) => c.name) }))
    }
  })
}

// ---------- Unpacking the UCI archives ----------

let preparing: Promise<void> | null = null
/** Unzips the UCI archives into uci/extracted and turns their spreadsheets into CSV; once, then only what's missing */
export function prepareDatasets(): Promise<void> {
  preparing ??= (async () => {
    const uci = join(datasetsRoot(), 'uci')
    if (!existsSync(uci)) return void (await Promise.all((await datasetInfo().catch(() => [] as DatasetInfo[])).filter((t) => t.abs.endsWith('.parquet')).map((t) => readDatasetTable(t.name).catch(() => null))))
    const out = join(uci, 'extracted')
    await fs.mkdir(out, { recursive: true })
    const unzip = (zip: string, dir: string) => run('/usr/bin/unzip', ['-o', '-q', zip, '-d', dir], { timeout: 120_000 })
    try {
      if (existsSync(join(uci, 'bank_marketing.zip')) && !existsSync(join(out, 'bank-additional-full.csv'))) {
        await unzip(join(uci, 'bank_marketing.zip'), join(out, 'bank'))
        await unzip(join(out, 'bank', 'bank-additional.zip'), join(out, 'bank'))
        const found = join(out, 'bank', 'bank-additional', 'bank-additional-full.csv')
        if (existsSync(found)) await fs.copyFile(found, join(out, 'bank-additional-full.csv'))
      }
      const sheets: [string, string, string, number][] = [
        ['default_credit_card.zip', 'default of credit card clients.xls', 'default_of_credit_card_clients.csv', 1],
        ['online_retail_ii.zip', 'online_retail_II.xlsx', 'online_retail_II.csv', 0]
      ]
      for (const [zip, inner, csv, skip] of sheets) {
        if (!existsSync(join(uci, zip)) || existsSync(join(out, csv))) continue
        await unzip(join(uci, zip), out)
        const py = await spreadsheetPython()
        if (!py) {
          console.warn('[datasets] no Python with pandas and openpyxl/xlrd to turn', inner, 'into CSV')
          continue
        }
        // Every sheet, stacked (Online Retail II keeps 2009-10 and 2010-11 on two)
        const script = 'import sys, pandas as pd\nframes = pd.read_excel(sys.argv[1], sheet_name=None, header=int(sys.argv[3]))\npd.concat(frames.values(), ignore_index=True).to_csv(sys.argv[2], index=False)'
        await run(py, ['-I', '-c', script, join(out, inner), join(out, csv), String(skip)], { timeout: 15 * 60_000, maxBuffer: 1 << 24 })
        await fs.rm(join(out, inner), { force: true })
      }
    } catch (e) {
      console.warn('[datasets] could not prepare the UCI files', (e as Error).message)
    }
    infoCache = null
    // The Parquet samples the lab loads, read once now rather than in the middle of a lesson
    for (const t of await datasetInfo().catch(() => [] as DatasetInfo[])) if (t.abs.endsWith('.parquet')) await readDatasetTable(t.name).catch(() => null)
  })().finally(() => (preparing = null))
  return preparing
}

/** A Python that reads spreadsheets: Tide's embedding environment has pandas, openpyxl and xlrd */
async function spreadsheetPython(): Promise<string | null> {
  const { embedPython } = await import('./embeddings')
  for (const py of [embedPython(), 'python3'].filter(Boolean) as string[]) {
    try {
      await run(py, ['-c', 'import pandas, openpyxl, xlrd'], { timeout: 20_000 })
      return py
    } catch {
      // next
    }
  }
  return null
}

// ---------- Into the lab ----------

const cacheRoot = () => join(process.env.TIDE_INDEX_DIR || app.getPath('userData'), 'dataset-samples')
const sampleCache = (name: string) => join(cacheRoot(), `${name}.json`)

export interface LoadedTable {
  columns: string[]
  types: string[]
  rows: (string | null)[][]
  /** Rows in the file(s), when the lab holds a sample */
  of?: number
}

const cell = (v: unknown): string | null => {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 19).replace('T', ' ')
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return v ? '1' : '0'
  return String(v)
}

/** A dataset table's rows for the lab: a sample spread over the file(s) when it has more than the lab holds */
export async function readDatasetTable(name: string): Promise<LoadedTable | null> {
  const t = (await datasetInfo()).find((x) => x.name === name)
  if (!t) return null
  const cap = t.labRows ?? 100_000
  if (t.abs.endsWith('.parquet')) {
    // The sample is read once (prepareDatasets) and kept: decoding Parquet row groups takes seconds and memory
    const cache = sampleCache(name)
    const sig = t.files.map((f) => `${f}:${statSync(f).size}`).join('|')
    try {
      const kept = JSON.parse(await fs.readFile(cache, 'utf8')) as LoadedTable & { sig: string }
      if (kept.sig === sig) return { columns: kept.columns, types: kept.types, rows: kept.rows, of: kept.of }
    } catch {
      // not kept yet
    }
    const { asyncBufferFromFile, parquetMetadataAsync, parquetRead } = await import('hyparquet')
    const { compressors } = await import('hyparquet-compressors')
    const rows: (string | null)[][] = []
    const per = Math.floor(cap / t.files.length)
    for (const f of t.files) {
      const file = await asyncBufferFromFile(f)
      const metadata = await parquetMetadataAsync(file)
      // A few runs per file, each inside one row group: spread over the month without decoding all of it
      for (const [rowStart, rowEnd] of sampleRanges(Number(metadata.num_rows), per, 4)) {
        await parquetRead({ file, metadata, compressors, rowStart, rowEnd, onComplete: (data: unknown[][]) => void rows.push(...data.map((r) => r.map(cell))) })
      }
    }
    const out = { columns: t.columns.map((c) => c.name), types: t.columns.map((c) => c.type), rows, of: t.rows }
    await fs.mkdir(join(cacheRoot()), { recursive: true }).catch(() => {})
    await fs.writeFile(cache, JSON.stringify({ ...out, sig })).catch(() => {})
    return out
  }
  // CSV: the first rows up to the cap (read from the start of the file, not all of it)
  const text = head(t.abs, 64 * 1024 * 1024)
  const parsed = parseDelimited(text, t.delimiter ?? sniffDelimiter(text))
  const body = parsed.slice(1, cap + 1).filter((r) => r.length > 1 || r[0] !== '')
  const width = t.columns.length
  return {
    columns: t.columns.map((c) => c.name),
    types: t.columns.map((c) => c.type),
    rows: body.map((r) => Array.from({ length: width }, (_, i) => (r[i] == null || r[i] === '' ? null : r[i]))),
    ...(t.rows > body.length ? { of: t.rows } : {})
  }
}

export const datasetTableNames = async () => (await datasetInfo().catch(() => [])).map((t) => t.name)
