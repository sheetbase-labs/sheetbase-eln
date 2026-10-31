import { describe, expect, it } from 'vitest'

import {
  modelFieldId,
  modelSearchFields,
  parseModelFieldId,
} from './search-model-fields'
import type { ModelFieldWire } from './search-model-fields'

const field = (over: Partial<ModelFieldWire>): ModelFieldWire => ({
  id: 'd1',
  kind: 'sample',
  field_name: 'concentration',
  label: 'Concentration',
  logical_type: 'decimal',
  ...over,
})

describe('model fields in the search builder', () => {
  it('names the model and unit, and types the value', () => {
    const [only] = modelSearchFields(
      [field({ quantity: { storageUnit: 'mg/mL' } })],
      [],
      [],
    )
    expect(only).toMatchObject({
      id: 'model:sample:concentration',
      label: 'Sample · Concentration (mg/mL)',
      dataType: 'number',
    })
  })

  it('files a subtype field under the model at the top of its chain', () => {
    const fields = modelSearchFields(
      [
        field({
          id: 'd2',
          kind: 'cell_culture',
          field_name: 'passage',
          label: 'Passage',
          logical_type: 'integer',
        }),
      ],
      [],
      [
        { key: 'cell_culture', name: 'Cell culture', parent_key: 'mammalian' },
        { key: 'mammalian', name: 'Mammalian', parent_key: 'experiment' },
      ],
    )
    expect(fields.map((f) => [f.id, f.label])).toEqual([
      ['model:experiment:passage', 'Cell culture · Passage'],
    ])
  })

  it('offers a category field’s choices', async () => {
    const [only] = modelSearchFields(
      [
        field({
          field_name: 'grade',
          label: 'Grade',
          logical_type: 'category',
        }),
      ],
      [
        { definition_id: 'd1', key: 'gmp', label: 'GMP' },
        { definition_id: 'd1', key: 'research', label: 'Research' },
      ],
      [],
    )
    expect(await only.loadOptions?.('gm')).toEqual([
      { value: 'gmp', label: 'GMP' },
    ])
  })

  it('leaves out fields the index cannot match', () => {
    expect(
      modelSearchFields(
        [
          field({ id: 'a', cardinality: 'many' }),
          field({ id: 'b', logical_type: 'reference' }),
          field({ id: 'c', kind: 'dataset_schema' }),
        ],
        [],
        [],
      ),
    ).toEqual([])
  })

  it('round-trips the field id', () => {
    expect(parseModelFieldId(modelFieldId('project', 'budget_code'))).toEqual({
      kind: 'project',
      key: 'budget_code',
    })
    expect(parseModelFieldId('fields.x')).toBeUndefined()
  })
})
