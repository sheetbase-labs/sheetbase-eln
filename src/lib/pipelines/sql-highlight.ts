/**
 * A small SQL tokenizer for the transform editor: it only decides which colour
 * each stretch of text gets. Nothing is parsed or validated here (the server
 * checks a statement before it runs), so an unfinished or wrong statement
 * highlights as best it can and never throws.
 *
 * The tokens always join back to exactly the text that went in, which is what
 * lets the editor draw them behind the textarea without the two drifting apart.
 */

export type SqlTokenKind =
  | 'keyword'
  | 'string'
  | 'identifier'
  | 'number'
  | 'comment'
  | 'parameter'
  | 'plain'

export interface SqlToken {
  kind: SqlTokenKind
  text: string
}

const KEYWORDS = new Set(
  (
    'select from where group by having order limit offset distinct all as on using join inner left right full outer cross ' +
    'union intersect except with recursive and or not in is null like ilike between exists case when then else end ' +
    'asc desc nulls first last over partition rows range unbounded preceding following current row filter within ' +
    'true false cast interval date timestamp lateral values any some array'
  ).split(' '),
)

const FUNCTIONS = new Set(
  (
    'count sum avg min max round floor ceil abs coalesce nullif greatest least lower upper trim length substring ' +
    'replace concat split_part to_char to_date date_trunc extract now row_number rank dense_rank lag lead first_value ' +
    'last_value percentile_cont percentile_disc stddev variance string_agg array_agg jsonb_build_object'
  ).split(' '),
)

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y
const NUMBER = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+/y

/** Split SQL into coloured stretches. `tokens.map(t => t.text).join('') === sql`. */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  const push = (kind: SqlTokenKind, text: string) => {
    const last = tokens.at(-1)
    if (last && last.kind === kind && kind === 'plain') last.text += text
    else tokens.push({ kind, text })
  }
  let i = 0
  while (i < sql.length) {
    const char = sql[i]
    const rest = sql.slice(i)
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      push('comment', sql.slice(i, stop))
      i = stop
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      push('comment', sql.slice(i, stop))
      i = stop
    } else if (rest.startsWith('{{')) {
      const end = sql.indexOf('}}', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      push('parameter', sql.slice(i, stop))
      i = stop
    } else if (char === "'" || char === '"') {
      // A doubled quote inside is an escaped quote, not the end.
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === char) {
          if (sql[j + 1] === char) j += 2
          else {
            j += 1
            break
          }
        } else j += 1
      }
      push(char === "'" ? 'string' : 'identifier', sql.slice(i, j))
      i = j
    } else if (/[A-Za-z_]/.test(char)) {
      WORD.lastIndex = i
      const word = WORD.exec(sql)?.[0] ?? char
      const lower = word.toLowerCase()
      const isCall = sql[i + word.length] === '('
      push(
        KEYWORDS.has(lower) || (isCall && FUNCTIONS.has(lower))
          ? 'keyword'
          : 'plain',
        word,
      )
      i += word.length
    } else if (
      /[0-9]/.test(char) ||
      (char === '.' && /[0-9]/.test(sql[i + 1] ?? ''))
    ) {
      NUMBER.lastIndex = i
      const number = NUMBER.exec(sql)?.[0] ?? char
      push('number', number)
      i += number.length
    } else {
      push('plain', char)
      i += 1
    }
  }
  return tokens
}
