import { z } from 'zod'
import { PAYLOAD_SCHEMA_VERSION, validateBlock } from './blocks'
import { plainTextToRichText } from './blocks/plain-text'
import { isRichTextPayload, richTextToPlainText } from './blocks/rich-text-data'
import type { DataClient } from './data-client'
import { recordDestination, sheetPath } from './navigation'
import { fetchRecordById } from './scientific-records'
import { toBlock } from './notebook-data'
import type { BlockWire } from './notebook-data'
import { sheetInstanceFromWire } from './sheet-instance-data'
import { sheetInstanceStateSchema } from './sheet-instance'
import { PROPOSAL_TOOLS, isProposalTool } from './assistant-proposals'
import type {
  AssistantProposal,
  ProposalChange,
  ProposalToolName,
} from './assistant-proposals'
import {
  getPipelineDefinition,
  listPipelineDefinitionVersions,
} from './pipelines/data'
import {
  PIPELINE_CONFIG_VERSION,
  validatePipelineConfig,
} from './pipelines/config'
import type {
  PipelineConfig as StoredVersionConfig,
  PipelineInput,
  PipelineParameter,
} from './pipelines/config'
import { configFromView, configView } from './pipelines/config-view'
import type {
  PipelineConfigView as PipelineConfig,
  PipelineViewStep as PipelineStep,
} from './pipelines/config-view'
import { pipelineJsonValueSchema } from './pipelines/types'

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

/** A custom-field or cell value, shown as text; the stored value is arbitrary JSON. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored custom-field or sheet-cell value is arbitrary JSONB; this is the decoder that turns it into one line of card text.
function show(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null

  const text = z.string().safeParse(value)

  return clip(text.success ? text.data : JSON.stringify(value))
}

async function fetchBlock(client: DataClient, blockId: string) {
  const rows = await client.list<BlockWire>(
    'blocks',
    `?id=eq.${encodeURIComponent(blockId)}`,
  )

  return rows.at(0) ? toBlock(rows[0]) : null
}

type PipelineArgs = Partial<
  Pick<
    z.infer<
      (typeof PROPOSAL_TOOLS)['sheetbase.pipeline_definition.draft']['schema']
    >,
    'description' | 'statement' | 'steps' | 'inputs' | 'parameters'
  >
>

/**
 * A configuration read back from storage. Older drafts can lack the empty
 * lists the current contract asks for, so they stay optional here.
 */
type StoredPipelineConfig = Omit<StoredVersionConfig, 'parameters' | 'inputs'> &
  Partial<Pick<StoredVersionConfig, 'parameters' | 'inputs'>>

/**
 * A stored version's configuration as the draft editor reads it.
 *
 * A version is only created from a configuration the app validated with
 * `validatePipelineConfig`, and this module refuses to propose an invalid one,
 * so the stored document is the configuration it was written from.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A version's configuration is a JSONB document read straight from the API; this is the decoder that turns it into the draft contract.
function storedPipelineConfig(configuration: unknown): PipelineConfig {
  // SAFETY: pipeline_definition_versions.configuration is written only from a configuration validatePipelineConfig accepted.
  const stored = configuration as StoredPipelineConfig

  return configView({
    ...stored,
    parameters: stored.parameters ?? [],
    inputs: stored.inputs ?? [],
  })
}

function blankPipelineConfig(): PipelineConfig {
  return {
    configVersion: PIPELINE_CONFIG_VERSION,
    mode: 'standard',
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
  const next: PipelineConfig = { ...base }

  if (args.description !== undefined) next.description = args.description

  if (args.inputs) {
    next.inputs = args.inputs.map((input): PipelineInput => {
      const entry: PipelineInput = {
        name: input.name,
        required: input.required ?? true,
      }

      if (input.description) entry.description = input.description

      return entry
    })
  }

  if (args.parameters) {
    next.parameters = args.parameters.map((parameter): PipelineParameter => {
      const required = parameter.required ?? false

      const entry: PipelineParameter = {
        name: parameter.name,
        type: parameter.type,
        required,
      }

      if (parameter.default !== undefined && !required)
        entry.default = parameter.default

      if (parameter.description) entry.description = parameter.description

      return entry
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
  const errors = validatePipelineConfig(configFromView(config)).filter(
    // A draft may be incomplete about where its result goes; a person sets that.
    (error) => !error.field.startsWith('output'),
  )

  return errors.length > 0
    ? `That pipeline is not valid: ${errors
        .map((error) => `${error.field} ${error.message}`)
        .join('; ')}`
    : null
}

/** The arguments of one proposal tool, as its own schema describes them. */
type ProposalArguments<T extends ProposalToolName> = z.infer<
  (typeof PROPOSAL_TOOLS)[T]['schema']
>

/**
 * The arguments of the tool the caller named, typed by that tool's own schema.
 *
 * The object that arrived comes back, not the schema's clone: a scientific key
 * that is an own `__proto__` property would not survive the clone, and the
 * parse in `buildAssistantProposal` already accepted every key.
 */
function toolArguments<T extends ProposalToolName>(
  _name: T,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The raw arguments of a model tool call; the caller parsed them against this tool's own schema before dispatching.
  args: unknown,
): ProposalArguments<T> {
  // SAFETY: buildAssistantProposal parsed these arguments against this tool's schema before dispatching here.
  return args as ProposalArguments<T>
}

export async function buildAssistantProposal(
  client: DataClient,
  workspaceId: string,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Model tool calls arrive raw from the provider and are decoded by the tool's own schema below, before anything reads a field.
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

  // The model-facing defaults use z.json(); validate their original values too,
  // because its record clone can omit a scientific key named __proto__.
  if (
    (name === 'sheetbase.pipeline_definition.draft' ||
      name === 'sheetbase.pipeline_definition.update_draft') &&
    !z
      .object({
        parameters: z
          .array(z.object({ default: pipelineJsonValueSchema.optional() }))
          .optional(),
      })
      .safeParse(args).success
  ) {
    return {
      ok: false,
      message:
        'The proposal was not valid: parameter defaults must contain only finite JSON values.',
    }
  }

  // Keep the raw arguments: the schema clone can discard own __proto__
  // scientific keys, and every branch below reads through its own schema.
  const { title, summary } = toolArguments(name, args)

  switch (name) {
    case 'sheetbase.notebook_block.insert': {
      const input = toolArguments(name, args)
      const recordId = input.recordId
      const record = await fetchRecordById(client, recordId)

      if (!record) return { ok: false, message: 'That record was not found.' }
      const payload = plainTextToRichText(input.text)

      if (!validateBlock({ type: 'rich_text', payload }).ok) {
        return { ok: false, message: 'That text could not be made a block.' }
      }

      const afterBlockId = input.afterBlockId ?? null

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
      const input = toolArguments(name, args)
      const block = await fetchBlock(client, input.blockId)

      if (!block) return { ok: false, message: 'That block was not found.' }

      if (block.type !== 'rich_text' || !isRichTextPayload(block.payload)) {
        return {
          ok: false,
          message: 'Only text blocks can be changed this way.',
        }
      }

      const record = await fetchRecordById(client, block.recordId)
      const payload = plainTextToRichText(input.text)

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
      const input = toolArguments(name, args)
      const record = await fetchRecordById(client, input.recordId)

      if (!record) return { ok: false, message: 'That record was not found.' }
      const values = input.values
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
      const input = toolArguments(name, args)

      const rows = await client.list<unknown>(
        'sheet_instances',
        `?id=eq.${encodeURIComponent(input.instanceId)}&limit=1`,
      )

      if (rows.length === 0) {
        return { ok: false, message: 'That sheet was not found.' }
      }

      const instance = sheetInstanceFromWire(rows[0])

      const patch = input.localValues

      const localValues = { ...instance.state.localValues }

      const fieldLabels = new Map(
        instance.state.localFields.map((field) => [field.fieldId, field.label]),
      )

      const changes: AssistantProposal['changes'] = []

      for (const [rowId, cells] of Object.entries(patch)) {
        // SAFETY: the merged state is parsed by sheetInstanceStateSchema below, before the cells are proposed.
        localValues[rowId] = {
          ...localValues[rowId],
          ...cells,
        } as (typeof localValues)[string]

        for (const [fieldId, value] of Object.entries(cells)) {
          const label = fieldLabels.get(fieldId) ?? fieldId

          changes.push({
            label: `${label} · ${rowId}`,
            before: show(instance.state.localValues[rowId]?.[fieldId]),
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
      const spec = toolArguments(name, args)

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
            configuration: configFromView(configuration),
          },
        },
      }
    }

    case 'sheetbase.pipeline_definition.update_draft': {
      const spec = toolArguments(name, args)
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

      const current = latest ? storedPipelineConfig(latest.configuration) : null

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
                configuration: configFromView(configuration),
              }
            : {
                kind: 'pipeline_definition.create_version',
                workspaceId,
                definitionId: definition.id,
                expectedDefinitionRevision: Number(definition.revision),
                configuration: configFromView(configuration),
              },
        },
      }
    }
  }
}
