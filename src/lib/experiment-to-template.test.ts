import { describe, expect, it } from 'vitest'

import {
  templateConfigurationFromBlocks,
  templateKeyFromName,
} from './experiment-to-template'
import { notebookTemplateConfigurationSchema } from './notebook-template'

let counter = 0
const newId = () => {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

const INSTANCE = '00000000-0000-4000-8000-0000000000aa'
const ADHOC = '00000000-0000-4000-8000-0000000000bb'
const DEFINITION = '00000000-0000-4000-8000-0000000000cc'

describe('templateConfigurationFromBlocks', () => {
  it('keeps the method, unchecks checklists and drops results', () => {
    counter = 0
    const draft = templateConfigurationFromBlocks(
      [
        { type: 'rich_text', payload: { doc: 'a' }, order: 1 },
        {
          type: 'checklist',
          payload: { items: [{ id: 'x', text: 'Spin', checked: true }] },
          order: 2,
        },
        { type: 'chart', payload: {}, order: 3 },
        { type: 'chart', payload: {}, order: 4 },
        { type: 'file', payload: {}, order: 5 },
        { type: 'sheet', payload: { instanceId: INSTANCE }, order: 6 },
        { type: 'sheet', payload: { instanceId: ADHOC }, order: 7 },
      ],
      new Map([[INSTANCE, DEFINITION]]),
      newId,
    )
    expect(draft.configuration.placements.map((p) => p.kind)).toEqual([
      'narrative',
      'narrative',
      'sheet',
    ])
    const checklist = draft.configuration.placements[1]
    expect(checklist).toMatchObject({
      payload: { items: [{ id: 'x', text: 'Spin', checked: false }] },
    })
    expect(draft.configuration.placements[2]).toMatchObject({
      definitionVersionId: DEFINITION,
      order: 3,
    })
    expect(draft.leftOut).toEqual([
      '2 charts',
      '1 file',
      '1 sheet not made from a sheet definition',
    ])
    // The server validates against this schema, so the draft must satisfy it.
    expect(() =>
      notebookTemplateConfigurationSchema.parse(draft.configuration),
    ).not.toThrow()
  })

  it('orders by the notebook order, renumbering placements from one', () => {
    counter = 0
    const draft = templateConfigurationFromBlocks(
      [
        { type: 'callout', payload: { text: 'b' }, order: 9 },
        { type: 'rich_text', payload: { doc: 'a' }, order: 2 },
      ],
      new Map(),
      newId,
    )
    expect(draft.configuration.placements.map((p) => p.order)).toEqual([1, 2])
    expect(draft.configuration.placements[0]).toMatchObject({
      blockType: 'rich_text',
    })
    expect(draft.leftOut).toEqual([])
  })
})

describe('templateKeyFromName', () => {
  it('makes a key the server accepts', () => {
    const pattern = /^[a-z][a-z0-9_]{0,59}$/
    for (const name of [
      'Harvest clarification',
      '2-step purification!',
      '   ',
      'A'.repeat(100),
    ]) {
      expect(templateKeyFromName(name)).toMatch(pattern)
    }
    expect(templateKeyFromName('Harvest clarification')).toBe(
      'harvest_clarification',
    )
    expect(templateKeyFromName('2-step purification!')).toBe(
      't_2_step_purification',
    )
  })
})
