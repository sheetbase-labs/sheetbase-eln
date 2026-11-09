import type { z } from 'zod'

import {
  ALIAS_ADD_TOOL,
  ALIAS_REMOVE_TOOL,
  EXPERIMENT_DELETE_DRAFT_TOOL,
  EXPERIMENT_OUTCOME_TOOL,
  EXPERIMENT_PROPOSE_TOOL_NAMES,
  EXPERIMENT_START_TOOL,
  EXPERIMENT_STATUS_TOOL,
  LABEL_TEMPLATE_ARCHIVE_TOOL,
  proposeAliasAddSchema,
  proposeAliasRemoveSchema,
  proposeExperimentDeleteDraftSchema,
  proposeExperimentOutcomeSchema,
  proposeExperimentStartSchema,
  proposeExperimentStatusSchema,
  proposeLabelTemplateArchiveSchema,
} from './assistant-experiments'
import type {
  ExperimentAction,
  ExperimentProposeToolName,
} from './assistant-experiments'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProviderToolDef } from './ai-providers/types'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'
import { recordPath } from './navigation'

/**
 * Experiments, record aliases and label templates from the
 * assistant (see `assistant-experiments.ts`). Each builder finds what the
 * person named under their own access and returns a card saying exactly what
 * will change. Nothing is written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export type ExperimentOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

type Lookup<T> = { ok: true; value: T } | { ok: false; message: string }

export const isExperimentProposalTool = (
  name: string,
): name is ExperimentProposeToolName =>
  (EXPERIMENT_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)

export function experimentProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      EXPERIMENT_START_TOOL,
      `Propose starting a planned experiment. ${NOTE}`,
      proposeExperimentStartSchema,
    ),
    toolDef(
      EXPERIMENT_STATUS_TOOL,
      `Propose putting an experiment on hold, resuming it or finishing it, with a reason. ${NOTE}`,
      proposeExperimentStatusSchema,
    ),
    toolDef(
      EXPERIMENT_OUTCOME_TOOL,
      `Propose recording what an experiment showed against its hypothesis: supported, refuted or inconclusive. Only when the person has said what it showed. ${NOTE}`,
      proposeExperimentOutcomeSchema,
    ),
    toolDef(
      EXPERIMENT_DELETE_DRAFT_TOOL,
      `Propose deleting a draft experiment that was never submitted. Only its author or an admin can. ${NOTE}`,
      proposeExperimentDeleteDraftSchema,
    ),
    toolDef(
      ALIAS_ADD_TOOL,
      `Propose giving a record another name it can be found by, such as a supplier code or an old id. ${NOTE}`,
      proposeAliasAddSchema,
    ),
    toolDef(
      ALIAS_REMOVE_TOOL,
      `Propose taking one of a record's other names off it. ${NOTE}`,
      proposeAliasRemoveSchema,
    ),
    toolDef(
      LABEL_TEMPLATE_ARCHIVE_TOOL,
      `Propose archiving a label template so it is no longer offered when printing, or bringing one back. ${NOTE}`,
      proposeLabelTemplateArchiveSchema,
    ),
  ]
}

// ---------------------------------------------------------------------------
// Lookups, as the person.
// ---------------------------------------------------------------------------

interface RecordRow {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  created_by_user_id: string | null
}

function pick<T>(
  rows: readonly T[],
  wanted: string,
  what: string,
  label: (row: T) => string,
  exact: (row: T) => boolean,
): Lookup<T> {
  const exacts = rows.filter(exact)

  if (exacts.length === 1) return { ok: true, value: exacts[0] }

  if (rows.length === 1) return { ok: true, value: rows[0] }

  if (rows.length === 0)
    return { ok: false, message: `No ${what} matches "${wanted}".` }

  return {
    ok: false,
    message: `More than one ${what} matches "${wanted}": ${rows
      .slice(0, 8)
      .map(label)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

async function findRecord(
  client: DataClient,
  text: string,
  kind?: string,
): Promise<Lookup<RecordRow>> {
  const like = likeValue(text)

  const rows = await client.list<RecordRow>(
    'records',
    `?deleted_at=is.null${kind ? `&kind=eq.${kind}` : ''}&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,kind,status,created_by_user_id&order=updated_at.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    kind ?? 'record',
    (row) => `${row.identifier} ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

// ---------------------------------------------------------------------------
// Cards.
// ---------------------------------------------------------------------------

const fail = (message: string): ExperimentOutcome => ({ ok: false, message })

function card(
  tool: ExperimentProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: ExperimentAction
  },
): ExperimentOutcome {
  return {
    ok: true,
    proposal: { tool, title: input.title, summary: input.summary, ...rest },
  }
}

const STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
}

const statusWord = (status: string) => STATUS_WORDS[status] ?? status

const OUTCOME_WORDS: Record<string, string> = {
  supported: 'Supported',
  refuted: 'Refuted',
  inconclusive: 'Inconclusive',
}

const experimentLink = (id: string) => `/experiments/${id}/summary`
const label = (row: RecordRow) => `${row.identifier} · ${row.title}`

function parse<T extends z.ZodType>(
  schema: T,
  args: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; message: string } {
  const parsed = schema.safeParse(args)

  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, message: invalid(parsed.error) }
}

export async function buildExperimentProposal(
  name: ExperimentProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<ExperimentOutcome> {
  const client = context.client

  switch (name) {
    case EXPERIMENT_START_TOOL: {
      const input = parse(proposeExperimentStartSchema, args)

      if (!input.ok) return fail(input.message)

      const found = await findRecord(
        client,
        input.data.experiment,
        'experiment',
      )

      if (!found.ok) return fail(found.message)
      const row = found.value

      if (row.status !== 'draft')
        return fail(`${row.identifier} is already ${statusWord(row.status)}.`)

      return card(name, input.data, {
        target: label(row),
        deepLink: experimentLink(row.id),
        changes: [
          {
            label: 'Status',
            before: statusWord(row.status),
            after: 'In progress',
          },
        ],
        action: {
          kind: 'experiments.start',
          recordId: row.id,
          reason: input.data.reason ?? null,
        },
      })
    }

    case EXPERIMENT_STATUS_TOOL: {
      const input = parse(proposeExperimentStatusSchema, args)

      if (!input.ok) return fail(input.message)

      const found = await findRecord(
        client,
        input.data.experiment,
        'experiment',
      )

      if (!found.ok) return fail(found.message)
      const row = found.value

      if (row.status === input.data.status)
        return fail(`${row.identifier} is already ${statusWord(row.status)}.`)

      return card(name, input.data, {
        target: label(row),
        deepLink: experimentLink(row.id),
        changes: [
          {
            label: 'Status',
            before: statusWord(row.status),
            after: statusWord(input.data.status),
          },
          { label: 'Reason', before: null, after: input.data.reason },
        ],
        action: {
          kind: 'experiments.status',
          recordId: row.id,
          status: input.data.status,
          reason: input.data.reason,
        },
      })
    }

    case EXPERIMENT_OUTCOME_TOOL: {
      const input = parse(proposeExperimentOutcomeSchema, args)

      if (!input.ok) return fail(input.message)

      const found = await findRecord(
        client,
        input.data.experiment,
        'experiment',
      )

      if (!found.ok) return fail(found.message)
      const row = found.value

      return card(name, input.data, {
        target: label(row),
        deepLink: experimentLink(row.id),
        changes: [
          {
            label: 'Outcome',
            before: null,
            after: OUTCOME_WORDS[input.data.outcome] ?? input.data.outcome,
          },
          ...(input.data.notes
            ? [{ label: 'Notes', before: null, after: input.data.notes }]
            : []),
        ],
        action: {
          kind: 'experiments.outcome',
          recordId: row.id,
          outcome: input.data.outcome,
          notes: input.data.notes ?? null,
        },
      })
    }

    case EXPERIMENT_DELETE_DRAFT_TOOL: {
      const input = parse(proposeExperimentDeleteDraftSchema, args)

      if (!input.ok) return fail(input.message)

      const found = await findRecord(
        client,
        input.data.experiment,
        'experiment',
      )

      if (!found.ok) return fail(found.message)
      const row = found.value

      if (row.status !== 'draft')
        return fail(
          `${row.identifier} is ${statusWord(row.status)}, and only a draft can be deleted.`,
        )

      return card(name, input.data, {
        target: label(row),
        deepLink: experimentLink(row.id),
        changes: [
          { label: 'Experiment', before: label(row), after: 'Deleted' },
        ],
        action: { kind: 'experiments.delete_draft', recordId: row.id },
      })
    }

    case ALIAS_ADD_TOOL:
    case ALIAS_REMOVE_TOOL: {
      const adding = name === ALIAS_ADD_TOOL

      const input = parse(
        adding ? proposeAliasAddSchema : proposeAliasRemoveSchema,
        args,
      )

      if (!input.ok) return fail(input.message)
      const found = await findRecord(client, input.data.record)

      if (!found.ok) return fail(found.message)
      const row = found.value
      const alias = input.data.alias.trim()

      const existing = await client.list<{ alias: string }>(
        'record_aliases',
        `?record_id=eq.${row.id}&select=alias`,
      )

      const has = existing.some(
        (a) => a.alias.toLowerCase() === alias.toLowerCase(),
      )

      if (adding && has)
        return fail(`${row.identifier} is already known as ${alias}.`)

      if (!adding && !has)
        return fail(`${row.identifier} has no other name ${alias}.`)

      return card(name, input.data, {
        target: label(row),
        deepLink: recordPath(row.id),
        changes: [
          {
            label: 'Also known as',
            before: adding ? null : alias,
            after: adding ? alias : 'Removed',
          },
        ],
        action: {
          kind: adding ? 'experiments.alias_add' : 'experiments.alias_remove',
          recordId: row.id,
          alias,
        },
      })
    }

    case LABEL_TEMPLATE_ARCHIVE_TOOL: {
      const input = parse(proposeLabelTemplateArchiveSchema, args)

      if (!input.ok) return fail(input.message)
      const like = likeValue(input.data.template)

      const rows = await client.list<{
        id: string
        name: string
        archived_at: string | null
      }>(
        'label_templates',
        `?name=ilike.${like}&select=id,name,archived_at&order=name.asc&limit=6`,
      )

      const lower = input.data.template.trim().toLowerCase()

      const found = pick(
        rows,
        input.data.template,
        'label template',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)
      const row = found.value
      const archived = row.archived_at !== null

      if (archived === input.data.archived)
        return fail(
          `${row.name} is already ${archived ? 'archived' : 'offered'}.`,
        )

      return card(name, input.data, {
        target: row.name,
        deepLink: '/settings/lab/storage',
        changes: [
          {
            label: 'Offered when printing',
            before: archived ? 'No' : 'Yes',
            after: input.data.archived ? 'No' : 'Yes',
          },
        ],
        action: {
          kind: 'experiments.label_archive',
          templateId: row.id,
          archived: input.data.archived,
        },
      })
    }
  }
}
