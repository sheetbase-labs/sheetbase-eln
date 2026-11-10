// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import type { PluginInstallDeps } from './install.server'

// The injected clients below never connect. These values let the real server
// modules initialise without replacing their exports or reading local secrets.
vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:1/test')

vi.stubEnv('FORMULA_DATABASE_URL', 'postgresql://test:test@localhost:1/test')

vi.stubEnv('BETTER_AUTH_SECRET', 'extension-unit-test-secret-not-for-use')

vi.stubEnv('PGRST_JWT_SECRET', 'extension-unit-test-token-not-for-use')

const { BUILT_IN_PLUGINS, ensureBuiltInPlugins, readBuiltInPackage } =
  await import('./built-in.server')

afterAll(() => vi.unstubAllEnvs())

const requestArgs = z.looseObject({
  p_key: z.string().optional(),
  p_extension_id: z.string().optional(),
  p_manifest: z.unknown().optional(),
})

describe('the plugins that ship with Sheetbase', () => {
  it.each(BUILT_IN_PLUGINS.map((p) => [p.folder, p] as const))(
    'reads %s into a valid package',
    async (_name, plugin) => {
      const pkg = await readBuiltInPackage(plugin)
      expect(pkg.manifest.id).toMatch(/^[a-z0-9.-]+$/)
      expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(Object.keys(pkg.files)).toContain('plugin.json')
      // Sources, tests and vectors stay out of the package.
      expect(Object.keys(pkg.files).some((f) => f.includes('ui-src'))).toBe(
        false,
      )
    },
  )

  it('installs each with its fixed key and switches it on', async () => {
    const calls: Array<{ fn: string; args: z.infer<typeof requestArgs> }> = []

    const client = createDataClient(async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(input, 'http://app'), init)

      if (request.method === 'GET') return Response.json([])
      const fn = new URL(request.url).pathname.split('/').at(-1) ?? ''
      const args = requestArgs.parse(await request.json())
      calls.push({ fn, args })

      if (fn === 'install_extension')
        return Response.json({
          id: `id-${args.p_key}`,
          key: args.p_key,
          status: 'installed',
          manifest: args.p_manifest,
        })

      return Response.json({ id: args.p_extension_id, status: 'enabled' })
    })

    const deps: PluginInstallDeps = {
      auth: {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: async () => {
          throw new Error('Authentication is not used by the installer')
        },
      },
      makeClient: () => client,
      savePackage: vi.fn(async () => undefined),
    }

    const results = await ensureBuiltInPlugins(
      client,
      { workspaceId: 'ws', userId: 'u' },
      { deps, hashOf: async () => null },
    )

    expect(results.map((r) => [r.key, r.action])).toEqual(
      BUILT_IN_PLUGINS.map((p) => [p.key, 'installed']),
    )

    const keys = calls.flatMap((c) =>
      c.fn === 'install_extension' ? [c.args.p_key] : [],
    )

    expect(keys).toEqual(BUILT_IN_PLUGINS.map((p) => p.key))
    expect(calls.filter((c) => c.fn === 'enable_extension')).toHaveLength(
      BUILT_IN_PLUGINS.length,
    )
  })
})
