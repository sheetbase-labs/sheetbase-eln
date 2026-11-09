import { describe, expect, it } from 'vitest'

import type { WorkItem } from './data'
import { collapseRepeats, repeatKey } from './repeats'

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    kind: 'run_failed',
    recordId: null,
    identifier: 'tb-02-folder',
    title: 'Import failed: TB-02 results folder',
    projectId: null,
    reason: 'This file isn’t in the shape TB-02 CSV reads.',
    dueAt: null,
    state: 'needs_action',
    createdAt: null,
    connectorId: 'connector-1',
    ...overrides,
  }
}

describe('collapseRepeats', () => {
  const first = item({ sourceId: 'run-2' })
  const second = item({ sourceId: 'run-1' })

  const other = item({
    sourceId: 'run-3',
    reason: 'The parser timed out.',
  })

  it('folds items that say the same thing about the same object', () => {
    const entries = collapseRepeats([first, other, second], new Set())
    expect(entries.map((e) => [e.item.sourceId, e.count, e.repeat])).toEqual([
      ['run-2', 2, false],
      ['run-3', 1, false],
    ])
    expect(entries[0].members).toEqual([first, second])
  })

  it('lists an expanded group’s repeats straight after its first row', () => {
    const entries = collapseRepeats(
      [first, other, second],
      new Set([repeatKey(first)]),
    )

    expect(entries.map((e) => [e.item.sourceId, e.repeat])).toEqual([
      ['run-2', false],
      ['run-1', true],
      ['run-3', false],
    ])
  })

  it('keeps items about different objects apart', () => {
    const elsewhere = item({ sourceId: 'run-4', connectorId: 'connector-2' })
    expect(collapseRepeats([first, elsewhere], new Set())).toHaveLength(2)
  })
})
