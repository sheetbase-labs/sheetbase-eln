/**
 * Colours and checks for JSON typed into a code editor. Cosmetic and helpful
 * only: the screen that owns the text decides what it accepts.
 */
import { z } from 'zod'

import type { CodeTokenRange } from '#/lib/pipelines/code-tokens'

const TOKEN =
  /"(?:[^"\\\n]|\\.)*"(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g

/** Keys, strings, numbers and true/false/null, each in its own colour. */
export function jsonTokens(text: string): CodeTokenRange[] {
  const tokens: CodeTokenRange[] = []

  for (const match of text.matchAll(TOKEN)) {
    const from = match.index
    const word = match[0]

    if (word.startsWith('"')) {
      const isKey = Boolean(match[1])

      const to = isKey
        ? from + word.length - match[1].length
        : from + word.length

      tokens.push({ from, to, kind: isKey ? 'key' : 'str' })
    } else {
      tokens.push({
        from,
        to: from + word.length,
        kind: /^-?\d/.test(word) ? 'num' : 'kw',
      })
    }
  }

  return tokens
}

/** Where the text stops being JSON, as a 1-based line and column. */
export interface JsonSpot {
  line: number
  column: number
}

/** Null when the text is JSON of the wanted shape; otherwise the first spot that is not. */
export function jsonProblem(
  text: string,
  accepts: 'object' | 'any' = 'any',
): { spot: JsonSpot; reason: 'syntax' | 'notObject' } | null {
  if (text.trim() === '') return null

  try {
    const parsed: unknown = JSON.parse(text)

    if (
      accepts === 'object' &&
      !z.record(z.string(), z.unknown()).safeParse(parsed).success
    )
      return { spot: { line: 1, column: 1 }, reason: 'notObject' }

    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const at = /position (\d+)/.exec(message)
    const offset = at ? Math.min(Number(at[1]), text.length) : text.length
    const before = text.slice(0, offset).split('\n')

    return {
      spot: {
        line: before.length,
        column: (before.at(-1)?.length ?? 0) + 1,
      },
      reason: 'syntax',
    }
  }
}
