import { describe, expect, it } from 'vitest'

import { configurationForWire, editorConfiguration } from './-configuration'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'

describe('persisted pipeline editor configuration', () => {
  it('keeps declarations with omitted or null required flags and descriptions', () => {
    const decoded = editorConfiguration.parse({
      inputs: [
        { name: 'raw' },
        { name: 'calibration', required: null, description: null },
      ],
      parameters: [
        { name: 'dose', type: 'decimal' },
        { name: 'label', type: 'text', required: null, description: null },
      ],
    })

    expect(decoded.inputs).toEqual([
      { name: 'raw', required: false },
      { name: 'calibration', required: false },
    ])
    expect(decoded.parameters).toEqual([
      { name: 'dose', type: 'decimal', required: false },
      { name: 'label', type: 'text', required: false },
    ])
    expect(pipelineJsonObjectSchema.parse(decoded)).toEqual(decoded)
    expect(Object.hasOwn(decoded.inputs?.[0] ?? {}, 'description')).toBe(false)
    expect(Object.hasOwn(decoded.inputs?.[1] ?? {}, 'description')).toBe(false)
    expect(Object.hasOwn(decoded.parameters?.[0] ?? {}, 'description')).toBe(
      false,
    )
    expect(Object.hasOwn(decoded.parameters?.[1] ?? {}, 'description')).toBe(
      false,
    )
  })

  it('preserves scientific and extension own __proto__ keys at every decoded level', () => {
    const decoded = editorConfiguration.parse(
      JSON.parse(`{
      "__proto__": {"extension": true},
      "inputs": [{"name": "raw", "__proto__": {"declaration": true}}],
      "parameters": [{"name": "settings", "type": "text", "default": {"__proto__": [1]}}],
      "transform": {"language": "python", "contract": {"inputs": {"__proto__": [{"name": "n", "type": "decimal"}]}}},
      "actions": [{"name": "post", "operation": "plugin.test.post", "arguments": {"__proto__": {"value": 2}}}],
      "output": {"mode": "none", "__proto__": {"output": true}, "fieldMapping": {"__proto__": "scientific_field"}}
    }`),
    )

    expect(
      Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value,
    ).toEqual({ extension: true })
    expect(
      Object.getOwnPropertyDescriptor(decoded.inputs?.[0] ?? {}, '__proto__')
        ?.value,
    ).toEqual({ declaration: true })
    expect(decoded.parameters?.[0].default).toEqual(
      JSON.parse('{"__proto__":[1]}'),
    )
    expect(
      Object.getOwnPropertyDescriptor(
        decoded.transform?.contract?.inputs ?? {},
        '__proto__',
      )?.value,
    ).toEqual([{ name: 'n', type: 'decimal' }])
    expect(decoded.actions?.[0].arguments).toEqual(
      JSON.parse('{"__proto__":{"value":2}}'),
    )
    expect(
      Object.getOwnPropertyDescriptor(decoded.output ?? {}, '__proto__')?.value,
    ).toEqual({ output: true })
    expect(
      Object.getOwnPropertyDescriptor(
        decoded.output?.fieldMapping ?? {},
        '__proto__',
      )?.value,
    ).toBe('scientific_field')
  })

  it('rejects non-JSON values even under an own __proto__ key', () => {
    const configuration = Object.fromEntries([['__proto__', () => 1]])

    expect(editorConfiguration.safeParse(configuration).success).toBe(false)
  })

  it('omits editor-only undefined properties without dropping own scientific keys', () => {
    const configuration = editorConfiguration.parse(
      JSON.parse(`{
      "__proto__": {"extension": true},
      "parameters": [{"name":"settings","type":"text","default":{"__proto__": [1]}}]
    }`),
    )

    const wire = configurationForWire({
      ...configuration,
      output: { mode: 'none', datasetName: undefined },
    })

    expect(wire).toEqual({
      ...configuration,
      configVersion: 2,
      mode: 'standard',
      inputs: [],
      steps: [],
      output: { mode: 'none' },
    })
    expect(pipelineJsonObjectSchema.parse(wire)).toEqual(wire)
    expect(Object.getOwnPropertyDescriptor(wire, '__proto__')?.value).toEqual({
      extension: true,
    })
  })

  it('reads a stored step list in the editor shape and writes it back', () => {
    const stored = {
      configVersion: 2,
      mode: 'standard',
      extension: { kept: true },
      parameters: [],
      inputs: [],
      steps: [
        { name: 'analysis', kind: 'sql', statement: 'select 1' },
        {
          name: 'flag',
          kind: 'sql',
          statement: 'select * from previous',
          onlyIfRows: true,
        },
        {
          name: 'tell',
          kind: 'notify',
          notify: { subscriptionId: '11111111-1111-4111-8111-111111111111' },
        },
      ],
      output: { mode: 'none' },
    }

    const decoded = editorConfiguration.parse(stored)

    expect(decoded.transform).toMatchObject({ statement: 'select 1' })
    expect(decoded.steps).toMatchObject([{ name: 'flag', onlyIfRows: true }])
    expect(decoded.notifications).toMatchObject([{ name: 'tell' }])
    expect(configurationForWire(decoded)).toEqual(stored)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses a nonfinite editor default %s instead of converting it to null',
    (value) => {
      expect(() =>
        configurationForWire({
          parameters: [
            { name: 'dose', type: 'decimal', required: false, default: value },
          ],
        }),
      ).toThrow()
    },
  )
})
