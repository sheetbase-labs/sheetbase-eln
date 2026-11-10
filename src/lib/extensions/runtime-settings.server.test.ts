/**
 * Where a plugin’s packages stand, the settings route and what a call runs with.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'

import {
  describeRuntime,
  ensureEnvironment,
  refreshEnvironment,
} from './runtime-settings.server'
import type {
  EnvironmentRunner,
  PluginRuntimeRow,
  RuntimeStore,
} from './runtime-settings.server'
import { handlePluginRuntime } from './runtime-settings-route.server'
import type { PluginRuntimeRouteDeps } from './runtime-settings-route.server'

// The session and database layers are exercised by the other plugin routes;
// here the session resolves to a fixed administrator.
vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  resolvePersonalAuth: async () => ({
    ok: true,
    context: { token: 't', workspaceId: 'w', userId: 'u' },
  }),
}))

vi.mock('../connectors/enterprise/execution.server', () => ({
  createServerDataClient: () => ({}),
}))

vi.mock('./client', () => ({
  listExtensions: async () => [
    { id: '11111111-1111-4111-8111-111111111111', key: 'cell-count' },
  ],
}))

const row = (over: Partial<PluginRuntimeRow> = {}): PluginRuntimeRow => ({
  extensionId: '11111111-1111-4111-8111-111111111111',
  requirements: ['rdkit>=2024.3'],
  networkHosts: ['eutils.ncbi.nlm.nih.gov'],
  limitOverrides: {},
  environmentId: null,
  environmentState: 'none',
  environmentError: null,
  ...over,
})

function memoryStore(initial: PluginRuntimeRow): RuntimeStore & {
  current: PluginRuntimeRow
} {
  const store = {
    current: initial,
    load: vi.fn(async () => store.current),
    loadByKey: vi.fn(async () => store.current),
    list: vi.fn(async () => [store.current]),
    saveEnvironment: vi.fn(async (_w, _e, environment) => {
      store.current = {
        ...store.current,
        environmentId: environment.id,
        environmentState: environment.state,
        environmentError: environment.error,
      }
    }),
    saveOverrides: vi.fn(async (_w, _e, overrides) => {
      store.current = { ...store.current, limitOverrides: overrides }
    }),
    saveDeclaration: vi.fn(async () => undefined),
  }

  return store
}

const runner = (over: Partial<EnvironmentRunner> = {}): EnvironmentRunner => ({
  request: vi.fn(async () => ({
    id: 'pe-0123456789abcdef',
    state: 'building' as const,
  })),
  status: vi.fn(async () => ({
    id: 'pe-0123456789abcdef',
    state: 'ready' as const,
  })),
  ...over,
})

describe('ensureEnvironment', () => {
  it('asks the runner for the plugin’s packages and records the answer', async () => {
    const store = memoryStore(row())
    const r = runner()

    const out = await ensureEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(r.request).toHaveBeenCalledWith(['rdkit>=2024.3'])
    expect(out).toMatchObject({
      environmentId: 'pe-0123456789abcdef',
      environmentState: 'building',
    })
    expect(store.saveEnvironment).toHaveBeenCalledTimes(1)
  })

  it('records a failure with the installer’s own reason', async () => {
    const store = memoryStore(row())

    const r = runner({
      request: async () => ({
        id: 'pe-0123456789abcdef',
        state: 'failed',
        error: 'No matching distribution found for rdkit',
      }),
    })

    const out = await ensureEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(out.environmentState).toBe('failed')
    expect(out.environmentError).toMatch(/No matching distribution/)
  })

  it('leaves the state alone when the runner cannot be reached, so the next call asks again', async () => {
    const store = memoryStore(row())

    const r = runner({
      request: async () => {
        throw new Error('Python runner is unavailable. Try again later.')
      },
    })

    const out = await ensureEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(out.environmentState).toBe('failed')
    expect(store.saveEnvironment).not.toHaveBeenCalled()
  })

  it('has nothing to install for a plugin with no packages', async () => {
    const store = memoryStore(row({ requirements: [] }))
    const r = runner()

    const out = await ensureEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(r.request).not.toHaveBeenCalled()
    expect(out.environmentState).toBe('none')
  })

  it('forgets a build whose packages were removed by an update', async () => {
    const store = memoryStore(
      row({
        requirements: [],
        environmentId: 'pe-0123456789abcdef',
        environmentState: 'ready',
      }),
    )

    const out = await ensureEnvironment(
      { store, runner: runner() },
      'w',
      store.current,
    )

    expect(out).toMatchObject({ environmentId: null, environmentState: 'none' })
  })
})

describe('refreshEnvironment', () => {
  it('follows a build to the end and reads what was installed', async () => {
    const store = memoryStore(
      row({
        environmentId: 'pe-0123456789abcdef',
        environmentState: 'building',
      }),
    )

    const r = runner({
      status: async () => ({
        id: 'pe-0123456789abcdef',
        state: 'ready',
        packages: { rdkit: '2024.9.1' },
      }),
    })

    const out = await refreshEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(out.row.environmentState).toBe('ready')
    expect(out.packages).toEqual({ rdkit: '2024.9.1' })
  })

  it('installs again when the runner has lost the packages', async () => {
    const store = memoryStore(
      row({ environmentId: 'pe-0123456789abcdef', environmentState: 'ready' }),
    )

    const r = runner({
      status: async () => ({ id: 'pe-0123456789abcdef', state: 'missing' }),
    })

    const out = await refreshEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(r.request).toHaveBeenCalled()
    expect(out.row.environmentState).toBe('building')
  })

  it('keeps what it knew when the runner is unreachable', async () => {
    const store = memoryStore(
      row({ environmentId: 'pe-0123456789abcdef', environmentState: 'ready' }),
    )

    const r = runner({
      status: async () => {
        throw new Error('down')
      },
    })

    const out = await refreshEnvironment(
      { store, runner: r },
      'w',
      store.current,
    )

    expect(out.row.environmentState).toBe('ready')
  })
})

describe('describeRuntime', () => {
  it('shows the limits a plugin runs with and only what was changed', () => {
    const info = describeRuntime(row({ limitOverrides: { memoryMb: 16384 } }))
    expect(info.overrides).toEqual({ memoryMb: 16384 })
    expect(info.limits.memoryMb).toBe(16384)
    expect(info.limits.timeoutSeconds).toBe(600)
    expect(info.network).toEqual(['eutils.ncbi.nlm.nih.gov'])
  })

  it('ignores stored junk instead of failing', () => {
    expect(describeRuntime(row({ limitOverrides: 'x' })).limits.memoryMb).toBe(
      4096,
    )
  })

  it('reports no environment for a plugin with no packages', () => {
    expect(describeRuntime(row({ requirements: [] })).environment.state).toBe(
      'none',
    )
  })
})

describe('POST/GET /api/plugins/runtime', () => {
  function route(initial = row(), role: 'ok' | 'forbidden' = 'ok') {
    const store = memoryStore(initial)
    const audit = vi.fn(async () => undefined)
    const r = runner()

    const deps = {
      auth: {} as never,
      makeClient: () =>
        ({
          rpc: async (name: string) => {
            if (name === 'require_capability') {
              if (role === 'forbidden') throw new Error('forbidden')

              return null
            }

            // list_extensions
            return []
          },
          list: async () => [
            { id: initial.extensionId, key: 'cell-count', manifest: {} },
          ],
        }) as unknown as DataClient,
      store,
      runner: r,
      audit,
    } satisfies PluginRuntimeRouteDeps

    return { deps, store, audit, r }
  }

  const post = (body: unknown) =>
    new Request('http://x/api/plugins/runtime', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  it('lists each plugin’s settings', async () => {
    const { deps } = route()

    const response = await handlePluginRuntime(
      new Request('http://x/api/plugins/runtime'),
      deps,
    )

    const body = (await response.json()) as {
      runtime: Array<{ requirements: string[] }>
    }

    expect(body.runtime[0].requirements).toEqual(['rdkit>=2024.3'])
  })

  it('saves limits without capping them and says so in the audit', async () => {
    const { deps, store, audit } = route()

    const response = await handlePluginRuntime(
      post({
        action: 'set-limits',
        extensionId: store.current.extensionId,
        limits: { memoryMb: 65536, timeoutSeconds: 7200 },
      }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(store.current.limitOverrides).toEqual({
      memoryMb: 65536,
      timeoutSeconds: 7200,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          change: 'settings_changed',
          extensionKey: 'cell-count',
          setting: 'limits',
        }),
      }),
    )
  })

  it('refuses a limit that makes no sense and changes nothing', async () => {
    const { deps, store, audit } = route()

    const response = await handlePluginRuntime(
      post({
        action: 'set-limits',
        extensionId: store.current.extensionId,
        limits: { memoryMb: 0 },
      }),
      deps,
    )

    expect(response.status).toBe(400)
    expect(store.saveOverrides).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('installs the packages again after a failure', async () => {
    const { deps, store, r } = route(
      row({
        environmentId: 'pe-0123456789abcdef',
        environmentState: 'failed',
        environmentError: 'x',
      }),
    )

    const response = await handlePluginRuntime(
      post({
        action: 'reinstall-packages',
        extensionId: store.current.extensionId,
      }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(r.request).toHaveBeenCalled()
  })

  it('is for owners and administrators only', async () => {
    const { deps } = route(row(), 'forbidden')

    const response = await handlePluginRuntime(
      new Request('http://x/api/plugins/runtime'),
      deps,
    )

    expect(response.status).toBe(403)
  })
})
