/**
 * An operation that calls into the app: the calls are made as the person, a
 * change waits for their yes, and the operation carries on with the answers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleExtensionRun } from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'

const invoke = vi.hoisted(() => vi.fn())
const perform = vi.hoisted(() => vi.fn())
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
vi.mock('./host-route.server', () => ({ performHostCall: perform }))
vi.mock('../auth', () => ({ getAppSession: vi.fn() }))
vi.mock('../connectors/enterprise/execution.server', () => ({
  createServerDataClient: () => ({}),
}))
vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  resolveSessionAuth: vi.fn(),
}))
vi.mock('./client', () => ({ listExtensions: vi.fn() }))

const deps: ExtensionRunRouteDeps = {
  getSession: async () => ({ user: { id: 'u' } }),
  getMember: async () => ({ workspaceId: 'w', role: 'member' }),
  runtime: {
    loadInstall: async () => ({ id: 'x' }),
    listRuntime: async () => [],
  } as never,
  host: async () => ({
    deps: { runtime: {} as never },
    call: {
      workspaceId: 'w',
      userId: 'u',
      client: {} as never,
      install: {} as never,
    },
  }),
}

const post = (extra: Record<string, unknown> = {}) =>
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
    expect(((await response.json()) as { output: unknown }).output).toEqual({
      lots: 2,
    })
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
    const body = (await response.json()) as {
      confirm: { index: number; summary: string }
      hostResults: unknown[]
    }
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
