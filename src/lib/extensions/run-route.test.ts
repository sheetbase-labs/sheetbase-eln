/**
 * The request limits of a plugin’s routes are the plugin’s own settings, and
 * by default there are none on rate.
 */
import { describe, expect, it, vi } from 'vitest'

import { handleExtensionRun } from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'
import { buildPluginPackage } from './package'
import { readExample } from './testing/local-python'

vi.mock('#/lib/auth', () => ({ getAppSession: async () => null }))

const pkg = buildPluginPackage(readExample('cell-count'))

function setup(overrides: Record<string, unknown> = {}) {
  const executePython = vi.fn(async () => ({
    rows: [{ viability: 92, total: 100 }],
    logs: [],
    runtime: 'x',
  }))
  const deps: ExtensionRunRouteDeps = {
    getSession: async () => ({ user: { id: 'u1' } }),
    getMember: async () => ({ workspaceId: 'w', role: 'member' }),
    runtime: {
      loadInstall: async () => ({
        id: 'e1',
        key: 'cell-count',
        name: 'Cell count',
        status: 'enabled',
        manifest: structuredClone(pkg.manifest),
        disabledPoints: [],
      }),
      loadPackage: async () => pkg.files,
      loadRuntime: async () => ({
        extensionId: 'e1',
        requirements: [],
        networkHosts: [],
        limitOverrides: overrides,
        environmentId: null,
        environmentState: 'none',
        environmentError: null,
      }),
      listRuntime: async () => [
        {
          extensionId: 'e1',
          requirements: [],
          networkHosts: [],
          limitOverrides: overrides,
          environmentId: null,
          environmentState: 'none',
          environmentError: null,
        },
      ],
      executePython,
      audit: async () => undefined,
      now: () => 0,
    },
  }
  const send = (body: unknown) =>
    handleExtensionRun(
      new Request('http://x/api/plugins/run', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      deps,
    )
  return { send, executePython }
}

const operation = (live = 92) => ({
  kind: 'operation',
  extensionKey: 'cell-count',
  operationId: 'viability',
  input: { live, dead: 8 },
})

describe('plugin calls', () => {
  it('have no rate limit unless an administrator sets one', async () => {
    const { send } = setup()
    for (let index = 0; index < 150; index += 1)
      expect((await send(operation(index))).status).toBe(200)
  })

  it('stop at the plugin’s own rate when one is set, naming what to change', async () => {
    const { send } = setup({ callsPerMinute: 3 })
    const statuses = []
    for (let index = 0; index < 5; index += 1)
      statuses.push((await send(operation(index))).status)
    expect(statuses).toEqual([200, 200, 200, 429, 429])
    const refused = await send(operation(9))
    expect(((await refused.json()) as { error: string }).error).toMatch(
      /Too many calls to this plugin/,
    )
  })

  it('refuse more data than the plugin is set up to take, naming where to change it', async () => {
    // 0.001 MB is about a kilobyte.
    const { send, executePython } = setup({ dataMb: 0.001 })
    const big = {
      ...operation(),
      input: { live: 1, dead: 1, pad: 'x'.repeat(5000) },
    }
    const response = await send(big)
    expect(response.status).toBe(413)
    expect(((await response.json()) as { error: string }).error).toMatch(
      /Settings → Plugins/,
    )
    expect(executePython).not.toHaveBeenCalled()
  })

  it('take large requests when the plugin allows them', async () => {
    const { send } = setup({ dataMb: 64 })
    const response = await send({
      ...operation(),
      input: { live: 1, dead: 1 },
    })
    expect(response.status).toBe(200)
  })
})
