import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { citationLabel, citationTarget, resolveCitation } from './pane-citation'

describe('citationTarget', () => {
  it('reads the kind and reference from an object page', () => {
    expect(citationTarget('/samples/SMP-2231?tab=lineage')).toEqual({
      kind: 'sample',
      reference: 'SMP-2231',
    })
    expect(citationTarget('/datasets/abc/rows')).toEqual({
      kind: 'dataset',
      reference: 'abc',
    })
  })

  it('ignores a page that is not one object', () => {
    expect(citationTarget('/samples')).toBeNull()
    expect(citationTarget('/settings/profile')).toBeNull()
  })
})

describe('resolveCitation', () => {
  it('finds a record by its display ID', async () => {
    const list = vi.fn(async (_r: string, _q: string) => [
      { id: 'r1', identifier: 'SMP-2231', kind: 'sample', title: 'Feed' },
    ])
    const cited = await resolveCitation({ list } as unknown as DataClient, {
      kind: 'sample',
      reference: 'SMP-2231',
    })
    expect(cited).toMatchObject({ id: 'r1', kind: 'sample' })
    expect(list.mock.calls[0]?.[1]).toContain('identifier=eq.SMP-2231')
    expect(citationLabel(cited!)).toBe('SMP-2231 · Feed')
  })

  it('finds a dataset by its UUID', async () => {
    const list = vi.fn(async (_r: string, _q: string) => [
      { id: 'd1', display_id: 'DS-0311', name: 'ELISA' },
    ])
    const cited = await resolveCitation({ list } as unknown as DataClient, {
      kind: 'dataset',
      reference: '3f2b8f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
    })
    expect(cited?.identifier).toBe('DS-0311')
    expect(list.mock.calls[0]?.[1]).toContain('id=eq.')
  })

  it('returns null for an object that cannot be found', async () => {
    const list = vi.fn(async (_r: string, _q: string) => [])
    expect(
      await resolveCitation({ list } as unknown as DataClient, {
        kind: 'sample',
        reference: 'SMP-0',
      }),
    ).toBeNull()
  })
})
