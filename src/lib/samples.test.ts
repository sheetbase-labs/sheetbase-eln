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
  isLowStock,
  parseSampleProperties,
  samplePropertiesPayload,
  toSampleRecord,
} from './samples'
import type { RecordWire } from './notebook-data'
import type { RegistryQuery } from './registry'

const baseQuery: RegistryQuery = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  grouping: [],
  filters: [],
}

function wire(props: Record<string, unknown> = {}): RecordWire {
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
      { label: 'Total samples', value: 1234 },
      { label: 'Available', value: 2, hint: 'on this page' },
      { label: 'Low stock', value: 1, hint: 'on this page' },
      { label: 'Consumed', value: 1, hint: 'on this page' },
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
    const clauses = buildSamplesFilter([{ id: 'archived', value: 'included' }])
    expect(clauses).not.toContain('archived_at=is.null')
  })

  it('maps status to an equality filter', () => {
    const clauses = buildSamplesFilter([{ id: 'status', value: 'available' }])
    expect(clauses).toContain('status=eq.available')
  })

  it('maps storage/type/barcode to ilike on the JSONB property', () => {
    const clauses = buildSamplesFilter([
      { id: 'storageLocation', value: 'Freezer A' },
      { id: 'sampleType', value: 'plasma' },
      { id: 'barcode', value: 'BC-1' },
    ])
    expect(clauses).toContain('properties->>storageLocation=ilike.*Freezer+A*')
    expect(clauses).toContain('properties->>sampleType=ilike.*plasma*')
    expect(clauses).toContain('properties->>barcode=ilike.*BC-1*')
  })

  it('strips PostgREST wildcards from search terms', () => {
    const clauses = buildSamplesFilter([{ id: 'search', value: '50%_off' }])
    const search = clauses.find((c) => c.startsWith('('))
    expect(search).toBeDefined()
    expect(search).not.toContain('%')
    expect(search).not.toContain('_')
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

  it('composes filter, order, limit, offset and select into the page query', () => {
    const q: RegistryQuery = {
      pageIndex: 2,
      pageSize: 50,
      sorting: [{ id: 'title', desc: false }],
      grouping: [],
      filters: [{ id: 'status', value: 'available' }],
    }
    const built = buildSamplesQuery(q)
    expect(built.startsWith('?')).toBe(true)
    expect(built).toContain('kind=eq.sample')
    expect(built).toContain('status=eq.available')
    expect(built).toContain('order=title.asc,identifier.asc')
    expect(built).toContain('limit=50')
    expect(built).toContain('offset=100')
    expect(built).toContain('select=id,workspace_id')
  })

  it('count query excludes pagination, order and select', () => {
    const q: RegistryQuery = {
      ...baseQuery,
      pageIndex: 3,
      pageSize: 100,
      filters: [{ id: 'status', value: 'consumed' }],
    }
    const built = buildSamplesCountQuery(q)
    expect(built).toContain('status=eq.consumed')
    expect(built).not.toContain('limit=')
    expect(built).not.toContain('order=')
    expect(built).not.toContain('select=')
  })
})
