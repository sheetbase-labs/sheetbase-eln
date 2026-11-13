/**
 * Colours for the code editors: where each keyword, string, comment and
 * parameter sits in the text, as offsets the editor can mark. Cosmetic only;
 * the server checks the statement.
 */
import { tokenizeSql } from './sql-highlight'
import type { SqlTokenKind } from './sql-highlight'
import { pythonSpans } from './version-file-highlight'

export interface CodeTokenRange {
  from: number
  to: number
  kind: string
}

const SQL_KIND: Record<SqlTokenKind, string | undefined> = {
  keyword: 'kw',
  string: 'str',
  identifier: undefined,
  number: 'num',
  comment: 'cm',
  parameter: 'ref',
  plain: undefined,
}

export function sqlTokens(text: string): CodeTokenRange[] {
  const tokens: CodeTokenRange[] = []
  let at = 0

  for (const token of tokenizeSql(text)) {
    const kind = SQL_KIND[token.kind]

    if (kind) tokens.push({ from: at, to: at + token.text.length, kind })
    at += token.text.length
  }

  return tokens
}

export function pythonTokens(text: string): CodeTokenRange[] {
  const tokens: CodeTokenRange[] = []
  let at = 0

  for (const line of text.split('\n')) {
    let column = at

    for (const span of pythonSpans(line)) {
      if (span.kind !== 'plain')
        tokens.push({
          from: column,
          to: column + span.text.length,
          kind: span.kind,
        })
      column += span.text.length
    }

    at += line.length + 1
  }

  return tokens
}
