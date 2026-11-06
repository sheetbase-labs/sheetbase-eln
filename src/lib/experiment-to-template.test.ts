import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  saveExperimentAsTemplate,
  templateConfigurationFromBlocks,
  templateKeyFromName,
} from './experiment-to-template'
import { fetchBlocksForRecord } from './notebook-data'
import type { NotebookBlock } from './notebook-data'
import { createNotebookTemplate } from './notebook-template-data'
import { fetchSheetInstance } from './sheet-instance-data'
import { notebookTemplateConfigurationSchema } from './notebook-template'

vi.mock('./notebook-data', () => ({ fetchBlocksForRecord: vi.fn() }))
vi.mock('./notebook-template-data', () => ({ createNotebookTemplate: vi.fn() }))
vi.mock('./sheet-instance-data', () => ({ fetchSheetInstance: vi.fn() }))

let counter = 0
const newId = () => {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

const INSTANCE = '00000000-0000-4000-8000-0000000000aa'
const ADHOC = '00000000-0000-4000-8000-0000000000bb'
const DEFINITION = '00000000-0000-4000-8000-0000000000cc'

describe('templateConfigurationFromBlocks with parts', () => {
  it('carries the parts and tags each placement with its part', () => {
    counter = 0
    const draft = templateConfigurationFromBlocks(
      [
        { type: 'rich_text', payload: {}, order: 1, partId: 'p1' },
        { type: 'rich_text', payload: {}, order: 2, partId: 'p2' },
      ],
      new Map(),
      newId,
      [
        { id: 'p1', title: 'Seed', dayOffset: 0 },
        { id: 'p2', title: 'Dose', dayOffset: 2 },
      ],
    )
    const config = draft.configuration
    expect(config.parts?.map((part) => [part.title, part.dayOffset])).toEqual([
      ['Seed', 0],
      ['Dose', 2],
    ])
    expect(config.placements.map((p) => 'partId' in p && p.partId)).toEqual(
      config.parts?.map((part) => part.id),
    )
    expect(notebookTemplateConfigurationSchema.safeParse(config).success).toBe(
      true,
    )
  })

  it('refuses a placement in a part the template does not have', () => {
    const result = notebookTemplateConfigurationSchema.safeParse({
      formatVersion: 1,
      parameters: [],
      parts: [],
      placements: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'narrative',
          order: 1,
          blockType: 'rich_text',
          payload: {},
          partId: '00000000-0000-4000-8000-000000000002',
        },
      ],
    })
    expect(result.success).toBe(false)
  })
})

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

describe('saveExperimentAsTemplate', () => {
  it('reads each Sheet once, all at the same time', async () => {
    const OTHER = '00000000-0000-4000-8000-0000000000dd'
    const sheetBlock = (instanceId: string, order: number): NotebookBlock => ({
      id: `block-${order}`,
      recordId: 'exp',
      type: 'sheet',
      payload: { instanceId },
      payloadSchemaVersion: 1,
      order,
      version: 1,
    })
    vi.mocked(fetchBlocksForRecord).mockResolvedValue([
      sheetBlock(INSTANCE, 1),
      sheetBlock(OTHER, 2),
      sheetBlock(INSTANCE, 3),
    ])
    let inFlight = 0
    let peak = 0
    vi.mocked(fetchSheetInstance).mockImplementation(async (id) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return {
        sourceDefinitionVersionId: id === INSTANCE ? DEFINITION : null,
      } as Awaited<ReturnType<typeof fetchSheetInstance>>
    })
    vi.mocked(createNotebookTemplate).mockResolvedValue(
      {} as Awaited<ReturnType<typeof createNotebookTemplate>>,
    )

    const result = await saveExperimentAsTemplate(
      { list: () => Promise.resolve([]) } as unknown as DataClient,
      {
        workspaceId: 'ws',
        experimentId: 'exp',
        key: 'k',
        name: 'Template',
      },
    )

    expect(vi.mocked(fetchSheetInstance).mock.calls.map(([id]) => id)).toEqual([
      INSTANCE,
      OTHER,
    ])
    expect(peak).toBe(2)
    const { configuration } = vi.mocked(createNotebookTemplate).mock.calls[0][0]
    expect(
      configuration.placements.filter((p) => p.kind === 'sheet'),
    ).toHaveLength(2)
    expect(result.leftOut).toEqual(['1 sheet not made from a sheet definition'])
  })
})
