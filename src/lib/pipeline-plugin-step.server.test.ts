import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PluginStepError, runPluginStep } from './pipeline-plugin-step.server'
import type { PluginStepScope } from './pipeline-plugin-step.server'
import type { PipelineStep } from './pipelines/config'

const invoke = vi.fn()
const open = vi.fn()

vi.mock('./extensions/runtime.server', () => ({
  ExtensionRunError: class ExtensionRunError extends Error {},
  defaultDeps: () => ({}),
  invokeExtension: (...args: unknown[]) => invoke(...args),
  openCallable: (...args: unknown[]) => open(...args),
}))

const step = (args: Record<string, unknown>): PipelineStep => ({
  name: 'join',
  language: 'plugin',
  statement: '',
  plugin: { operation: 'plugin.plate-tools.join', arguments: args },
})

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

const scope = (over: Partial<PluginStepScope> = {}): PluginStepScope => ({
  parameters: { key: 'well' },
  previous: rows(2),
  inputRows: async (name) => (name === 'plates' ? rows(3) : undefined),
  steps: { first: rows(4) },
  ...over,
})

const run = (s: PipelineStep, sc: PluginStepScope) =>
  runPluginStep({ workspaceId: 'w', actorUserId: 'u', step: s }, sc)

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ output: { rows: [{ ok: 1 }] } })
  open.mockReset().mockResolvedValue({
    callable: { point: 'pipeline-steps', tableNames: ['left', 'right'] },
  })
})

describe('runPluginStep', () => {
  it('gives the plugin the tables and settings the step names', async () => {
    const result = await run(
      step({
        left: { $ref: 'steps.first' },
        right: { $ref: 'inputs.plates' },
        key: { $ref: 'parameters.key' },
        suffix: '_b',
      }),
      scope(),
    )

    expect(result.rows).toEqual([{ ok: 1 }])
    const call = invoke.mock.calls[0][0]
    expect(call).toMatchObject({
      workspaceId: 'w',
      actorUserId: 'u',
      extensionKey: 'plate-tools',
      itemId: 'join',
    })
    expect(call.input.left).toHaveLength(4)
    expect(call.input.right).toHaveLength(3)
    expect(call.input.key).toBe('well')
    expect(call.input.suffix).toBe('_b')
  })

  it('fills a table the step does not name with the result so far', async () => {
    await run(step({ right: { $ref: 'inputs.plates' } }), scope())
    expect(invoke.mock.calls[0][0].input.left).toHaveLength(2)
  })

  it('says so when a table has nowhere to come from', async () => {
    await expect(
      run(step({ left: { $ref: 'previous' } }), scope({ previous: undefined })),
    ).rejects.toThrow('no result before this step')
    await expect(
      run(step({ left: { $ref: 'steps.later' } }), scope()),
    ).rejects.toThrow('has not run before this step')
    await expect(
      run(step({ left: { $ref: 'inputs.nope' } }), scope()),
    ).rejects.toThrow('no input called')
    await expect(
      run(step({ key: { $ref: 'parameters.nope' } }), scope()),
    ).rejects.toThrow('has no value')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('refuses anything but a plugin step that gives back a table', async () => {
    open.mockResolvedValue({
      callable: { point: 'publishers', tableNames: [] },
    })
    await expect(run(step({}), scope())).rejects.toThrow('gives back a table')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports the plugin’s own failure in its words', async () => {
    invoke.mockRejectedValue(new Error('Column “well” is missing.'))
    await expect(run(step({}), scope())).rejects.toThrow(PluginStepError)
    await expect(run(step({}), scope())).rejects.toThrow('“well” is missing')
  })

  it('needs a plugin to run', async () => {
    await expect(
      run({ name: 'x', language: 'plugin', statement: '' }, scope()),
    ).rejects.toThrow('does not name a plugin step')
  })
})
