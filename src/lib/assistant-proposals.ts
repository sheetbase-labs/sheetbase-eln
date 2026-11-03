import { z } from 'zod'

import { toWireToolName } from './agent-tool-catalogue'
import type { AgentOperation } from './agent-operations'
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
  tool: ProposalToolName
  title: string
  summary: string
  /** Where it goes, for the card: "EXP-12 · Notebook". */
  target: string
  deepLink: string | null
  changes: ProposalChange[]
  operation: AgentOperation
}

/** The output the chat server attaches to a finished proposal tool call. */
export function proposalFromOutput(output: unknown): AssistantProposal | null {
  if (output === null || typeof output !== 'object' || !('proposal' in output))
    return null
  const proposal = output.proposal
  if (proposal === null || typeof proposal !== 'object') return null
  return 'tool' in proposal && 'operation' in proposal && 'changes' in proposal
    ? (proposal as AssistantProposal)
    : null
}
