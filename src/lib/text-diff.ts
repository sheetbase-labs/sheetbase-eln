/**
 * A word-level diff between two texts, for showing what differs between a
 * saved version and one made elsewhere. Whitespace is kept as tokens so the
 * parts join back into the readable text.
 */

export type DiffPart = {
  kind: 'same' | 'removed' | 'added'
  text: string
}

const MAX_CELLS = 4_000_000

function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0)
}

function push(parts: DiffPart[], kind: DiffPart['kind'], text: string) {
  const last = parts.at(-1)

  if (last && last.kind === kind) last.text += text
  else parts.push({ kind, text })
}

/** What changed going from `before` to `after`. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokens(before)
  const b = tokens(after)
  const parts: DiffPart[] = []

  if (a.length * b.length > MAX_CELLS) {
    if (before) push(parts, 'removed', before)

    if (after) push(parts, 'added', after)

    return parts
  }

  // Longest common subsequence table, filled from the end.
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(parts, 'same', a[i])
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push(parts, 'removed', a[i])
      i += 1
    } else {
      push(parts, 'added', b[j])
      j += 1
    }
  }

  while (i < a.length) push(parts, 'removed', a[i++])

  while (j < b.length) push(parts, 'added', b[j++])

  return parts
}
