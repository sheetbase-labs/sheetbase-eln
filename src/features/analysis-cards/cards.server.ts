import { z } from 'zod'

import {
  cardSchema,
  changed,
  fail,
  findBlock,
  findRecord,
  ok,
  recordLabel,
  rpcCard,
  same,
} from '#/lib/assistant-rpc-cards.server'
import type { RpcCard } from '#/lib/assistant-rpc-cards.server'
import { likeValue } from '#/lib/assistant-lab-tools.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import { ANALYSIS_CARDS } from './cards'
import type { AnalysisCardsProposeToolName } from './cards'

/**
 * The analysis and chart cards (see `cards.ts`). Chart and analysis
 * specifications are passed through as the analysis tools write them; the
 * database checks them when the button is pressed.
 */

const covers = (tool: AnalysisCardsProposeToolName): readonly string[] =>
  ANALYSIS_CARDS.find((card) => card.tool === tool)?.covers ?? []

interface FoundAnalysis {
  id: string
  name: string
  version: number
  display_id?: string | null
}

async function findSaved(
  client: DataClient,
  table: 'analysis_views' | 'analysis_definitions',
  wanted: string,
): Promise<Lookup<FoundAnalysis>> {
  const like = likeValue(wanted)
  const isView = table === 'analysis_views'

  const rows = await client.list<FoundAnalysis>(
    table,
    `?or=(name.ilike.${like}${isView ? `,display_id.ilike.${like}` : ''})&select=id,name,version${isView ? ',display_id' : ''}&order=updated_at.desc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    isView ? 'analysis view' : 'analysis',
    (row) => row.name,
    (row) => same(row.name, wanted) || same(row.display_id, wanted),
  )
}

const json = z.json()

const jsonObject = z.record(z.string(), json)

const viewRef = (what: string) =>
  z.string().min(1).max(200).describe(`${what}, by its name or ID.`)

// ---------------------------------------------------------------------------

const saveViewSchema = cardSchema({
  name: z.string().min(1).max(100).describe('The view’s name.'),
  charts: z
    .array(jsonObject)
    .min(1)
    .max(8)
    .describe(
      'One to eight chart specifications, as the analysis tools write them.',
    ),
  sourceRevisions: z
    .array(json)
    .describe(
      'The data versions the charts were made from, so the view can be reproduced.',
    ),
  update: viewRef('An existing view to save a new version of').optional(),
})

const saveView = rpcCard({
  tool: 'sheetbase.analysis.save_view',
  covers: covers('sheetbase.analysis.save_view'),
  description:
    'Propose saving an analysis view (one to eight charts of the lab’s data) or saving a new version of one you own.',
  schema: saveViewSchema,
  async build(input, { client }) {
    const existing = input.update
      ? await findSaved(client, 'analysis_views', input.update)
      : null

    if (existing && !existing.ok) return existing

    return ok({
      target: input.name,
      deepLink: '/analysis',
      changes: [
        changed(
          existing ? 'New version' : 'New view',
          existing ? `v${existing.value.version}` : null,
          existing ? `v${existing.value.version + 1}` : input.name,
        ),
        changed('Charts', null, String(input.charts.length)),
      ],
      rpc: 'save_analysis_view',
      args: {
        p_id: existing?.value.id ?? null,
        p_name: input.name,
        p_charts: input.charts,
        p_source_revisions: input.sourceRevisions,
        p_export_settings: null,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const saveDefinitionSchema = cardSchema({
  name: z.string().min(1).max(100).describe('The analysis’s name.'),
  definition: jsonObject.describe(
    'The analysis definition, as the analysis tools write it.',
  ),
  sourceRevisions: z
    .array(json)
    .describe('The data versions it was made from.'),
  update: viewRef('An existing analysis to save a new version of').optional(),
})

const saveDefinition = rpcCard({
  tool: 'sheetbase.analysis.save_definition',
  covers: covers('sheetbase.analysis.save_definition'),
  description:
    'Propose saving a reusable analysis (a curve fit, standard curve or comparison) or saving a new version of one you own.',
  schema: saveDefinitionSchema,
  async build(input, { client }) {
    const existing = input.update
      ? await findSaved(client, 'analysis_definitions', input.update)
      : null

    if (existing && !existing.ok) return existing

    return ok({
      target: input.name,
      deepLink: '/analysis',
      changes: [
        changed(
          existing ? 'New version' : 'New analysis',
          existing ? `v${existing.value.version}` : null,
          existing ? `v${existing.value.version + 1}` : input.name,
        ),
      ],
      rpc: 'save_analysis_definition',
      args: {
        p_id: existing?.value.id ?? null,
        p_name: input.name,
        p_definition: input.definition,
        p_source_revisions: input.sourceRevisions,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const composeSchema = cardSchema({
  view: viewRef('The saved chart view'),
  statistic: viewRef('The saved analysis whose statistic to combine it with'),
  name: z.string().min(1).max(100).describe('The new analysis’s name.'),
})

const compose = rpcCard({
  tool: 'sheetbase.analysis.compose',
  covers: covers('sheetbase.analysis.compose'),
  description:
    'Propose combining a saved chart view with a saved statistic into a new named analysis.',
  schema: composeSchema,
  async build(input, { client }) {
    const view = await findSaved(client, 'analysis_views', input.view)

    if (!view.ok) return view

    const statistic = await findSaved(
      client,
      'analysis_definitions',
      input.statistic,
    )

    if (!statistic.ok) return statistic

    return ok({
      target: input.name,
      deepLink: '/analysis',
      changes: [
        changed('Chart view', null, view.value.name),
        changed('Statistic', null, statistic.value.name),
        changed('New analysis', null, input.name),
      ],
      rpc: 'compose_analysis_definition',
      args: {
        p_chart_view_id: view.value.id,
        p_statistic_definition_id: statistic.value.id,
        p_name: input.name,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const resolveSchema = cardSchema({
  view: viewRef('The analysis view whose data has moved on'),
  resolution: z
    .enum(['keep', 'update'])
    .describe(
      'keep stays on the pinned data versions (give a justification); update moves to the newest.',
    ),
  justification: z
    .string()
    .max(400)
    .optional()
    .describe('Why the old data is kept. Needed for keep.'),
})

const resolveSources = rpcCard({
  tool: 'sheetbase.analysis.resolve_sources',
  covers: covers('sheetbase.analysis.resolve_sources'),
  description:
    'Propose deciding what to do about newer data behind an analysis view: keep the pinned versions or move to the newest.',
  schema: resolveSchema,
  async build(input, { client }) {
    const view = await findSaved(client, 'analysis_views', input.view)

    if (!view.ok) return view

    if (input.resolution === 'keep' && !input.justification?.trim()) {
      return fail('Keeping the old data needs a reason. Ask the person why.')
    }

    return ok({
      target: view.value.name,
      deepLink: '/analysis',
      changes: [
        changed(
          'Newer data',
          null,
          input.resolution === 'keep'
            ? `Keep the pinned versions: ${input.justification}`
            : 'Move to the newest versions',
        ),
      ],
      rpc: 'resolve_analysis_view_sources',
      args: {
        p_view_id: view.value.id,
        p_expected_version: view.value.version,
        p_resolution: input.resolution,
        p_justification: input.justification ?? null,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const notebook = z
  .string()
  .min(1)
  .max(200)
  .describe('The notebook or experiment, by ID (EXP-0004) or name.')

const position = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    'Which block of that kind, counting from 1, when the notebook has several.',
  )

const freezeSchema = cardSchema({
  notebook,
  block: z
    .enum(['chart', 'analysis'])
    .describe('A chart block or an analysis block.'),
  action: z
    .enum(['freeze', 'unfreeze'])
    .describe(
      'freeze fixes it to the data it shows now; unfreeze lets it follow its data again.',
    ),
  position,
})

const RPC_OF = {
  chart: { freeze: 'freeze_chart', unfreeze: 'unfreeze_chart' },
  analysis: {
    freeze: 'freeze_analysis_block',
    unfreeze: 'unfreeze_analysis_block',
  },
} as const

const freeze = rpcCard({
  tool: 'sheetbase.notebook_chart.freeze',
  covers: covers('sheetbase.notebook_chart.freeze'),
  description:
    'Propose freezing a chart or analysis block in a notebook to the data it shows now, or unfreezing it.',
  schema: freezeSchema,
  async build(input, { client }) {
    const record = await findRecord(client, input.notebook)

    if (!record.ok) return record

    const block = await findBlock(
      client,
      record.value,
      [input.block],
      input.position,
    )

    if (!block.ok) return block
    const freezing = input.action === 'freeze'

    return ok({
      target: recordLabel(record.value),
      deepLink: `/records/${record.value.id}`,
      changes: [
        changed(
          `${input.block === 'chart' ? 'Chart' : 'Analysis'} block`,
          freezing ? 'Follows its data' : 'Frozen',
          freezing ? 'Frozen' : 'Follows its data',
        ),
      ],
      rpc: RPC_OF[input.block][input.action],
      args: {
        p_block_id: block.value.id,
        p_expected_version: block.value.version,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const bindSchema = cardSchema({
  notebook,
  position,
  revision: z
    .union([z.literal('latest'), z.number().int().min(1)])
    .default('latest')
    .describe(
      'The saved revision of the notebook: latest, or its number counting from 1 (oldest).',
    ),
})

const bindRevision = rpcCard({
  tool: 'sheetbase.notebook_chart.bind_revision',
  covers: covers('sheetbase.notebook_chart.bind_revision'),
  description:
    'Propose pointing a frozen chart block in a notebook at one saved revision of the notebook’s data.',
  schema: bindSchema,
  async build(input, { client }) {
    const record = await findRecord(client, input.notebook)

    if (!record.ok) return record

    const block = await findBlock(
      client,
      record.value,
      ['chart'],
      input.position,
    )

    if (!block.ok) return block

    const revisions = await client.list<{
      id: string
      created_at: string
      reason: string
    }>(
      'revisions',
      `?record_id=eq.${record.value.id}&select=id,created_at,reason&order=created_at.asc`,
    )

    const chosen =
      input.revision === 'latest'
        ? revisions.at(-1)
        : revisions.at(input.revision - 1)

    if (!chosen)
      return fail(`${recordLabel(record.value)} has no such saved revision.`)

    return ok({
      target: recordLabel(record.value),
      deepLink: `/records/${record.value.id}`,
      changes: [
        changed(
          'Chart shows',
          null,
          `Revision of ${chosen.created_at.slice(0, 10)}: ${chosen.reason}`,
        ),
      ],
      rpc: 'bind_chart_revision',
      args: {
        p_block_id: block.value.id,
        p_revision_id: chosen.id,
        p_expected_version: block.value.version,
      },
    })
  },
})

export const ANALYSIS_CARD_SPECS: readonly RpcCard[] = [
  saveView,
  saveDefinition,
  compose,
  resolveSources,
  freeze,
  bindRevision,
]
