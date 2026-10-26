import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import { fetchPeekSummary, humanise, peekRef } from './peek-summary'

const SAMPLE = '00000000-0000-4000-8000-000000000340'

function clientWith(rows: Record<string, unknown[]>): DataClient {
  return {
    list: (resource: string) => Promise.resolve(rows[resource] ?? []),
  } as unknown as DataClient
}

describe('peek summary', () => {
  it('reads the reference out of a record address', () => {
    expect(peekRef(`/samples/${SAMPLE}/history?tab=1`)).toBe(SAMPLE)
    expect(peekRef('/models/cell_bank')).toBe('cell_bank')
    expect(peekRef('/projects')).toBeNull()
  })

  it('says keys and values as plain words', () => {
    expect(humanise('hold_exceeded')).toBe('Hold exceeded')
    expect(humanise('storageLocation')).toBe('Storage location')
  })

  it('summarises a sample from its record row', async () => {
    const summary = await fetchPeekSummary(
      `/samples/${SAMPLE}`,
      clientWith({
        records: [
          {
            id: SAMPLE,
            identifier: 'SMP-2231',
            title: 'Harvest lot HL-0934',
            kind: 'sample',
            status: 'hold_exceeded',
            project_id: null,
            tags: [],
            planned_end: null,
            reviewer_user_id: null,
            created_by_user_id: 'u1',
            updated_at: '2026-09-25T09:00:00Z',
            locked_at: null,
            properties: { quantity: 4600, holdUntil: '2026-10-04T00:00:00Z' },
          },
        ],
        'rpc/workspace_members_list': [{ user_id: 'u1', name: 'Gareth P.' }],
      }),
    )
    expect(summary).toMatchObject({
      identifier: 'SMP-2231',
      title: 'Harvest lot HL-0934',
      kindLabel: 'Sample',
      status: 'hold_exceeded',
    })
    const facts = Object.fromEntries(
      summary!.facts.map((entry) => [entry.label, entry.value]),
    )
    expect(facts.Owner).toBe('Gareth P.')
    expect(facts.Quantity).toBe('4600')
    expect(facts['Hold until']).toBe('4 Oct 2026')
  })

  it('is null for a record the caller cannot read', async () => {
    expect(
      await fetchPeekSummary(`/samples/${SAMPLE}`, clientWith({})),
    ).toBeNull()
  })

  it('is null for a page that is not a record', async () => {
    expect(await fetchPeekSummary('/inbox', clientWith({}))).toBeNull()
  })
})
