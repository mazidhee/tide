import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// A fixture notes folder in a temporary directory, and the real Rust module beside the source
const root = mkdtempSync(join(tmpdir(), 'tide-lab-load-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, 'Data'), { recursive: true })
mkdirSync(join(vault, 'Secret project'), { recursive: true })
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => root } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

import { labLoadTable, labQuery, labReset, labSchema, loadTableTool, runSqlTool, vaultDataFile } from '../src/main/lab'

const isPrivate = async (p: string) => p === 'Secret project' || p.startsWith('Secret project/')
/** As the lab:load IPC does it */
const load = (id: string, path: string) => labLoadTable(id, path, isPrivate)
import { CSV_LIMITS } from '../src/shared/csvTable'

const write = (rel: string, text: string | Buffer) => writeFileSync(join(vault, rel), text)
afterAll(() => rmSync(root, { recursive: true, force: true }))

write('Data/Sales 2024.csv', '﻿Order ID,Customer,Amount,Postcode,Day,Notes\r\n1,1,12.50,007,2025-01-06,"first, ""quoted"""\r\n2,2,8,010,2025-01-07,\r\n3,1,,E1 6AN,2025-01-08,"two\nlines"\r\n')
write('Data/survey.tsv', 'who\tscore\tcomment\nAda\t4\tgood, clear\nTom\t5\t\n')
write('Secret project/payroll.csv', 'name,salary\nAda,50000\n')
write('outside.csv', 'a\n1\n')
writeFileSync(join(root, 'elsewhere.csv'), 'a\n1\n')

describe('loading the learner’s own file into the lab', () => {
  it('makes a typed table named after the file, which SQL can then query', async () => {
    const r = await load('own-1', 'Data/Sales 2024.csv')
    expect(r.error).toBeUndefined()
    expect(r).toMatchObject({ table: 'sales_2024', path: 'Data/Sales 2024.csv', rows: 3, replaced: false, padded: 0, cut: 0 })
    expect(r.columns).toEqual([
      { name: 'order_id', type: 'integer' },
      { name: 'customer', type: 'integer' },
      { name: 'amount', type: 'real' },
      { name: 'postcode', type: 'text' },
      { name: 'day', type: 'text' },
      { name: 'notes', type: 'text' }
    ])
    const q = labQuery('own-1', 'SELECT order_id, amount, postcode, day, notes, typeof(amount) AS kind FROM sales_2024 ORDER BY order_id')
    expect(q.error ?? null).toBeNull()
    expect(q.types.slice(0, 5)).toEqual(['integer', 'real', 'text', 'text', 'text'])
    expect(q.rows).toEqual([
      [1, 12.5, '007', '2025-01-06', 'first, "quoted"', 'real'],
      [2, 8, '010', '2025-01-07', null, 'real'],
      [3, null, 'E1 6AN', '2025-01-08', 'two\nlines', 'null']
    ])
    // Beside the sample data, and joinable to it
    expect(labQuery('own-1', 'SELECT c.name, sum(s.amount) FROM sales_2024 s JOIN customers c ON c.customer_id = s.customer GROUP BY 1 ORDER BY 2 DESC').rows.length).toBe(2)
    expect(labQuery('own-1', "SELECT strftime('%m', day) AS month, count(*) FROM sales_2024 GROUP BY 1").rows).toEqual([['01', 3]])
    const t = labSchema('own-1').find((x) => x.name === 'sales_2024')
    expect(t?.rows).toBe(3)
    // Another conversation's lab doesn't have it
    expect(labQuery('own-other', 'SELECT * FROM sales_2024').error).toBe('no such table: sales_2024')
  })

  it('reads a .tsv on tabs', async () => {
    const r = await load('own-1', 'Data/survey.tsv')
    expect(r).toMatchObject({ table: 'survey', rows: 2 })
    expect(r.columns.map((c) => `${c.name} ${c.type}`)).toEqual(['who text', 'score integer', 'comment text'])
    expect(labQuery('own-1', 'SELECT comment FROM survey WHERE score = 4').rows).toEqual([['good, clear']])
  })

  it('replaces the table when the same file is loaded again, and numbers it when the name is someone else’s', async () => {
    write('Data/Sales 2024.csv', 'Order ID,Amount\n1,1\n2,2\n3,3\n4,4\n')
    const again = await load('own-1', './Data/../Data/Sales 2024.csv')
    expect(again).toMatchObject({ table: 'sales_2024', rows: 4, replaced: true })
    expect(labQuery('own-1', 'SELECT count(*), sum(amount) FROM sales_2024').rows).toEqual([[4, 10]])
    expect(labSchema('own-1').filter((t) => t.name.startsWith('sales_2024')).length).toBe(1)
    // A table the learner made themselves is never overwritten
    labQuery('own-2', 'CREATE TABLE survey (mine)')
    expect(await load('own-2', 'Data/survey.tsv')).toMatchObject({ table: 'survey_2', replaced: false })
    expect(await load('own-2', 'Data/survey.tsv')).toMatchObject({ table: 'survey_2', replaced: true })
    expect(labQuery('own-2', 'SELECT count(*) FROM survey').rows).toEqual([[0]])
    // Nor is the sample data, whatever the file is called
    write('Data/orders.csv', 'a\n1\n')
    expect((await load('own-2', 'Data/orders.csv')).table).toBe('orders_data')
    expect(labQuery('own-2', 'SELECT count(*) FROM orders').rows[0][0]).toBeGreaterThan(2000)
  })

  it('keeps the lab’s rules for a loaded table, and brings it back after a reset', async () => {
    expect(labQuery('own-1', "ATTACH DATABASE '/tmp/tide-own.db' AS other").error).toBeTruthy()
    expect(labQuery('own-1', 'PRAGMA writable_schema = 1').error).toMatch(/not authorized/)
    labQuery('own-1', 'DELETE FROM sales_2024; DROP TABLE survey; DELETE FROM customers')
    labReset('own-1')
    expect(labQuery('own-1', 'SELECT count(*) FROM sales_2024').rows).toEqual([[4]])
    expect(labQuery('own-1', 'SELECT count(*) FROM survey').rows).toEqual([[2]])
    expect(labQuery('own-1', 'SELECT count(*) FROM customers').rows).toEqual([[300]])
  })

  it('refuses what is outside the notes folder, not a CSV, or not there', async () => {
    expect((await load('own-3', '../elsewhere.csv')).error).toMatch(/outside the notes folder/)
    expect((await load('own-3', join(root, 'elsewhere.csv'))).error).toMatch(/outside the notes folder/)
    expect((await load('own-3', 'Data/../../elsewhere.csv')).error).toMatch(/outside the notes folder/)
    symlinkSync(join(root, 'elsewhere.csv'), join(vault, 'Data', 'link.csv'))
    expect((await load('own-3', 'Data/link.csv')).error).toMatch(/outside the notes folder/)
    write('Data/notes.md', 'a,b\n1,2\n')
    write('Data/book.xlsx', 'a,b\n1,2\n')
    expect((await load('own-3', 'Data/notes.md')).error).toBe("The lab loads .csv and .tsv files only, and Data/notes.md isn't one.")
    expect((await load('own-3', 'Data/book.xlsx')).error).toMatch(/\.csv and \.tsv files only/)
    expect((await load('own-3', 'Data')).error).toMatch(/\.csv and \.tsv files only/)
    expect((await load('own-3', 'Data/missing.csv')).error).toBe('There is no file at Data/missing.csv in the notes folder.')
    mkdirSync(join(vault, 'Data', 'folder.csv'))
    expect((await load('own-3', 'Data/folder.csv')).error).toBe('Data/folder.csv is a folder, not a file.')
    expect((await load('own-3', '  ')).error).toMatch(/No file was named/)
    write('Data/binary.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x2c, 0x00]))
    expect((await load('own-3', 'Data/binary.csv')).error).toMatch(/doesn't read as text/)
    write('Data/empty.csv', '')
    expect((await load('own-3', 'Data/empty.csv')).error).toMatch(/This file is empty/)
    // Nothing was added by any of them
    expect(labSchema('own-3').map((t) => t.name)).toEqual(['customers', 'products', 'orders', 'order_items', 'users', 'events'])
    expect(() => vaultDataFile('../elsewhere.csv')).toThrow(/outside the notes folder/)
  })

  it('refuses a file over the limits, saying the limit and the file’s size', async () => {
    expect(CSV_LIMITS).toEqual({ bytes: 10 * 1024 * 1024, rows: 100_000, columns: 100 })
    write('Data/huge.csv', `a,b\n${'1234567,abcdefghij\n'.repeat(600_000)}`)
    expect((await load('own-4', 'Data/huge.csv')).error).toBe('huge.csv is 11 MB; the lab loads files of up to 10 MB. Cut it down to the rows and columns you need.')
    write('Data/long.csv', `n\n${'1\n'.repeat(100_001)}`)
    expect((await load('own-4', 'Data/long.csv')).error).toMatch(/^This file has 100,001 rows; the lab loads at most 100,000 from one file\./)
    write('Data/wide.csv', `${Array.from({ length: 101 }, (_, i) => `c${i}`).join(',')}\n`)
    expect((await load('own-4', 'Data/wide.csv')).error).toMatch(/101 columns; the lab loads at most 100/)
    // Exactly at the row limit it loads, quickly
    write('Data/full.csv', `id,amount,label\n${Array.from({ length: 100_000 }, (_, i) => `${i},${(i % 97) + 0.5},row ${i}`).join('\n')}\n`)
    const t0 = Date.now()
    expect(await load('own-4', 'Data/full.csv')).toMatchObject({ table: 'full_data', rows: 100_000 })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(labQuery('own-4', 'SELECT count(*), max(id), typeof(amount) FROM full_data').rows).toEqual([[100_000, 99_999, 'real']])
  })

  it('reads UTF-16 with a byte-order mark, as Excel saves "Unicode text"', async () => {
    write('Data/excel.tsv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('name\tn\nZoë\t2\n', 'utf16le')]))
    expect(await load('own-5', 'Data/excel.tsv')).toMatchObject({ rows: 1, columns: [{ name: 'name', type: 'text' }, { name: 'n', type: 'integer' }] })
    expect(labQuery('own-5', 'SELECT name FROM excel').rows).toEqual([['Zoë']])
  })
})

describe('the load_table tool', () => {
  it('returns the table’s name, columns with types and row count', async () => {
    const r = await loadTableTool('tool-own-1', 'Data/survey.tsv', { private: false, isPrivate })
    expect(r).toEqual({ text: 'Loaded Data/survey.tsv as the table survey (2 rows). Columns: who text, score integer, comment text.', ok: true, detail: 'survey: 2 rows' })
    const again = await loadTableTool('tool-own-1', 'Data/survey.tsv', { private: false, isPrivate })
    expect(again.text).toMatch(/It replaced the earlier load of this file\.$/)
    write('Data/ragged.csv', 'a,b\n1\n1,2,3\n')
    expect((await loadTableTool('tool-own-1', 'Data/ragged.csv', { private: false, isPrivate })).text).toBe(
      'Loaded Data/ragged.csv as the table ragged (2 rows). Columns: a integer, b integer. 1 row had fewer cells than the header and was filled out with NULL. 1 row had more cells than the header; the extra cells were dropped.'
    )
    // run_sql sees it, and its first result says where the table came from
    const first = runSqlTool('tool-own-1', 'SELECT who FROM survey ORDER BY score DESC', false)
    expect(first.text).toMatch(/^who\nTom\nAda\n2 rows · /)
    expect(first.text).toContain('survey (2 rows): who, score integer, comment')
    expect(first.text).toContain("Loaded from the student's own files: survey (Data/survey.tsv), ragged (Data/ragged.csv).")
  })

  it('loads a private project’s file only on a private turn', async () => {
    const open = await loadTableTool('tool-own-2', 'Secret project/payroll.csv', { private: false, isPrivate })
    expect(open.ok).toBe(false)
    expect(open.text).toBe('Could not load that file: Secret project/payroll.csv belongs to a private project, whose files stay on this Mac. It can be loaded in a lesson or conversation about that project.')
    expect(labQuery('tool-own-2', 'SELECT * FROM payroll').error).toBe('no such table: payroll')
    // Another way of writing the path, or a link to the file from a folder that isn't private, is no way round
    expect((await loadTableTool('tool-own-2', 'Data/../Secret project/payroll.csv', { private: false, isPrivate })).ok).toBe(false)
    symlinkSync(join(vault, 'Secret project', 'payroll.csv'), join(vault, 'Data', 'pay.csv'))
    expect((await loadTableTool('tool-own-2', 'Data/pay.csv', { private: false, isPrivate })).text).toMatch(/belongs to a private project/)
    expect((await loadTableTool('tool-own-2', 'secret PROJECT/payroll.csv', { private: false, isPrivate })).ok).toBe(false)
    expect(labSchema('tool-own-2').some((t) => t.name.startsWith('pay'))).toBe(false)
    // On a private turn it loads; a file that isn't private loads on any turn
    const mine = await loadTableTool('tool-own-2', 'Secret project/payroll.csv', { private: true, isPrivate })
    expect(mine).toMatchObject({ ok: true, detail: 'payroll: 1 row' })
    expect(labQuery('tool-own-2', 'SELECT salary FROM payroll').rows).toEqual([[50000]])
    expect((await loadTableTool('tool-own-2', 'outside.csv', { private: false, isPrivate })).ok).toBe(true)
  })

  it('returns a refusal as text', async () => {
    expect(await loadTableTool('tool-own-3', '../elsewhere.csv', { private: false, isPrivate })).toEqual({ text: 'Could not load that file: Path is outside the notes folder: ../elsewhere.csv', ok: false, detail: 'not loaded' })
    expect((await loadTableTool('tool-own-3', 'Data/notes.md', { private: true, isPrivate })).text).toBe("Could not load that file: The lab loads .csv and .tsv files only, and Data/notes.md isn't one.")
    expect((await loadTableTool('tool-own-3', 'nowhere.csv', { private: false, isPrivate })).text).toBe('Could not load that file: There is no file at nowhere.csv in the notes folder.')
  })
})

describe('a private project’s table in the lab', () => {
  const HELD = /^This lab holds a table loaded from a private project: payroll \(Secret project\/payroll\.csv\)\. Its rows stay on this Mac, so run_sql is not available on this turn\. It can be queried in a lesson or conversation about that project; the student can clear it by dropping the table payroll in an SQL block \(DROP TABLE\), along with anything made from it\.$/

  it('answers run_sql only on a private turn, until the table is dropped', async () => {
    expect((await loadTableTool('priv-1', 'Secret project/payroll.csv', { private: true, isPrivate })).ok).toBe(true)
    expect(runSqlTool('priv-1', 'SELECT salary FROM payroll', true).text).toMatch(/^salary\n50000\n1 row · /)
    // Not private: nothing is run, whatever the query names, and no schema is given
    for (const sql of ['SELECT * FROM payroll', 'SELECT count(*) FROM customers', 'DROP TABLE payroll']) {
      const r = runSqlTool('priv-1', sql, false)
      expect(r).toMatchObject({ ok: false, detail: 'private' })
      expect(r.text).toMatch(HELD)
      expect(r.text).not.toContain('50000')
    }
    expect(labQuery('priv-1', 'SELECT count(*) FROM payroll').rows).toEqual([[1]])
    // The learner drops it in a cell: with nothing made from it, the lab is open again
    labQuery('priv-1', 'DROP TABLE payroll')
    expect(runSqlTool('priv-1', 'SELECT count(*) AS n FROM customers', false).text).toMatch(/^n\n300\n/)
    expect(runSqlTool('priv-1', 'SELECT 1 AS one', false).ok).toBe(true)
  })

  it('stays private while a view, a copy or a temporary table made from it is left', async () => {
    await loadTableTool('priv-2', 'Secret project/payroll.csv', { private: true, isPrivate })
    await loadTableTool('priv-2', 'Data/survey.tsv', { private: true, isPrivate })
    runSqlTool('priv-2', 'CREATE VIEW pay_view AS SELECT * FROM payroll; CREATE TABLE pay_copy AS SELECT * FROM payroll; CREATE TEMP TABLE pay_temp AS SELECT * FROM payroll', true)
    labQuery('priv-2', 'DROP VIEW pay_view; DROP TABLE payroll')
    const r = runSqlTool('priv-2', 'SELECT * FROM pay_copy', false)
    expect(r).toMatchObject({ ok: false, detail: 'private' })
    expect(r.text).toBe(
      'This lab held a table loaded from a private project, and pay_copy, pay_temp may have been made from it. Those rows stay on this Mac, so run_sql is not available on this turn. It can be queried in a lesson or conversation about that project; the student can clear it by dropping those tables and views in an SQL block.'
    )
    labQuery('priv-2', 'DROP TABLE pay_copy')
    expect(runSqlTool('priv-2', 'SELECT 1', false).text).toMatch(/pay_temp may have been made from it/)
    expect(runSqlTool('priv-2', 'SELECT name FROM pay_temp', true).text).toMatch(/^name\nAda\n/)
    labQuery('priv-2', 'DROP TABLE pay_temp')
    // Only the samples and a file that isn't private are left
    expect(runSqlTool('priv-2', 'SELECT count(*) AS n FROM survey', false).text).toMatch(/^n\n2\n/)
  })

  it('keeps the flag through a reset, which reads the file again', async () => {
    await loadTableTool('priv-3', 'Secret project/payroll.csv', { private: true, isPrivate })
    labQuery('priv-3', 'DELETE FROM payroll')
    labReset('priv-3')
    expect(labQuery('priv-3', 'SELECT count(*) FROM payroll').rows).toEqual([[1]])
    expect(runSqlTool('priv-3', 'SELECT * FROM payroll', false).text).toMatch(HELD)
    expect(runSqlTool('priv-3', 'SELECT count(*) AS n FROM payroll', true).text).toMatch(/^n\n1\n/)
  })

  it('is flagged when the file is loaded from the app rather than by the tutor', async () => {
    expect(await load('priv-4', 'Secret project/payroll.csv')).toMatchObject({ table: 'payroll', rows: 1 })
    expect(runSqlTool('priv-4', 'SELECT * FROM payroll', false)).toMatchObject({ ok: false, detail: 'private' })
    // By a link from a folder that isn't private, too
    expect(await load('priv-5', 'Data/pay.csv')).toMatchObject({ table: 'pay', rows: 1 })
    expect(runSqlTool('priv-5', 'SELECT * FROM pay', false).text).toMatch(/loaded from a private project: pay \(Data\/pay\.csv\)/)
    expect(runSqlTool('priv-5', 'SELECT salary FROM pay', true).ok).toBe(true)
  })

  it('leaves a lab with only files from outside private projects alone', async () => {
    await load('priv-6', 'Data/survey.tsv')
    await loadTableTool('priv-6', 'outside.csv', { private: false, isPrivate })
    labQuery('priv-6', 'CREATE TABLE mine AS SELECT * FROM survey')
    expect(runSqlTool('priv-6', 'SELECT count(*) AS n FROM mine', false).text).toMatch(/^n\n2\n/)
    labReset('priv-6')
    expect(runSqlTool('priv-6', 'SELECT count(*) AS n FROM survey', false).ok).toBe(true)
  })
})
