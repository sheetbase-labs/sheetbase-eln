import { z } from 'zod'

import { toWireToolName } from './agent-tool-catalogue'
import type { AgentOperation } from './agent-operations'
import type { AssistantAction } from './assistant-booking'
import type { BenchProposeToolName } from './assistant-bench'
import type { PlanningProposeToolName } from './assistant-planning'
import type { LabworkProposeToolName } from './assistant-labwork'
import type { PlatesProposeToolName } from './assistant-plates'
import type { QcProposeToolName } from './assistant-qc'
import type { StudiesProposeToolName } from './assistant-studies'
import type { AutomationProposeToolName } from './assistant-automation'
import type { PlannerProposeToolName } from './assistant-planner'
import type { UpkeepProposeToolName } from './assistant-upkeep'
import {
  INPUT_NAME_RE,
  MAX_INPUTS,
  MAX_PARAMETERS,
  MAX_STATEMENT_LENGTH,
  PARAMETER_TYPES,
} from './pipelines/config'
import type { PipelineConfig } from './pipelines/config'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Changes the assistant can propose in the chat.
 *
 * The model never writes. It calls one of these tools with plain arguments;
 * the server checks them against the person's own data, fills in the version
 * the change was built against, and sends back a card. Nothing is written
 * until the person presses Apply, and then it goes through the same
 * propose, approve and execute path as every other agent change, so the
 * record's version check and audit trail still apply.
 */

const uuid = z.string().uuid()
const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const shared = { title, summary }

export const proposeNotebookInsertSchema = z
  .object({
    ...shared,
    recordId: uuid.describe('The notebook record to add the text block to.'),
    afterBlockId: uuid
      .nullish()
      .describe('Block to add it after; leave out to add at the end.'),
    text: z
      .string()
      .min(1)
      .max(8_000)
      .describe(
        'The text of the new block. Blank line between paragraphs; "- " for bullets; "## " for a heading.',
      ),
  })
  .strict()

export const proposeNotebookUpdateSchema = z
  .object({
    ...shared,
    blockId: uuid.describe('The text block to change.'),
    text: z
      .string()
      .min(1)
      .max(8_000)
      .describe('The whole new text of the block, replacing what is there.'),
  })
  .strict()

export const proposeFieldsUpdateSchema = z
  .object({
    ...shared,
    recordId: uuid,
    values: z
      .record(z.string().min(1).max(80), z.unknown())
      .refine((values) => Object.keys(values).length > 0, {
        message: 'Give at least one field.',
      })
      .describe('Field name to new value, only the fields to change.'),
  })
  .strict()

export const proposeSheetValuesSchema = z
  .object({
    ...shared,
    instanceId: uuid,
    localValues: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .refine((values) => Object.keys(values).length > 0, {
        message: 'Give at least one row.',
      })
      .describe(
        'Row id to { field id: new value }, only the cells to change. Ids come from reading the sheet.',
      ),
  })
  .strict()

const pipelineName = z
  .string()
  .regex(INPUT_NAME_RE)
  .refine((value) => value !== 'previous', {
    message: '"previous" is reserved.',
  })

const pipelineStatement = z
  .string()
  .min(1)
  .max(MAX_STATEMENT_LENGTH)
  .describe(
    'SQL. Name an input as a table; write a parameter as {{name}}; the step before is `previous`.',
  )

const pipelineSteps = z
  .array(
    z
      .object({
        name: pipelineName.describe(
          'Lowercase letters, digits and underscores, starting with a letter.',
        ),
        statement: pipelineStatement
          .optional()
          .describe('The SQL of the step. Leave out for a plugin step.'),
        plugin: z
          .object({
            operation: z
              .string()
              .regex(/^plugin\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
              .describe(
                'The plugin step to run, as `plugin.<plugin>.<step>` (a pipeline step an installed plugin offers).',
              ),
            arguments: z
              .record(z.string(), z.unknown())
              .describe(
                'What the plugin step is given. A table is `{ "$ref": "previous" }`, `{ "$ref": "inputs.<name>" }` or `{ "$ref": "steps.<step>" }`; a pipeline setting is `{ "$ref": "parameters.<name>" }`; anything else is a plain value.',
              ),
          })
          .strict()
          .optional()
          .describe(
            'Instead of SQL: a step a plugin runs between two other steps. It turns tables into a table, and the next step reads that table as `previous`.',
          ),
      })
      .strict()
      .refine(
        (step) =>
          (step.statement === undefined) !== (step.plugin === undefined),
        {
          message:
            'Give a step either SQL (`statement`) or a `plugin`, not both.',
        },
      ),
  )
  .max(9)
  .describe(
    'Further steps after the first, SQL or plugin. Each reads the step before as `previous`.',
  )

const pipelineInputs = z
  .array(
    z
      .object({
        name: pipelineName.describe('The table name the SQL uses.'),
        description: z.string().max(400).optional(),
        required: z.boolean().optional(),
      })
      .strict(),
  )
  .max(MAX_INPUTS)
  .describe('Dataset versions the pipeline reads, by the table name SQL uses.')

const pipelineParameters = z
  .array(
    z
      .object({
        name: pipelineName,
        type: z.enum(PARAMETER_TYPES),
        required: z.boolean().optional(),
        default: z.unknown().optional(),
        description: z.string().max(400).optional(),
      })
      .strict(),
  )
  .max(MAX_PARAMETERS)
  .describe('Values chosen when the pipeline is run.')

export const proposePipelineDraftSchema = z
  .object({
    ...shared,
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,59}$/)
      .describe('Short id: lowercase letters, digits, underscores.'),
    name: z.string().min(1).max(200).describe('The name people see.'),
    description: z.string().max(2000).optional(),
    inputs: pipelineInputs.optional(),
    parameters: pipelineParameters.optional(),
    statement: pipelineStatement,
    steps: pipelineSteps.optional(),
  })
  .strict()

export const proposePipelineStepsSchema = z
  .object({
    ...shared,
    pipelineId: uuid.describe(
      'The pipeline (definition) id. Its draft is edited; if it has none, a new draft is made from the latest published version.',
    ),
    statement: pipelineStatement.optional(),
    steps: pipelineSteps
      .optional()
      .describe(
        'The whole list of further steps, replacing the current ones; leave out to keep them.',
      ),
    inputs: pipelineInputs.optional(),
    parameters: pipelineParameters.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.statement !== undefined ||
      value.steps !== undefined ||
      value.inputs !== undefined ||
      value.parameters !== undefined,
    { message: 'Give something to change.' },
  )

export const PROPOSAL_TOOLS = {
  'sheetbase.notebook_block.insert': {
    schema: proposeNotebookInsertSchema,
    description:
      'Propose adding a text block to a notebook. The person sees a card with Apply and Dismiss; nothing changes until they apply.',
  },
  'sheetbase.notebook_block.update': {
    schema: proposeNotebookUpdateSchema,
    description:
      'Propose replacing the text of one notebook text block. The person sees a card with Apply and Dismiss; nothing changes until they apply.',
  },
  'sheetbase.record.custom_fields.update': {
    schema: proposeFieldsUpdateSchema,
    description:
      'Propose new values for fields on a record. The person sees a card with Apply and Dismiss; nothing changes until they apply.',
  },
  'sheetbase.sheet_instance.update': {
    schema: proposeSheetValuesSchema,
    description:
      'Propose new values for cells in a sheet’s own columns. The person sees a card with Apply and Dismiss; nothing changes until they apply.',
  },
  'sheetbase.pipeline_definition.draft': {
    schema: proposePipelineDraftSchema,
    description:
      'Propose a new pipeline with a first draft: its name, inputs, parameters and SQL steps. Never published; a person reviews and publishes it. The person sees a card with Apply and Dismiss; nothing changes until they apply.',
  },
  'sheetbase.pipeline_definition.update_draft': {
    schema: proposePipelineStepsSchema,
    description:
      'Propose changes to the steps, inputs or parameters of an existing pipeline’s draft. Read the current pipeline first (canonical read of pipeline_definitions and pipeline_definition_versions). Never published. The person sees a card with Apply and Dismiss; nothing changes until they apply.',
  },
} as const

export type ProposalToolName = keyof typeof PROPOSAL_TOOLS

export function isProposalTool(name: string): name is ProposalToolName {
  return Object.hasOwn(PROPOSAL_TOOLS, name)
}

/** Tool definitions for the model, named the way providers accept. */
export function proposalToolDefs(): ProviderToolDef[] {
  return (Object.keys(PROPOSAL_TOOLS) as ProposalToolName[]).map((name) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(
      PROPOSAL_TOOLS[name].schema,
      { io: 'input' },
    )
    return {
      name: toWireToolName(name),
      description: PROPOSAL_TOOLS[name].description,
      parameters,
    }
  })
}

/** One line of a card: what changes, from what, to what. */
export interface ProposalChange {
  label: string
  before: string | null
  after: string
}

/** What the card needs, and what Apply sends through the approval path. */
export interface AssistantProposal {
  /** The proposing tool: a change tool here, or a booking tool. */
  tool:
    | ProposalToolName
    | `sheetbase.booking.${'create' | 'move' | 'cancel'}`
    | BenchProposeToolName
    | PlanningProposeToolName
    | UpkeepProposeToolName
    | LabworkProposeToolName
    | PlatesProposeToolName
    | QcProposeToolName
    | StudiesProposeToolName
    | AutomationProposeToolName
    | PlannerProposeToolName
    | `plugin.${string}.${string}`
  title: string
  summary: string
  /** Where it goes, for the card: "EXP-12 · Notebook". */
  target: string
  deepLink: string | null
  changes: ProposalChange[]
  /** A change that goes through the propose, approve and execute path. */
  operation?: AgentOperation
  /**
   * Or an everyday action the person takes themselves, such as booking an
   * instrument: run as them through the ordinary RPC when they press the button.
   */
  action?: AssistantAction
  /**
   * A second step run right after the first, once the first has made
   * something it depends on: a new pipeline gets its first draft version.
   */
  followUp?: {
    kind: 'pipeline_definition.create_version'
    workspaceId: string
    configuration: PipelineConfig
  }
}

/** The output the chat server attaches to a finished proposal tool call. */
export function proposalFromOutput(output: unknown): AssistantProposal | null {
  if (output === null || typeof output !== 'object' || !('proposal' in output))
    return null
  const proposal = output.proposal
  if (proposal === null || typeof proposal !== 'object') return null
  return 'tool' in proposal &&
    ('operation' in proposal || 'action' in proposal) &&
    'changes' in proposal
    ? (proposal as AssistantProposal)
    : null
}
