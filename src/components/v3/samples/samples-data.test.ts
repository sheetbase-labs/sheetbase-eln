import { describe, expect, it, vi } from 'vitest'

import type { SampleRecord } from '#/lib/samples'

import type { DataClient } from '#/lib/data-client'

import { fetchAllSamples, sampleStatus, toSampleListRow } from './samples-data'

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

describe('fetchAllSamples', () => {
  it('pages past the first 200 samples and reports the server total', async () => {
    const wire = (n: number) => ({
      id: `s-${n}`,
      identifier: `SMP-${n}`,
      title: `Sample ${n}`,
      kind: 'sample',
      status: 'available',
      properties: {},
      custom_fields: {},
      tags: [],
    })
    const list = vi.fn(async (_table: string, query: string) => {
      const offset = Number(/offset=(\d+)/.exec(query)?.[1] ?? 0)
      const count = Math.min(200, 250 - offset)
      return Array.from({ length: count }, (_, i) => wire(offset + i))
    })
    const client = {
      list,
      count: vi.fn(async () => 250),
    } as unknown as DataClient

    const result = await fetchAllSamples(client)

    expect(result.rows).toHaveLength(250)
    expect(result.rows.at(-1)?.identifier).toBe('SMP-249')
    expect(result.totalCount).toBe(250)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
