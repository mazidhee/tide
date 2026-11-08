/**
 * Metabase, read-only. The tutor may look at dashboards, questions and tables and run queries, but
 * never change anything: SQL has to be a single SELECT (or WITH … SELECT), checked here before it
 * goes anywhere, on top of whatever the Metabase key itself is allowed to do.
 */

// Words that change data or reach outside a read, wherever they appear (a WITH can hide a DELETE,
// SELECT … INTO makes a table, FOR UPDATE takes locks)
const WRITES = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|rename|grant|revoke|copy|call|exec|execute|attach|detach|vacuum|into|dblink\w*|lo_\w+|pg_(?:read|write|terminate|cancel|sleep)\w*)\b/i

/** Why this SQL can't run, or null when it's a plain read */
export function sqlProblem(sql: string): string | null {
  // Strings, quoted names and comments can hold any words: judge only the code around them
  const code = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;\s*$/, '')
  if (!code) return 'The query is empty.'
  if (code.includes(';')) return 'Only one statement at a time.'
  if (!/^(select|with)\b/i.test(code)) return 'Only SELECT queries can run: Tide reads Metabase, it never changes it.'
  const write = WRITES.exec(code)
  if (write) return `"${write[1]}" isn't allowed: Tide only reads from Metabase.`
  return null
}

export interface MbColumn {
  display_name?: string
  name?: string
}

/** Rows as a small Markdown table, for the tutor: the first `limit` rows, long cells cut short */
export function rowsTable(cols: MbColumn[], rows: unknown[][], limit = 25): string {
  if (!cols.length) return 'No columns.'
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return (s.length > 48 ? `${s.slice(0, 47)}…` : s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  }
  const head = cols.map((c) => cell(c.display_name || c.name))
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.slice(0, limit).map((r) => `| ${r.map(cell).join(' | ')} |`)]
  if (rows.length > limit) lines.push(`(${rows.length - limit} more rows not shown)`)
  return lines.join('\n')
}

/** Whether a question is about Metabase or its data, so that conversation stays on this Mac */
export const aboutMetabase = (text: string, host?: string) => /\bmetabase\b/i.test(text) || (!!host && text.toLowerCase().includes(host.toLowerCase()))
