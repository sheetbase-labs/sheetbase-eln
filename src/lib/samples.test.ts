/**
 * REG-002 unit tests for the samples domain library. These cover the pure
 * application-boundary helpers: property parsing, PostgREST query building
 * for the registry composition, low-stock projection and summary metrics.
 * Database integrity (negative-quantity prevention, custody attribution,
 * isolation) is covered by tests/db/samples.test.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  buildSamplesCountQuery,
  buildSamplesFilter,
  buildSamplesOrder,
  buildSamplesQuery,
  computeSampleSummaries,
  fetchSampleEvents,
  isLowStock,
  parseSampleProperties,
  recordSampleLabelPrint,
  samplePropertiesPayload,
  toSampleRecord,
} from './samples'
import type { DataClient } from './data-client'
import type { RecordWire } from './notebook-data'
import type { RegistryQuery } from './registry'

const baseQuery: RegistryQuery = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  grouping: [],
  filters: [],
}

function wire(
  props: Record<string, unknown> = {},
  customFields: Record<string, unknown> = {},
): RecordWire {
  return {
    id: 's1',
    workspace_id: 'ws',
    project_id: 'p1',
    kind: 'sample',
    identifier: 'SMP-2026-0001',
    title: 'Pool 14',
    status: 'available',
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    folder_id: null,
    created_by_user_id: 'u1',
    updated_by_user_id: null,
    properties: props,
    custom_fields: customFields,
    locked_at: null,
    locked_by_revision_id: null,
  }
}

describe('parseSampleProperties and toSampleRecord', () => {
  it('parses typed properties from the raw JSONB', () => {
    const props = parseSampleProperties({
      sampleType: 'plasma',
      quantity: '12.5',
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
      barcode: 'BC-1',
      lowStockThreshold: 2,
      notes: 'handle cold',
    })
    expect(props).toEqual({
      sampleType: 'plasma',
      quantity: 12.5,
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
      barcode: 'BC-1',
      lowStockThreshold: 2,
      notes: 'handle cold',
    })
  })

  it('treats empty strings and missing keys as null on the record', () => {
    const rec = toSampleRecord(wire({ quantity: '', storageLocation: '' }))
    expect(rec.quantity).toBeNull()
    expect(rec.storageLocation).toBeNull()
    expect(rec.sampleType).toBeNull()
  })

  it('rejects non-numeric quantities without throwing', () => {
    const rec = toSampleRecord(wire({ quantity: 'lots' }))
    expect(rec.quantity).toBeNull()
  })

  it('keeps workspace model fields separate from system properties', () => {
    const rec = toSampleRecord(wire({ quantity: 2 }, { study_arm: 'treated' }))
    expect(rec.quantity).toBe(2)
    expect(rec.customFields).toEqual({ study_arm: 'treated' })
  })
})

describe('samplePropertiesPayload', () => {
  it('omits unset fields so defaults are not overwritten', () => {
    expect(samplePropertiesPayload({})).toEqual({})
    expect(
      samplePropertiesPayload({ quantity: 5, quantityUnit: 'mL' }),
    ).toEqual({ quantity: 5, quantityUnit: 'mL' })
  })
})

describe('isLowStock', () => {
  it('is low-stock when positive quantity is at or below the threshold', () => {
    expect(isLowStock({ quantity: 1, lowStockThreshold: 2 })).toBe(true)
    expect(isLowStock({ quantity: 2, lowStockThreshold: 2 })).toBe(true)
  })

  it('is not low-stock above the threshold or when unset', () => {
    expect(isLowStock({ quantity: 10, lowStockThreshold: 2 })).toBe(false)
    expect(isLowStock({ quantity: 1, lowStockThreshold: null })).toBe(false)
    expect(isLowStock({ quantity: null, lowStockThreshold: 2 })).toBe(false)
  })

  it('does not flag a fully consumed sample as low-stock', () => {
    expect(isLowStock({ quantity: 0, lowStockThreshold: 2 })).toBe(false)
  })
})

describe('computeSampleSummaries', () => {
  it('uses the server total and projects page buckets with honest hints', () => {
    const rows = [
      toSampleRecord(wire({ quantity: 1, lowStockThreshold: 2 })), // available + low
      toSampleRecord(wire({ quantity: 5, lowStockThreshold: 2 })), // available
      toSampleRecord(wire({ quantity: 0, lowStockThreshold: 2 })),
    ]
    rows[2].status = 'consumed'
    const summaries = computeSampleSummaries(rows, 1234)
    expect(summaries).toEqual([
      {
        label: 'Total samples',
        value: 1234,
        hint: '3 on this page',
        tone: 'neutral',
      },
      { label: 'Available', value: 2, hint: '0% of total', tone: 'positive' },
      {
        label: 'Low stock',
        value: 1,
        hint: 'Needs attention',
        tone: 'warning',
      },
      { label: 'Consumed', value: 1, hint: 'On this page', tone: 'neutral' },
    ])
  })
})

describe('buildSamplesFilter', () => {
  it('scopes to kind=sample, non-deleted, non-archived by default', () => {
    const clauses = buildSamplesFilter([])
    expect(clauses).toContain('kind=eq.sample')
    expect(clauses).toContain('deleted_at=is.null')
    expect(clauses).toContain('archived_at=is.null')
  })

  it('includes archived rows only when the archived filter is set', () => {
    const clauses = buildSamplesFilter([
      { fieldId: 'archived', operator: 'eq', values: ['included'] },
    ])
    expect(clauses).not.toContain('archived_at=is.null')
  })

  it('maps status to an equality filter', () => {
    const clauses = buildSamplesFilter([
      { fieldId: 'status', operator: 'eq', values: ['available'] },
    ])
    expect(clauses).toContain('status=eq.available')
  })

  it('maps storage/type/barcode to ilike on the JSONB property', () => {
    const clauses = buildSamplesFilter([
      {
        fieldId: 'storageLocation',
        operator: 'contains',
        values: ['Freezer A'],
      },
      { fieldId: 'sampleType', operator: 'contains', values: ['plasma'] },
      { fieldId: 'barcode', operator: 'contains', values: ['BC-1'] },
    ])
    expect(clauses).toContain('properties->>storageLocation=ilike.*Freezer+A*')
    expect(clauses).toContain('properties->>sampleType=ilike.*plasma*')
    expect(clauses).toContain('properties->>barcode=ilike.*BC-1*')
  })

  it('strips PostgREST wildcards from search terms', () => {
    const clauses = buildSamplesFilter([
      { fieldId: 'search', operator: 'contains', values: ['50%_off'] },
    ])
    const search = clauses.find((c) => c.startsWith('('))
    expect(search).toBeDefined()
    expect(search).not.toContain('%')
    expect(search).not.toContain('_')
  })

  it('filters administrator-defined fields through custom_fields', () => {
    expect(
      buildSamplesFilter([
        { fieldId: 'custom:study_arm', operator: 'eq', values: ['treated'] },
        {
          fieldId: 'custom:assay_name',
          operator: 'contains',
          values: ['ELISA'],
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'custom_fields->>study_arm=eq.treated',
        'custom_fields->>assay_name=ilike.*ELISA*',
      ]),
    )
  })
})

describe('buildSamplesOrder and buildSamplesQuery', () => {
  it('orders by identifier by default and adds a stable tiebreaker', () => {
    expect(buildSamplesOrder(baseQuery)).toBe('order=identifier.asc')
  })

  it('respects sort and grouping fields, grouping first', () => {
    const q: RegistryQuery = {
      ...baseQuery,
      grouping: ['status'],
      sorting: [{ id: 'quantity', desc: true }],
    }
    expect(buildSamplesOrder(q)).toBe(
      'order=status.asc,(properties->>quantity)::numeric.desc,identifier.asc',
    )
  })

  it('sorts and groups by validated model-field keys', () => {
    expect(
      buildSamplesOrder({
        ...baseQuery,
        grouping: ['custom:study_arm'],
        sorting: [{ id: 'custom:assay_name', desc: true }],
      }),
    ).toBe(
      'order=custom_fields->study_arm.asc,custom_fields->assay_name.desc,identifier.asc',
    )
  })

  it('composes filter, order, limit, offset and select into the page query', () => {
    const q: RegistryQuery = {
      pageIndex: 2,
      pageSize: 50,
      sorting: [{ id: 'title', desc: false }],
      grouping: [],
      filters: [{ fieldId: 'status', operator: 'eq', values: ['available'] }],
    }
    const built = buildSamplesQuery(q)
    expect(built.startsWith('?')).toBe(true)
    expect(built).toContain('kind=eq.sample')
    expect(built).toContain('status=eq.available')
    expect(built).toContain('order=title.asc,identifier.asc')
    expect(built).toContain('limit=50')
    expect(built).toContain('offset=100')
    expect(built).toContain('select=id,workspace_id')
    expect(built).toContain('custom_fields')
  })

  it('count query excludes pagination, order and select', () => {
    const q: RegistryQuery = {
      ...baseQuery,
      pageIndex: 3,
      pageSize: 100,
      filters: [{ fieldId: 'status', operator: 'eq', values: ['consumed'] }],
    }
    const built = buildSamplesCountQuery(q)
    expect(built).toContain('status=eq.consumed')
    expect(built).not.toContain('limit=')
    expect(built).not.toContain('order=')
    expect(built).not.toContain('select=')
  })
})

describe('recordSampleLabelPrint', () => {
  it('records the print as its own sample event, with the label note', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return Promise.resolve({
          id: 'ev-1',
          operation: 'print',
          notes: 'Printed label SMP-2231',
          created_at: '2026-10-10T00:00:00.000Z',
        })
      },
    } as unknown as DataClient

    const sample = await recordSampleLabelPrint(client, {
      recordId: 's-1',
      expectedMetadataVersion: 7,
      identifier: 'SMP-2231',
    })

    // LAB-05.2: printing records its own event rather than editing the sample.
    expect(calls).toEqual([
      {
        name: 'record_sample_label_print',
        args: {
          p_record_id: 's-1',
          p_expected_metadata_version: 7,
          p_note: 'Printed label SMP-2231',
        },
      },
    ])
    // The appended sample_events row comes back.
    expect(sample.operation).toBe('print')
  })
})

describe('fetchSampleEvents', () => {
  it('reads the whole custody ledger, newest first, without a silent cap', async () => {
    const requests: string[] = []
    const client = {
      list: (resource: string, query?: string) => {
        requests.push(`${resource}${query ?? ''}`)
        return Promise.resolve([])
      },
    } as unknown as DataClient

    await fetchSampleEvents(client, 's-1')

    // The History tab counts what it renders and `deriveSampleVolumeSummary`
    // reads the same stream, so older events must not be dropped.
    expect(requests).toEqual([
      'sample_events?record_id=eq.s-1&order=created_at.desc',
    ])
  })
})
