import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import type { SampleRecord } from '#/lib/samples'
import { toSampleRecord } from '#/lib/samples'

import { createDataClient } from '#/lib/data-client'

import {
  distinctLocations,
  SAMPLE_TABS,
  fetchStorageLocations,
  sampleListFilters,
  sampleStatus,
  sampleOrder,
  toSampleListRow,
  useSampleTabCounts,
} from './samples-data'

afterEach(cleanup)

function row(overrides: Partial<SampleRecord>): SampleRecord {
  return {
    ...toSampleRecord({
      id: 's-1',
      workspace_id: 'w-1',
      project_id: null,
      folder_id: null,
      kind: 'sample',
      identifier: 'SMP-2220',
      title: 'pAAV9-RC',
      status: 'available',
      tags: [],
      structure_version: 1,
      metadata_version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
      deleted_at: null,
      created_by_user_id: 'u-1',
      updated_by_user_id: null,
      locked_at: null,
      locked_by_revision_id: null,
      properties: {
        sampleType: 'Plasmid',
        quantity: 12.5,
        quantityUnit: 'mg',
        storageLocation: 'F-3',
      },
    }),
    ...overrides,
  }
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

  it('uses unknown-status fallback for inherited object names', () => {
    expect(sampleStatus('constructor')).toEqual({
      tone: 'none',
      label: 'Constructor',
    })
    expect(sampleStatus('toString')).toEqual({
      tone: 'none',
      label: 'ToString',
    })
    expect(sampleStatus('__proto__')).toEqual({
      tone: 'none',
      label: '  Proto  ',
    })
  })
})

describe('sample sorting key boundaries', () => {
  it('ignores inherited names and retains the next supported column or default', () => {
    for (const id of ['constructor', 'toString', '__proto__']) {
      expect(sampleOrder([{ id, desc: false }])).toBe(
        'created_at.desc,identifier.desc',
      )
      expect(
        sampleOrder([
          { id, desc: true },
          { id: 'name', desc: false },
        ]),
      ).toBe('title.asc.nullslast,identifier.asc')
    }
  })

  it('preserves repeated native property reads', () => {
    let reads = 0

    const entry = {
      get id() {
        reads += 1

        return reads === 1 ? 'name' : 'location'
      },
      desc: true,
    }

    expect(sampleOrder([entry])).toBe(
      'properties->>storageLocation.desc.nullslast,identifier.desc',
    )
    expect(reads).toBe(2)
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

    for (const tab of SAMPLE_TABS.filter((t) => t !== 'archived'))
      expect(decoded(tab)).toContain('archived_at=is.null')
    expect(decoded('archived')).toContain('archived_at=not.is.null')
  })

  it('searches ID, name, type and location, matching punctuation literally', () => {
    const clauses = decoded('instock', '50% C-150')
    const or = clauses.find((c) => c.startsWith('or=('))
    expect(or).toContain('identifier.ilike."*50\\\\% C-150*"')
    expect(or).toContain('properties->>sampleType.ilike.')
    expect(or).toContain('properties->>storageLocation.ilike.')
  })
})

describe('database ordering and counts', () => {
  it('keeps server sorting and its identifier tie-breaker, skipping local-only columns', () => {
    expect(sampleOrder(undefined)).toBe('created_at.desc,identifier.desc')
    expect(sampleOrder([{ id: 'quantity', desc: false }])).toBe(
      'created_at.desc,identifier.desc',
    )
    expect(
      sampleOrder([
        { id: 'quantity', desc: false },
        { id: 'type', desc: true },
      ]),
    ).toBe('properties->>sampleType.desc.nullslast,identifier.desc')
    expect(sampleOrder([{ id: 'name', desc: false }])).toBe(
      'title.asc.nullslast,identifier.asc',
    )
  })

  it('keeps each exact HTTP count assigned to its tab', async () => {
    const requests: string[] = []

    const client = createDataClient(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      requests.push(url.search)
      const count = requests.length

      return Response.json([], { headers: { 'content-range': `*/${count}` } })
    })

    const queryClient = new QueryClient()

    const { result } = renderHook(
      () => useSampleTabCounts('u-1', undefined, client),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      instock: 1,
      mine: 2,
      awaiting: 3,
      quarantine: 4,
      consumed: 5,
      archived: 6,
    })
    expect(requests).toHaveLength(SAMPLE_TABS.length)
    expect(decodeURIComponent(requests[1])).toContain(
      'created_by_user_id=eq.u-1',
    )
    expect(decodeURIComponent(requests[5])).toContain('archived_at=not.is.null')
    queryClient.clear()
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
    const list = vi.fn(async () =>
      Response.json([
        { location: 'Shelf B' },
        { location: 'Shelf A' },
        { location: null },
        { location: 'shelf a' },
      ]),
    )

    const client = createDataClient(list)
    expect(await fetchStorageLocations(client)).toEqual(['Shelf A', 'Shelf B'])
    expect(list).toHaveBeenCalledWith(
      '/api/db/rpc/sample_storage_locations?select=location',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
