import { describe, expect, it } from 'vitest'

import {
  validatePipelineConfig,
  validatePipelineRunRequest,
  validateConfirmAnswer,
  findPipelineConfirmStep,
  confirmNoAnswerOutcome,
  confirmExpiryHours,
} from './config'
import type { PipelineConfig, PipelineStepConfirm } from './config'

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
    config.transform.language = 'javascript' as never
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

describe('Python and workflow configuration', () => {
  const runtime = 'sheetbase/python@sha256:' + 'a'.repeat(64)
  it('accepts pinned Python, a following SQL step and webhook output', () => {
    const config = validConfig()
    config.transform = {
      language: 'python',
      statement:
        'def transform(inputs, parameters): return inputs["measurements"]',
    }
    config.pythonRuntime = runtime
    config.steps = [
      {
        name: 'scale',
        language: 'sql',
        statement: 'SELECT value FROM previous',
      },
    ]
    config.notifications = [
      { subscriptionId: '11111111-1111-4111-8111-111111111111' },
    ]
    expect(validatePipelineConfig(config)).toEqual([])
  })
  it('rejects Python without an immutable runtime pin', () => {
    const config = validConfig()
    config.transform.language = 'python'
    expect(
      validatePipelineConfig(config).some(
        (error) => error.field === 'pythonRuntime',
      ),
    ).toBe(true)
  })
  it('accepts actions without datasets or analysis', () => {
    const config = validConfig()
    config.inputs = []
    config.transform = { language: 'none', statement: '' }
    config.output = { mode: 'none', datasetLabel: '' }
    expect(validatePipelineConfig(config)).toEqual([])
  })
  it('rejects duplicate steps and the reserved previous input name', () => {
    const config = validConfig()
    config.inputs[0].name = 'previous'
    config.steps = [
      { name: 'a', language: 'sql', statement: 'SELECT 1' },
      { name: 'a', language: 'sql', statement: 'SELECT 2' },
    ]
    const errors = validatePipelineConfig(config)
    expect(errors.some((error) => error.field === 'inputs[0].name')).toBe(true)
    expect(errors.some((error) => error.code === 'duplicate_name')).toBe(true)
  })
})

describe('Confirm steps (PIPE-02)', () => {
  function confirmConfig(): PipelineConfig {
    const config = validConfig()
    config.steps = [
      {
        name: 'confirm_units',
        language: 'sql',
        statement: 'SELECT batch, count(*) FROM measurements GROUP BY batch',
        confirm: {
          fields: [
            { key: 'unit', label: 'Unit', type: 'text', required: true },
          ],
          askedUserIds: ['chemist-a'],
          skipSteps: ['set_units'],
          noAnswer: 'apply',
          expiresHours: 48,
        },
      },
      {
        name: 'set_units',
        language: 'sql',
        statement: 'SELECT batch FROM measurements',
      },
    ]
    return config
  }

  it('accepts a confirm step with a form, asked people and skip dependents', () => {
    expect(validatePipelineConfig(confirmConfig())).toEqual([])
  })

  it('rejects a confirm step without a form or asked people', () => {
    const config = confirmConfig()
    config.steps![0].confirm = { fields: [], askedUserIds: [] }
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.field === 'steps[0].confirm.fields')).toBe(true)
    expect(
      errors.some((e) => e.field === 'steps[0].confirm.askedUserIds'),
    ).toBe(true)
  })

  it('rejects an unknown no-answer outcome and an out-of-range expiry', () => {
    const config = confirmConfig()
    config.steps![0].confirm!.noAnswer = 'ignore' as never
    config.steps![0].confirm!.expiresHours = 0
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.field === 'steps[0].confirm.noAnswer')).toBe(
      true,
    )
    expect(
      errors.some((e) => e.field === 'steps[0].confirm.expiresHours'),
    ).toBe(true)
  })

  it('rejects skipSteps that do not name a declared step', () => {
    const config = confirmConfig()
    config.steps![0].confirm!.skipSteps = ['nope']
    const errors = validatePipelineConfig(config)
    expect(errors.some((e) => e.field === 'steps[0].confirm.skipSteps')).toBe(
      true,
    )
  })

  it('finds the confirm step and applies the DEC-08 defaults', () => {
    const config = confirmConfig()
    expect(findPipelineConfirmStep(config, 'set_units')).toBeNull()
    const step = findPipelineConfirmStep(config, 'confirm_units')
    expect(step?.name).toBe('confirm_units')
    const confirm = step!.confirm!
    expect(confirmNoAnswerOutcome(confirm)).toBe('apply')
    expect(confirmExpiryHours(confirm)).toBe(48)
    expect(
      confirmNoAnswerOutcome({ fields: confirm.fields, askedUserIds: ['a'] }),
    ).toBe('reask')
    expect(
      confirmExpiryHours({ fields: confirm.fields, askedUserIds: ['a'] }),
    ).toBe(24)
  })

  it('validates a recorded decision against the form', () => {
    const confirm: PipelineStepConfirm = {
      fields: [
        { key: 'unit', label: 'Unit', type: 'text', required: true },
        { key: 'note', label: 'Note', type: 'text' },
      ],
      askedUserIds: ['chemist-a'],
    }
    expect(validateConfirmAnswer(confirm, { decision: 'stop' })).toBeNull()
    expect(validateConfirmAnswer(confirm, { decision: 'skip' })).toBeNull()
    expect(
      validateConfirmAnswer(confirm, {
        decision: 'confirm',
        values: { unit: 'g/L' },
      }),
    ).toBeNull()
    expect(
      validateConfirmAnswer(confirm, { decision: 'confirm', values: {} }),
    ).toContain('missing required field')
    expect(
      validateConfirmAnswer(confirm, {
        decision: 'confirm',
        values: { unit: 5 },
      }),
    ).toContain('does not match')
    expect(validateConfirmAnswer(confirm, { decision: 'maybe' })).toContain(
      'decision',
    )
    expect(validateConfirmAnswer(confirm, null)).toContain('object')
  })
})
