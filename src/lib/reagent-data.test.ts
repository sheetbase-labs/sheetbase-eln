/**
 * Unit tests for the reagent registry domain library (REG-003).
 *
 * Covers the pure, deterministic pieces: property projection, low-stock and
 * expiry attention derivation from configured thresholds, and PostgREST query
 * translation. Database-enforced behaviour (receive/consume/quarantine ledger
 * writes, optimistic concurrency, attention summary RPC) is covered by
 * tests/db/reagents.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_EXPIRY_WARNING_DAYS,
  createReagent,
  fetchReagentUsage,
  projectReagentProperties,
  reagentAttention,
  reagentCountQuery,
  reagentListQuery,
  toReagent,
} from './reagent-data'
import type { Reagent } from './reagent-data'
import type { DataClient } from './data-client'
import type { RegistryQuery } from './registry'

function makeReagent(
  overrides: Partial<
    Pick<
      Reagent,
      | 'status'
      | 'quantity'
      | 'expiry'
      | 'lowStockThreshold'
      | 'expiryWarningDays'
      | 'unit'
    >
  > = {},
): Reagent {
  return {
    id: 'r1',
    identifier: 'RGT-2026-0001',
    title: 'Acetonitrile',
    status: 'available',
    tags: ['solvent'],
    projectId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    metadataVersion: 1,
    category: 'solvent',
    supplier: null,
    catalogNo: null,
    lot: null,
    expiry: null,
    quantity: null,
    initialQuantity: null,
    unit: null,
    storage: null,
    received: null,
    releasedBy: null,
    releasedAt: null,
    certificate: null,
    lowStockThreshold: null,
    expiryWarningDays: null,
    record: {
      id: 'r1',
      projectId: null,
      kind: 'reagent',
      identifier: 'RGT-2026-0001',
      title: 'Acetonitrile',
      status: 'available',
      tags: ['solvent'],
      structureVersion: 1,
      metadataVersion: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archivedAt: null,
      deletedAt: null,
      createdByUserId: 'u1',
      updatedByUserId: null,
      properties: {},
      lockedAt: null,
      lockedByRevisionId: null,
    },
    ...overrides,
  }
}

const baseQuery: RegistryQuery = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  grouping: [],
  filters: [],
}

describe('projectReagentProperties', () => {
  it('reads known fields and tolerates missing/empty values', () => {
    expect(projectReagentProperties({})).toEqual({
      supplier: null,
      catalogNo: null,
      lot: null,
      expiry: null,
      quantity: null,
      unit: null,
      storage: null,
      lowStockThreshold: null,
      expiryWarningDays: null,
    })
    expect(
      projectReagentProperties({
        supplier: 'Sigma',
        catalog_no: 'A123',
        lot: 'L9',
        expiry: '2026-12-01',
        quantity: '5',
        unit: 'mL',
        storage: '-20 °C',
        low_stock_threshold: '2',
        expiry_warning_days: 14,
      }),
    ).toEqual({
      supplier: 'Sigma',
      catalogNo: 'A123',
      lot: 'L9',
      expiry: '2026-12-01',
      quantity: 5,
      unit: 'mL',
      storage: '-20 °C',
      lowStockThreshold: 2,
      expiryWarningDays: 14,
    })
  })

  it('treats empty strings as null', () => {
    expect(projectReagentProperties({ supplier: '', lot: '' })).toMatchObject({
      supplier: null,
      lot: null,
    })
  })

  it('rejects non-numeric quantity strings', () => {
    expect(projectReagentProperties({ quantity: 'lots' }).quantity).toBeNull()
  })
})

describe('fetchReagentUsage', () => {
  it('resolves incoming link source records into inspector labels', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'link-1',
          source_record_id: 'experiment-1',
          link_type: 'reagent',
          link_metadata: { quantity: 1, unit: 'units' },
          created_at: '2026-09-23T00:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'experiment-1',
          kind: 'experiment',
          identifier: 'EXP-2026-0001',
        },
      ])

    await expect(
      fetchReagentUsage({ list } as unknown as DataClient, 'RGT-2025-0001'),
    ).resolves.toEqual([
      {
        id: 'link-1',
        sourceRecordId: 'experiment-1',
        sourceKind: 'experiment',
        sourceIdentifier: 'EXP-2026-0001',
        linkType: 'reagent',
        createdAt: '2026-09-23T00:00:00Z',
        quantity: 1,
        unit: 'units',
      },
    ])
    expect(list).toHaveBeenNthCalledWith(
      2,
      'records',
      '?id=in.(experiment-1)&select=id,kind,identifier',
    )
  })
})

describe('toReagent', () => {
  it('uses the first tag as the category and falls back to Uncategorised', () => {
    expect(toReagent(makeReagent().record).category).toBe('solvent')
    const noTags = makeReagent()
    noTags.record.tags = []
    expect(toReagent(noTags.record).category).toBe('Uncategorised')
  })
})

describe('reagentAttention', () => {
  const now = new Date('2026-07-26T00:00:00Z')

  it('is ok when no thresholds or expiry are configured', () => {
    const attention = reagentAttention(makeReagent(), now)
    expect(attention.kind).toBe('ok')
    expect(attention.lowStock).toBe(false)
    expect(attention.nearExpiry).toBe(false)
    expect(attention.expired).toBe(false)
    expect(attention.daysToExpiry).toBeNull()
  })

  it('flags low stock when quantity is at or below the threshold', () => {
    expect(
      reagentAttention(makeReagent({ quantity: 2, lowStockThreshold: 5 }), now)
        .kind,
    ).toBe('low_stock')
    // At the boundary (equal) it is still low stock.
    expect(
      reagentAttention(makeReagent({ quantity: 5, lowStockThreshold: 5 }), now)
        .kind,
    ).toBe('low_stock')
  })

  it('does not flag low stock above the threshold', () => {
    expect(
      reagentAttention(makeReagent({ quantity: 10, lowStockThreshold: 5 }), now)
        .kind,
    ).toBe('ok')
  })

  it('suppresses low stock for consumed/expired/quarantined reagents', () => {
    for (const status of ['consumed', 'expired', 'quarantined'] as const) {
      expect(
        reagentAttention(
          makeReagent({ status, quantity: 0, lowStockThreshold: 5 }),
          now,
        ).lowStock,
      ).toBe(false)
    }
  })

  it('flags near expiry when expiry falls within the warning window', () => {
    const attention = reagentAttention(
      makeReagent({ expiry: '2026-08-10', expiryWarningDays: 30 }),
      now,
    )
    expect(attention.kind).toBe('near_expiry')
    expect(attention.nearExpiry).toBe(true)
    expect(attention.daysToExpiry).toBe(15)
  })

  it('uses the default 30-day window when no per-reagent warning days set', () => {
    const attention = reagentAttention(
      makeReagent({ expiry: '2026-08-20' }),
      now,
    )
    expect(attention.nearExpiry).toBe(true)
    expect(attention.daysToExpiry).toBe(25)
  })

  it('is ok when expiry is beyond the warning window', () => {
    expect(
      reagentAttention(
        makeReagent({ expiry: '2026-12-31', expiryWarningDays: 30 }),
        now,
      ).kind,
    ).toBe('ok')
  })

  it('flags expired when expiry date has passed', () => {
    const attention = reagentAttention(
      makeReagent({ expiry: '2026-07-01' }),
      now,
    )
    expect(attention.kind).toBe('expired')
    expect(attention.expired).toBe(true)
    expect(attention.daysToExpiry).toBe(-25)
  })

  it('suppresses expiry attention for quarantined reagents', () => {
    expect(
      reagentAttention(
        makeReagent({ status: 'quarantined', expiry: '2026-07-01' }),
        now,
      ).expired,
    ).toBe(false)
    expect(
      reagentAttention(
        makeReagent({ status: 'quarantined', expiry: '2026-08-10' }),
        now,
      ).nearExpiry,
    ).toBe(false)
  })

  it('suppresses near expiry for expired-status reagents', () => {
    expect(
      reagentAttention(
        makeReagent({ status: 'expired', expiry: '2026-08-10' }),
        now,
      ).nearExpiry,
    ).toBe(false)
  })

  it('prefers expired over near_expiry and low_stock', () => {
    const attention = reagentAttention(
      makeReagent({
        expiry: '2026-07-01',
        quantity: 0,
        lowStockThreshold: 5,
      }),
      now,
    )
    expect(attention.kind).toBe('expired')
  })

  it('prefers near_expiry over low_stock', () => {
    const attention = reagentAttention(
      makeReagent({
        expiry: '2026-08-10',
        quantity: 0,
        lowStockThreshold: 5,
      }),
      now,
    )
    expect(attention.kind).toBe('near_expiry')
    expect(attention.lowStock).toBe(true)
  })
})

describe('reagentListQuery / reagentCountQuery', () => {
  it('fails closed for unknown fields and operators', () => {
    expect(() =>
      reagentListQuery({
        ...baseQuery,
        filters: [{ fieldId: 'expiry', operator: 'eq', values: ['today'] }],
      }),
    ).toThrow('Unsupported reagent filter')
    expect(() =>
      reagentListQuery({
        ...baseQuery,
        filters: [{ fieldId: 'supplier', operator: 'eq', values: ['Acme'] }],
      }),
    ).toThrow('Unsupported reagent filter')
  })

  it('uses every expanded filter identically for list and count', () => {
    const query = {
      ...baseQuery,
      filters: [
        {
          fieldId: 'category',
          operator: 'contains' as const,
          values: ['enzyme'],
        },
        {
          fieldId: 'supplier',
          operator: 'contains' as const,
          values: ['Acme'],
        },
        {
          fieldId: 'catalogNo',
          operator: 'contains' as const,
          values: ['CAT-1'],
        },
        { fieldId: 'lot', operator: 'contains' as const, values: ['LOT-1'] },
      ],
    }
    const listFilters = reagentListQuery(query).replace(
      /&(?:order|limit|offset)=[^&]+/g,
      '',
    )
    expect(reagentCountQuery(query)).toBe(listFilters)
  })
  it('scopes to non-archived, non-deleted reagents by default', () => {
    const q = reagentListQuery(baseQuery)
    expect(q).toContain('kind=eq.reagent')
    expect(q).toContain('deleted_at=is.null')
    expect(q).toContain('archived_at=is.null')
    expect(q).toContain('order=identifier.asc')
    expect(q).toContain('limit=25')
    expect(q).toContain('offset=0')
  })

  it('includes archived rows only when status filter is archived', () => {
    const q = reagentListQuery({
      ...baseQuery,
      filters: [{ fieldId: 'status', operator: 'eq', values: ['archived'] }],
    })
    expect(q).toContain('archived_at=is.not.null')
    expect(q).not.toContain('status=eq.archived')
  })

  it('applies status, storage and search filters', () => {
    const q = reagentListQuery({
      ...baseQuery,
      filters: [
        { fieldId: 'status', operator: 'eq', values: ['available'] },
        { fieldId: 'storage', operator: 'eq', values: ['-20 °C'] },
        { fieldId: 'q', operator: 'contains', values: ['acetonitrile'] },
      ],
    })
    expect(q).toContain('status=eq.available')
    expect(q).toContain('properties->>storage=eq.-20 °C')
    expect(q).toContain('or=(identifier.ilike.%22acetonitrile*%22')
    expect(q).toContain('properties->>supplier.ilike.%22acetonitrile*%22')
    expect(q).toContain('properties->>catalog_no.ilike.%22acetonitrile*%22')
    expect(q).toContain('properties->>lot.ilike.%22acetonitrile*%22')
  })

  it('quotes punctuation in logical search patterns', () => {
    const q = decodeURIComponent(
      reagentListQuery({
        ...baseQuery,
        filters: [
          { fieldId: 'q', operator: 'contains', values: ['Tris (1, "M"\\)'] },
        ],
      }),
    )

    expect(q).toContain(
      'or=(identifier.ilike."Tris (1, \\"M\\"\\\\)*",title.ilike."Tris (1, \\"M\\"\\\\)*"',
    )
  })

  it('translates sorting to properties->>field for JSONB columns', () => {
    const q = reagentListQuery({
      ...baseQuery,
      sorting: [{ id: 'expiry', desc: true }],
    })
    expect(q).toContain('order=properties->>expiry.desc,identifier.asc')
  })

  it('orders server pages by the active grouping before row sorting', () => {
    const q = reagentListQuery({
      ...baseQuery,
      grouping: ['category'],
      sorting: [{ id: 'updatedAt', desc: true }],
    })
    expect(q).toContain('order=tags->>0.asc,updated_at.desc,identifier.asc')
  })

  it('paginates with limit and offset', () => {
    const q = reagentListQuery({
      ...baseQuery,
      pageIndex: 3,
      pageSize: 50,
    })
    expect(q).toContain('limit=50')
    expect(q).toContain('offset=150')
  })

  it('count query strips limit, offset and order but keeps filters', () => {
    const q = reagentCountQuery({
      ...baseQuery,
      pageIndex: 2,
      pageSize: 50,
      sorting: [{ id: 'title', desc: false }],
      filters: [{ fieldId: 'status', operator: 'eq', values: ['available'] }],
    })
    expect(q).not.toMatch(/limit=/)
    expect(q).not.toMatch(/offset=/)
    expect(q).not.toMatch(/order=/)
    expect(q).toContain('status=eq.available')
  })
})

describe('DEFAULT_EXPIRY_WARNING_DAYS', () => {
  it('is 30', () => {
    expect(DEFAULT_EXPIRY_WARNING_DAYS).toBe(30)
  })
})

describe('createReagent and editReagent', () => {
  it('creates through create_model_record', async () => {
    const rpc = vi.fn(async () => ({
      id: 'r-new',
      workspace_id: 'ws',
      project_id: 'p1',
      kind: 'reagent',
      identifier: 'RGT-2026-0002',
      title: 'Acetonitrile',
      status: 'available',
      tags: ['solvent'],
      structure_version: 1,
      metadata_version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
      deleted_at: null,
      created_by_user_id: 'u1',
      updated_by_user_id: null,
      properties: { supplier: 'Sigma', catalog_no: 'A123' },
      custom_fields: {},
      locked_at: null,
      locked_by_revision_id: null,
    }))
    const created = await createReagent({ rpc } as unknown as DataClient, {
      projectId: 'p1',
      title: 'Acetonitrile',
      tags: ['solvent'],
      properties: { supplier: 'Sigma', catalogNo: 'A123' },
    })
    expect(rpc).toHaveBeenCalledWith('create_model_record', {
      p_project_id: 'p1',
      p_kind: 'reagent',
      p_title: 'Acetonitrile',
      p_status: 'available',
      p_tags: ['solvent'],
      p_properties: { supplier: 'Sigma', catalog_no: 'A123' },
      p_custom_fields: {},
    })
    expect(created.identifier).toBe('RGT-2026-0002')
    expect(created.catalogNo).toBe('A123')
  })
})
