import { describe, expect, it, vi } from 'vitest'

import { dataClientTestDouble } from './data-client-test-support'
import { fetchUserPreferences } from './user-preferences'

function clientReturning(rows: readonly object[]) {
  const list = vi.fn(async () => rows)

  return { client: dataClientTestDouble({ list }), list }
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
    expect(theme).toEqual({
      appearance: 'dark',
      navCollapsed: true,
      navFolded: [],
    })
    expect(sidebar).toBe(theme)
  })

  it('reads again once the first request has finished', async () => {
    const { client, list } = clientReturning([])
    expect(await fetchUserPreferences(client)).toBeNull()
    await fetchUserPreferences(client)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
