import { describe, expect, it } from 'vitest'

import { parseNotebookTemplateConfiguration } from './notebook-template'

const parameterId = '11000000-0000-4000-8000-000000000001'
const placementId = '12000000-0000-4000-8000-000000000001'
const definitionParameterId = '10000000-0000-4000-8000-000000000001'
const definitionVersionId = '13000000-0000-4000-8000-000000000001'

describe('Notebook Template configuration', () => {
  it('accepts CORE-03 parameters mapped by stable IDs', () => {
    const parsed = parseNotebookTemplateConfiguration({
      formatVersion: 1,
      parameters: [
        {
          id: parameterId,
          key: 'results',
          label: 'Results',
          required: true,
          type: {
            kind: 'dataset',
            contract: {
              mode: 'exact',
              schemaVersionId: '90000000-0000-4000-8000-000000000001',
            },
          },
          constraints: {},
        },
      ],
      placements: [
        {
          id: placementId,
          kind: 'sheet',
          order: 1,
          definitionVersionId,
          parameterMappings: [
            {
              templateParameterId: parameterId,
              definitionParameterId,
            },
          ],
        },
      ],
    })
    expect(parsed.placements[0]).toMatchObject({ kind: 'sheet' })
  })

  it('rejects mappings that do not use a declared Template parameter id', () => {
    expect(() =>
      parseNotebookTemplateConfiguration({
        formatVersion: 1,
        parameters: [],
        placements: [
          {
            id: placementId,
            kind: 'sheet',
            order: 1,
            definitionVersionId,
            parameterMappings: [
              {
                templateParameterId: parameterId,
                definitionParameterId,
              },
            ],
          },
        ],
      }),
    ).toThrow(/unknown Template parameter/)
  })
})
