/**
 * A plugin from upload to answer: the manifest, the generated surfaces, the
 * gate every call passes through, and a real run of the plugin's Python in the
 * runner's own worker.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  operationPresentation,
  pipelineActionsFrom,
  assistantToolsFrom,
} from '../operations/descriptor'
import { validateExtensionManifest } from './manifest'
import { buildPluginPackage } from './package'
import { parsePluginName, pluginOperationName } from './points'
import { describeRunnerAdds, resolveRunnerPoints } from './runner-points'
import {
  ExtensionRunError,
  checkDeclaredValues,
  invokeExtension,
  openExtensionPoint,
  runExtensionAnalysis,
} from './runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
import { pluginStatement } from './python-host.server'
import {
  localPython,
  pythonAvailable,
  readExample,
} from './testing/local-python'

const files = readExample('cell-count')
const pkg = buildPluginPackage(files)
const manifest = () => structuredClone(pkg.manifest) as any

function withWriteOperation() {
  const m = manifest()
  m.contributions.operations.push({
    ...m.contributions.operations[0],
    id: 'record-count',
    access: 'write',
  })
  return m
}

describe('resolveRunnerPoints and the generated surfaces', () => {
  const install = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    key: 'cell-count',
    status: 'enabled',
    manifest: withWriteOperation(),
    disabled_points: [],
    ...over,
  })

  it('lists every enabled operation with its generated descriptor', () => {
    const out = resolveRunnerPoints([install()])
    expect(out.operations.map((i) => i.name)).toEqual([
      'plugin.cell-count.record-count',
      'plugin.cell-count.seeding-volume',
      'plugin.cell-count.viability',
    ])
    expect(out.descriptors).toHaveLength(3)
  })

  it('one declaration gives the assistant tool, the pipeline action and the card or answer', () => {
    const { descriptors } = resolveRunnerPoints([install()])
    const byName = Object.fromEntries(descriptors.map((d) => [d.name, d]))
    expect(operationPresentation(byName['plugin.cell-count.viability'])).toBe(
      'answer',
    )
    expect(
      operationPresentation(byName['plugin.cell-count.record-count']),
    ).toBe('card')
    expect(assistantToolsFrom(descriptors, 'read')).toContain(
      'plugin.cell-count.viability',
    )
    expect(assistantToolsFrom(descriptors, 'propose')).toEqual([
      'plugin.cell-count.record-count',
    ])
    const action = pipelineActionsFrom(descriptors).find(
      (a) => a.operation === 'plugin.cell-count.viability',
    )!
    expect(action.label).toBe('Cell viability')
    expect(action.arguments.map((a) => [a.name, a.type, a.required])).toEqual([
      ['live', 'integer', true],
      ['dead', 'integer', true],
    ])
  })

  it('removes work when disabled, removed or switched off', () => {
    expect(
      resolveRunnerPoints([install({ status: 'disabled' })]).operations,
    ).toEqual([])
    expect(resolveRunnerPoints([]).descriptors).toEqual([])
    const off = resolveRunnerPoints([
      install({ disabled_points: ['operations'] }),
    ])
    expect(off.operations).toEqual([])
    expect(off.descriptors).toEqual([])
  })

  it('ignores an unreadable manifest instead of failing', () => {
    expect(
      resolveRunnerPoints([install({ manifest: { nope: 1 } })]).operations,
    ).toEqual([])
  })

  it('describes what a manifest adds, and nothing for junk', () => {
    expect(describeRunnerAdds(manifest()).map((a) => a.point)).toEqual([
      'operations',
    ])
    expect(describeRunnerAdds('x')).toEqual([])
  })

  it('round-trips names', () => {
    expect(parsePluginName(pluginOperationName('a-b', 'c'))).toEqual({
      key: 'a-b',
      id: 'c',
    })
    expect(parsePluginName('records.search')).toBeNull()
  })

  it('the stored manifest validates as a manifest', () => {
    expect(validateExtensionManifest(manifest())).toEqual([])
  })
})

describe('checkDeclaredValues', () => {
  const fields = [
    { name: 'n', type: 'integer' as const, required: true },
    { name: 'note', type: 'text' as const, required: false },
  ]
  it('returns the declared fields and refuses others', () => {
    expect(checkDeclaredValues(fields, { n: 2 }, 'input')).toEqual({ n: 2 })
    expect(() =>
      checkDeclaredValues(fields, { n: 2, extra: 1 }, 'input'),
    ).toThrow(/extra/)
  })
  it('names a missing or wrong value', () => {
    expect(() => checkDeclaredValues(fields, {}, 'input')).toThrow(
      ExtensionRunError,
    )
    expect(() => checkDeclaredValues(fields, { n: 1.5 }, 'input')).toThrow(/n/)
    expect(() => checkDeclaredValues(fields, [], 'answer')).toThrow(
      ExtensionRunError,
    )
  })
})

function deps(over: Partial<ExtensionRuntimeDeps> = {}) {
  const audit = vi.fn(async () => undefined)
  const d: ExtensionRuntimeDeps = {
    loadInstall: async () => ({
      id: 'e1',
      key: 'cell-count',
      name: 'Cell count',
      status: 'enabled',
      manifest: manifest(),
      disabledPoints: [],
    }),
    loadPackage: async () => files,
    executePython: pythonAvailable
      ? localPython
      : vi.fn(async () => ({
          rows: [{ viability: 92, total: 100 }],
          logs: [],
          runtime: 'x',
        })),
    audit,
    now: () => 0,
    ...over,
  }
  return { d, audit }
}

const base = { workspaceId: 'w', actorUserId: 'u', extensionKey: 'cell-count' }

describe('the gate', () => {
  it.each([
    [{ status: 'disabled' }, 'not_enabled'],
    [{ disabledPoints: ['operations'] }, 'point_off'],
    [{ manifest: { bad: true } }, 'bad_manifest'],
  ])('refuses %j', async (over, code) => {
    const { d } = deps({
      loadInstall: async () => ({
        id: 'e1',
        key: 'cell-count',
        name: 'C',
        status: 'enabled',
        manifest: manifest(),
        disabledPoints: [],
        ...over,
      }),
    })
    await expect(
      openExtensionPoint(d, 'w', 'cell-count', 'operations'),
    ).rejects.toMatchObject({ code })
  })

  it('refuses a removed plugin', async () => {
    const { d } = deps({ loadInstall: async () => null })
    await expect(
      openExtensionPoint(d, 'w', 'x', 'operations'),
    ).rejects.toMatchObject({
      code: 'not_installed',
    })
  })

  it('refuses a plugin whose code is gone', async () => {
    const { d } = deps({ loadPackage: async () => null })
    await expect(
      invokeExtension(
        {
          ...base,

          itemId: 'viability',
          input: { live: 1, dead: 1 },
        },
        d,
      ),
    ).rejects.toMatchObject({ code: 'no_package' })
  })
})

describe('the Python step', () => {
  it('carries the plugin files and the host, and nothing from outside', () => {
    const statement = pluginStatement(files)
    expect(statement).toContain('counting.py')
    expect(statement).toContain('sheetbase_plugin/host.py')
    expect(statement).not.toContain('README')
  })
})

describe.skipIf(!pythonAvailable)(
  'invokeExtension with the real Python worker',
  () => {
    const run = (
      itemId: string,
      input: Record<string, unknown>,
      over: Partial<ExtensionRuntimeDeps> = {},
    ) => {
      const { d, audit } = deps(over)
      return {
        audit,
        promise: invokeExtension({ ...base, itemId, input }, d),
      }
    }

    it('runs the operation, checks the answer and audits', async () => {
      const { promise, audit } = run('viability', { live: 92, dead: 8 })
      const out = await promise
      expect(out.output).toEqual({ viability: 92, total: 100 })
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            change: 'invoked',
            ok: true,
            itemId: 'viability',
          }),
        }),
      )
    })

    it('passes the plugin’s own refusal through word for word', async () => {
      const { promise, audit } = run('viability', { live: 0, dead: 0 })
      await expect(promise).rejects.toMatchObject({
        code: 'plugin_refused',
        message: 'Count at least one cell.',
      })
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ ok: false }),
        }),
      )
    })

    it('reports a crash as a crash, not as the plugin’s refusal', async () => {
      const broken = {
        ...files,
        'python/counting.py': 'def viability(input):\n    return 1 / 0\n',
      }
      const { promise } = run(
        'viability',
        { live: 1, dead: 1 },
        { loadPackage: async () => broken },
      )
      await expect(promise).rejects.toMatchObject({ code: 'transform_failed' })
      await expect(promise).rejects.toThrow(/ZeroDivisionError/)
    })

    it('rejects an answer that breaks the declared outputs', async () => {
      const wrong = {
        ...files,
        'python/counting.py':
          'def viability(input):\n    return {"viability": "lots", "total": 1}\n',
      }
      const { promise } = run(
        'viability',
        { live: 1, dead: 1 },
        { loadPackage: async () => wrong },
      )
      await expect(promise).rejects.toMatchObject({ code: 'bad_answer' })
    })

    it('cannot reach the network or other files', async () => {
      // The runner's container has no network; here we only prove the loader
      // serves the plugin's own files, so an import of anything else is the
      // standard library or nothing.
      const peek = {
        ...files,
        'python/counting.py':
          'def viability(input):\n    import counting_secret\n    return {}\n',
      }
      const { promise } = run(
        'viability',
        { live: 1, dead: 1 },
        { loadPackage: async () => peek },
      )
      await expect(promise).rejects.toThrow(
        /ModuleNotFoundError|No module named/,
      )
    })

    it('refuses undeclared operations and bad input before any code runs', async () => {
      const executePython = vi.fn(localPython)
      await expect(
        run('nope', {}, { executePython }).promise,
      ).rejects.toMatchObject({
        code: 'not_declared',
      })
      await expect(
        run('viability', { live: 1 }, { executePython }).promise,
      ).rejects.toMatchObject({
        code: 'bad_input',
      })
      expect(executePython).not.toHaveBeenCalled()
    })
  },
)

describe.skipIf(!pythonAvailable)('analysis kinds', () => {
  it('runs a declared analysis and returns its result shape', async () => {
    const analysisFiles = {
      ...files,
      'python/stats.py':
        'def smooth(df):\n    df = df.sort_values("x")\n    df["y"] = df["y"].rolling(2, min_periods=1).mean()\n    return df[["x", "y"]]\n',
    }
    const m = manifest()
    m.contributions['analysis-kinds'] = [
      {
        id: 'smooth',
        title: 'Smooth',
        inputs: [
          { name: 'x', label: 'X', type: 'number', required: true },
          { name: 'y', label: 'Y', type: 'number', required: true },
        ],
        runner: { kind: 'python', entry: 'stats:smooth' },
        result: {
          columns: [
            { name: 'x', type: 'number' },
            { name: 'y', type: 'number' },
          ],
          chart: { type: 'line', x: 'x', y: 'y' },
        },
      },
    ]
    const { d } = deps({
      loadInstall: async () => ({
        id: 'e1',
        key: 'cell-count',
        name: 'C',
        status: 'enabled',
        manifest: m,
        disabledPoints: [],
      }),
      loadPackage: async () => analysisFiles,
    })
    const out = await runExtensionAnalysis(
      {
        workspaceId: 'w',
        actorUserId: 'u',
        extensionKey: 'cell-count',
        kindId: 'smooth',
        rows: [
          { x: 1, y: 2 },
          { x: 2, y: 4 },
          { x: 3, y: 8 },
        ],
      },
      d,
    )
    expect(out.rows.map((r) => r.y)).toEqual([2, 3, 6])
    expect(out.chart).toEqual({ type: 'line', x: 'x', y: 'y' })
  })
})

describe('what a call runs with', () => {
  const runtimeRow = (over: Record<string, unknown> = {}) => ({
    extensionId: 'e1',
    requirements: [] as string[],
    networkHosts: [] as string[],
    limitOverrides: {},
    environmentId: null as string | null,
    environmentState: 'none' as const,
    environmentError: null as string | null,
    ...over,
  })
  const call = (over: Partial<ExtensionRuntimeDeps>) => {
    const executePython = vi.fn(async (_job: unknown) => ({
      rows: [{ viability: 92, total: 100 }],
      logs: [],
      runtime: 'x',
    }))
    const { d } = deps({ executePython, ...over })
    return {
      executePython,
      promise: invokeExtension(
        {
          ...base,
          point: 'operations',
          itemId: 'viability',
          input: { live: 92, dead: 8 },
        },
        d,
      ),
    }
  }

  it('gives a plugin with no settings the generous defaults and no packages or hosts', async () => {
    const { executePython, promise } = call({})
    await promise
    const sent = executePython.mock.calls[0][0] as any
    expect(sent.limits).toMatchObject({
      timeoutSeconds: 600,
      memoryMb: 4096,
      rows: 5_000_000,
    })
    expect(sent.environment).toBeUndefined()
    expect(sent.network).toBeUndefined()
  })

  it('gives the plugin its administrator’s limits, its installed packages and its approved hosts', async () => {
    const { executePython, promise } = call({
      loadRuntime: async () =>
        runtimeRow({
          limitOverrides: { memoryMb: 32768, timeoutSeconds: 3600 },
          requirements: ['rdkit>=2024.3'],
          networkHosts: ['eutils.ncbi.nlm.nih.gov'],
          environmentId: 'pe-0123456789abcdef',
          environmentState: 'ready',
        }),
    })
    await promise
    const sent = executePython.mock.calls[0][0] as any
    expect(sent.limits).toMatchObject({ memoryMb: 32768, timeoutSeconds: 3600 })
    expect(sent.environment).toBe('pe-0123456789abcdef')
    expect(sent.network).toEqual(['eutils.ncbi.nlm.nih.gov'])
  })

  it('does not run until the packages are installed, and says why', async () => {
    const settle = vi.fn(async (_w: string, row: any) => ({
      ...row,
      environmentId: 'pe-0123456789abcdef',
      environmentState: 'building' as const,
    }))
    const { executePython, promise } = call({
      loadRuntime: async () => runtimeRow({ requirements: ['rdkit'] }),
      settleEnvironment: settle,
    })
    await expect(promise).rejects.toMatchObject({
      code: 'environment_not_ready',
      message: expect.stringMatching(/still being installed/),
    })
    expect(executePython).not.toHaveBeenCalled()
    expect(settle).toHaveBeenCalled()
  })

  it('names the installer’s reason when the packages could not be installed', async () => {
    const { promise } = call({
      loadRuntime: async () =>
        runtimeRow({
          requirements: ['nope'],
          environmentId: 'pe-0123456789abcdef',
          environmentState: 'failed',
          environmentError: 'No matching distribution found for nope',
        }),
    })
    await expect(promise).rejects.toMatchObject({
      code: 'environment_failed',
      message: expect.stringMatching(/No matching distribution found for nope/),
    })
  })

  it('asks for the packages again when the runner has lost them', async () => {
    const settle = vi.fn(async (_w: string, row: any) => row)
    const { promise } = call({
      loadRuntime: async () =>
        runtimeRow({
          requirements: ['rdkit'],
          environmentId: 'pe-0123456789abcdef',
          environmentState: 'ready',
        }),
      settleEnvironment: settle,
      executePython: async () => {
        throw Object.assign(new Error('not installed on the runner yet'), {
          code: 'environment_not_ready',
        })
      },
    })
    await expect(promise).rejects.toMatchObject({
      code: 'environment_not_ready',
    })
    expect(settle).toHaveBeenCalledWith(
      'w',
      expect.objectContaining({
        environmentId: null,
        environmentState: 'none',
      }),
    )
  })

  it('passes the runner’s own words about time, data and hosts through', async () => {
    const { promise } = call({
      executePython: async () => {
        throw Object.assign(
          new Error(
            'Python execution timed out after 600 seconds. An administrator can allow this plugin more time in Settings → Plugins.',
          ),
          { code: 'transform_timed_out' },
        )
      },
    })
    await expect(promise).rejects.toMatchObject({
      message: expect.stringMatching(/allow this plugin more time/),
    })
  })
})
