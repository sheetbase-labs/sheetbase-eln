import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  describeBulkOutcome,
  summariseBulkUpgrade,
  upgradeNotebooksInBulk,
} from './notebook-template-bulk-upgrade'

const TARGET = '00000000-0000-4000-8000-0000000000f0'
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const emptyPreview = (recordId: string) => ({
  recordId,
  sourceVersionId: ID(900),
  targetVersionId: TARGET,
  automatic: [],
  conflicts: [],
})

function client(
  conflictsFor: Set<string> = new Set(),
  failFor: Set<string> = new Set(),
) {
  const applied: string[] = []
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.includes('/rpc/preview_notebook_template_upgrade')) {
        const body = JSON.parse(String(init?.body))
        const id = body.p_record_id as string
        const preview = emptyPreview(id)
        if (conflictsFor.has(id)) {
          return json({
            ...preview,
            conflicts: [
              {
                id: 'c1',
                kind: 'sheet-definition-conflict',
                allowedOutcomes: ['keep'],
              },
            ],
          })
        }
        return json(preview)
      }
      if (url.includes('/rpc/apply_notebook_template_upgrade')) {
        const body = JSON.parse(String(init?.body))
        if (failFor.has(body.p_record_id)) {
          return json({ message: 'structure version moved on' }, 409)
        }
        applied.push(body.p_record_id)
        return json({})
      }
      if (url.includes('/records?')) return json([{ structure_version: 4 }])
      return json([])
    },
  )
  return { client: createDataClient(fetcher), applied, fetcher }
}

describe('upgradeNotebooksInBulk', () => {
  it('updates the clean ones, leaves decisions and signed notebooks, and carries on past a failure', async () => {
    const { client: c, applied } = client(new Set([ID(2)]), new Set([ID(4)]))
    const progress: number[] = []
    const results = await upgradeNotebooksInBulk(
      c,
      {
        targetVersionId: TARGET,
        notebooks: [
          { id: ID(1), identifier: 'EXP-1', locked_at: null },
          { id: ID(2), identifier: 'EXP-2', locked_at: null },
          { id: ID(3), identifier: 'EXP-3', locked_at: '2026-09-01T00:00:00Z' },
          { id: ID(4), identifier: 'EXP-4', locked_at: null },
          { id: ID(5), identifier: 'EXP-5', locked_at: null },
        ],
      },
      (done) => progress.push(done),
    )
    expect(results.map((r) => r.outcome.kind)).toEqual([
      'updated',
      'needs-decision',
      'signed',
      'failed',
      'updated',
    ])
    expect(applied).toEqual([ID(1), ID(5)])
    expect(progress).toEqual([1, 2, 3, 4, 5])
    expect(summariseBulkUpgrade(results)).toEqual({
      updated: 2,
      needsDecision: 1,
      signed: 1,
      failed: 1,
    })
  })

  it('describes each outcome in plain words', () => {
    expect(describeBulkOutcome({ kind: 'updated' })).toBe('Updated')
    expect(describeBulkOutcome({ kind: 'needs-decision', conflicts: 2 })).toBe(
      'Needs your decision on 2 sheets',
    )
    expect(describeBulkOutcome({ kind: 'signed' })).toMatch(/amend/i)
  })
})
