/**
 * Tidies a query the way a style guide would: one clause to a line, keywords in capitals, the
 * select list and conditions indented. sql-formatter (MIT), SQLite dialect only, loaded the first
 * time someone asks.
 */
export async function tidySql(sql: string): Promise<string | null> {
  const { formatDialect, sqlite } = await import('sql-formatter')
  try {
    const out = formatDialect(sql, { dialect: sqlite, keywordCase: 'upper', functionCase: 'upper', dataTypeCase: 'upper', tabWidth: 2, linesBetweenQueries: 1 })
    return out.trim() ? out : null
  } catch {
    // Something it can't parse (a half-written query): leave it as it is
    return null
  }
}
