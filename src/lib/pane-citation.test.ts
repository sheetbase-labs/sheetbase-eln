import { describe, expect, it } from 'vitest'

import { createDataClient } from './data-client'
import { citationLabel, citationTarget, resolveCitation } from './pane-citation'

/** A real data client over a recorded transport, answering each read with `rows`. */
function readingClient(rows: unknown[]) {
  const urls: URL[] = []

  const client = createDataClient(async (input, init) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(input, 'http://app.test'), init)

    urls.push(new URL(request.url))

    return Response.json(rows)
  })

  return { client, urls }
}

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
    expect(citationTarget('/settings/account/profile')).toBeNull()
  })
})

describe('resolveCitation', () => {
  it('finds a record by its display ID', async () => {
    const { client, urls } = readingClient([
      { id: 'r1', identifier: 'SMP-2231', kind: 'sample', title: 'Feed' },
    ])

    const cited = await resolveCitation(client, {
      kind: 'sample',
      reference: 'SMP-2231',
    })

    expect(cited).toMatchObject({ id: 'r1', kind: 'sample' })
    expect(urls[0]?.search).toContain('identifier=eq.SMP-2231')
    expect(cited && citationLabel(cited)).toBe('SMP-2231 · Feed')
  })

  it('finds a dataset by its UUID', async () => {
    const { client, urls } = readingClient([
      { id: 'd1', display_id: 'DS-0311', name: 'ELISA' },
    ])

    const cited = await resolveCitation(client, {
      kind: 'dataset',
      reference: '3f2b8f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
    })

    expect(cited?.identifier).toBe('DS-0311')
    expect(urls[0]?.search).toContain('id=eq.')
  })

  it('returns null for an object that cannot be found', async () => {
    const { client } = readingClient([])

    expect(
      await resolveCitation(client, { kind: 'sample', reference: 'SMP-0' }),
    ).toBeNull()
  })
})
