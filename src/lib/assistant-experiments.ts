import { z } from 'zod'

/**
 * Experiments, record aliases and label templates from the
 * assistant, as cards. The model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button, which calls the ordinary RPC as them.
 */

export const EXPERIMENT_START_TOOL = 'sheetbase.experiment.start'
export const EXPERIMENT_STATUS_TOOL = 'sheetbase.experiment.set_status'
export const EXPERIMENT_OUTCOME_TOOL = 'sheetbase.experiment.set_outcome'
export const EXPERIMENT_DELETE_DRAFT_TOOL = 'sheetbase.experiment.delete_draft'
export const ALIAS_ADD_TOOL = 'sheetbase.record.add_alias'
export const ALIAS_REMOVE_TOOL = 'sheetbase.record.remove_alias'
export const LABEL_TEMPLATE_ARCHIVE_TOOL = 'sheetbase.label_template.archive'

export const EXPERIMENT_PROPOSE_TOOL_NAMES = [
  EXPERIMENT_START_TOOL,
  EXPERIMENT_STATUS_TOOL,
  EXPERIMENT_OUTCOME_TOOL,
  EXPERIMENT_DELETE_DRAFT_TOOL,
  ALIAS_ADD_TOOL,
  ALIAS_REMOVE_TOOL,
  LABEL_TEMPLATE_ARCHIVE_TOOL,
] as const

export type ExperimentProposeToolName =
  (typeof EXPERIMENT_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const named = (what: string) => z.string().min(1).max(200).describe(what)
const experiment = named('The experiment, by its id (EXP-12) or title.')
const reason = z.string().min(1).max(500).describe('Why, in a sentence.')

export const EXPERIMENT_STATUSES = [
  'on_hold',
  'in_progress',
  'completed',
] as const
export const EXPERIMENT_OUTCOMES = [
  'supported',
  'refuted',
  'inconclusive',
] as const

export const proposeExperimentStartSchema = z
  .object({ title, summary, experiment, reason: reason.optional() })
  .strict()

export const proposeExperimentStatusSchema = z
  .object({
    title,
    summary,
    experiment,
    status: z
      .enum(EXPERIMENT_STATUSES)
      .describe(
        'on_hold pauses it, in_progress resumes it, completed ends it.',
      ),
    reason,
  })
  .strict()

export const proposeExperimentOutcomeSchema = z
  .object({
    title,
    summary,
    experiment,
    outcome: z
      .enum(EXPERIMENT_OUTCOMES)
      .describe('What the experiment showed against its hypothesis.'),
    notes: z.string().min(1).max(2000).optional().describe('Why, briefly.'),
  })
  .strict()

export const proposeExperimentDeleteDraftSchema = z
  .object({ title, summary, experiment })
  .strict()

const aliasFields = {
  title,
  summary,
  record: named('The record, by its id (SMP-12) or title.'),
  alias: z
    .string()
    .min(1)
    .max(200)
    .describe('The other name, such as a supplier code.'),
}

export const proposeAliasAddSchema = z.object(aliasFields).strict()
export const proposeAliasRemoveSchema = z.object(aliasFields).strict()

export const proposeLabelTemplateArchiveSchema = z
  .object({
    title,
    summary,
    template: named('The label template, by its name.'),
    archived: z
      .boolean()
      .describe('true to stop offering it, false to bring it back.'),
  })
  .strict()

export type ExperimentAction =
  | {
      kind: 'experiments.start'
      recordId: string
      reason: string | null
    }
  | {
      kind: 'experiments.status'
      recordId: string
      status: (typeof EXPERIMENT_STATUSES)[number]
      reason: string
    }
  | {
      kind: 'experiments.outcome'
      recordId: string
      outcome: (typeof EXPERIMENT_OUTCOMES)[number]
      notes: string | null
    }
  | { kind: 'experiments.delete_draft'; recordId: string }
  | { kind: 'experiments.alias_add'; recordId: string; alias: string }
  | { kind: 'experiments.alias_remove'; recordId: string; alias: string }
  | { kind: 'experiments.label_archive'; templateId: string; archived: boolean }

const KINDS: ReadonlySet<string> = new Set([
  'experiments.start',
  'experiments.status',
  'experiments.outcome',
  'experiments.delete_draft',
  'experiments.alias_add',
  'experiments.alias_remove',
  'experiments.label_archive',
])

export function isExperimentAction(action: {
  kind: string
}): action is ExperimentAction {
  return KINDS.has(action.kind)
}
