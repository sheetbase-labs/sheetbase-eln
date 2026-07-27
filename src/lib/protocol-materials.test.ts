import { describe, expect, it } from 'vitest'

import type { NotebookRecord } from '#/lib/notebook-data'
import { materialAlerts } from './protocol-materials'

function record(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 'record-1',
    projectId: 'project-1',
    kind: 'reagent',
    identifier: 'RGT-2026-0001',
    title: 'Assay reagent',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'user-1',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

describe('materialAlerts', () => {
  it('reports unavailable records without inventing inventory detail', () => {
    expect(materialAlerts(null)).toEqual([
      { kind: 'unavailable', label: 'Unavailable' },
    ])
  })

  it('surfaces archived and expired state independently', () => {
    expect(
      materialAlerts(
        record({
          archivedAt: '2026-01-01T00:00:00Z',
          properties: { expiry: '2026-06-30' },
        }),
        new Date('2026-07-21T00:00:00Z'),
      ),
    ).toEqual([
      { kind: 'archived', label: 'Archived' },
      { kind: 'expired', label: 'Expired' },
    ])
  })

  it('derives low stock only when a threshold is available', () => {
    expect(materialAlerts(record({ properties: { quantity: 4 } }))).toEqual([])
    expect(
      materialAlerts(
        record({ properties: { quantity: 4, low_stock_threshold: 5 } }),
      ),
    ).toEqual([{ kind: 'low_stock', label: 'Low stock' }])
  })
})
