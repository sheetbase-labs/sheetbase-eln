import { describe, expect, it } from 'vitest'

import type { NotebookBlock, RevisionWire } from './notebook-data'
import {
  SECTION_ORDER,
  SECTION_LABELS,
  BLOCK_SECTION_MAP,
  sectionForBlockType,
  assignSections,
  composeSections,
  getOverviewConfig,
  normaliseOverviewConfig,
  mergeOverviewConfig,
  toggleBlockExclusion,
  isBlockExcluded,
  detectOverviewMode,
  canConfigureOverview,
  toOverviewRevision,
} from './overview'
import type { OverviewConfig } from './overview'

// Helpers --------------------------------------------------------------------

function makeBlock(
  overrides: Partial<NotebookBlock> & { id: string; type: string },
): NotebookBlock {
  return {
    recordId: 'r1',
    payload: {},
    payloadSchemaVersion: 1,
    order: 0,
    version: 1,
    ...overrides,
  }
}

const blocks: NotebookBlock[] = [
  makeBlock({ id: 'b1', type: 'rich_text', order: 1 }),
  makeBlock({ id: 'b2', type: 'materials', order: 2 }),
  makeBlock({ id: 'b3', type: 'chart', order: 3 }),
  makeBlock({ id: 'b4', type: 'checklist', order: 4 }),
  makeBlock({ id: 'b5', type: 'rich_text', order: 5 }),
  makeBlock({ id: 'b6', type: 'file', order: 6 }),
  makeBlock({ id: 'b7', type: 'plate_map', order: 7 }),
  makeBlock({ id: 'b8', type: 'procedure_step', order: 8 }),
  makeBlock({ id: 'b9', type: 'protocol_reference', order: 9 }),
  makeBlock({ id: 'b10', type: 'table', order: 10 }),
  makeBlock({ id: 'b11', type: 'sheet', order: 11 }),
  makeBlock({ id: 'b12', type: 'linked_record', order: 12 }),
  makeBlock({ id: 'b13', type: 'metric', order: 13 }),
  makeBlock({ id: 'b14', type: 'callout', order: 14 }),
  makeBlock({ id: 'b15', type: 'unknown_future_type', order: 15 }),
]

// Block-to-section mapping ---------------------------------------------------

describe('sectionForBlockType', () => {
  it('maps every known block type to its section', () => {
    expect(sectionForBlockType('rich_text')).toBe('notes')
    expect(sectionForBlockType('callout')).toBe('notes')
    expect(sectionForBlockType('materials')).toBe('materials')
    expect(sectionForBlockType('protocol_reference')).toBe('procedures')
    expect(sectionForBlockType('procedure_step')).toBe('procedures')
    expect(sectionForBlockType('table')).toBe('tables')
    expect(sectionForBlockType('sheet')).toBe('tables')
    expect(sectionForBlockType('chart')).toBe('visualizations')
    expect(sectionForBlockType('plate_map')).toBe('visualizations')
    expect(sectionForBlockType('metric')).toBe('metrics')
    expect(sectionForBlockType('file')).toBe('files')
    expect(sectionForBlockType('linked_record')).toBe('links')
    expect(sectionForBlockType('checklist')).toBe('tasks')
  })

  it('maps unknown block types to "other"', () => {
    expect(sectionForBlockType('unknown_future_type')).toBe('other')
    expect(sectionForBlockType('')).toBe('other')
  })

  it('BLOCK_SECTION_MAP covers all known block types', () => {
    const knownTypes = [
      'rich_text',
      'checklist',
      'linked_record',
      'callout',
      'table',
      'sheet',
      'chart',
      'plate_map',
      'file',
      'metric',
      'procedure_step',
      'protocol_reference',
      'materials',
    ]
    for (const type of knownTypes) {
      expect(BLOCK_SECTION_MAP[type]).toBeDefined()
    }
  })
})

// Section composition --------------------------------------------------------

describe('assignSections', () => {
  it('assigns each block to its section', () => {
    const sectioned = assignSections(blocks)
    expect(sectioned).toHaveLength(blocks.length)
    expect(sectioned[0]).toEqual({
      block: blocks[0],
      section: 'notes',
    })
    expect(sectioned[2]).toEqual({
      block: blocks[2],
      section: 'visualizations',
    })
  })
})

describe('composeSections', () => {
  it('groups blocks into sections in canonical order', () => {
    const sections = composeSections(blocks)
    const sectionIds = sections.map((s) => s.id)
    // Sections appear in canonical order, not block order
    expect(sectionIds).toEqual([
      'notes',
      'materials',
      'procedures',
      'tables',
      'visualizations',
      'metrics',
      'files',
      'links',
      'tasks',
      'other',
    ])
  })

  it('preserves notebook order within each section', () => {
    const sections = composeSections(blocks)
    const notesSection = sections.find((s) => s.id === 'notes')
    expect(notesSection?.blocks).toEqual([blocks[0], blocks[4], blocks[13]])
  })

  it('omits empty sections by default', () => {
    const fewBlocks = [blocks[0], blocks[2]] // rich_text, chart
    const sections = composeSections(fewBlocks)
    expect(sections.map((s) => s.id)).toEqual(['notes', 'visualizations'])
  })

  it('includes empty sections when includeEmpty is true', () => {
    const fewBlocks = [blocks[0]]
    const sections = composeSections(fewBlocks, [], true)
    expect(sections).toHaveLength(SECTION_ORDER.length)
    expect(sections.find((s) => s.id === 'materials')?.blocks).toEqual([])
  })

  it('filters excluded blocks before section assignment', () => {
    const sections = composeSections(blocks, ['b1', 'b3'])
    const notesSection = sections.find((s) => s.id === 'notes')
    expect(notesSection?.blocks.map((b) => b.id)).toEqual(['b5', 'b14'])
    // visualizations section still exists (plate_map remains)
    expect(sections.find((s) => s.id === 'visualizations')?.blocks).toEqual([
      blocks[6],
    ])
  })

  it('produces empty sections list for empty blocks', () => {
    expect(composeSections([])).toEqual([])
  })

  it('assigns section labels from SECTION_LABELS', () => {
    const sections = composeSections(blocks)
    for (const section of sections) {
      expect(section.label).toBe(SECTION_LABELS[section.id])
    }
  })
})

// Overview configuration -----------------------------------------------------

describe('getOverviewConfig', () => {
  it('returns empty config when no overview key exists', () => {
    expect(getOverviewConfig({})).toEqual({ excludedBlockIds: [] })
    expect(getOverviewConfig({ other: 'value' })).toEqual({
      excludedBlockIds: [],
    })
  })

  it('returns excludedBlockIds when properly shaped', () => {
    const config = getOverviewConfig({
      overview: { excludedBlockIds: ['b1', 'b2'] },
    })
    expect(config).toEqual({ excludedBlockIds: ['b1', 'b2'] })
  })

  it('returns empty config when overview is malformed', () => {
    expect(getOverviewConfig({ overview: 'not an object' })).toEqual({
      excludedBlockIds: [],
    })
    expect(
      getOverviewConfig({ overview: { excludedBlockIds: 'not array' } }),
    ).toEqual({
      excludedBlockIds: [],
    })
    expect(
      getOverviewConfig({ overview: { excludedBlockIds: [1, 2] } }),
    ).toEqual({ excludedBlockIds: [] })
  })
})

describe('normaliseOverviewConfig', () => {
  it('keeps only known block ids', () => {
    const config = normaliseOverviewConfig(
      ['b1', 'unknown', 'b2'],
      ['b1', 'b2', 'b3'],
    )
    expect(config.excludedBlockIds).toEqual(['b1', 'b2'])
  })

  it('deduplicates block ids', () => {
    const config = normaliseOverviewConfig(['b1', 'b1', 'b2'], ['b1', 'b2'])
    expect(config.excludedBlockIds).toEqual(['b1', 'b2'])
  })

  it('returns empty for non-array input', () => {
    expect(normaliseOverviewConfig('not array', ['b1'])).toEqual({
      excludedBlockIds: [],
    })
    expect(normaliseOverviewConfig(null, ['b1'])).toEqual({
      excludedBlockIds: [],
    })
  })

  it('filters out non-string entries', () => {
    const config = normaliseOverviewConfig(
      ['b1', 123, null, 'b2'],
      ['b1', 'b2'],
    )
    expect(config.excludedBlockIds).toEqual(['b1', 'b2'])
  })
})

describe('mergeOverviewConfig', () => {
  it('preserves other property keys', () => {
    const merged = mergeOverviewConfig(
      { concentration: '50 mg/mL', other: 'value' },
      { excludedBlockIds: ['b1'] },
    )
    expect(merged.concentration).toBe('50 mg/mL')
    expect(merged.other).toBe('value')
    expect(merged.overview).toEqual({ excludedBlockIds: ['b1'] })
  })

  it('overwrites existing overview key', () => {
    const merged = mergeOverviewConfig(
      { overview: { excludedBlockIds: ['old'] } },
      { excludedBlockIds: ['new'] },
    )
    expect(merged.overview).toEqual({ excludedBlockIds: ['new'] })
  })
})

describe('toggleBlockExclusion', () => {
  const config: OverviewConfig = { excludedBlockIds: ['b1', 'b2'] }

  it('adds a block id when excluding', () => {
    const next = toggleBlockExclusion(config, 'b3', true)
    expect(next.excludedBlockIds).toContain('b3')
    expect(config.excludedBlockIds).not.toContain('b3') // immutable
  })

  it('removes a block id when including', () => {
    const next = toggleBlockExclusion(config, 'b1', false)
    expect(next.excludedBlockIds).not.toContain('b1')
    expect(next.excludedBlockIds).toContain('b2')
  })

  it('does not duplicate when excluding an already-excluded block', () => {
    const next = toggleBlockExclusion(config, 'b1', true)
    expect(next.excludedBlockIds.filter((id) => id === 'b1')).toHaveLength(1)
  })
})

describe('isBlockExcluded', () => {
  it('returns true for excluded blocks', () => {
    expect(isBlockExcluded({ excludedBlockIds: ['b1'] }, 'b1')).toBe(true)
  })

  it('returns false for included blocks', () => {
    expect(isBlockExcluded({ excludedBlockIds: ['b1'] }, 'b2')).toBe(false)
  })
})

// Locked / historical state detection ---------------------------------------

describe('detectOverviewMode', () => {
  const activeRecord = {
    status: 'in_progress',
    archivedAt: null,
    lockedAt: null,
  }
  const lockedRecord = { status: 'locked', archivedAt: null, lockedAt: null }
  const signedRecord = {
    status: 'in_progress',
    archivedAt: null,
    lockedAt: '2026-07-26T00:00:00Z',
  }
  const archivedRecord = {
    status: 'in_progress',
    archivedAt: '2026-07-20T00:00:00Z',
    lockedAt: null,
  }

  it('returns "active" for a live, non-locked record', () => {
    expect(detectOverviewMode(activeRecord, false)).toBe('active')
  })

  it('returns "locked" when status is "locked"', () => {
    expect(detectOverviewMode(lockedRecord, false)).toBe('locked')
  })

  it('returns "locked" when the record is signed/locked (lockedAt set)', () => {
    expect(detectOverviewMode(signedRecord, false)).toBe('locked')
  })

  it('returns "archived" when archivedAt is set', () => {
    expect(detectOverviewMode(archivedRecord, false)).toBe('archived')
  })

  it('returns "historical" when viewing a revision (takes precedence)', () => {
    expect(detectOverviewMode(archivedRecord, true)).toBe('historical')
    expect(detectOverviewMode(lockedRecord, true)).toBe('historical')
    expect(detectOverviewMode(signedRecord, true)).toBe('historical')
  })
})

describe('canConfigureOverview', () => {
  it('allows configuration only in active mode', () => {
    expect(canConfigureOverview('active')).toBe(true)
    expect(canConfigureOverview('locked')).toBe(false)
    expect(canConfigureOverview('archived')).toBe(false)
    expect(canConfigureOverview('historical')).toBe(false)
  })
})

// Revision snapshot parsing --------------------------------------------------

describe('toOverviewRevision', () => {
  const wire: RevisionWire = {
    id: 'rev-1',
    record_id: 'r1',
    structure_version: 2,
    metadata_version: 1,
    metadata_snapshot: { title: 'Test', status: 'locked' },
    block_snapshot: [
      {
        id: 'b1',
        type: 'rich_text',
        payload: { doc: { type: 'doc', content: [] } },
        payload_schema_version: 1,
        order: 0,
        version: 1,
      },
      {
        id: 'b2',
        type: 'chart',
        payload: { title: 'Chart' },
        payload_schema_version: 1,
        order: 1,
        version: 1,
      },
    ],
    reason: 'submit',
    superseded_by_revision_id: null,
    created_at: '2026-07-22T10:00:00Z',
    created_by_user_id: 'u1',
  }

  it('maps the wire shape to the domain shape', () => {
    const revision = toOverviewRevision(wire)
    expect(revision.id).toBe('rev-1')
    expect(revision.recordId).toBe('r1')
    expect(revision.reason).toBe('submit')
    expect(revision.superseded).toBe(false)
    expect(revision.metadata).toEqual({ title: 'Test', status: 'locked' })
  })

  it('maps block snapshot to NotebookBlock[]', () => {
    const revision = toOverviewRevision(wire)
    expect(revision.blocks).toHaveLength(2)
    expect(revision.blocks[0]).toEqual({
      id: 'b1',
      recordId: 'r1',
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: [] } },
      payloadSchemaVersion: 1,
      order: 0,
      version: 1,
    })
  })

  it('marks superseded revisions', () => {
    const revision = toOverviewRevision({
      ...wire,
      superseded_by_revision_id: 'rev-2',
    })
    expect(revision.superseded).toBe(true)
  })

  it('handles empty block snapshot', () => {
    const revision = toOverviewRevision({
      ...wire,
      block_snapshot: [],
    })
    expect(revision.blocks).toEqual([])
  })

  it('handles null metadata snapshot', () => {
    const revision = toOverviewRevision({
      ...wire,
      metadata_snapshot: {},
    })
    expect(revision.metadata).toEqual({})
  })
})
