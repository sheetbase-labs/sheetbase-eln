import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { fetchUserPreferences } from './user-preferences'

function clientReturning(rows: unknown[]) {
  const list = vi.fn(async () => rows)
  return { client: { list } as unknown as DataClient, list }
}

describe('fetchUserPreferences', () => {
  it('shares one request between callers that ask at the same time', async () => {
    const { client, list } = clientReturning([
      { appearance: 'dark', nav_collapsed: true },
    ])
    const [theme, sidebar] = await Promise.all([
      fetchUserPreferences(client),
      fetchUserPreferences(client),
    ])
    expect(list).toHaveBeenCalledTimes(1)
    expect(theme).toEqual({ appearance: 'dark', navCollapsed: true })
    expect(sidebar).toBe(theme)
  })

  it('reads again once the first request has finished', async () => {
    const { client, list } = clientReturning([])
    expect(await fetchUserPreferences(client)).toBeNull()
    await fetchUserPreferences(client)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
