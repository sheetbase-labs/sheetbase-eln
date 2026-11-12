import { describe, expect, it } from 'vitest'

import {
  configurationText,
  diffText,
  diffVersions,
  withContext,
} from './version-diff'

describe('version diff', () => {
  it('writes keys in a stable order', () => {
    expect(configurationText({ b: 1, a: { d: 1, c: 2 } })).toBe(
      'a:\n  c: 2\n  d: 1\nb: 1',
    )
  })

  it('counts added and removed lines', () => {
    const diff = diffText('a\nb\nc', 'a\nx\nc\nd')

    expect(diff.added).toBe(2)
    expect(diff.removed).toBe(1)

    expect(diff.lines.map((line) => line.kind)).toEqual([
      'same',
      'removed',
      'added',
      'same',
      'added',
    ])
  })

  it('shows a first version as all added', () => {
    const diff = diffVersions(null, { steps: [{ name: 'a' }] })

    expect(diff.removed).toBe(0)
    expect(diff.added).toBe(diff.lines.length)
  })

  it('is empty when nothing changed', () => {
    const diff = diffVersions({ a: 1 }, { a: 1 })

    expect(diff.added + diff.removed).toBe(0)
  })

  it('collapses unchanged runs around the changes', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'changed')
    const shown = withContext(diffText(before, after), 1)

    expect(shown.some((line) => line.kind === 'gap')).toBe(true)
    expect(shown.filter((line) => line.kind !== 'gap').length).toBe(4)
  })
})
