import { describe, expect, it } from 'vitest'

import { getConnector } from './client'
import type { DataClient } from '#/lib/data-client'

function recording() {
  const queries: string[] = []
  const client = {
    list: async (_table: string, query: string) => {
      queries.push(query)
      return [{ id: 'c-1', key: 'document-management' }]
    },
  } as unknown as DataClient
  return { client, queries }
}

describe('getConnector', () => {
  it('looks a connector up by id when given a uuid', async () => {
    const { client, queries } = recording()
    await getConnector(client, 'ad1cb5f7-f4f9-4595-9b07-09e733b68429')
    expect(queries[0]).toContain('&id=eq.ad1cb5f7')
  })

  it('looks it up by key when the address carries the readable name', async () => {
    const { client, queries } = recording()
    await getConnector(client, 'document-management')
    expect(queries[0]).toContain('&key=eq.document-management')
  })
})
