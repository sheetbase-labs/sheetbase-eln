import { describe, expect, it } from 'vitest'

import {
  buildPickupConfig,
  DEFAULT_DATASET_NAME_PATTERN,
  pickupFormValues,
} from './pickup-config'

describe('pickup config form', () => {
  it('reads defaults from an unconfigured connector', () => {
    expect(pickupFormValues({})).toEqual({
      projectId: '',
      schemaVersionId: '',
      datasetId: '',
      datasetNamePattern: DEFAULT_DATASET_NAME_PATTERN,
      autoDetect: false,
      instrumentId: '',
    })
  })

  it('requires a project and a schema', () => {
    const result = buildPickupConfig({}, pickupFormValues({}))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'projectId',
        'schemaVersionId',
      ])
    }
  })

  it('writes a pickup block and keeps unrelated config keys', () => {
    const values = {
      ...pickupFormValues({}),
      projectId: 'p',
      schemaVersionId: 's',
      instrumentId: 'i',
      autoDetect: true,
    }
    const result = buildPickupConfig({ bucket: 'b' }, values)
    expect(result).toEqual({
      ok: true,
      config: {
        bucket: 'b',
        pickup: {
          projectId: 'p',
          schemaVersionId: 's',
          autoDetect: true,
          datasetNamePattern: DEFAULT_DATASET_NAME_PATTERN,
          instrumentId: 'i',
        },
      },
    })
    expect(
      pickupFormValues((result as { config: Record<string, unknown> }).config),
    ).toMatchObject({
      projectId: 'p',
      instrumentId: 'i',
      autoDetect: true,
    })
  })
})
