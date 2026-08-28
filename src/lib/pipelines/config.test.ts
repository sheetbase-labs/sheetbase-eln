import { describe, expect, it } from 'vitest'

import { validatePipelineConfig, validatePipelineRunRequest } from './config'
import type { PipelineConfig } from './config'

function validConfig(): PipelineConfig {
  return {
    configVersion: 1,
    description: 'normalize measurements',
    parameters: [
      { name: 'factor', type: 'decimal', required: true },
      { name: 'note', type: 'text', required: false, default: 'x' },
    ],
    inputs: [{ name: 'measurements', required: true }],
    transform: {
      language: 'sql',
      statement: 'SELECT value * {{factor}} AS scaled FROM measurements',
    },
    output: {
      mode: 'create',
      schemaVersionId: '11111111-1111-4111-8111-111111111111',
      datasetName: 'Scaled measurements',
      datasetLabel: 'pipeline output',
      fieldMapping: null,
    },
  }
}

describe('validatePipelineConfig', () => {
  it('accepts a well-formed v1 configuration', () => {
    expect(validatePipelineConfig(validConfig())).toEqual([])
  })

  it('rejects a non-object configuration', () => {
    const errors = validatePipelineConfig(null)
    expect(errors.some((e) => e.code === 'invalid_shape')).toBe(true)
  })

  it('rejects an unsupported configVersion', () => {
    const errors = validatePipelineConfig({
      ...validConfig(),
      configVersion: 2,
    })
    expect(errors.some((e) => e.code === 'unsupported_config_version')).toBe(
      true,
    )
  })

  it('rejects duplicate parameter names', () => {
    const config = validConfig()
    config.parameters.push({ name: 'factor', type: 'text', required: false })
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.code === 'duplicate_name')).toBe(true)
  })

  it('rejects a required parameter with a default', () => {
    const config = validConfig()
    config.parameters[0] = {
      name: 'factor',
      type: 'decimal',
      required: true,
      default: 2,
    }
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.code === 'invalid_value')).toBe(true)
  })

  it('rejects a default that does not match its type', () => {
    const config = validConfig()
    config.parameters[1] = {
      name: 'note',
      type: 'text',
      required: false,
      default: 42,
    }
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.code === 'invalid_value')).toBe(true)
  })

  it('rejects an unsupported transform language', () => {
    const config = validConfig()
    config.transform.language = 'python' as never
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.code === 'unsupported_language')).toBe(true)
  })

  it('rejects an empty statement', () => {
    const config = validConfig()
    config.transform.statement = '   '
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.field === 'transform.statement')).toBe(true)
  })

  it('rejects create output without a schema version or dataset name', () => {
    const config = validConfig()
    config.output.schemaVersionId = ''
    config.output.datasetName = ''
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.field === 'output.schemaVersionId')).toBe(true)
    expect(errors.some((e) => e.field === 'output.datasetName')).toBe(true)
  })

  it('rejects append output without a dataset id', () => {
    const config = validConfig()
    config.output.mode = 'append'
    config.output.datasetId = ''
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.field === 'output.datasetId')).toBe(true)
  })

  it('rejects an invalid input identifier', () => {
    const config = validConfig()
    config.inputs = [{ name: 'Bad Name!', required: true }]
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.code === 'invalid_value')).toBe(true)
  })
})

describe('validatePipelineRunRequest', () => {
  const config = validConfig()

  it('accepts a fully-supplied request', () => {
    expect(
      validatePipelineRunRequest(
        config,
        { factor: 2.5, note: 'hello' },
        { measurements: '22222222-2222-4222-8222-222222222222' },
      ),
    ).toEqual([])
  })

  it('rejects an unknown parameter', () => {
    const errors = validatePipelineRunRequest(
      config,
      { factor: 1, bogus: 'x' },
      { measurements: '22222222-2222-4222-8222-222222222222' },
    )
    expect(errors.some((e) => e.message.includes('unknown parameter'))).toBe(
      true,
    )
  })

  it('rejects a missing required parameter', () => {
    const errors = validatePipelineRunRequest(
      config,
      {},
      { measurements: '22222222-2222-4222-8222-222222222222' },
    )
    expect(
      errors.some((e) => e.message.includes('missing required parameter')),
    ).toBe(true)
  })

  it('rejects a type mismatch', () => {
    const errors = validatePipelineRunRequest(
      config,
      { factor: 'not-a-number' },
      { measurements: '22222222-2222-4222-8222-222222222222' },
    )
    expect(errors.some((e) => e.message.includes('does not match'))).toBe(true)
  })

  it('rejects a missing input', () => {
    const errors = validatePipelineRunRequest(config, { factor: 1 }, {})
    expect(errors.some((e) => e.message.includes('missing input'))).toBe(true)
  })

  it('rejects an unknown input', () => {
    const errors = validatePipelineRunRequest(
      config,
      { factor: 1 },
      {
        measurements: '22222222-2222-4222-8222-222222222222',
        bogus: '22222222-2222-4222-8222-222222222222',
      },
    )
    expect(errors.some((e) => e.message.includes('unknown input'))).toBe(true)
  })
})
