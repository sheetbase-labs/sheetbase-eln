// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from '../data-client'
import type { SessionAuthDeps } from '../request-auth'
import { handlePluginInstall } from './install.server'
import type { PluginInstallDeps } from './install.server'

/**
 * The install handler's real dependencies (the database client, the session
 * auth, the runner settings) read the server environment when they load. The
 * test gives them a disposable one instead of replacing the modules, so the
 * handler under test is the real one.
 */
vi.hoisted(() => {
  const secret = 'x'.repeat(32)

  process.env.DATABASE_URL ??=
    'postgresql://sheetbase:sheetbase@localhost:5432/sheetbase'
  process.env.FORMULA_DATABASE_URL ??=
    'postgresql://sheetbase:sheetbase@localhost:5432/sheetbase'
  process.env.BETTER_AUTH_SECRET ??= secret
  process.env.PGRST_JWT_SECRET ??= secret
})

function deps(
  verifyBearer: SessionAuthDeps['verifyBearer'],
  capability: () => Promise<void>,
) {
  const rpc = vi.fn((name: string) =>
    name === 'require_capability' ? capability() : Promise.resolve(null),
  )

  const makeClient = vi.fn((_token: string) => {
    return Object.assign(createDataClient(), { rpc })
  })

  const value: PluginInstallDeps = {
    auth: {
      getSession: async () => null,
      getWorkspaceForUser: async () => null,
      mintToken: async () => 'minted',
      verifyBearer,
    },
    makeClient,
    savePackage: async () => {},
  }

  return { value, makeClient, rpc }
}

const post = (token?: string) =>
  new Request('https://lab.example/api/plugins/install?mode=check', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: new Uint8Array([1, 2, 3]),
  })

describe('POST /api/plugins/install with an API token', () => {
  it('takes a personal token with admin:write and checks the person may manage plugins', async () => {
    const verify = vi.fn(async () => ({
      userId: 'u-owner',
      workspaceId: 'ws-1',
      credentialId: 'cred-1',
    }))

    const { value, makeClient, rpc } = deps(verify, async () => {})
    const response = await handlePluginInstall(post('sbk_token'), value)
    expect(verify).toHaveBeenCalledWith('sbk_token', 'admin:write')
    expect(makeClient).toHaveBeenCalledWith('sbk_token')
    expect(rpc).toHaveBeenCalledWith('require_capability', {
      p_workspace_id: 'ws-1',
      p_capability: 'extensions.manage',
    })
    // Three bytes are not a plugin: the token got as far as reading the file.
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_package' },
    })
  })

  it('refuses a token without admin:write', async () => {
    const { value, makeClient } = deps(
      async () => null,
      async () => {},
    )

    const response = await handlePluginInstall(post('sbk_token'), value)
    expect(response.status).toBe(401)
    expect(makeClient).not.toHaveBeenCalled()
  })

  it('refuses a token whose owner cannot manage plugins', async () => {
    const { value } = deps(
      async () => ({
        userId: 'u-member',
        workspaceId: 'ws-1',
        credentialId: 'cred-2',
      }),
      async () => {
        throw new Error('capability required')
      },
    )

    const response = await handlePluginInstall(post('sbk_token'), value)
    expect(response.status).toBe(403)
  })

  it('still needs a session when there is no token', async () => {
    const { value } = deps(undefined, async () => {})
    const response = await handlePluginInstall(post(), value)
    expect(response.status).toBe(401)
  })
})
