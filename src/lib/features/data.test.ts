import { describe, expect, it } from 'vitest'

import { featureKeysOf, modelsWithFeature, registrySetupOf } from './data'

describe('registrySetupOf', () => {
  it('reads what a registry keeps', () => {
    expect(
      registrySetupOf({
        keyFields: ['name', 'species'],
        sequenceField: 'sequence',
        structureField: '',
        lotKind: null,
      }),
    ).toEqual({
      keyFields: ['name', 'species'],
      sequenceField: 'sequence',
      structureField: null,
      lotKind: null,
    })
  })

  it('falls back to nothing chosen', () => {
    expect(registrySetupOf(undefined)).toEqual({
      keyFields: [],
      sequenceField: null,
      structureField: null,
      lotKind: null,
    })
    expect(registrySetupOf({ keyFields: 'name' }).keyFields).toEqual([])
  })
})

describe('reading features', () => {
  it('lists the models that have a feature', () => {
    const rows = [
      { model_key: 'a', capability: 'registry', settings: {} },
      { model_key: 'b', capability: 'incident_log', settings: {} },
      { model_key: 'c', capability: 'registry', settings: {} },
    ]
    expect(modelsWithFeature(rows, 'registry')).toEqual(['a', 'c'])
  })

  it('reads the features a model came back with', () => {
    expect(
      [
        ...featureKeysOf({
          model_capabilities: [
            { capability: 'registry', settings: {} },
            { capability: 'retention', settings: {} },
          ],
        }),
      ].sort(),
    ).toEqual(['registry', 'retention'])
    expect(featureKeysOf(null).size).toBe(0)
  })
})
