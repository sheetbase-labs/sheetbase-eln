/**
 * Saving an experiment as a notebook template.
 *
 * A template carries the writing, the method and the sheet structure, never the
 * data: checklists come back unchecked, sheets are taken only when they came
 * from a sheet definition, and anything that points at this experiment's own
 * results (charts, files, metrics, plate maps) is left out. The result says
 * what it left out, so the person is not surprised by a thinner template.
 */
import type { DataClient } from '#/lib/data-client'
import { createNotebookTemplate } from '#/lib/notebook-template-data'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'
import { fetchBlocksForRecord } from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import { sheetBlockInstanceId } from '#/lib/sheet-block'
import { fetchSheetInstance } from '#/lib/sheet-instance-data'

/** Block types that describe the method and carry no results. */
const STRUCTURAL_TYPES = [
  'rich_text',
  'callout',
  'checklist',
  'procedure_step',
  'protocol_reference',
] as const

type StructuralType = (typeof STRUCTURAL_TYPES)[number]

const isStructural = (type: string): type is StructuralType =>
  (STRUCTURAL_TYPES as readonly string[]).includes(type)

export interface TemplateDraft {
  configuration: NotebookTemplateConfiguration
  /** Plain-language list of what was not carried over, with counts. */
  leftOut: string[]
}

const LEFT_OUT_LABEL: Record<string, string> = {
  chart: 'chart',
  analysis: 'analysis',
  file: 'file',
  metric: 'metric',
  plate_map: 'plate map',
  table: 'table',
  materials: 'materials list',
  linked_record: 'linked record',
  pipeline_output: 'pipeline output',
  signature_request: 'signature request',
  corrective_actions: 'corrective actions block',
  conclusion: 'conclusion',
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The template configuration for a set of notebook blocks. `sheetDefinitions`
 * maps a sheet instance id to the definition version it was made from; a sheet
 * missing from it is left out. `newId` makes placement ids (tests pass a
 * counter).
 */
export function templateConfigurationFromBlocks(
  blocks: readonly Pick<NotebookBlock, 'type' | 'payload' | 'order'>[],
  sheetDefinitions: ReadonlyMap<string, string>,
  newId: () => string = () => crypto.randomUUID(),
): TemplateDraft {
  const placements: NotebookTemplateConfiguration['placements'] = []
  const skipped = new Map<string, number>()
  let adHocSheets = 0
  const note = (label: string) =>
    skipped.set(label, (skipped.get(label) ?? 0) + 1)

  for (const block of [...blocks].sort((a, b) => a.order - b.order)) {
    const order = placements.length + 1
    if (block.type === 'sheet') {
      const instanceId = sheetBlockInstanceId(block.payload)
      const definition = instanceId ? sheetDefinitions.get(instanceId) : null
      if (!definition) {
        adHocSheets += 1
        continue
      }
      placements.push({
        id: newId(),
        kind: 'sheet',
        order,
        definitionVersionId: definition,
        parameterMappings: [],
      })
      continue
    }
    if (!isStructural(block.type)) {
      note(LEFT_OUT_LABEL[block.type] ?? block.type.replace(/_/g, ' '))
      continue
    }
    placements.push({
      id: newId(),
      kind: 'narrative',
      order,
      blockType: block.type,
      payload:
        block.type === 'checklist' && Array.isArray(block.payload.items)
          ? {
              ...block.payload,
              items: (block.payload.items as Record<string, unknown>[]).map(
                (item) => ({ ...item, checked: false }),
              ),
            }
          : block.payload,
    })
  }

  const leftOut = [...skipped].map(([label, count]) => plural(count, label))
  if (adHocSheets > 0) {
    leftOut.push(
      `${plural(adHocSheets, 'sheet')} not made from a sheet definition`,
    )
  }
  return {
    configuration: { formatVersion: 1, parameters: [], placements },
    leftOut,
  }
}

/** A template key from a name: lowercase, underscores, starts with a letter. */
export function templateKeyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const withLetter = /^[a-z]/.test(slug) ? slug : `t_${slug}`
  return (withLetter === 't_' ? 'template' : withLetter).slice(0, 60)
}

export async function saveExperimentAsTemplate(
  client: DataClient,
  input: {
    workspaceId: string
    experimentId: string
    key: string
    name: string
    description?: string | null
  },
) {
  const blocks = await fetchBlocksForRecord(client, input.experimentId)
  const sheetDefinitions = new Map<string, string>()
  for (const block of blocks) {
    const instanceId =
      block.type === 'sheet' ? sheetBlockInstanceId(block.payload) : null
    if (!instanceId) continue
    const instance = await fetchSheetInstance(instanceId, client)
    if (instance?.sourceDefinitionVersionId) {
      sheetDefinitions.set(instanceId, instance.sourceDefinitionVersionId)
    }
  }
  const draft = templateConfigurationFromBlocks(blocks, sheetDefinitions)
  const created = await createNotebookTemplate(
    {
      workspaceId: input.workspaceId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      configuration: draft.configuration,
    },
    client,
  )
  return { ...created, leftOut: draft.leftOut }
}
