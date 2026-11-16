import {
  findExperiment,
  likeValue,
  toolDef,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { parse } from '#/lib/assistant-upkeep.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

import {
  DATA_IN_PROPOSE_TOOL_NAMES,
  SHEET_OPEN_DATASET_TOOL,
  openDatasetInSheetSchema,
} from './cards'
import type { DataInAction } from './cards'

/**
 * The card that puts a dataset in a sheet (see `assistant.ts`). The builder
 * looks up the dataset and the experiment as the signed-in person, so a card
 * only ever names things they can see.
 */

export type DataInOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

export function isDataInProposalTool(name: string): boolean {
  return DATA_IN_PROPOSE_TOOL_NAMES.some((tool) => tool === name)
}

export function dataInProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      SHEET_OPEN_DATASET_TOOL,
      'Propose showing a dataset in a new sheet, optionally inside an experiment’s notebook. The sheet shows every column and row of the dataset; no sheet definition has to exist first. Use it when the person asks to open, show or put data in a sheet. The person sees a card and presses a button to make it; nothing changes until they do.',
      openDatasetInSheetSchema,
    ),
  ]
}

interface DatasetRow {
  id: string
  name: string
  display_id: string | null
}

async function findDataset(
  context: LabToolContext,
  text: string,
): Promise<DatasetRow | { message: string }> {
  const like = likeValue(text)

  const rows = await context.client.list<DatasetRow>(
    'datasets',
    `?lifecycle=eq.active&or=(name.ilike.${like},display_id.ilike.${like})&select=id,name,display_id&order=updated_at.desc&limit=5`,
  )

  const lower = text.trim().toLowerCase()

  const exact = rows.find(
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower,
  )

  if (exact) return exact

  if (rows.length === 1) return rows[0]

  if (rows.length === 0) return { message: `No dataset matches "${text}".` }

  return {
    message: `More than one dataset matches "${text}": ${rows
      .map((row) =>
        row.display_id ? `${row.display_id} ${row.name}` : row.name,
      )
      .join(', ')}. Ask which one.`,
  }
}

export async function buildDataInProposal(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it.
  args: unknown,
  context: LabToolContext,
): Promise<DataInOutcome> {
  if (name !== SHEET_OPEN_DATASET_TOOL)
    return { ok: false, message: 'Unknown tool.' }
  const parsed = parse(openDatasetInSheetSchema, args)

  if (!parsed.ok) return { ok: false, message: parsed.message }
  const input = parsed.data

  try {
    const dataset = await findDataset(context, input.dataset)

    if ('message' in dataset) return { ok: false, message: dataset.message }

    const experiment = input.experiment
      ? await findExperiment(context.client, input.experiment)
      : null

    if (experiment && 'message' in experiment)
      return { ok: false, message: experiment.message }

    const label = dataset.display_id
      ? `${dataset.display_id} ${dataset.name}`
      : dataset.name

    const action: DataInAction = {
      kind: 'sheet.open_dataset',
      datasetId: dataset.id,
      notebookRecordId: experiment?.id ?? null,
      name: input.name ?? null,
    }

    return {
      ok: true,
      proposal: {
        tool: SHEET_OPEN_DATASET_TOOL,
        title: input.title,
        summary: input.summary,
        target: label,
        deepLink: experiment ? `/records/${experiment.id}/notebook` : null,
        changes: [
          {
            label: 'Sheet',
            before: 'None',
            after: experiment ? `${label}, in ${experiment.identifier}` : label,
          },
        ],
        action,
      },
    }
  } catch {
    return { ok: false, message: 'Could not look up the dataset.' }
  }
}
