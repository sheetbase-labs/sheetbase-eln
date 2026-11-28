import { describe, expect, it } from 'vitest'

import type { NotebookTemplateConfiguration } from './notebook-template'
import {
  TEMPLATE_SECTION_BLOCK,
  TEMPLATE_SHEET_BLOCK,
  duplicateTemplateBlock,
  insertTemplateBlock,
  isTemplateBlockType,
  moveTemplateBlock,
  removeTemplateBlock,
  setPlacementBlock,
  templateBlockOf,
  templateNotebookBlocks,
} from './template-blocks'

const id = (n: number) =>
  `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const part = { a: id(90), b: id(91) }

function config(): NotebookTemplateConfiguration {
  return {
    formatVersion: 1,
    parameters: [],
    parts: [
      { id: part.a, title: 'Treat', dayOffset: 0 },
      { id: part.b, title: 'Verify', dayOffset: 1 },
    ],
    placements: [
      {
        id: id(1),
        kind: 'narrative',
        order: 1,
        blockType: 'procedure_step',
        payload: { text: 'Add enzyme', stepNumber: 1 },
        partId: part.a,
      },
      {
        id: id(2),
        kind: 'narrative',
        order: 2,
        blockType: 'checklist',
        payload: { items: [{ text: 'Thaw', checked: false }] },
        partId: part.a,
      },
      {
        id: id(3),
        kind: 'narrative',
        order: 3,
        blockType: 'callout',
        payload: { text: 'Do not vortex', variant: 'warning' },
        partId: part.b,
      },
      {
        id: id(4),
        kind: 'section_placeholder',
        order: 4,
        key: 'notes',
        label: 'Notes',
      },
      {
        id: id(5),
        kind: 'sheet',
        order: 5,
        definitionVersionId: id(80),
        title: 'Runs',
        parameterMappings: [],
      },
    ],
  }
}

const order = (c: NotebookTemplateConfiguration) =>
  [...c.placements].sort((a, b) => a.order - b.order).map((p) => p.id)

describe('templateBlockOf', () => {
  it('turns a title beside text into the heading a notebook shows', () => {
    const block = templateBlockOf({
      blockType: 'rich_text',
      payload: { title: 'Objective', doc: { type: 'doc', content: [] } },
    })

    expect(block).toEqual({
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Objective' }],
            },
          ],
        },
      },
    })
  })

  it('makes a metric that only names fields into a list to fill in', () => {
    const block = templateBlockOf({
      blockType: 'metric',
      payload: { fields: ['Yield', ' '] },
    })

    expect(block.type).toBe('rich_text')
    expect(JSON.stringify(block.payload)).toContain('Yield')
    expect(JSON.stringify(block.payload)).toContain('bulletList')
  })

  it('keeps a materials list to its items', () => {
    expect(
      templateBlockOf({
        blockType: 'materials',
        payload: { label: 'Material lot', modelKey: 'material' },
      }),
    ).toEqual({ type: 'materials', payload: { items: [] } })
  })
})

describe('templateNotebookBlocks', () => {
  it('reads every placement as a block in order, with its part', () => {
    const blocks = templateNotebookBlocks(id(99), config().placements)

    expect(blocks.map((b) => [b.type, b.partId])).toEqual([
      ['procedure_step', part.a],
      ['checklist', part.a],
      ['callout', part.b],
      [TEMPLATE_SECTION_BLOCK, null],
      [TEMPLATE_SHEET_BLOCK, null],
    ])
  })
})

describe('template block edits', () => {
  it('keeps a block’s new content and only for template blocks', () => {
    const next = setPlacementBlock(config(), id(1), {
      type: 'procedure_step',
      payload: { text: 'Add enzyme gently', stepNumber: 1 },
    })

    const placement = next.placements.find((p) => p.id === id(1))
    expect(placement?.kind === 'narrative' && placement.payload.text).toBe(
      'Add enzyme gently',
    )
    expect(isTemplateBlockType('dataset_import')).toBe(false)
    expect(
      setPlacementBlock(config(), id(1), {
        type: 'dataset_import',
        payload: {},
      }),
    ).toEqual(config())
  })

  it('adds a block after another, in that block’s part', () => {
    const next = insertTemplateBlock(config(), {
      id: id(10),
      type: 'checklist',
      afterBlockId: id(1),
    })

    expect(order(next)).toEqual([id(1), id(10), id(2), id(3), id(4), id(5)])
    const added = next.placements.find((p) => p.id === id(10))
    expect(added?.kind === 'narrative' && added.partId).toBe(part.a)
  })

  it('adds a block at the end of the part it is added to', () => {
    const next = insertTemplateBlock(config(), {
      id: id(10),
      type: 'rich_text',
      partId: part.a,
    })

    expect(order(next)).toEqual([id(1), id(2), id(10), id(3), id(4), id(5)])
  })

  it('moves, copies and removes blocks, keeping orders 1..n', () => {
    const moved = moveTemplateBlock(config(), id(3), {
      afterBlockId: null,
      beforeBlockId: id(1),
    })

    expect(order(moved)[0]).toBe(id(3))

    const copied = duplicateTemplateBlock(config(), id(2), id(11))
    expect(order(copied)).toEqual([id(1), id(2), id(11), id(3), id(4), id(5)])

    const removed = removeTemplateBlock(config(), id(2))
    expect(removed.placements.map((p) => p.order)).toEqual([1, 2, 3, 4])
  })
})
