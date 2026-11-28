import { describe, expect, it } from 'vitest'

import { notebookTemplateConfigurationSchema } from './notebook-template'
import {
  buildTemplateConfiguration,
  describeTemplateDraft,
  templateDraftBlockSchema,
} from './assistant-template-draft'

let counter = 0

const newId = () => {
  counter += 1

  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

describe('buildTemplateConfiguration', () => {
  it('turns plain blocks into a configuration the template schema accepts', () => {
    counter = 0

    const config = buildTemplateConfiguration(
      {
        parts: [{ title: 'Coat plate' }, { title: 'Assay', dayOffset: 1 }],
        blocks: [
          { type: 'callout', text: 'Wear gloves.', variant: 'warning' },
          { type: 'step', text: 'Coat the plate.', part: 'Coat plate' },
          { type: 'step', text: 'Block.', minutes: 60, part: 'Coat plate' },
          { type: 'plate_map', part: 'Assay' },
          {
            type: 'checklist',
            items: ['Standards', 'Controls'],
            part: 'Assay',
          },
          { type: 'note', text: 'Read at 450 nm.\n\nFit a 4PL curve.' },
        ],
      },
      newId,
    )

    expect(notebookTemplateConfigurationSchema.safeParse(config).success).toBe(
      true,
    )
    expect(config.parts?.map((part) => part.title)).toEqual([
      'Coat plate',
      'Assay',
    ])
    expect(config.placements.map((placement) => placement.order)).toEqual([
      1, 2, 3, 4, 5,
    ])

    // Steps are checklist items (a template cannot carry procedure steps),
    // timed when they have a length, grouped while they follow each other.
    const lists = config.placements.flatMap((placement) =>
      placement.kind === 'narrative' && placement.blockType === 'checklist'
        ? [placement.payload]
        : [],
    )

    expect(
      config.placements.some(
        (placement) =>
          placement.kind === 'narrative' &&
          placement.blockType === 'procedure_step',
      ),
    ).toBe(false)

    expect(lists[0]).toMatchObject({
      items: [
        { text: 'Coat the plate.', checked: false },
        { text: 'Block.', checked: false, durationSeconds: 3600 },
      ],
    })
  })

  it('makes a part for a block that names one the draft did not list', () => {
    counter = 0

    const config = buildTemplateConfiguration(
      { blocks: [{ type: 'step', text: 'Read.', part: 'Readout' }] },
      newId,
    )

    expect(config.parts?.map((part) => part.title)).toEqual(['Readout'])
    expect(notebookTemplateConfigurationSchema.safeParse(config).success).toBe(
      true,
    )
  })

  it('counts the blocks for the card', () => {
    expect(
      describeTemplateDraft({
        parts: [{ title: 'A' }],
        blocks: [
          { type: 'step', text: 'x' },
          { type: 'step', text: 'y' },
          { type: 'plate_map' },
        ],
      }),
    ).toEqual(['1 part', '2 steps', '1 plate map'])
  })

  it('rejects an empty step', () => {
    expect(
      templateDraftBlockSchema.safeParse({ type: 'step', text: '' }).success,
    ).toBe(false)
  })
})
