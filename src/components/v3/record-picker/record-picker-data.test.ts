import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { searchPickerRecords } from './record-picker-data'

function client(tables: Record<string, unknown[]>): DataClient {
  return {
    list: vi.fn(async (table: string) => tables[table] ?? []),
    rpc: vi.fn(async () => null),
  } as unknown as DataClient
}

const tables = {
  recently_viewed: [
    { object_kind: 'record', object_id: 'e-1' },
    { object_kind: 'dataset', object_id: 'd-1' },
  ],
  projects: [{ id: 'p-1', title: 'Malaria' }],
  records: [
    {
      id: 'e-1',
      kind: 'experiment',
      identifier: 'EXP-1',
      title: 'Run',
      status: 'draft',
      project_id: 'p-1',
    },
  ],
  datasets: [
    {
      id: 'd-1',
      display_id: 'DS-1',
      name: 'Stability',
      lifecycle: 'active',
      primary_project_id: 'p-1',
    },
  ],
}

describe('searchPickerRecords with no query', () => {
  it('offers only the kinds the picker is limited to', async () => {
    const result = await searchPickerRecords(
      { q: '', kinds: ['Experiment'] },
      client(tables),
    )
    expect(result.recent).toBe(true)
    expect(result.items.map((item) => item.id)).toEqual(['e-1'])
  })

  it('offers every recent kind when the picker is not limited', async () => {
    const result = await searchPickerRecords({ q: '' }, client(tables))
    expect(result.items.map((item) => item.id)).toEqual(['e-1', 'd-1'])
  })
})
