import { describe, expect, it } from 'vitest'

import type { SampleRecord } from '#/lib/samples'

import { sampleStatus, toSampleListRow } from './samples-data'

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
