import { describe, expect, it } from 'vitest'
import { aboutMetabase, rowsTable, sqlProblem } from '../src/shared/metabase'

describe('sqlProblem', () => {
  it('lets plain reads through', () => {
    expect(sqlProblem("SELECT id, amount FROM payments WHERE status = 'settled' LIMIT 10")).toBeNull()
    expect(sqlProblem('with t as (select * from orders) select count(*) from t;')).toBeNull()
    expect(sqlProblem("select replace(name, 'a', 'b'), last_update from users")).toBeNull()
  })

  it('ignores words inside strings, quoted names and comments', () => {
    expect(sqlProblem("select * from logs where message = 'delete from users'")).toBeNull()
    expect(sqlProblem('select "update" from t -- drop table t')).toBeNull()
  })

  it('refuses anything that writes, locks or runs more than one statement', () => {
    expect(sqlProblem('delete from users')).toMatch(/Only SELECT/)
    expect(sqlProblem('select 1; drop table users')).toMatch(/one statement/)
    expect(sqlProblem('with gone as (delete from users returning *) select * from gone')).toMatch(/delete/)
    expect(sqlProblem('select * into backup from users')).toMatch(/into/)
    expect(sqlProblem('select * from users for update')).toMatch(/update/)
    expect(sqlProblem('select pg_sleep(100)')).toMatch(/pg_sleep/)
    expect(sqlProblem('  ')).toMatch(/empty/)
  })
})

describe('rowsTable', () => {
  it('draws a small table and says how many rows it left out', () => {
    const out = rowsTable(
      [{ display_name: 'Day' }, { name: 'total' }],
      [
        ['Mon', 3],
        ['Tue', null],
        ['Wed', 'a|b']
      ],
      2
    )
    expect(out.split('\n')).toEqual(['| Day | total |', '| --- | --- |', '| Mon | 3 |', '| Tue |  |', '(1 more rows not shown)'])
  })
})

describe('aboutMetabase', () => {
  it('spots Metabase by name or by its address', () => {
    expect(aboutMetabase('teach me our Metabase')).toBe(true)
    expect(aboutMetabase('what is on analytic.rank.africa/dashboard/4', 'analytic.rank.africa')).toBe(true)
    expect(aboutMetabase('explain base rates')).toBe(false)
  })
})
