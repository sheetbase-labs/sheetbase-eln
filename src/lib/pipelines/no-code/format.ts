/**
 * The generated SQL of a no-code step as lines to read, the way the board draws it:
 *
 *   SELECT *,
 *     ROUND(...) AS step_yield_pct
 *   FROM previous
 *
 * Display only. The stored statement is the one line `generate.ts` writes, and a line break is
 * added only at a clause keyword outside quotes and brackets, so the lines joined with a space
 * are the statement again.
 */
const BREAK_BEFORE = ['FROM', 'WHERE', 'LEFT JOIN', 'INNER JOIN', 'ON']

export function sqlLines(statement: string): string[] {
  const lines: string[] = []
  let line = ''
  let depth = 0
  let quote: string | null = null

  for (let i = 0; i < statement.length; i += 1) {
    const ch = statement[i]

    if (quote) {
      if (ch === quote) quote = null
      line += ch
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      line += ch
      continue
    }

    if (ch === '(') depth += 1

    if (ch === ')') depth -= 1

    const atBoundary = i === 0 || statement[i - 1] === ' '

    if (depth === 0 && atBoundary && line.trim() !== '') {
      const keyword = BREAK_BEFORE.find((k) => statement.startsWith(`${k} `, i))

      if (keyword) {
        lines.push(line.trimEnd())
        line = ''
      }
    }

    line += ch

    // After "SELECT *," the added columns start on a line of their own, indented.
    if (depth === 0 && line === 'SELECT *, ') {
      lines.push('SELECT *,')
      line = '  '
    }
  }

  if (line.trim() !== '') lines.push(line.trimEnd())

  return lines
}
