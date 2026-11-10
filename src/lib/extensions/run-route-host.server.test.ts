// @vitest-environment node
/**
 * An operation that calls into the app: the calls are made as the person, a
 * change waits for their yes, and the operation carries on with the answers.
 *
 * The route, the host-call loop and its deps are the real ones; the plugin's
 * Python run is replaced, because that is the one thing this harness is not
 * about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import type { ExtensionWire } from './client'
import { parseExtensionManifest } from './manifest'
import type { HostBridge } from './operation-host.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
import { handleExtensionRun } from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'

const invoke = vi.hoisted(() => vi.fn())

const perform = vi.hoisted(() => vi.fn<NonNullable<HostBridge['perform']>>())

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

// The plugin's Python run is the app's own subprocess boundary; the route imports `invokeExtension` directly and `ExtensionRunRouteDeps` exposes no seam for it, so this harness replaces that one module and exercises the host-call loop around it.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('./runtime.server', async () => ({
  ExtensionRunError: class extends Error {},
  invokeExtension: invoke,
  openCallable: async () => ({
    callable: { declaration: { access: 'write' } },
  }),
  pluginLimits: async () => ({
    callsPerMinute: null,
    dataMb: 10,
    rows: 1000,
  }),
  runExtensionAnalysis: vi.fn(),
  runExtensionHook: vi.fn(),
  defaultDeps: () => ({}),
}))

/** The plugin's Python settings: the route reads only the workspace's list. */
const runtime: ExtensionRuntimeDeps = {
  loadInstall: async () => null,
  loadPackage: async () => null,
  listRuntime: async () => [],
  executePython: async () => {
    throw new Error('The plugin run is replaced in this harness.')
  },
  audit: async () => undefined,
  now: () => 0,
}

/** The installed plugin the host-call loop names when it performs a call. */
const install: ExtensionWire = {
  id: 'ext-1',
  workspace_id: 'w',
  key: 'chemistry',
  name: 'Chemistry',
  version: '1.0.0',
  source: 'https://extensions.example.com/chemistry-1.0.0.tgz',
  manifest: parseExtensionManifest({
    id: 'acme.chemistry',
    name: 'Chemistry',
    version: '1.0.0',
    source: 'https://extensions.example.com/chemistry-1.0.0.tgz',
    capabilities: ['record.create'],
    scopes: ['projects:read'],
    contributions: {},
  }),
  status: 'enabled',
  disabled_points: [],
  credential_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const hostBridge: Pick<HostBridge, 'perform' | 'install'> = {
  perform,
  install: async () => install,
}

const deps: ExtensionRunRouteDeps = {
  getSession: async () => ({ user: { id: 'u' } }),
  getMember: async () => ({ workspaceId: 'w', role: 'member' }),
  runtime,
  host: async () => ({
    client: createDataClient(async () => Response.json([])),
    ...hostBridge,
  }),
}

const postBody = z.object({
  hostResults: z
    .array(
      z.object({
        ok: z.boolean(),
        result: z.unknown().optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
    )
    .optional(),
  approved: z.array(z.number()).optional(),
})

const post = (extra: z.infer<typeof postBody> = {}) =>
  new Request('http://x/api/plugins/run', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'operation',
      extensionKey: 'chemistry',
      operationId: 'add-lot',
      input: { compound_id: 'c1' },
      ...extra,
    }),
  })

const read = {
  name: 'sheetbase.lab.act',
  arguments: { action: 'list_compound_lots' },
}

const write = {
  name: 'sheetbase.lab.act',
  arguments: { action: 'add_compound_lot' },
}

/** What a successful run answers with. */
const doneBody = z.object({ output: z.unknown(), durationMs: z.number() })

/** What a stopped run answers with. */
const confirmBody = z.object({
  confirm: z.object({ index: z.number(), summary: z.string().nullable() }),
  hostResults: z.array(z.unknown()),
})

beforeEach(() => {
  invoke.mockReset()
  perform.mockReset()
})

describe('an operation that calls into the app', () => {
  it('makes a read at once and runs the operation again with the answer', async () => {
    invoke
      .mockResolvedValueOnce({ output: {}, durationMs: 1, hostCalls: [read] })
      .mockResolvedValueOnce({ output: { lots: 2 }, durationMs: 1 })
    perform.mockResolvedValueOnce({ ok: true, result: [{}, {}] })
    const response = await handleExtensionRun(post(), deps)
    expect(response.status).toBe(200)
    expect(doneBody.parse(await response.json()).output).toEqual({ lots: 2 })
    expect(invoke.mock.calls[1][0].hostResults).toEqual([
      { ok: true, result: [{}, {}] },
    ])
  })

  it('stops at a change and says which, keeping the answers so far', async () => {
    invoke.mockResolvedValueOnce({
      output: {},
      durationMs: 1,
      hostCalls: [read, write],
    })
    perform
      .mockResolvedValueOnce({ ok: true, result: [] })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        code: 'confirmation_needed',
        message: 'x',
        summary: 'Add a lot to a compound',
      })
    const response = await handleExtensionRun(post(), deps)
    expect(response.status).toBe(409)

    const body = confirmBody.parse(await response.json())

    expect(body.confirm).toMatchObject({
      index: 1,
      summary: 'Add a lot to a compound',
    })
    expect(body.hostResults).toEqual([{ ok: true, result: [] }])
  })

  it('makes the change once the person has said yes to that call', async () => {
    invoke
      .mockResolvedValueOnce({ output: {}, durationMs: 1, hostCalls: [write] })
      .mockResolvedValueOnce({ output: { lots: 3 }, durationMs: 1 })
    perform.mockResolvedValueOnce({
      ok: true,
      result: { identifier: 'LOT-0003' },
    })

    const response = await handleExtensionRun(
      post({ hostResults: [{ ok: true, result: [] }], approved: [1] }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(perform.mock.calls[0][1].confirmed).toBe(true)
  })

  it('gives a refused call back to the plugin as an error it can handle', async () => {
    invoke
      .mockResolvedValueOnce({ output: {}, durationMs: 1, hostCalls: [read] })
      .mockResolvedValueOnce({ output: {}, durationMs: 1 })
    perform.mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: 'scope_missing',
      message: 'This plugin did not ask for lab:read.',
    })
    await handleExtensionRun(post(), deps)
    expect(invoke.mock.calls[1][0].hostResults).toEqual([
      {
        ok: false,
        error: 'This plugin did not ask for lab:read.',
        code: 'scope_missing',
      },
    ])
  })
})
