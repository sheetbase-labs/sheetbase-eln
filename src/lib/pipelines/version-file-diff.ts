/**
 * Two files line by line: what a draft changed against the version it came
 * from, with the unchanged stretches between folded away.
 */
export type DiffKind = 'same' | 'add' | 'del'

export interface DiffLine {
  kind: DiffKind
  text: string
  /** Line number in the older file (del, same) and in the newer one (add, same). */
  before?: number
  after?: number
}

export type DiffRow = DiffLine | { kind: 'gap'; hidden: number }

/** Longest common subsequence; version files are a few hundred lines. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  const cols = b.length + 1
  const table = new Uint32Array((a.length + 1) * cols)

  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])

  const out: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], before: i + 1, after: j + 1 })
      i++
      j++
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      out.push({ kind: 'del', text: a[i], before: i + 1 })
      i++
    } else {
      out.push({ kind: 'add', text: b[j], after: j + 1 })
      j++
    }
  }

  for (; i < a.length; i++) out.push({ kind: 'del', text: a[i], before: i + 1 })

  for (; j < b.length; j++) out.push({ kind: 'add', text: b[j], after: j + 1 })

  return out
}

/** Only the changed lines and `context` lines around each; a run between them folds to one gap. */
export function withContext(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = lines.map((line, index) => {
    if (line.kind !== 'same') return true

    for (let k = Math.max(0, index - context); k <= index + context; k++)
      if (lines.at(k) && lines[k].kind !== 'same') return true

    return false
  })

  const rows: DiffRow[] = []
  let hidden = 0

  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden) rows.push({ kind: 'gap', hidden })
      hidden = 0
      rows.push(line)
    } else hidden++
  })

  if (hidden) rows.push({ kind: 'gap', hidden })

  return rows
}

export function countChanges(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length,
  }
}
