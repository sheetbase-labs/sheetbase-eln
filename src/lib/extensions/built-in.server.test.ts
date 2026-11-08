import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import {
  BUILT_IN_PLUGINS,
  ensureBuiltInPlugins,
  readBuiltInPackage,
} from './built-in.server'
import type { PluginInstallDeps } from './install.server'

vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: vi.fn(),
  resolveSessionAuth: vi.fn(),
}))
vi.mock('../connectors/enterprise/execution.server', () => ({
  createServerDataClient: vi.fn(),
}))
vi.mock('./runtime-settings.server', () => ({
  databaseStore: vi.fn(),
  ensureEnvironment: vi.fn(),
  runnerEnvironments: {},
}))

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
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        if (fn === 'list_extensions') return []
        if (fn === 'install_extension')
          return {
            id: `id-${String(args.p_key)}`,
            key: args.p_key,
            status: 'installed',
            manifest: args.p_manifest,
          }
        return { id: String(args.p_extension_id), status: 'enabled' }
      }),
      list: vi.fn(async () => []),
    } as unknown as DataClient
    const deps: PluginInstallDeps = {
      auth: {} as PluginInstallDeps['auth'],
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
    const keys = calls
      .filter((c) => c.fn === 'install_extension')
      .map((c) => c.args.p_key)
    expect(keys).toEqual(BUILT_IN_PLUGINS.map((p) => p.key))
    expect(calls.filter((c) => c.fn === 'enable_extension')).toHaveLength(
      BUILT_IN_PLUGINS.length,
    )
  })
})
