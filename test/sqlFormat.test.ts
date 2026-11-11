import { describe, expect, it } from 'vitest'
import { tidySql } from '../src/renderer/src/lib/sqlFormat'

describe('tidying a query', () => {
  it('puts each clause on its own line with keywords in capitals', async () => {
    expect(await tidySql('select name, count(*) as n from orders o join customers c on c.id = o.customer_id where o.total > 10 group by name order by n desc limit 5')).toBe(
      ['SELECT', '  name,', '  COUNT(*) AS n', 'FROM', '  orders o', '  JOIN customers c ON c.id = o.customer_id', 'WHERE', '  o.total > 10', 'GROUP BY', '  name', 'ORDER BY', '  n DESC', 'LIMIT', '  5'].join('\n')
    )
  })

  it('keeps comments, and leaves alone what it cannot read', async () => {
    expect(await tidySql('-- top customers\nselect 1')).toBe('-- top customers\nSELECT\n  1')
    expect(await tidySql('select (((')).toBeNull()
  })
})
