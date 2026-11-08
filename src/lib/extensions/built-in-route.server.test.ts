/**
 * Installing the built-in plugins moves existing compounds onto the chemistry plugin.
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
vi.mock('./data-runtime.server', () => ({ runExtensionSamenessKey: vi.fn() }))

const deps = (adoptChemistry: ReturnType<typeof vi.fn>) => ({
  auth: {} as never,
  makeClient: () => ({ rpc: async () => null }) as unknown as DataClient,
  adoptChemistry,
})
const post = () =>
  new Request('http://x/api/plugins/built-in', { method: 'POST' })

describe('POST /api/plugins/built-in', () => {
  it('adopts existing compounds when chemistry was installed', async () => {
    ensure.mockResolvedValueOnce([{ key: 'chemistry', action: 'installed' }])
    const adopt = vi.fn(async () => [
      {
        modelKey: 'compound',
        structureField: 'structure',
        keyed: 3,
        skipped: 0,
      },
    ])
    const body = (await (
      await handleBuiltInPlugins(post(), deps(adopt))
    ).json()) as {
      adopted: unknown[]
    }
    expect(adopt).toHaveBeenCalledTimes(1)
    expect(body.adopted).toHaveLength(1)
  })

  it('leaves compounds alone when nothing changed', async () => {
    ensure.mockResolvedValueOnce([{ key: 'chemistry', action: 'unchanged' }])
    const adopt = vi.fn()
    await handleBuiltInPlugins(post(), deps(adopt))
    expect(adopt).not.toHaveBeenCalled()
  })

  it('keeps the install when adopting fails and says so', async () => {
    ensure.mockResolvedValueOnce([{ key: 'chemistry', action: 'updated' }])
    const adopt = vi.fn(async () => {
      throw new Error('The plugin is off.')
    })
    const response = await handleBuiltInPlugins(post(), deps(adopt))
    expect(response.status).toBe(200)
    expect(((await response.json()) as { adoptError: string }).adoptError).toBe(
      'The plugin is off.',
    )
  })
})
