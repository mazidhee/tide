import { describe, expect, it } from 'vitest'
import { cellType, columnNames, CsvError, inferType, parseDelimited, readCsvTable, sniffDelimiter, tableNameFor } from '../src/shared/csvTable'

describe('splitting delimited text', () => {
  it('reads plain rows, with or without a last line break', () => {
    expect(parseDelimited('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('')).toEqual([])
    expect(parseDelimited('a,b\n1,')).toEqual([['a', 'b'], ['1', '']])
    expect(parseDelimited(',\n')).toEqual([['', '']])
  })

  it('reads quoted cells: delimiters, line breaks and doubled quotes inside them', () => {
    expect(parseDelimited('name,note\n"Okafor, Ada","said ""hello"""\n')).toEqual([['name', 'note'], ['Okafor, Ada', 'said "hello"']])
    expect(parseDelimited('a,b\n"line one\nline two",2\r\n"x\r\ny",3')).toEqual([['a', 'b'], ['line one\nline two', '2'], ['x\r\ny', '3']])
    expect(parseDelimited('"",""\n"a"')).toEqual([['', ''], ['a']])
    expect(parseDelimited('""""')).toEqual([['"']])
  })

  it('handles CRLF, old Mac line ends, a byte-order mark and blank lines', () => {
    expect(parseDelimited('﻿id,name\r\n1,Ada\r\n\r\n2,Tom\r\n')).toEqual([['id', 'name'], ['1', 'Ada'], ['2', 'Tom']])
    expect(parseDelimited('a\rb\rc')).toEqual([['a'], ['b'], ['c']])
    // A line holding only "" is a row with an empty cell, not a blank line
    expect(parseDelimited('a\n""\nb\n')).toEqual([['a'], [''], ['b']])
  })

  it('is lenient with what real files get wrong', () => {
    expect(parseDelimited('a,5" pipe,c')).toEqual([['a', '5" pipe', 'c']])
    expect(parseDelimited('"abc"def,2')).toEqual([['abcdef', '2']])
    expect(parseDelimited('a,"never closed\nb,c')).toEqual([['a', 'never closed\nb,c']])
  })

  it('splits on tabs and semicolons, and works out which a .csv uses', () => {
    expect(parseDelimited('a\tb\n1,5\t"x\ty"', '\t')).toEqual([['a', 'b'], ['1,5', 'x\ty']])
    expect(sniffDelimiter('a,b,c\n1;2;3')).toBe(',')
    expect(sniffDelimiter('a;b;c\n1,5;2;3')).toBe(';')
    expect(sniffDelimiter('a\tb\tc')).toBe('\t')
    expect(sniffDelimiter('"a;b;c",d\n')).toBe(',')
    expect(sniffDelimiter('single')).toBe(',')
    expect(readCsvTable('id;price\n1;2.5\n').columns).toEqual([{ name: 'id', type: 'integer' }, { name: 'price', type: 'real' }])
  })
})

describe('column types', () => {
  it('tells integers, reals and text apart', () => {
    for (const s of ['0', '7', '-12', ' 42 ', '9223372036854775807', '-9223372036854775808']) expect(cellType(s), s).toBe('integer')
    for (const s of ['0.5', '-3.25', '1.', '.5', '1e6', '2.5E-3', '-0.0']) expect(cellType(s), s).toBe('real')
    for (const s of ['007', '-01', '00.5', '+44', '1,234', '£5', '12%', 'NaN', 'Infinity', '0x1F', '1e999', '9223372036854775808', '123456789012345678901234567890', '2025-01-06', '2025-01-06 10:00:00', '12:30', '1 2', 'abc', ''])
      expect(cellType(s), s).toBe('text')
  })

  it('gives a column the narrowest type that fits every cell, ignoring empty ones', () => {
    expect(inferType(['1', null, '3'])).toBe('integer')
    expect(inferType(['1', '2.5', null])).toBe('real')
    expect(inferType(['2.5', '1'])).toBe('real')
    expect(inferType(['1', 'n/a', '3'])).toBe('text')
    expect(inferType(['1', '007'])).toBe('text')
    expect(inferType(['1', '99999999999999999999'])).toBe('text')
    expect(inferType([null, '', '  '])).toBe('text')
    expect(inferType([])).toBe('text')
  })
})

describe('names', () => {
  it('makes a table name from a file name', () => {
    expect(tableNameFor('Data/Sales 2024 (final).csv')).toBe('sales_2024_final')
    expect(tableNameFor('survey.TSV')).toBe('survey')
    expect(tableNameFor('2024-results.csv')).toBe('t_2024_results')
    expect(tableNameFor('Café Münster.csv')).toBe('cafe_munster')
    expect(tableNameFor('orders.csv')).toBe('orders_data')
    expect(tableNameFor('Order.csv')).toBe('order_data')
    expect(tableNameFor('select.csv')).toBe('select_data')
    expect(tableNameFor('sqlite_master.csv')).toBe('sqlite_master_data')
    expect(tableNameFor('数据.csv')).toBe('data')
    expect(tableNameFor('.csv')).toBe('data')
    expect(tableNameFor(`${'x'.repeat(80)}.csv`)).toHaveLength(48)
    expect(tableNameFor('a"; DROP TABLE customers; --.csv')).toBe('a_drop_table_customers')
  })

  it('makes column names safe and different from each other', () => {
    expect(columnNames(['ID', 'Order Date', 'Total (£)', '', 'id', 'Id', '  ', '2024', 'group', 'order date'])).toEqual(['id', 'order_date', 'total', 'column_4', 'id_2', 'id_3', 'column_7', 'c_2024', 'group_col', 'order_date_2'])
    expect(columnNames(['a_2', 'a', 'a'])).toEqual(['a_2', 'a', 'a_3'])
  })
})

describe('reading a file as a table', () => {
  it('types each column, leaves dates and codes as text, and turns empty cells into NULL', () => {
    const t = readCsvTable('﻿id,Amount,Code,Day,Note,Score\r\n1,2.50,007,2025-01-06,"a, b",\r\n2,,010,2025-01-07,,3\r\n3,4,,,"",4.5\r\n')
    expect(t.columns).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'amount', type: 'real' },
      { name: 'code', type: 'text' },
      { name: 'day', type: 'text' },
      { name: 'note', type: 'text' },
      { name: 'score', type: 'real' }
    ])
    expect(t.rows).toEqual([
      ['1', '2.50', '007', '2025-01-06', 'a, b', null],
      ['2', null, '010', '2025-01-07', null, '3'],
      ['3', '4', null, null, null, '4.5']
    ])
    expect([t.padded, t.cut]).toEqual([0, 0])
  })

  it('fills out short rows, cuts long ones, and counts both', () => {
    const t = readCsvTable('a,b,c\n1\n1,2,3,4,5\n1,2,3\n')
    expect(t.rows).toEqual([['1', null, null], ['1', '2', '3'], ['1', '2', '3']])
    expect([t.padded, t.cut]).toEqual([1, 1])
  })

  it('trims the spaces round numbers but keeps text as written', () => {
    const t = readCsvTable('n,s\n 1 , x \n   , y\n')
    expect(t.columns.map((c) => c.type)).toEqual(['integer', 'text'])
    expect(t.rows).toEqual([['1', ' x '], [null, ' y']])
  })

  it('takes a header with no rows, and refuses an empty file', () => {
    expect(readCsvTable('a,b\n')).toMatchObject({ columns: [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }], rows: [] })
    expect(() => readCsvTable('')).toThrow(CsvError)
    expect(() => readCsvTable('\n\n')).toThrow('This file is empty')
  })

  it('says what the limit is and what the file has when it is too big', () => {
    const text = `n\n${Array.from({ length: 12 }, (_, i) => i).join('\n')}\n`
    expect(() => readCsvTable(text, { limits: { rows: 10 } })).toThrow('This file has 12 rows; the lab loads at most 10 from one file.')
    expect(readCsvTable(text, { limits: { rows: 12 } }).rows).toHaveLength(12)
    expect(() => readCsvTable('a,b,c\n1,2,3', { limits: { columns: 2 } })).toThrow('This file has 3 columns; the lab loads at most 2 from one file.')
    const wide = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',')
    expect(() => readCsvTable(wide)).toThrow('101 columns; the lab loads at most 100')
  })
})
