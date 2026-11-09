import { describe, expect, it } from 'vitest'

import {
  buildMappingInstruction,
  changesFromSuggestions,
  extractJsonObject,
  parseMappingAnswer,
} from './ai-import-mapping'
import type { ImportTargetField } from './import-mapping'

const fields: ImportTargetField[] = [
  {
    id: 'f-titre',
    label: 'Titre',
    logicalType: 'decimal',
    nullable: false,
    unit: 'mg/mL',
    kind: 'dataset-field',
  },
  {
    id: 'f-batch',
    label: 'Batch',
    logicalType: 'text',
    nullable: true,
    kind: 'dataset-field',
  },
]

describe('parseMappingAnswer', () => {
  const headers = ['Conc (mg/mL)', 'Lot', 'Notes']

  it('keeps suggestions that name real columns and fields', () => {
    const answer = JSON.stringify({
      columns: [
        {
          header: 'Conc (mg/mL)',
          field_id: 'f-titre',
          unit: 'mg/mL',
          kind: 'number',
          reason: 'Header names a concentration.',
        },
        {
          header: 'Lot',
          field_id: 'f-batch',
          unit: 'g',
          kind: 'text',
          reason: 'Lot is a batch.',
        },
      ],
    })

    const out = parseMappingAnswer(
      `Here you go:\n\`\`\`json\n${answer}\n\`\`\``,
      headers,
      fields,
    )

    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      header: 'Conc (mg/mL)',
      fieldId: 'f-titre',
      sourceUnit: 'mg/mL',
      kind: 'number',
    })
    // A unit on a text field is meaningless, so it is dropped.
    expect(out[1]?.sourceUnit).toBeNull()
  })

  it('drops invented headers, unknown fields and repeated fields', () => {
    const answer = JSON.stringify({
      columns: [
        { header: 'Made up', field_id: 'f-titre' },
        { header: 'Lot', field_id: 'f-nope' },
        { header: 'Conc (mg/mL)', field_id: 'f-titre' },
        { header: 'Notes', field_id: 'f-titre' },
      ],
    })

    const out = parseMappingAnswer(answer, headers, fields)
    expect(out.map((s) => s.header)).toEqual(['Conc (mg/mL)'])
  })

  it('returns nothing for text that is not the expected JSON', () => {
    expect(parseMappingAnswer('no idea', headers, fields)).toEqual([])
    expect(parseMappingAnswer('{"columns": 3}', headers, fields)).toEqual([])
    expect(extractJsonObject('{broken')).toBeNull()
  })
})

describe('changesFromSuggestions', () => {
  it('leaves out what is already mapped', () => {
    const suggestions = [
      { header: 'A', fieldId: 'f1', sourceUnit: null, kind: null, reason: '' },
      { header: 'B', fieldId: 'f2', sourceUnit: 'mg', kind: null, reason: '' },
    ]

    expect(
      changesFromSuggestions(suggestions, { A: 'f1', B: 'f2' }, { B: 'mg' }),
    ).toEqual([])
    expect(
      changesFromSuggestions(suggestions, { A: 'f1', B: 'f2' }, {}).map(
        (s) => s.header,
      ),
    ).toEqual(['B'])
  })
})

describe('buildMappingInstruction', () => {
  it('lists the fields and columns with example values', () => {
    const text = buildMappingInstruction(
      [{ header: 'Lot', examples: ['A1', 'A2'] }],
      fields,
    )

    expect(text).toContain(
      'f-titre | Titre | decimal | stored in mg/mL | required',
    )
    expect(text).toContain('"Lot": "A1", "A2"')
  })
})
