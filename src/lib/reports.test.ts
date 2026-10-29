import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import {
  addEvidenceSection,
  createReport,
  fingerprint,
  frozenBlockOf,
  moveId,
  payloadText,
  reportStatus,
  sectionKindForBlock,
  updateSection,
  validationLabel,
} from './reports'
import type { ReportSection } from './reports'

const stub = (overrides: Record<string, unknown>) =>
  overrides as unknown as DataClient

describe('moveId', () => {
  it('moves an id one place and leaves the ends alone', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b'])
  })
})

describe('payloadText', () => {
  it('collects every text value in order, as one line', () => {
    expect(
      payloadText({
        content: [
          { type: 'heading', content: [{ text: 'Objective' }] },
          {
            type: 'paragraph',
            content: [{ text: 'Compare  seeding\n densities' }],
          },
        ],
      }),
    ).toBe('Objective Compare seeding densities')
    expect(payloadText(null)).toBe('')
  })
})

describe('sectionKindForBlock', () => {
  it('turns charts and tables into their own section kinds', () => {
    expect(sectionKindForBlock('chart')).toEqual({
      sectionType: 'chart',
      sourceType: 'chart_block',
    })
    expect(sectionKindForBlock('table').sourceType).toBe('table_block')
    expect(sectionKindForBlock('rich_text')).toEqual({
      sectionType: 'text',
      sourceType: 'revision_block',
    })
  })
})

describe('frozenBlockOf', () => {
  const section = (frozenPayload: Record<string, unknown>): ReportSection => ({
    id: 's',
    position: 1,
    title: 'T',
    description: null,
    sectionType: 'text',
    sourceType: 'revision_block',
    sourceRevisionId: 'r',
    sourceRef: { recordId: 'rec-1' },
    frozenPayload,
    validationStatus: 'valid',
    validationDetail: {},
  })

  it('reads the frozen block in the shape the notebook preview takes', () => {
    const block = frozenBlockOf(
      section({
        block: { id: 'b1', type: 'rich_text', payload: { a: 1 }, order: 2 },
      }),
    )
    expect(block).toMatchObject({
      id: 'b1',
      recordId: 'rec-1',
      type: 'rich_text',
      payload: { a: 1 },
      order: 2,
      version: 1,
    })
  })

  it('returns null when nothing is frozen yet', () => {
    expect(frozenBlockOf(section({}))).toBeNull()
  })
})

describe('labels', () => {
  it('names each check result in plain words', () => {
    expect(validationLabel('valid').tone).toBe('ok')
    expect(validationLabel('stale').tone).toBe('warn')
    expect(validationLabel('missing_source').tone).toBe('bad')
    expect(validationLabel('pending').tone).toBe('none')
  })

  it('shows approved and published reports as approved', () => {
    expect(reportStatus('published')).toEqual(reportStatus('approved'))
    expect(reportStatus('draft').tone).toBe('draft')
  })

  it('shortens a checksum to something a person can read out', () => {
    expect(fingerprint('f1f5036fabcdef')).toBe('F1F5-036F')
  })
})

describe('calls', () => {
  it('creates a report with the project and a trimmed title', async () => {
    const rpc = vi.fn(async () => ({ id: 'def-1', record_id: 'rec-1' }))
    const result = await createReport(stub({ rpc }), {
      workspaceId: 'ws',
      title: '  Yield  ',
      projectId: 'p1',
    })
    expect(result).toEqual({ recordId: 'rec-1', definitionId: 'def-1' })
    expect(rpc).toHaveBeenCalledWith('create_report_definition', {
      p_workspace_id: 'ws',
      p_title: 'Yield',
      p_subtitle: null,
      p_project_id: 'p1',
    })
  })

  it('adds an evidence section, then freezes the block from its revision', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'add_report_section' ? { id: 'sec-1' } : {},
    )
    await addEvidenceSection(stub({ rpc }), {
      workspaceId: 'ws',
      definitionId: 'def-1',
      title: 'Method',
      evidence: {
        revisionId: 'rev-1',
        blockId: 'b1',
        blockType: 'chart',
        recordIdentifier: 'EXP-1',
        recordId: 'rec-9',
        revisionVersion: 3,
      },
    })
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'add_report_section',
      expect.objectContaining({
        p_section_type: 'chart',
        p_source_type: 'chart_block',
      }),
    )
    expect(rpc).toHaveBeenNthCalledWith(2, 'bind_report_section_source', {
      p_workspace_id: 'ws',
      p_section_id: 'sec-1',
      p_source_revision_id: 'rev-1',
      p_source_ref: {
        blockId: 'b1',
        recordId: 'rec-9',
        recordIdentifier: 'EXP-1',
        revisionVersion: 3,
      },
    })
  })

  it('clears a section’s text with an empty string, not null', async () => {
    const rpc = vi.fn(async () => ({}))
    await updateSection(stub({ rpc }), {
      workspaceId: 'ws',
      sectionId: 's',
      body: '',
    })
    expect(rpc).toHaveBeenCalledWith('update_report_section', {
      p_workspace_id: 'ws',
      p_section_id: 's',
      p_title: null,
      p_description: '',
    })
  })
})
