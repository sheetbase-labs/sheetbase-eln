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

  it('defaults malformed fields independently without dropping valid settings', () => {
    expect(
      pickupFormValues({
        pickup: {
          projectId: 'project-1',
          schemaVersionId: 42,
          datasetId: null,
          datasetNamePattern: '',
          autoDetect: 'true',
          instrumentId: 'instrument-2',
        },
      }),
    ).toEqual({
      projectId: 'project-1',
      schemaVersionId: '',
      datasetId: '',
      datasetNamePattern: DEFAULT_DATASET_NAME_PATTERN,
      autoDetect: false,
      instrumentId: 'instrument-2',
    })

    for (const pickup of [null, 42, 'pickup', []]) {
      expect(pickupFormValues({ pickup })).toEqual(pickupFormValues({}))
    }
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

    if (!result.ok) throw new Error('Valid pickup settings were rejected')

    expect(pickupFormValues(result.config)).toMatchObject({
      projectId: 'p',
      instrumentId: 'i',
      autoDetect: true,
    })
  })
})
