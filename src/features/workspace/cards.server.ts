import { z } from 'zod'

import {
  JOIN_DOMAINS_TOOL,
  REGULATED_LAB_TOOL,
  RESOLVE_CONFLICT_TOOL,
  STARTER_TABLES_TOOL,
  STARTER_TABLE_KEYS,
  STUDY_ASSIGN_TOOL,
  WORKSPACE_PROPOSE_TOOL_NAMES,
  proposeJoinDomainsSchema,
  proposeRegulatedLabSchema,
  proposeResolveConflictSchema,
  proposeStarterTablesSchema,
  proposeStudyAssignSchema,
} from './cards'
import type { WorkspaceAction, WorkspaceProposeToolName } from './cards'
import { likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { parse, pick } from '#/lib/assistant-upkeep.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

/**
 * Workspace cards (see `assistant.ts`). Each builder finds what the model
 * named under the signed-in person's own access and returns a card that says
 * exactly what will change. Nothing is written here; the button calls the
 * ordinary RPC, which checks the person's admin or settings access again.
 */

export type WorkspaceOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isWorkspaceProposalTool(
  name: string,
): name is WorkspaceProposeToolName {
  return WORKSPACE_PROPOSE_TOOL_NAMES.includes(name)
}

export function workspaceProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      STARTER_TABLES_TOOL,
      `Propose adding starter measurement tables (plate reader, qPCR, chromatography, cell counts, general) the workspace does not have yet. They are ordinary tables people can change. For people who edit tables. ${NOTE}`,
      proposeStarterTablesSchema,
    ),
    toolDef(
      JOIN_DOMAINS_TOOL,
      `Propose the whole list of email domains whose people can join the workspace themselves, and the role they join as. Read the join_domains area first; an empty list turns it off. Only the person's own verified email domain can be added. For people who manage members. ${NOTE}`,
      proposeJoinDomainsSchema,
    ),
    toolDef(
      REGULATED_LAB_TOOL,
      `Propose turning the regulated-lab rules on or off (such as approving parsers before regulated data uses them). For people who manage General settings. ${NOTE}`,
      proposeRegulatedLabSchema,
    ),
    toolDef(
      RESOLVE_CONFLICT_TOOL,
      `Propose settling a sheet cell that changed in two places while one was offline: keep one side or another value, with a reason. Read the cell_conflicts area first for the conflict id. ${NOTE}`,
      proposeResolveConflictSchema,
    ),
    toolDef(
      STUDY_ASSIGN_TOOL,
      `Propose filing a planner workstream (with its tasks that have no study) or a single task under a study. ${NOTE}`,
      proposeStudyAssignSchema,
    ),
  ]
}

const fail = (message: string): WorkspaceOutcome => ({ ok: false, message })

function card(
  tool: WorkspaceProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: WorkspaceAction
  },
): WorkspaceOutcome {
  return {
    ok: true,
    proposal: { tool, title: input.title, summary: input.summary, ...rest },
  }
}

const show = (value: z.core.util.JSONType | undefined): string => {
  if (value === null || value === undefined) return 'Empty'

  const text = z.string().safeParse(value)

  return text.success ? text.data : JSON.stringify(value)
}

const TABLE_LABELS: Record<(typeof STARTER_TABLE_KEYS)[number], string> = {
  plate_reader: 'Plate reader',
  qpcr: 'qPCR',
  chromatography: 'Chromatography',
  cell_counts: 'Cell counts',
  general: 'General',
}

export async function buildWorkspaceProposal(
  name: WorkspaceProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it or accessing data.
  args: unknown,
  context: LabToolContext,
): Promise<WorkspaceOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case STARTER_TABLES_TOOL: {
      const parsed = parse(proposeStarterTablesSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const keys = input.tables ?? [...STARTER_TABLE_KEYS]

      return card(name, input, {
        target: 'Starter tables',
        deepLink: '/models',
        changes: [
          {
            label: 'Add',
            before: null,
            after: keys.map((key) => TABLE_LABELS[key]).join(', '),
          },
        ],
        action: {
          kind: 'workspace.starter_tables',
          workspaceId,
          keys: input.tables ? [...input.tables] : null,
        },
      })
    }

    case JOIN_DOMAINS_TOOL: {
      const parsed = parse(proposeJoinDomainsSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data

      const domains = [
        ...new Set(input.domains.map((d) => d.trim().toLowerCase())),
      ].filter(Boolean)

      const current = await client.list<{ domain: string; role: string }>(
        'workspace_join_domains',
        '?select=domain,role&order=domain.asc',
      )

      const role = input.role ?? 'scientist'

      return card(name, input, {
        target: 'Joining by email domain',
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: 'Domains',
            before: current.length
              ? current.map((row) => row.domain).join(', ')
              : 'None',
            after: domains.length ? domains.join(', ') : 'None',
          },
          {
            label: 'Join as',
            before: current[0]?.role ?? null,
            after: role,
          },
        ],
        action: { kind: 'workspace.join_domains', workspaceId, domains, role },
      })
    }

    case REGULATED_LAB_TOOL: {
      const parsed = parse(proposeRegulatedLabSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data

      const rows = await client.list<{ regulated_lab: boolean | null }>(
        'workspace_settings',
        '?select=regulated_lab&limit=1',
      )

      const before = rows[0]?.regulated_lab === true

      if (before === input.regulated)
        return fail(
          `The regulated-lab rules are already ${before ? 'on' : 'off'}.`,
        )

      return card(name, input, {
        target: 'Regulated-lab rules',
        deepLink: '/settings/workspace',
        changes: [
          {
            label: 'Regulated lab',
            before: before ? 'On' : 'Off',
            after: input.regulated ? 'On' : 'Off',
          },
        ],
        action: {
          kind: 'workspace.regulated_lab',
          workspaceId,
          regulated: input.regulated,
        },
      })
    }

    case RESOLVE_CONFLICT_TOOL: {
      const parsed = parse(proposeResolveConflictSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data

      const rows = await client.list<{
        id: string
        sheet_instance_id: string
        row_key: string
        state: string
        local_value: z.core.util.JSONType
        remote_value: z.core.util.JSONType
      }>(
        'sheet_cell_conflicts',
        `?id=eq.${encodeURIComponent(input.conflict)}&select=id,sheet_instance_id,row_key,state,local_value,remote_value&limit=1`,
      )

      const conflict = rows.at(0)

      if (!conflict) return fail('No conflict has that id.')

      if (conflict.state !== 'open')
        return fail('That conflict is already settled.')

      if (input.keep === 'other' && input.value === undefined)
        return fail('Say which value to keep.')

      const value =
        input.keep === 'mine'
          ? conflict.local_value
          : input.keep === 'theirs'
            ? conflict.remote_value
            : input.value

      const sheets = await client.list<{ name: string }>(
        'sheet_instances',
        `?id=eq.${conflict.sheet_instance_id}&select=name&limit=1`,
      )

      return card(name, input, {
        target: `${sheets[0]?.name ?? 'Sheet'}, row ${conflict.row_key}`,
        deepLink: `/sheets/${conflict.sheet_instance_id}`,
        changes: [
          {
            label: 'Offline edit',
            before: null,
            after: show(conflict.local_value),
          },
          {
            label: 'Saved value',
            before: null,
            after: show(conflict.remote_value),
          },
          { label: 'Keep', before: null, after: show(value) },
          { label: 'Reason', before: null, after: input.reason },
        ],
        action: {
          kind: 'sheet.resolve_conflict',
          conflictId: conflict.id,
          value: value ?? null,
          reason: input.reason,
          sheetId: conflict.sheet_instance_id,
        },
      })
    }

    case STUDY_ASSIGN_TOOL: {
      const parsed = parse(proposeStudyAssignSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data

      if (Boolean(input.workstream) === Boolean(input.task))
        return fail('Name one workstream or one task, not both.')

      const studies = await client.list<{ record_id: string }>(
        'studies',
        '?select=record_id&limit=500',
      )

      const ids = studies.map((row) => row.record_id)

      if (ids.length === 0) return fail('There are no studies yet.')
      const like = likeValue(input.study)

      const records = await client.list<{
        id: string
        identifier: string
        title: string
      }>(
        'records',
        `?id=in.(${ids.join(',')})&deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&limit=6`,
      )

      const lower = input.study.trim().toLowerCase()

      const study = pick(
        records,
        input.study,
        'study',
        (row) => `${row.identifier} ${row.title}`,
        (row) =>
          row.identifier.toLowerCase() === lower ||
          row.title.toLowerCase() === lower,
      )

      if (!study.ok) return fail(study.message)
      const studyLabel = `${study.value.identifier} ${study.value.title}`

      if (input.workstream) {
        const wanted = input.workstream

        const rows = await client.list<{ id: string; name: string }>(
          'study_workstreams',
          `?name=ilike.${likeValue(wanted)}&select=id,name&limit=6`,
        )

        const found = pick(
          rows,
          wanted,
          'workstream',
          (row) => row.name,
          (row) => row.name.toLowerCase() === wanted.trim().toLowerCase(),
        )

        if (!found.ok) return fail(found.message)

        return card(name, input, {
          target: found.value.name,
          deepLink: `/records/${study.value.id}`,
          changes: [{ label: 'Study', before: null, after: studyLabel }],
          action: {
            kind: 'study.assign_item',
            studyRecordId: study.value.id,
            workstreamId: found.value.id,
            taskId: null,
          },
        })
      }

      const wanted = input.task ?? ''

      const rows = await client.list<{ id: string; title: string }>(
        'study_tasks',
        `?title=ilike.${likeValue(wanted)}&select=id,title&limit=6`,
      )

      const found = pick(
        rows,
        wanted,
        'task',
        (row) => row.title,
        (row) => row.title.toLowerCase() === wanted.trim().toLowerCase(),
      )

      if (!found.ok) return fail(found.message)

      return card(name, input, {
        target: found.value.title,
        deepLink: `/records/${study.value.id}`,
        changes: [{ label: 'Study', before: null, after: studyLabel }],
        action: {
          kind: 'study.assign_item',
          studyRecordId: study.value.id,
          workstreamId: null,
          taskId: found.value.id,
        },
      })
    }
  }
}
