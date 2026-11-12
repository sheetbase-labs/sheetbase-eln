import { stringify } from 'yaml'

import type { PipelineDefinitionVersionWire } from './types'

type Configuration = PipelineDefinitionVersionWire['configuration']

/**
 * The text a publish request shows an approver: the draft's configuration
 * written out as text, line by line, against the published version's. The
 * version file (Advanced mode) will own the canonical text form; until then
 * this is the stored configuration as YAML with keys in a stable order.
 */
export type DiffLineKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

export interface VersionDiff {
  lines: DiffLine[]
  added: number
  removed: number
}

/** A configuration as text, keys sorted so a reorder alone is no change. */
export function configurationText(configuration: Configuration): string {
  return stringify(configuration, {
    lineWidth: 0,
    sortMapEntries: true,
  }).trimEnd()
}

/** Line diff by longest common subsequence; versions are a few hundred lines. */
export function diffText(before: string, after: string): VersionDiff {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const cols = b.length + 1
  const table = new Uint32Array((a.length + 1) * cols)

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      lines.push({ kind: 'removed', text: a[i++] })
    } else {
      lines.push({ kind: 'added', text: b[j++] })
    }
  }

  while (i < a.length) lines.push({ kind: 'removed', text: a[i++] })

  while (j < b.length) lines.push({ kind: 'added', text: b[j++] })

  return {
    lines,
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
  }
}

/** The diff of a draft against the version it replaces (or against nothing). */
export function diffVersions(
  published: Configuration | null,
  draft: Configuration,
): VersionDiff {
  return diffText(
    published == null ? '' : configurationText(published),
    configurationText(draft),
  )
}

/**
 * Only the changed lines and `context` lines around them, so a long version
 * file shows what changed. Unchanged runs in between collapse to one gap.
 */
export type ShownLine =
  (DiffLine & { n: number }) | { kind: 'gap'; hidden: number; n: number }

export function withContext(diff: VersionDiff, context = 2): ShownLine[] {
  const keep = Array.from({ length: diff.lines.length }, () => false)

  diff.lines.forEach((line, index) => {
    if (line.kind === 'same') return

    for (
      let k = Math.max(0, index - context);
      k <= Math.min(diff.lines.length - 1, index + context);
      k++
    )
      keep[k] = true
  })

  const out: ShownLine[] = []
  let hidden = 0

  diff.lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden) out.push({ kind: 'gap', hidden, n: index - hidden + 1 })
      hidden = 0
      out.push({ ...line, n: index + 1 })
    } else hidden++
  })

  if (hidden) {
    out.push({ kind: 'gap', hidden, n: diff.lines.length - hidden + 1 })
  }

  return out
}
