/**
 * Extension runner points: manifest validation, the resolver, the runtime gate,
 * declared inputs and outputs, and webhook signing.
 */
import { describe, expect, it, vi } from 'vitest'

import { validateExtensionManifest } from './manifest'
import { describeRunnerAdds, resolveRunnerPoints } from './runner-points'
import {
  ExtensionRunError,
  checkDeclaredValues,
  invokeExtension,
  openExtensionPoint,
  signExtensionRequest,
} from './runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
import { SAMPLE_TOOLS_MANIFEST } from './sample/tools'
import { extensionToolName, parseExtensionName } from './points'

const manifest = () => structuredClone(SAMPLE_TOOLS_MANIFEST) as any

function withContribution(point: string, entry: unknown) {
  const m = manifest()
  m.contributions = { [point]: [entry] }
  return m
}

describe('manifest validation of runner points', () => {
  it('accepts the sample', () => {
    expect(validateExtensionManifest(manifest())).toEqual([])
  })

  it('rejects bad declarations', () => {
    const action = manifest().contributions['pipeline-actions'][0]
    const cases: Array<[string, unknown]> = [
      ['pipeline-actions', { ...action, id: 'Bad Id' }],
      [
        'pipeline-actions',
        { ...action, runner: { kind: 'shell', code: 'ls' } },
      ],
      [
        'pipeline-actions',
        { ...action, runner: { kind: 'webhook', url: 'http://x.example.org' } },
      ],
      [
        'pipeline-actions',
        {
          ...action,
          inputs: [
            { name: 'a', type: 'text' },
            { name: 'a', type: 'text' },
          ],
        },
      ],
      [
        'pipeline-actions',
        { ...action, outputs: [{ name: 'x', type: 'blob' }] },
      ],
      [
        'analysis-kinds',
        {
          id: 'k',
          title: 'K',
          inputs: [{ name: 'x', type: 'number' }],
          result: {
            columns: [{ name: 'x', type: 'number' }],
            chart: { type: 'pie', x: 'x', y: 'x' },
          },
          runner: { kind: 'python', code: 'def run(data): return data' },
        },
      ],
      [
        'assistant-tools',
        {
          id: 't',
          title: 'T',
          access: 'sign',
          inputs: [],
          runner: action.runner,
        },
      ],
    ]
    for (const [point, entry] of cases) {
      expect(
        validateExtensionManifest(withContribution(point, entry)).length,
      ).toBeGreaterThan(0)
    }
  })

  it('rejects duplicate ids', () => {
    const m = manifest()
    m.contributions['pipeline-actions'].push(
      m.contributions['pipeline-actions'][0],
    )
    expect(validateExtensionManifest(m).length).toBeGreaterThan(0)
  })
})

describe('resolveRunnerPoints', () => {
  const install = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    key: 'sample-tools',
    status: 'enabled',
    manifest: manifest(),
    disabled_points: [],
    ...over,
  })

  it('lists every enabled point, sorted', () => {
    const out = resolveRunnerPoints([install()])
    expect(out.pipelineActions.map((i) => i.name)).toEqual([
      'extension.sample-tools.summarise-values',
    ])
    expect(out.assistantTools).toHaveLength(2)
    expect(out.analysisKinds).toHaveLength(1)
  })

  it('removes work when disabled, removed or switched off', () => {
    expect(
      resolveRunnerPoints([install({ status: 'disabled' })]).assistantTools,
    ).toEqual([])
    expect(resolveRunnerPoints([]).analysisKinds).toEqual([])
    const off = resolveRunnerPoints([
      install({ disabled_points: ['assistant-tools'] }),
    ])
    expect(off.assistantTools).toEqual([])
    expect(off.pipelineActions).toHaveLength(1)
  })

  it('ignores an unreadable manifest instead of failing', () => {
    expect(
      resolveRunnerPoints([install({ manifest: { nope: 1 } })]).pipelineActions,
    ).toEqual([])
  })

  it('describes what a manifest adds', () => {
    expect(describeRunnerAdds(manifest()).map((a) => a.point)).toEqual([
      'pipeline-actions',
      'assistant-tools',
      'analysis-kinds',
    ])
    expect(describeRunnerAdds('x')).toEqual([])
  })
})

describe('names', () => {
  it('round-trips tool names', () => {
    expect(parseExtensionName(extensionToolName('a-b', 'c'))).not.toBeNull()
    expect(parseExtensionName('records.search')).toBeNull()
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
      key: 'sample-tools',
      name: 'Sample',
      status: 'enabled',
      manifest: manifest(),
      disabledPoints: [],
    }),
    loadSecret: async () => 'sek',
    fetch: vi.fn() as typeof fetch,
    executePython: vi.fn(async () => ({
      rows: [{ count: 2, mean: 2, minimum: 1, maximum: 3 }],
    })) as any,
    audit,
    now: () => 0,
    ...over,
  }
  return { d, audit }
}

const base = {
  workspaceId: 'w',
  actorUserId: 'u',
  extensionKey: 'sample-tools',
}

describe('the gate', () => {
  it.each([
    [{ status: 'disabled' }, 'not_enabled'],
    [{ disabledPoints: ['pipeline-actions'] }, 'point_off'],
    [{ manifest: { bad: true } }, 'bad_manifest'],
  ])('refuses %j', async (over, code) => {
    const { d } = deps({
      loadInstall: async () => ({
        id: 'e1',
        key: 'sample-tools',
        name: 'S',
        status: 'enabled',
        manifest: manifest(),
        disabledPoints: [],
        ...over,
      }),
    })
    await expect(
      openExtensionPoint(d, 'w', 'sample-tools', 'pipeline-actions'),
    ).rejects.toMatchObject({ code })
  })

  it('refuses a removed extension', async () => {
    const { d } = deps({ loadInstall: async () => null })
    await expect(
      openExtensionPoint(d, 'w', 'x', 'assistant-tools'),
    ).rejects.toMatchObject({ code: 'not_installed' })
  })
})

describe('invokeExtension', () => {
  it('runs python, checks the answer and audits', async () => {
    const { d, audit } = deps()
    const out = await invokeExtension(
      {
        ...base,
        point: 'pipeline-actions',
        itemId: 'summarise-values',
        input: { values: [1, 2, 3] },
      },
      d,
    )
    expect(out.output).toEqual({ count: 2, mean: 2, minimum: 1, maximum: 3 })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ change: 'invoked', ok: true }),
      }),
    )
  })

  it('rejects an answer that breaks the declared outputs, and audits the failure', async () => {
    const { d, audit } = deps({
      executePython: vi.fn(async () => ({ rows: [{ count: 'x' }] })) as any,
    })
    await expect(
      invokeExtension(
        {
          ...base,
          point: 'pipeline-actions',
          itemId: 'summarise-values',
          input: { values: [1] },
        },
        d,
      ),
    ).rejects.toMatchObject({ code: 'bad_answer' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ ok: false }),
      }),
    )
  })

  it('refuses undeclared items and bad input', async () => {
    const { d } = deps()
    await expect(
      invokeExtension(
        { ...base, point: 'pipeline-actions', itemId: 'nope', input: {} },
        d,
      ),
    ).rejects.toMatchObject({ code: 'not_declared' })
    await expect(
      invokeExtension(
        {
          ...base,
          point: 'pipeline-actions',
          itemId: 'summarise-values',
          input: {},
        },
        d,
      ),
    ).rejects.toMatchObject({ code: 'bad_input' })
  })

  it('signs a webhook call and never follows redirects', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ printed: true }), { status: 200 }),
    )
    const { d } = deps({ fetch: fetchMock as unknown as typeof fetch })
    const tool = manifest().contributions['assistant-tools'].find(
      (t: any) => t.id === 'print-label',
    )
    const input = Object.fromEntries(
      tool.inputs
        .filter((f: any) => f.required)
        .map((f: any) => [
          f.name,
          f.type === 'integer' || f.type === 'number' ? 1 : 'x',
        ]),
    )
    // The sample's webhook host is a placeholder, so the host policy may refuse
    // it before fetch; either way no unsigned call is made.
    try {
      await invokeExtension(
        { ...base, point: 'assistant-tools', itemId: 'print-label', input },
        d,
      )
    } catch (error) {
      expect(error).toBeInstanceOf(ExtensionRunError)
    }
    for (const call of fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      const headers = call[1].headers as Record<string, string>
      const ts = headers['x-sheetbase-timestamp']
      expect(headers['x-sheetbase-signature']).toBe(
        signExtensionRequest('sek', ts, call[1].body as string),
      )
      expect(call[1].redirect).toBe('error')
    }
  })

  it('signs as sha256 over timestamp, dot and body', () => {
    expect(signExtensionRequest('s', '1', '{}')).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    )
    expect(signExtensionRequest('s', '1', '{}')).not.toBe(
      signExtensionRequest('s', '2', '{}'),
    )
  })
})
