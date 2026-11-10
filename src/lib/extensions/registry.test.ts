/**
 * EXT-02 registry tests: one resolve path for every surface, per-action
 * capability gating, fail-closed invoke, and audit identity.
 */
import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from '../data-client'
import {
  describeExtensionInvocationError,
  extensionInvocationAudit,
  invokeExtensionContribution,
  resolveExtensionContributions,
} from './registry'
import type { ExtensionInstallLike } from './registry'

function install(
  overrides: Partial<ExtensionInstallLike> & { manifest: unknown },
): ExtensionInstallLike {
  return {
    id: 'ext-1',
    key: 'sample',
    status: 'enabled',
    ...overrides,
  }
}

function manifest<T extends object>(overrides: T) {
  return {
    id: 'sheetbase.sample-panel',
    name: 'Sample Panel',
    version: '1.0.0',
    source: 'dev:sheetbase-sample-panel',
    capabilities: [],
    scopes: ['projects:read'],
    contributions: {},
    ...overrides,
  }
}

describe('resolveExtensionContributions', () => {
  it('resolves declared UI points from enabled installs', () => {
    const points = resolveExtensionContributions(
      [
        install({
          manifest: manifest({
            contributions: {
              'object-actions': [
                { id: 'open-panel', title: 'Open sample panel' },
              ],
              panels: [{ id: 'sample-panel', title: 'Sample panel' }],
              commands: [
                { id: 'sample-overview', title: 'Open sample overview' },
              ],
            },
          }),
        }),
      ],
      'member',
    )

    expect(points.objectActions.map((c) => c.id)).toEqual(['open-panel'])
    expect(points.panels.map((c) => c.id)).toEqual(['sample-panel'])
    expect(points.commands.map((c) => c.id)).toEqual(['sample-overview'])
    expect(points.objectActions[0]).toMatchObject({
      extensionId: 'ext-1',
      extensionKey: 'sample',
      manifestId: 'sheetbase.sample-panel',
      manifestVersion: '1.0.0',
      point: 'object-actions',
      requiredCapability: null,
      key: 'sample:object-actions:open-panel',
    })
  })

  it('contributes nothing for disabled, installed-only, or role-less callers', () => {
    const withContributions = manifest({
      contributions: { commands: [{ id: 'c', title: 'C' }] },
    })

    for (const status of ['installed', 'disabled', 'revoked']) {
      expect(
        resolveExtensionContributions(
          [install({ manifest: withContributions, status })],
          'member',
        ).commands,
      ).toEqual([])
    }

    expect(
      resolveExtensionContributions(
        [install({ manifest: withContributions })],
        null,
      ).commands,
    ).toEqual([])
    expect(
      resolveExtensionContributions(
        [install({ manifest: withContributions })],
        undefined,
      ).commands,
    ).toEqual([])
  })

  it('drops unparsable manifests and ignores non-UI points', () => {
    const points = resolveExtensionContributions(
      [
        install({ id: 'bad', key: 'bad', manifest: { nope: true } }),
        install({
          id: 'sub',
          key: 'sub',
          manifest: manifest({
            contributions: {
              'event-subscriptions': [{ eventType: 'record.updated' }],
            },
          }),
        }),
      ],
      'member',
    )

    expect(points).toEqual({ objectActions: [], panels: [], commands: [] })
  })

  it('gates hinted contributions on the caller effective capabilities', () => {
    const withHint = manifest({
      capabilities: ['record.create'],
      scopes: [],
      contributions: {
        'object-actions': [
          { id: 'gated', title: 'Gated', capability: 'record.create' },
          { id: 'open', title: 'Open' },
        ],
      },
    })

    const member = resolveExtensionContributions(
      [install({ manifest: withHint })],
      'member',
    )

    expect(member.objectActions.map((c) => c.id)).toEqual(['gated', 'open'])
    expect(member.objectActions[0].requiredCapability).toBe('record.create')

    const viewer = resolveExtensionContributions(
      [install({ manifest: withHint })],
      'viewer',
    )

    expect(viewer.objectActions.map((c) => c.id)).toEqual(['open'])
  })

  it('drops declarations whose hint names an undeclared capability', () => {
    const points = resolveExtensionContributions(
      [
        install({
          manifest: manifest({
            capabilities: ['record.create'],
            scopes: [],
            contributions: {
              commands: [
                { id: 'bad', title: 'Bad', capability: 'schema.edit' },
                {
                  id: 'alsobad',
                  title: 'Also bad',
                  capability: 'database.drop',
                },
                { id: 'null', title: 'Null', capability: null },
                { id: 'boolean', title: 'Boolean', capability: false },
                {
                  id: 'object',
                  title: 'Object',
                  capability: { name: 'record.create' },
                },
              ],
            },
          }),
        }),
      ],
      'owner',
    )

    expect(points.commands).toEqual([])
  })

  it('orders contributions deterministically across extensions', () => {
    const points = resolveExtensionContributions(
      [
        install({
          id: 'b',
          key: 'bravo',
          manifest: manifest({
            contributions: { commands: [{ id: 'z', title: 'Z' }] },
          }),
        }),
        install({
          id: 'a',
          key: 'alpha',
          manifest: manifest({
            contributions: { commands: [{ id: 'a', title: 'A' }] },
          }),
        }),
      ],
      'member',
    )

    expect(points.commands.map((c) => c.key)).toEqual([
      'alpha:commands:a',
      'bravo:commands:z',
    ])
  })
})

describe('invokeExtensionContribution', () => {
  function contribution() {
    return resolveExtensionContributions(
      [
        install({
          manifest: manifest({
            capabilities: ['record.create'],
            scopes: [],
            contributions: {
              commands: [{ id: 'c', title: 'C', capability: 'record.create' }],
            },
          }),
        }),
      ],
      'member',
    ).commands[0]
  }

  it('asserts the required capability before running the operation', async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    )

    const operation = vi.fn(async () => 'done')

    const { result, audit } = await invokeExtensionContribution(
      createDataClient(transport),
      'ws-1',
      contribution(),
      operation,
    )

    expect(transport).toHaveBeenCalledWith(
      '/api/db/rpc/assert_extension_capability',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          p_workspace_id: 'ws-1',
          p_extension_id: 'ext-1',
          p_capability: 'record.create',
        }),
      }),
    )
    expect(operation).toHaveBeenCalledTimes(1)
    expect(result).toBe('done')
    expect(audit).toEqual({
      extension_id: 'ext-1',
      extension_key: 'sample',
      extension_manifest: 'sheetbase.sample-panel',
      extension_version: '1.0.0',
    })
  })

  it('fails closed: the operation never runs when the assert rejects', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            code: 'forbidden',
            message: 'capability required: record.create',
          },
        },
        { status: 403 },
      ),
    )

    const operation = vi.fn(async () => 'done')
    await expect(
      invokeExtensionContribution(
        createDataClient(transport),
        'ws-1',
        contribution(),
        operation,
      ),
    ).rejects.toThrow('capability required')
    expect(operation).not.toHaveBeenCalled()
  })

  it('skips the assert for authority-free contributions', async () => {
    const free = resolveExtensionContributions(
      [
        install({
          manifest: manifest({
            contributions: { commands: [{ id: 'c', title: 'C' }] },
          }),
        }),
      ],
      'member',
    ).commands[0]

    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    )

    const { result } = await invokeExtensionContribution(
      createDataClient(transport),
      'ws-1',
      free,
      async () => 42,
    )

    expect(transport).not.toHaveBeenCalled()
    expect(result).toBe(42)
  })
})

describe('extension invocation audit + errors', () => {
  it('preserves native diagnostic coercion, Unicode and arbitrary coercion throws', () => {
    expect(describeExtensionInvocationError(Symbol('Δμ'))).toBe('Symbol(Δμ)')
    expect(describeExtensionInvocationError({})).toBe('[object Object]')
    const coerce = vi.fn(() => 'Δμ 6.02e23')

    expect(describeExtensionInvocationError({ toString: coerce })).toBe(
      'Δμ 6.02e23',
    )
    expect(coerce).toHaveBeenCalledTimes(1)
    const thrown = Symbol('coercion failure')

    try {
      describeExtensionInvocationError({
        toString() {
          throw thrown
        },
      })
      expect.unreachable('native coercion must throw')
    } catch (error) {
      expect(error).toBe(thrown)
    }
  })

  it('stamps the stable audit identity', () => {
    expect(
      extensionInvocationAudit({
        extensionId: 'ext-1',
        extensionKey: 'sample',
        manifestId: 'sheetbase.sample-panel',
        manifestVersion: '1.0.0',
      }),
    ).toEqual({
      extension_id: 'ext-1',
      extension_key: 'sample',
      extension_manifest: 'sheetbase.sample-panel',
      extension_version: '1.0.0',
    })
  })

  it('explains gating failures without leaking internals', () => {
    expect(
      describeExtensionInvocationError(new Error('extension is not enabled')),
    ).toMatch(/no longer enabled/)
    expect(
      describeExtensionInvocationError(new Error('capability required: x')),
    ).toMatch(/permission/)
    expect(
      describeExtensionInvocationError(new Error('extension not found')),
    ).toMatch(/no longer installed/)
  })
})
