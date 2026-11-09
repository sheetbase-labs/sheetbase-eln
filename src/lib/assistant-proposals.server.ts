import { PAYLOAD_SCHEMA_VERSION, validateBlock } from './blocks'
import { plainTextToRichText } from './blocks/plain-text'
import { isRichTextPayload, richTextToPlainText } from './blocks/rich-text'
import type { DataClient } from './data-client'
import { recordDestination, sheetPath } from './navigation'
import { fetchRecordById } from './scientific-records'
import { toBlock } from './notebook-data'
import type { BlockWire } from './notebook-data'
import { sheetInstanceFromWire } from './sheet-instance-data'
import { sheetInstanceStateSchema } from './sheet-instance'
import { PROPOSAL_TOOLS, isProposalTool } from './assistant-proposals'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import {
  getPipelineDefinition,
  listPipelineDefinitionVersions,
} from './pipelines/data'
import {
  PIPELINE_CONFIG_VERSION,
  validatePipelineConfig,
} from './pipelines/config'
import type {
  PipelineConfig,
  PipelineInput,
  PipelineParameter,
  PipelineStep,
} from './pipelines/config'

/**
 * Turns a model's proposal arguments into a card payload, against the person's
 * own data. Reads only. A bad id, a record the person cannot see, or a block
 * that is not plain text comes back as a short message the model can act on.
 */

export type ProposalOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const MAX_SHOWN = 240

function clip(text: string): string {
  const tidy = text
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()

  return tidy.length <= MAX_SHOWN ? tidy : `${tidy.slice(0, MAX_SHOWN)}…`
}

function show(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null

  return clip(typeof value === 'string' ? value : JSON.stringify(value))
}

async function fetchBlock(client: DataClient, blockId: string) {
  const rows = await client.list<BlockWire>(
    'blocks',
    `?id=eq.${encodeURIComponent(blockId)}`,
  )

  return rows.at(0) ? toBlock(rows[0]) : null
}

type PipelineArgs = {
  description?: string
  statement?: string
  steps?: Array<{
    name: string
    statement?: string
    plugin?: { operation: string; arguments: Record<string, unknown> }
  }>
  inputs?: Array<{ name: string; description?: string; required?: boolean }>
  parameters?: Array<{
    name: string
    type: PipelineParameter['type']
    required?: boolean
    default?: unknown
    description?: string
  }>
}

function blankPipelineConfig(): PipelineConfig {
  return {
    configVersion: PIPELINE_CONFIG_VERSION,
    parameters: [],
    inputs: [],
    transform: { language: 'sql', statement: '' },
    output: { mode: 'none', datasetLabel: '' },
  }
}

/**
 * The assistant's edit laid over a configuration. Only what was given
 * changes. A step it names that already exists keeps its language, contract
 * and confirmation, so a Python step is never turned into SQL by accident.
 */
function applyPipelineArgs(
  base: PipelineConfig,
  args: PipelineArgs,
): PipelineConfig {
  // Older drafts can lack the empty lists the contract asks for.
  const next: PipelineConfig = {
    ...base,
    parameters: (base as Partial<PipelineConfig>).parameters ?? [],
    inputs: (base as Partial<PipelineConfig>).inputs ?? [],
  }

  if (args.description !== undefined) next.description = args.description

  if (args.inputs) {
    next.inputs = args.inputs.map((input): PipelineInput => ({
      name: input.name,
      required: input.required ?? true,
      ...(input.description ? { description: input.description } : {}),
    }))
  }

  if (args.parameters) {
    next.parameters = args.parameters.map((parameter): PipelineParameter => {
      const required = parameter.required ?? false

      return {
        name: parameter.name,
        type: parameter.type,
        required,
        ...(parameter.default !== undefined && !required
          ? { default: parameter.default }
          : {}),
        ...(parameter.description
          ? { description: parameter.description }
          : {}),
      }
    })
  }

  if (args.statement !== undefined) {
    next.transform = { ...base.transform, statement: args.statement }
  }

  if (args.steps) {
    const existing = base.steps ?? []
    next.steps = args.steps.map((step): PipelineStep => {
      const kept = existing.find((entry) => entry.name === step.name)

      // A plugin step has no code: it is the plugin step and what it is given.
      if (step.plugin) {
        const { contract: _contract, ...rest } = kept ?? {}

        return {
          ...rest,
          name: step.name,
          language: 'plugin',
          statement: '',
          plugin: step.plugin,
        }
      }

      const statement = step.statement ?? ''

      if (kept?.language === 'plugin') {
        // Naming a plugin step with SQL turns it into a SQL step on purpose.
        const { plugin: _plugin, ...rest } = kept

        return { ...rest, language: 'sql', statement }
      }

      return kept
        ? { ...kept, statement }
        : { name: step.name, language: 'sql', statement }
    })

    if (next.steps.length === 0) delete next.steps
  }

  return next
}

function pipelineStatements(config: PipelineConfig): Array<[string, string]> {
  return [
    ['First step', config.transform.statement],
    ...(config.steps ?? []).map((step): [string, string] => [
      `Step · ${step.name}`,
      step.plugin
        ? `Plugin step ${step.plugin.operation}\n${JSON.stringify(step.plugin.arguments, null, 2)}`
        : step.statement,
    ]),
  ]
}

function listNames(items: Array<{ name: string }> | undefined): string | null {
  return items && items.length > 0
    ? items.map((item) => item.name).join(', ')
    : null
}

/** The lines of a card: only what differs between two configurations. */
function pipelineChanges(
  before: PipelineConfig | null,
  after: PipelineConfig,
): ProposalChange[] {
  const changes: ProposalChange[] = []
  const was = new Map(before ? pipelineStatements(before) : [])
  const now = pipelineStatements(after)

  for (const [label, statement] of now) {
    const previous = was.get(label) ?? null

    if (previous === statement) continue
    changes.push({
      label,
      before: previous === null ? null : show(previous),
      after: show(statement) ?? '(empty)',
    })
  }

  for (const [label, statement] of was) {
    if (!now.some(([name]) => name === label)) {
      changes.push({ label, before: show(statement), after: '(removed)' })
    }
  }

  const beforeInputs = listNames(before?.inputs)
  const afterInputs = listNames(after.inputs)

  if (beforeInputs !== afterInputs) {
    changes.push({
      label: 'Inputs',
      before: beforeInputs,
      after: afterInputs ?? '(none)',
    })
  }

  const beforeParameters = listNames(before?.parameters)
  const afterParameters = listNames(after.parameters)

  if (beforeParameters !== afterParameters) {
    changes.push({
      label: 'Parameters',
      before: beforeParameters,
      after: afterParameters ?? '(none)',
    })
  }

  return changes
}

function configProblem(config: PipelineConfig): string | null {
  const errors = validatePipelineConfig(config).filter(
    // A draft may be incomplete about where its result goes; a person sets that.
    (error) => !error.field.startsWith('output'),
  )

  return errors.length > 0
    ? `That pipeline is not valid: ${errors
        .map((error) => `${error.field} ${error.message}`)
        .join('; ')}`
    : null
}

export async function buildAssistantProposal(
  client: DataClient,
  workspaceId: string,
  name: string,
  args: unknown,
): Promise<ProposalOutcome> {
  if (!isProposalTool(name)) {
    return { ok: false, message: 'That tool is not available.' }
  }

  const parsed = PROPOSAL_TOOLS[name].schema.safeParse(args)

  if (!parsed.success) {
    return {
      ok: false,
      message: `The proposal was not valid: ${parsed.error.issues
        .map(
          (issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`,
        )
        .join('; ')}`,
    }
  }

  const input = parsed.data as Record<string, unknown>
  const title = String(input.title)
  const summary = String(input.summary)

  switch (name) {
    case 'sheetbase.notebook_block.insert': {
      const recordId = String(input.recordId)
      const record = await fetchRecordById(client, recordId)

      if (!record) return { ok: false, message: 'That record was not found.' }
      const payload = plainTextToRichText(String(input.text))

      if (!validateBlock({ type: 'rich_text', payload }).ok) {
        return { ok: false, message: 'That text could not be made a block.' }
      }

      const afterBlockId =
        typeof input.afterBlockId === 'string' ? input.afterBlockId : null

      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: `${record.identifier} · ${record.title}`,
          deepLink: recordDestination(record.kind, record.id),
          changes: [
            {
              label: 'New text block',
              before: null,
              after: clip(String(input.text)),
            },
          ],
          operation: {
            kind: 'notebook_block.insert',
            recordId,
            afterBlockId,
            block: {
              type: 'rich_text',
              payload,
              payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
            },
            expectedRevision: record.structureVersion,
          },
        },
      }
    }

    case 'sheetbase.notebook_block.update': {
      const block = await fetchBlock(client, String(input.blockId))

      if (!block) return { ok: false, message: 'That block was not found.' }

      if (block.type !== 'rich_text' || !isRichTextPayload(block.payload)) {
        return {
          ok: false,
          message: 'Only text blocks can be changed this way.',
        }
      }

      const record = await fetchRecordById(client, block.recordId)
      const payload = plainTextToRichText(String(input.text))

      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: record
            ? `${record.identifier} · ${record.title}`
            : 'Notebook',
          deepLink: record ? recordDestination(record.kind, record.id) : null,
          changes: [
            {
              label: 'Text block',
              before: show(richTextToPlainText(block.payload)),
              after: clip(String(input.text)),
            },
          ],
          operation: {
            kind: 'notebook_block.update',
            blockId: block.id,
            expectedVersion: block.version,
            payload,
            payloadSchemaVersion: block.payloadSchemaVersion,
          },
        },
      }
    }

    case 'sheetbase.record.custom_fields.update': {
      const record = await fetchRecordById(client, String(input.recordId))

      if (!record) return { ok: false, message: 'That record was not found.' }
      const values = input.values as Record<string, unknown>
      const current = record.customFields ?? {}

      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: `${record.identifier} · ${record.title}`,
          deepLink: recordDestination(record.kind, record.id),
          changes: Object.entries(values).map(([field, value]) => ({
            label: field,
            before: show(current[field]),
            after: show(value) ?? '(empty)',
          })),
          operation: {
            kind: 'record.custom_fields.update',
            recordId: record.id,
            expectedMetadataVersion: record.metadataVersion,
            values,
          },
        },
      }
    }

    case 'sheetbase.sheet_instance.update': {
      const rows = await client.list<unknown>(
        'sheet_instances',
        `?id=eq.${encodeURIComponent(String(input.instanceId))}&limit=1`,
      )

      if (rows.length === 0) {
        return { ok: false, message: 'That sheet was not found.' }
      }

      const instance = sheetInstanceFromWire(rows[0])
      const patch = input.localValues as Record<string, Record<string, unknown>>
      const localValues = { ...instance.state.localValues }
      const changes: AssistantProposal['changes'] = []

      for (const [rowId, cells] of Object.entries(patch)) {
        localValues[rowId] = { ...localValues[rowId], ...cells } as never

        for (const [fieldId, value] of Object.entries(cells)) {
          const label =
            instance.state.localFields.find(
              (field) => field.fieldId === fieldId,
            )?.label ?? fieldId

          changes.push({
            label: `${label} · ${rowId}`,
            before: show(
              (
                instance.state.localValues as Record<
                  string,
                  Record<string, unknown> | undefined
                >
              )[rowId]?.[fieldId],
            ),
            after: show(value) ?? '(empty)',
          })
        }
      }

      const state = { ...instance.state, localValues }
      const checked = sheetInstanceStateSchema.safeParse(state)

      if (!checked.success) {
        return {
          ok: false,
          message: `Those values do not fit the sheet: ${checked.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        }
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: instance.name,
          deepLink: sheetPath(instance.id),
          changes,
          operation: {
            kind: 'sheet_instance.update',
            instanceId: instance.id,
            expectedRevision: instance.revision,
            state: checked.data,
          },
        },
      }
    }

    case 'sheetbase.pipeline_definition.draft': {
      const spec = input as unknown as PipelineArgs & {
        key: string
        name: string
      }

      const configuration = applyPipelineArgs(blankPipelineConfig(), spec)
      const problem = configProblem(configuration)

      if (problem) return { ok: false, message: problem }

      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: 'New pipeline',
          deepLink: null,
          changes: [
            { label: 'Pipeline', before: null, after: spec.name },
            ...pipelineChanges(null, configuration),
          ],
          operation: {
            kind: 'pipeline_definition.create',
            workspaceId,
            key: spec.key,
            name: spec.name,
            description: spec.description ?? null,
          },
          followUp: {
            kind: 'pipeline_definition.create_version',
            workspaceId,
            configuration,
          },
        },
      }
    }

    case 'sheetbase.pipeline_definition.update_draft': {
      const spec = input as unknown as PipelineArgs & { pipelineId: string }
      const definition = await getPipelineDefinition(client, spec.pipelineId)

      if (!definition) {
        return { ok: false, message: 'That pipeline was not found.' }
      }

      if (definition.lifecycle !== 'active') {
        return { ok: false, message: 'That pipeline is retired.' }
      }

      const versions = await listPipelineDefinitionVersions(
        client,
        definition.id,
      )

      const draft = versions.find((version) => version.lifecycle === 'draft')
      const latest = draft ?? versions.find((v) => v.lifecycle === 'published')

      const current = latest
        ? (latest.configuration as unknown as PipelineConfig)
        : null

      const configuration = applyPipelineArgs(
        current ?? blankPipelineConfig(),
        spec,
      )

      const problem = configProblem(configuration)

      if (problem) return { ok: false, message: problem }
      const changes = pipelineChanges(current, configuration)

      if (changes.length === 0) {
        return { ok: false, message: 'That would not change anything.' }
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: `${definition.display_id ?? definition.key} · ${definition.name}${draft ? ' · Draft' : ' · New draft'}`,
          deepLink: `/pipelines/${definition.id}`,
          changes,
          operation: draft
            ? {
                kind: 'pipeline_definition.update_draft',
                workspaceId,
                versionId: draft.id,
                expectedRevision: Number(draft.revision),
                configuration,
              }
            : {
                kind: 'pipeline_definition.create_version',
                workspaceId,
                definitionId: definition.id,
                expectedDefinitionRevision: Number(definition.revision),
                configuration,
              },
        },
      }
    }
  }
}
