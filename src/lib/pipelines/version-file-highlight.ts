/**
 * Colours for the version file: which stretch of each line is a key, a string,
 * a comment, a reference or SQL. Like the SQL tokenizer it only decides colour;
 * the file is checked by `checkVersionFile`. The spans of a line always join
 * back to exactly that line, so they can be drawn behind the textarea.
 */
import { tokenizeSql } from './sql-highlight'

export type SpanKind = 'key' | 'str' | 'cm' | 'ref' | 'sid' | 'kw' | 'plain'

export interface Span {
  kind: SpanKind
  text: string
}

const KEY_LINE = /^(\s*)(- +)?([A-Za-z_][\w-]*)(:)(?=\s|$)(.*)$/
const BLOCK_START = /^[|>][+-]?\d*\s*(#.*)?$/

/** Strings, references and keys inside a value (a flow map keeps keys there). */
const VALUE_PART =
  /(\s#.*$)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$[A-Za-z_]\w*|\{\{[^}]*\}\})|([A-Za-z_][\w-]*)(?=:(?:\s|$))/g

function valueSpans(text: string, plain: SpanKind = 'plain'): Span[] {
  const spans: Span[] = []
  let last = 0

  for (const m of text.matchAll(VALUE_PART)) {
    if (m.index > last)
      spans.push({ kind: plain, text: text.slice(last, m.index) })

    const kind: SpanKind = m[1] ? 'cm' : m[2] ? 'str' : m[3] ? 'ref' : 'key'

    spans.push({ kind, text: m[0] })
    last = m.index + m[0].length
  }

  if (last < text.length) spans.push({ kind: plain, text: text.slice(last) })

  return spans
}

// oxlint-disable-next-line anti-slop/no-known-value-widening -- keyed by the SQL highlighter's token names, which are open strings.
const SQL_KIND: Record<string, SpanKind> = {
  keyword: 'kw',
  string: 'str',
  comment: 'cm',
  parameter: 'ref',
}

function sqlSpans(text: string): Span[] {
  return tokenizeSql(text).map((token) => ({
    kind: SQL_KIND[token.kind] ?? 'plain',
    text: token.text,
  }))
}

const PYTHON_WORDS =
  /^(def|return|import|from|as|if|else|elif|for|in|while|with|not|and|or|None|True|False|lambda|try|except|raise|class|yield)$/

function pythonSpans(text: string): Span[] {
  const spans: Span[] = []
  const part = /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)/g
  let last = 0

  for (const m of text.matchAll(part)) {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- an unmatched regex group is undefined at runtime.
    if (m[3] !== undefined && !PYTHON_WORDS.test(m[3])) continue

    if (m.index > last)
      spans.push({ kind: 'plain', text: text.slice(last, m.index) })
    spans.push({ kind: m[1] ? 'cm' : m[2] ? 'str' : 'kw', text: m[0] })
    last = m.index + m[0].length
  }

  if (last < text.length) spans.push({ kind: 'plain', text: text.slice(last) })

  return spans
}

/** One list of spans per line of the file. */
export function highlightFile(text: string): Span[][] {
  const out: Span[][] = []

  let block: { indent: number; language: 'sql' | 'python' | 'other' } | null =
    null

  for (const line of text.split('\n')) {
    const indent = line.length - line.trimStart().length

    if (block) {
      if (line.trim() === '' || indent > block.indent) {
        out.push(
          block.language === 'sql'
            ? sqlSpans(line)
            : block.language === 'python'
              ? pythonSpans(line)
              : [{ kind: 'plain', text: line }],
        )
        continue
      }

      block = null
    }

    if (line.trimStart().startsWith('#')) {
      out.push([{ kind: 'cm', text: line }])
      continue
    }

    const key = KEY_LINE.exec(line)

    if (!key) {
      out.push(valueSpans(line))
      continue
    }

    const [, lead, dash = '', name, colon, rest] = key
    const spans: Span[] = []

    if (lead) spans.push({ kind: 'plain', text: lead })

    if (dash) spans.push({ kind: 'plain', text: dash })
    spans.push({ kind: 'key', text: name }, { kind: 'plain', text: colon })

    const value = rest.trim()

    if (BLOCK_START.test(value)) {
      block = {
        indent: lead.length + dash.length,
        language:
          name === 'sql' ? 'sql' : name === 'python' ? 'python' : 'other',
      }
      spans.push(...valueSpans(rest))
    } else if (name === 'sql' && value && !/^["']/.test(value)) {
      spans.push(
        {
          kind: 'plain',
          text: rest.slice(0, rest.length - rest.trimStart().length),
        },
        ...sqlSpans(rest.trimStart()),
      )
    } else if (name === 'id') {
      const lead2 = rest.length - rest.trimStart().length
      const comment = rest.search(/\s#/)
      const end = comment === -1 ? rest.length : comment

      spans.push(
        { kind: 'plain', text: rest.slice(0, lead2) },
        { kind: 'sid', text: rest.slice(lead2, end).trimEnd() },
        ...valueSpans(
          rest.slice(lead2 + rest.slice(lead2, end).trimEnd().length),
        ),
      )
    } else spans.push(...valueSpans(rest))

    out.push(spans)
  }

  return out
}

/** Cut a line's spans at the characters of a mistake, marking the cut `bad`. */
export function markRange(
  spans: Span[],
  from: number,
  to: number,
): Array<Span & { bad?: boolean }> {
  const out: Array<Span & { bad?: boolean }> = []
  let at = 0

  for (const span of spans) {
    const start = at
    const end = at + span.text.length

    at = end

    if (end <= from || start >= to) {
      out.push(span)
      continue
    }

    const a = Math.max(from, start) - start
    const b = Math.min(to, end) - start

    if (a > 0) out.push({ ...span, text: span.text.slice(0, a) })
    out.push({ ...span, text: span.text.slice(a, b), bad: true })

    if (b < span.text.length) out.push({ ...span, text: span.text.slice(b) })
  }

  return out
}
