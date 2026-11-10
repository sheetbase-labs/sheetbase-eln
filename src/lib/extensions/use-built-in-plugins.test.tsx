import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extensionQueryKeys } from './client'
import { useBuiltInPlugins } from './use-built-in-plugins'

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity },
    },
  })
  client.setQueryData(extensionQueryKeys.extensions, [])
})

afterEach(() => {
  cleanup()
  client.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('built-in plugin installation', () => {
  it.each(['member', 'viewer', 'scientist'])(
    'does not install for a %s',
    (role) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      renderHook(() => useBuiltInPlugins('workspace', role), { wrapper })
      expect(fetch).not.toHaveBeenCalled()
      expect(sessionStorage.length).toBe(0)
    },
  )

  it('waits for a workspace before installing', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    renderHook(() => useBuiltInPlugins(null, 'owner'), { wrapper })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('installs once per workspace session and invalidates changed plugin data', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ plugins: [{ action: 'updated' }] }),
    )

    vi.stubGlobal('fetch', fetch)

    const hook = renderHook(
      ({ role }) => useBuiltInPlugins('workspace', role),
      {
        initialProps: { role: 'owner' },
        wrapper,
      },
    )

    await waitFor(() =>
      expect(
        client.getQueryState(extensionQueryKeys.extensions)?.isInvalidated,
      ).toBe(true),
    )
    expect(fetch).toHaveBeenCalledWith('/api/plugins/built-in', {
      method: 'POST',
    })
    hook.rerender({ role: 'admin' })
    hook.unmount()
    renderHook(() => useBuiltInPlugins('workspace', 'owner'), { wrapper })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps current plugin data when nothing changed', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ plugins: [{ action: 'unchanged' }] }),
    )

    vi.stubGlobal('fetch', fetch)
    renderHook(() => useBuiltInPlugins('workspace', 'admin'), { wrapper })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(fetch).toHaveBeenCalledOnce()
    expect(
      client.getQueryState(extensionQueryKeys.extensions)?.isInvalidated,
    ).toBe(false)
    expect(sessionStorage.getItem('sheetbase.built-in-plugins.workspace')).toBe(
      '1',
    )
  })

  it.each([
    { body: { plugins: [{ action: 'not-an-install-result' }] }, status: 200 },
    { body: { error: 'forbidden' }, status: 403 },
  ])(
    'allows retry after an invalid or refused response: %j',
    async ({ body, status }) => {
      const fetch = vi.fn(async () => Response.json(body, { status }))
      vi.stubGlobal('fetch', fetch)

      const hook = renderHook(() => useBuiltInPlugins('workspace', 'admin'), {
        wrapper,
      })

      await waitFor(() =>
        expect(
          sessionStorage.getItem('sheetbase.built-in-plugins.workspace'),
        ).toBeNull(),
      )
      expect(
        client.getQueryState(extensionQueryKeys.extensions)?.isInvalidated,
      ).toBe(false)
      hook.unmount()
      fetch.mockImplementation(async () =>
        Response.json({ plugins: [{ action: 'installed' }] }),
      )
      renderHook(() => useBuiltInPlugins('workspace', 'admin'), { wrapper })

      await waitFor(() =>
        expect(
          client.getQueryState(extensionQueryKeys.extensions)?.isInvalidated,
        ).toBe(true),
      )
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )
})
