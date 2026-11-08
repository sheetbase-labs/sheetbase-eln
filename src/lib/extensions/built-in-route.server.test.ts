/**
 * POST /api/plugins/built-in installs the plugins that ship with Sheetbase.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'

import { handleBuiltInPlugins } from './built-in-route.server'

vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  resolveSessionAuth: async () => ({
    ok: true,
    context: { token: 't', workspaceId: 'w', userId: 'u' },
  }),
}))
vi.mock('../connectors/enterprise/execution.server', () => ({
  createServerDataClient: () => ({}),
}))
const ensure = vi.hoisted(() => vi.fn())
vi.mock('./built-in.server', () => ({ ensureBuiltInPlugins: ensure }))

const deps = (rpc: () => Promise<unknown> = async () => null) => ({
  auth: {} as never,
  makeClient: () => ({ rpc }) as unknown as DataClient,
})
const post = () =>
  new Request('http://x/api/plugins/built-in', { method: 'POST' })

describe('POST /api/plugins/built-in', () => {
  it('installs the built-in plugins and says what happened', async () => {
    ensure.mockResolvedValueOnce([{ key: 'chemistry', action: 'installed' }])
    const body = (await (
      await handleBuiltInPlugins(post(), deps())
    ).json()) as {
      plugins: { key: string }[]
    }
    expect(body.plugins).toHaveLength(1)
  })

  it('refuses someone who cannot manage plugins', async () => {
    const response = await handleBuiltInPlugins(
      post(),
      deps(async () => {
        throw new Error('no')
      }),
    )
    expect(response.status).toBe(403)
  })
})
