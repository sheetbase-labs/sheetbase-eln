import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { ask } from '#/lib/assistant-rpc-cards.fixture'

import { ANALYSIS_CARDS } from './cards'
import { ANALYSIS_CARD_SPECS } from './cards.server'

const view = {
  id: 'av1',
  name: 'Growth view',
  version: 2,
  display_id: 'AV-0001',
}

const definition = { id: 'ad1', name: 'Growth fit', version: 1 }

const record = {
  id: 'r1',
  identifier: 'EXP-0004',
  title: 'Growth curve',
  kind: 'experiment',
  project_id: null,
}

const ask1 = (
  tool: string,
  input: Parameters<typeof ask>[2],
  tables: Parameters<typeof ask>[3],
) => ask(ANALYSIS_CARD_SPECS, tool, input, tables)

describe('the analysis cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(ANALYSIS_CARD_SPECS.map((card) => card.tool)).toEqual(
      ANALYSIS_CARDS.map((card) => card.tool),
    )

    for (const card of ANALYSIS_CARD_SPECS) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, card.tool).toContain(card.tool)
    }
  })

  it('saves a new view, or a new version of one found by its ID', async () => {
    const input = {
      name: 'Growth view',
      charts: [{ kind: 'line' }],
      sourceRevisions: [],
    }

    const created = await ask1('sheetbase.analysis.save_view', input, {})

    expect(created.action?.rpc).toBe('save_analysis_view')
    expect(created.action?.args).toMatchObject({
      p_id: null,
      p_name: 'Growth view',
    })

    const updated = await ask1(
      'sheetbase.analysis.save_view',
      { ...input, update: 'AV-0001' },
      { analysis_views: [view] },
    )

    expect(updated.action?.args).toMatchObject({ p_id: 'av1' })
    expect(updated.changes?.[0].after).toBe('v3')
  })

  it('saves an analysis definition', async () => {
    const result = await ask1(
      'sheetbase.analysis.save_definition',
      {
        name: 'Growth fit',
        definition: { kind: 'curve_fit' },
        sourceRevisions: [],
        update: 'Growth fit',
      },
      { analysis_definitions: [definition] },
    )

    expect(result.action?.rpc).toBe('save_analysis_definition')
    expect(result.action?.args).toMatchObject({
      p_id: 'ad1',
      p_definition: { kind: 'curve_fit' },
    })
  })

  it('combines a chart view with a statistic', async () => {
    const result = await ask1(
      'sheetbase.analysis.compose',
      { view: 'Growth view', statistic: 'Growth fit', name: 'Growth analysis' },
      { analysis_views: [view], analysis_definitions: [definition] },
    )

    expect(result.action?.rpc).toBe('compose_analysis_definition')
    expect(result.action?.args).toEqual({
      p_chart_view_id: 'av1',
      p_statistic_definition_id: 'ad1',
      p_name: 'Growth analysis',
    })
  })

  it('keeping old data needs a reason, moving to the newest does not', async () => {
    const keep = await ask1(
      'sheetbase.analysis.resolve_sources',
      { view: 'Growth view', resolution: 'keep' },
      { analysis_views: [view] },
    )

    expect(keep.ok).toBe(false)

    const update = await ask1(
      'sheetbase.analysis.resolve_sources',
      { view: 'Growth view', resolution: 'update' },
      { analysis_views: [view] },
    )

    expect(update.action?.rpc).toBe('resolve_analysis_view_sources')
    expect(update.action?.args).toMatchObject({
      p_view_id: 'av1',
      p_expected_version: 2,
      p_resolution: 'update',
    })
  })

  it('freezes and unfreezes chart and analysis blocks with the right call', async () => {
    const tables = {
      records: [record],
      blocks: [{ id: 'b1', type: 'chart', version: 4, order: 2 }],
    }

    const frozen = await ask1(
      'sheetbase.notebook_chart.freeze',
      { notebook: 'EXP-0004', block: 'chart', action: 'freeze' },
      tables,
    )

    expect(frozen.action?.rpc).toBe('freeze_chart')
    expect(frozen.action?.args).toEqual({
      p_block_id: 'b1',
      p_expected_version: 4,
    })

    const analysis = await ask1(
      'sheetbase.notebook_chart.freeze',
      { notebook: 'EXP-0004', block: 'analysis', action: 'unfreeze' },
      tables,
    )

    expect(analysis.action?.rpc).toBe('unfreeze_analysis_block')
  })

  it('asks which block when a notebook has several', async () => {
    const result = await ask1(
      'sheetbase.notebook_chart.freeze',
      { notebook: 'EXP-0004', block: 'chart', action: 'freeze' },
      {
        records: [record],
        blocks: [
          { id: 'b1', type: 'chart', version: 1, order: 1 },
          { id: 'b2', type: 'chart', version: 1, order: 2 },
        ],
      },
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('which one')

    const second = await ask1(
      'sheetbase.notebook_chart.freeze',
      { notebook: 'EXP-0004', block: 'chart', action: 'freeze', position: 2 },
      {
        records: [record],
        blocks: [
          { id: 'b1', type: 'chart', version: 1, order: 1 },
          { id: 'b2', type: 'chart', version: 1, order: 2 },
        ],
      },
    )

    expect(second.action?.args).toMatchObject({ p_block_id: 'b2' })
  })

  it('pins a chart to the latest saved revision', async () => {
    const result = await ask1(
      'sheetbase.notebook_chart.bind_revision',
      { notebook: 'EXP-0004' },
      {
        records: [record],
        blocks: [{ id: 'b1', type: 'chart', version: 4, order: 2 }],
        revisions: [
          { id: 'rev1', created_at: '2026-11-01T10:00:00Z', reason: 'First' },
          {
            id: 'rev2',
            created_at: '2026-11-20T10:00:00Z',
            reason: 'Signed off',
          },
        ],
      },
    )

    expect(result.action?.rpc).toBe('bind_chart_revision')
    expect(result.action?.args).toEqual({
      p_block_id: 'b1',
      p_revision_id: 'rev2',
      p_expected_version: 4,
    })
  })
})
