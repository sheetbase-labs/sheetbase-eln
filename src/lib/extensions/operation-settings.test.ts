/**
 * Operation settings: declared in the manifest, set by an administrator, and
 * handed to the function as `_settings` without reaching the audit or the
 * run history.
 */
import { describe, expect, it, vi } from 'vitest'

import { buildPluginPackage } from './package'
import {
  databaseSettingsStore,
  describeSettings,
} from './plugin-settings.server'
import { ExtensionRunError, invokeExtension } from './runtime.server'
import type { ExtensionRuntimeDeps, PluginRunRecord } from './runtime.server'
import { PipelinePythonError } from '#/lib/pipeline-python.server'

type SettingsInput =
  | string
  | ReadonlyArray<{
      name: string
      label: string
      secret?: boolean
      required?: boolean
    }>

interface OperationInput {
  id: string
  title: string
  description: string
  access: 'read' | 'write'
  inputs: Array<{ name: string; type: string; required: boolean }>
  outputs: Array<{ name: string; type: string; required: boolean }>
  run: string
  settings?: SettingsInput
}

interface Manifest {
  id: string
  name: string
  version: string
  description: string
  provides: { operations: OperationInput[] }
}

const manifestOf = (settings?: SettingsInput): Manifest => {
  const operation: OperationInput = {
    id: 'search',
    title: 'Search',
    description: 'Searches.',
    access: 'read',
    inputs: [{ name: 'query', type: 'text', required: true }],
    outputs: [{ name: 'found', type: 'text', required: true }],
    run: 'ops:search',
  }

  if (settings !== undefined) operation.settings = settings

  return {
    id: 'acme.lookup',
    name: 'Lookup',
    version: '1.0.0',
    description: 'Looks things up.',
    provides: { operations: [operation] },
  }
}

const manifestText = (settings?: SettingsInput) =>
  JSON.stringify(manifestOf(settings))

const SETTINGS = [
  { name: 'token', label: 'Access token', secret: true, required: true },
  { name: 'region', label: 'Region', secret: false, required: false },
]

const PY = 'def search(input):\n    return {"found": "x"}\n'

const build = (manifest: Manifest) =>
  buildPluginPackage({
    'plugin.json': JSON.stringify(manifest),
    'python/ops.py': PY,
  })

describe('manifest', () => {
  it('accepts operation settings in the connector shape', () => {
    expect(() => build(manifestOf(SETTINGS))).not.toThrow()
  })

  it('refuses a duplicate name, a missing flag and too many', () => {
    for (const bad of [
      [SETTINGS[0], SETTINGS[0]],
      [{ name: 'token', label: 'Token', required: true }],
      Array.from({ length: 9 }, (_, i) => ({
        name: `s${i}`,
        label: 'S',
        secret: false,
        required: false,
      })),
      'nope',
    ]) {
      expect(() => build(manifestOf(bad))).toThrow()
    }
  })

  it('does not allow a declared input called _settings', () => {
    const manifest = manifestOf(SETTINGS)
    manifest.provides.operations[0].inputs = [
      { name: '_settings', type: 'text', required: true },
    ]
    expect(() => build(manifest)).toThrow()
  })
})

describe('settings shared across operations', () => {
  const second = (settings: SettingsInput): OperationInput => ({
    id: 'read',
    title: 'Read',
    description: 'Reads.',
    access: 'read',
    inputs: [{ name: 'id', type: 'text', required: true }],
    outputs: [{ name: 'found', type: 'text', required: true }],
    run: 'ops:search',
    settings,
  })

  it('accepts two operations that declare the same setting alike', () => {
    const manifest = manifestOf(SETTINGS)
    manifest.provides.operations.push(second([SETTINGS[0]]))
    expect(() => build(manifest)).not.toThrow()
  })

  it('refuses two that disagree on label, secret or required', () => {
    for (const other of [
      { ...SETTINGS[0], label: 'Other label' },
      { ...SETTINGS[0], secret: false },
      { ...SETTINGS[0], required: false },
    ]) {
      const manifest = manifestOf(SETTINGS)
      manifest.provides.operations.push(second([other]))
      expect(() => build(manifest)).toThrow()
    }
  })
})

describe('describeSettings', () => {
  it('says a secret is set without giving its value', () => {
    const out = describeSettings({ settings: SETTINGS }, [
      {
        scope: 'operations',
        name: 'token',
        value: 'sealed',
        secret: true,
      },
      {
        scope: 'operations',
        name: 'region',
        value: 'eu',
        secret: false,
      },
    ])

    expect(out.find((s) => s.name === 'token')).toMatchObject({
      isSet: true,
      value: null,
    })
    expect(out.find((s) => s.name === 'region')).toMatchObject({ value: 'eu' })
  })

  it('has a store for the operations scope', () => {
    expect(databaseSettingsStore()).toBeDefined()
  })
})

const files = {
  'plugin.json': manifestText(SETTINGS),
  'python/ops.py': 'def search(input):\n    return {"found": "x"}\n',
}

const pkg = buildPluginPackage(files)

function setup(
  stored: Record<string, string>,
  python: ExtensionRuntimeDeps['executePython'],
) {
  const audit = vi.fn(async () => undefined)
  const loadSettings = vi.fn(async () => stored)

  const deps: ExtensionRuntimeDeps = {
    loadInstall: async () => ({
      id: 'e1',
      key: 'lookup',
      name: 'Lookup',
      status: 'enabled',
      manifest: structuredClone(pkg.manifest),
      disabledPoints: [],
    }),
    loadPackage: async () => files,
    loadSettings,
    executePython: python,
    audit,
    now: () => 0,
  }

  return { deps, audit, loadSettings }
}

const args = {
  workspaceId: 'w1',
  actorUserId: 'u1',
  extensionKey: 'lookup',
  itemId: 'search',
  input: { query: 'picogreen' },
}

describe('invokeExtension', () => {
  it('passes the stored settings as _settings and nowhere else', async () => {
    const calls: unknown[] = []

    const { deps, audit, loadSettings } = setup(
      { token: 'sekret-token', region: 'eu' },
      async (call) => {
        calls.push(call.parameters)

        // SAFETY: the function under test reads only `rows` from the runner's answer.
        // SAFETY: the function under test reads only `rows` from the runner's answer.
        return { rows: [{ found: 'ok' }] } as never
      },
    )

    const out = await invokeExtension(args, deps)
    expect(out.output).toEqual({ found: 'ok' })
    expect(loadSettings).toHaveBeenCalledWith('w1', 'e1', 'operations')
    expect(calls[0]).toMatchObject({
      input: {
        query: 'picogreen',
        _settings: { token: 'sekret-token', region: 'eu' },
      },
    })
    expect(JSON.stringify(audit.mock.calls)).not.toContain('sekret-token')
  })

  it('stops with a plain sentence when a required setting is not set', async () => {
    const python = vi.fn()
    const { deps } = setup({ region: 'eu' }, python)
    await expect(invokeExtension(args, deps)).rejects.toMatchObject({
      code: 'not_set_up',
      message: expect.stringContaining('Settings'),
    })
    expect(python).not.toHaveBeenCalled()
  })

  it('hides a secret the function repeats in an error', async () => {
    const { deps, audit } = setup({ token: 'sekret-token' }, async () => {
      throw new Error('PluginError: bad token sekret-token')
    })

    const error = await invokeExtension(args, deps).then(
      () => null,
      (cause: Error) => cause,
    )

    expect(error).toBeInstanceOf(ExtensionRunError)
    expect(error?.message).not.toContain('sekret-token')
    expect(JSON.stringify(audit.mock.calls)).not.toContain('sekret-token')
  })

  it('keeps each run for the Logs view: what it printed, never the inputs or a setting', async () => {
    const kept: PluginRunRecord[] = []

    const { deps } = setup({ token: 'sekret-token' }, async () => {
      // SAFETY: the function under test reads only `rows` and `logs` from the runner's answer.
      return {
        rows: [{ found: 'ok' }],
        logs: ['using sekret-token', 'done'],
      } as never
    })

    deps.recordRun = async (run) => {
      kept.push(run)
    }

    await invokeExtension(args, deps)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      workspaceId: 'w1',
      extensionId: 'e1',
      extensionKey: 'lookup',
      ok: true,
      error: null,
      output: ['using •••', 'done'],
    })
    expect(JSON.stringify(kept)).not.toContain('picogreen')
    expect(JSON.stringify(kept)).not.toContain('sekret-token')
  })

  it('keeps a failed run with the text it printed before failing', async () => {
    const kept: PluginRunRecord[] = []

    const { deps } = setup({ token: 'sekret-token' }, async () => {
      throw new PipelinePythonError('PluginError: nope', 'transform_failed', {
        logs: ['about to fail'],
      })
    })

    deps.recordRun = async (run) => {
      kept.push(run)
    }

    await invokeExtension(args, deps).catch(() => undefined)
    expect(kept[0]).toMatchObject({
      ok: false,
      error: 'PluginError: nope',
      output: ['about to fail'],
    })
  })

  it('does not fail a run when the log cannot be kept', async () => {
    const { deps } = setup({ token: 'sekret-token' }, async () => {
      // SAFETY: the function under test reads only `rows` from the runner's answer.
      return { rows: [{ found: 'ok' }], logs: [] } as never
    })

    deps.recordRun = async () => {
      throw new Error('database down')
    }

    const out = await invokeExtension(args, deps)
    expect(out.output).toEqual({ found: 'ok' })
  })

  it('sends no _settings for an operation that declares none', async () => {
    const plain = { ...files, 'plugin.json': manifestText() }
    const plainPkg = buildPluginPackage(plain)
    const calls: unknown[] = []

    const { deps, loadSettings } = setup({}, async (call) => {
      calls.push(call.parameters)

      // SAFETY: the function under test reads only `rows` from the runner's answer.
      return { rows: [{ found: 'ok' }] } as never
    })

    deps.loadInstall = async () => ({
      id: 'e1',
      key: 'lookup',
      name: 'Lookup',
      status: 'enabled',
      manifest: structuredClone(plainPkg.manifest),
      disabledPoints: [],
    })
    await invokeExtension(args, deps)
    expect(loadSettings).not.toHaveBeenCalled()
    expect(JSON.stringify(calls[0])).not.toContain('_settings')
  })

  it('serves the one stored value to every operation that declares it', async () => {
    const manifest = manifestOf(SETTINGS)

    manifest.provides.operations.push({
      id: 'read',
      title: 'Read',
      description: 'Reads.',
      access: 'read',
      inputs: [{ name: 'id', type: 'text', required: true }],
      outputs: [{ name: 'found', type: 'text', required: true }],
      run: 'ops:search',
      settings: [SETTINGS[0]],
    })

    const both = buildPluginPackage({
      'plugin.json': JSON.stringify(manifest),
      'python/ops.py': files['python/ops.py'],
    })

    const calls: unknown[] = []

    const { deps, loadSettings } = setup(
      { token: 'one-value', region: 'eu' },
      async (call) => {
        calls.push(call.parameters)

        // SAFETY: the function under test reads only `rows` from the runner's answer.
        return { rows: [{ found: 'ok' }] } as never
      },
    )

    deps.loadInstall = async () => ({
      id: 'e1',
      key: 'lookup',
      name: 'Lookup',
      status: 'enabled',
      manifest: structuredClone(both.manifest),
      disabledPoints: [],
    })
    await invokeExtension(args, deps)
    await invokeExtension(
      { ...args, itemId: 'read', input: { id: 'p1' } },
      deps,
    )
    expect(loadSettings).toHaveBeenNthCalledWith(1, 'w1', 'e1', 'operations')
    expect(loadSettings).toHaveBeenNthCalledWith(2, 'w1', 'e1', 'operations')
    // The second operation declares only token, so it gets only token.
    expect(calls[1]).toMatchObject({
      input: { id: 'p1', _settings: { token: 'one-value' } },
    })
    expect(JSON.stringify(calls[1])).not.toContain('region')
  })
})
