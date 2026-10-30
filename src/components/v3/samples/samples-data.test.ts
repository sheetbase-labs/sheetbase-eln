import { describe, expect, it, vi } from 'vitest'

import type { SampleRecord } from '#/lib/samples'

import type { DataClient } from '#/lib/data-client'

import {
  distinctLocations,
  SAMPLE_TABS,
  fetchStorageLocations,
  sampleListFilters,
  sampleStatus,
  toSampleListRow,
} from './samples-data'

function row(overrides: Partial<SampleRecord>): SampleRecord {
  return {
    id: 's-1',
    identifier: 'SMP-2220',
    title: 'pAAV9-RC',
    sampleType: 'Plasmid',
    projectId: null,
    quantity: 12.5,
    quantityUnit: 'mg',
    storageLocation: 'F-3',
    status: 'available',
    createdByUserId: 'u-1',
    ...overrides,
  } as unknown as SampleRecord
}

describe('sampleStatus', () => {
  it('maps every known sample state to a human label', () => {
    expect(sampleStatus('quarantined')).toEqual({
      tone: 'warn',
      label: 'Quarantine',
    })
    expect(sampleStatus('hold_exceeded')).toEqual({
      tone: 'bad',
      label: 'Hold exceeded',
    })
    expect(sampleStatus('disposed')).toEqual({
      tone: 'stored',
      label: 'Disposed',
    })
  })

  it('still capitalises an unknown state instead of hiding it', () => {
    expect(sampleStatus('under_triage').label).toBe('Under Triage')
  })
})

describe('toSampleListRow status tabs', () => {
  it('groups consumed and disposed as terminal, never in stock', () => {
    for (const status of ['consumed', 'disposed']) {
      const mapped = toSampleListRow(row({ status }), new Map(), undefined)
      expect(mapped.tabs).toContain('consumed')
      expect(mapped.tabs).not.toContain('instock')
      expect(mapped.status.label).toBe(
        status === 'disposed' ? 'Disposed' : 'Consumed',
      )
    }
  })

  it('lists quarantine under both in stock and quarantine', () => {
    const mapped = toSampleListRow(
      row({ status: 'quarantined' }),
      new Map(),
      undefined,
    )
    expect(mapped.tabs).toEqual(['instock', 'quarantine'])
  })

  it('keeps a past-hold sample in stock without claiming quarantine', () => {
    const mapped = toSampleListRow(
      row({ status: 'hold_exceeded' }),
      new Map(),
      undefined,
    )
    expect(mapped.tabs).toEqual(['instock'])
    expect(mapped.status.label).toBe('Hold exceeded')
  })
})

describe('sampleListFilters', () => {
  const decoded = (tab: Parameters<typeof sampleListFilters>[0], q?: string) =>
    sampleListFilters(tab, 'u-1', q).map(decodeURIComponent)

  it('puts each tab in the database, so no tab depends on the loaded rows', () => {
    expect(decoded('instock')).toContain('status=not.in.(consumed,disposed)')
    expect(decoded('consumed')).toContain('status=in.(consumed,disposed)')
    expect(decoded('quarantine')).toContain('status=eq.quarantined')
    expect(decoded('awaiting')).toContain('status=eq.reserved')
    expect(decoded('mine')).toContain('created_by_user_id=eq.u-1')
    for (const tab of SAMPLE_TABS)
      expect(decoded(tab)[0]).toContain('archived_at=is.null')
  })

  it('searches ID, name, type and location, matching punctuation literally', () => {
    const clauses = decoded('instock', '50% C-150')
    const or = clauses.find((c) => c.startsWith('or=('))
    expect(or).toContain('identifier.ilike."*50\\\\% C-150*"')
    expect(or).toContain('properties->>sampleType.ilike.')
    expect(or).toContain('properties->>storageLocation.ilike.')
  })
})

describe('storage locations', () => {
  it('lists each place once, ignoring case and blanks, in natural order', () => {
    expect(
      distinctLocations([
        'Freezer 10',
        'freezer 2',
        'Freezer 2',
        null,
        '  ',
        undefined,
        'Bench',
      ]),
    ).toEqual(['Bench', 'freezer 2', 'Freezer 10'])
  })

  it('reads the places from the database, each once', async () => {
    const list = vi.fn(async () => [
      { location: 'Shelf B' },
      { location: 'Shelf A' },
      { location: null },
      { location: 'shelf a' },
    ])
    const client = { list } as unknown as DataClient
    expect(await fetchStorageLocations(client)).toEqual(['Shelf A', 'Shelf B'])
    expect(list).toHaveBeenCalledWith(
      'rpc/sample_storage_locations',
      expect.any(String),
    )
  })
})
