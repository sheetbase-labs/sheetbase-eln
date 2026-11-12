import { z } from 'zod'

import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import { parse, pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import {
  CONNECTION_ADD_TOOL,
  CONNECTION_CHANGE_TOOL,
  CONNECTION_REMOVE_TOOL,
  PIPELINE_CONNECTION_PROPOSE_TOOL_NAMES,
  proposeConnectionAddSchema,
  proposeConnectionChangeSchema,
  proposeConnectionRemoveSchema,
} from './cards'
import type {
  ClusterSettings,
  PipelineConnectionAction,
  PipelineConnectionProposeToolName,
} from './cards'

/**
 * Cards for pipeline connections (see `cards.ts`). Each builder finds the
 * connection the model named under the person's own access and returns a card
 * that says exactly what changes. Nothing is written here.
 */
export type PipelineConnectionOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do. Secrets are never set here: they are typed into Settings.'

const PAGE = '/settings/workspace/integrations'

export function isPipelineConnectionProposalTool(
  name: string,
): name is PipelineConnectionProposeToolName {
  return PIPELINE_CONNECTION_PROPOSE_TOOL_NAMES.includes(name)
}

export function pipelineConnectionProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      CONNECTION_ADD_TOOL,
      `Propose approving an https address that pipeline web call steps may call. For owners, admins and stewards. ${NOTE}`,
      proposeConnectionAddSchema,
    ),
    toolDef(
      CONNECTION_CHANGE_TOOL,
      `Propose renaming a pipeline connection, moving it to another address, or switching it off or on. Switching it off stops every web call that uses it. ${NOTE}`,
      proposeConnectionChangeSchema,
    ),
    toolDef(
      CONNECTION_REMOVE_TOOL,
      `Propose removing a pipeline connection and its stored secrets. It is refused while a published pipeline still calls it. ${NOTE}`,
      proposeConnectionRemoveSchema,
    ),
  ]
}

const fail = (message: string): PipelineConnectionOutcome => ({
  ok: false,
  message,
})

interface ConnectionRow {
  id: string
  key: string
  name: string
  base_url: string
  status: string
  kind: 'web' | 'hpc'
  settings: unknown
}

const storedSettings = z.object({
  user: z.string().catch(''),
  queues: z
    .array(
      z.object({
        name: z.string(),
        maxMinutes: z.number().int().positive().optional(),
      }),
    )
    .catch([]),
  callbackUrl: z.string().optional(),
})

async function findConnection(
  client: DataClient,
  text: string,
): Promise<Lookup<ConnectionRow>> {
  const like = likeValue(text)

  const rows = await client.list<ConnectionRow>(
    'pipeline_connections',
    `?or=(name.ilike.${like},key.ilike.${like})&select=id,key,name,base_url,status,kind,settings&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'pipeline connection',
    (row) => `${row.name} (${row.key})`,
    (row) => row.name.toLowerCase() === lower || row.key === lower,
  )
}

function card(
  tool: PipelineConnectionProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    changes: ProposalChange[]
    action: PipelineConnectionAction
  },
): PipelineConnectionOutcome {
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      deepLink: PAGE,
      ...rest,
    },
  }
}

const STATUS_WORDS = { active: 'On', off: 'Off' } as const

export async function buildPipelineConnectionProposal(
  name: PipelineConnectionProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it or accessing data.
  args: unknown,
  context: LabToolContext,
): Promise<PipelineConnectionOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case CONNECTION_ADD_TOOL: {
      const parsed = parse(proposeConnectionAddSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data

      const hpc = input.kind === 'hpc'

      const addressOk = hpc
        ? /^https?:\/\/[^\s/@?#]+(\/[^\s?#]*)?$/.test(input.baseUrl)
        : /^https:\/\/[^\s/@?#]+(\/[^\s?#]*)?$/.test(input.baseUrl)

      if (!addressOk) {
        return fail(
          'A connection address is an https address with no password, query or fragment.',
        )
      }

      if (hpc && (!input.user || !input.queues))
        return fail(
          'A cluster connection needs the user and the queues it offers.',
        )

      const settings: ClusterSettings | null =
        hpc && input.user && input.queues
          ? {
              scheduler: 'slurm',
              user: input.user,
              queues: input.queues,
              callbackUrl: input.callbackUrl,
            }
          : null

      return card(name, input, {
        target: input.name,
        changes: [
          { label: 'Name', before: null, after: input.name },
          { label: 'Key', before: null, after: input.key },
          {
            label: 'Type',
            before: null,
            after: hpc ? 'HPC cluster' : 'Web call',
          },
          { label: 'Address', before: null, after: input.baseUrl },
          ...(settings
            ? [
                { label: 'User', before: null, after: settings.user },
                {
                  label: 'Queues',
                  before: null,
                  after: settings.queues.map((q) => q.name).join(', '),
                },
              ]
            : []),
        ],
        action: {
          kind: 'pipeline_connection.add',
          workspaceId,
          key: input.key,
          name: input.name.trim(),
          baseUrl: input.baseUrl,
          description: input.description?.trim() || null,
          connectionKind: hpc ? 'hpc' : 'web',
          settings,
        },
      })
    }

    case CONNECTION_CHANGE_TOOL: {
      const parsed = parse(proposeConnectionChangeSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findConnection(client, input.connection)

      if (!found.ok) return fail(found.message)
      const row = found.value
      const changes: ProposalChange[] = []

      if (input.name && input.name !== row.name)
        changes.push({ label: 'Name', before: row.name, after: input.name })

      if (input.baseUrl && input.baseUrl !== row.base_url)
        changes.push({
          label: 'Address',
          before: row.base_url,
          after: input.baseUrl,
        })

      const stored = storedSettings.safeParse(row.settings)

      const settings: ClusterSettings | null =
        row.kind === 'hpc' &&
        stored.success &&
        (input.user || input.queues || input.callbackUrl)
          ? {
              scheduler: 'slurm',
              user: input.user ?? stored.data.user,
              queues: input.queues ?? stored.data.queues,
              callbackUrl: input.callbackUrl ?? stored.data.callbackUrl,
            }
          : null

      if (settings && input.user && input.user !== stored.data?.user)
        changes.push({
          label: 'User',
          before: stored.data?.user ?? null,
          after: input.user,
        })

      if (settings && input.queues)
        changes.push({
          label: 'Queues',
          before: stored.data?.queues.map((q) => q.name).join(', ') ?? null,
          after: input.queues.map((q) => q.name).join(', '),
        })

      if (settings && input.callbackUrl)
        changes.push({
          label: 'Callback address',
          before: stored.data?.callbackUrl ?? null,
          after: input.callbackUrl,
        })

      if (input.status && input.status !== row.status)
        changes.push({
          label: 'Status',
          before: STATUS_WORDS[row.status === 'off' ? 'off' : 'active'],
          after: STATUS_WORDS[input.status],
        })

      if (changes.length === 0)
        return fail('That connection is already set that way.')

      return card(name, input, {
        target: row.name,
        changes,
        action: {
          kind: 'pipeline_connection.change',
          workspaceId,
          connectionId: row.id,
          name: input.name?.trim() || null,
          baseUrl: input.baseUrl ?? null,
          status: input.status ?? null,
          settings,
        },
      })
    }

    case CONNECTION_REMOVE_TOOL: {
      const parsed = parse(proposeConnectionRemoveSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findConnection(client, input.connection)

      if (!found.ok) return fail(found.message)
      const row = found.value

      return card(name, input, {
        target: row.name,
        changes: [
          {
            label: 'Connection',
            before: `${row.name} (${row.base_url})`,
            after: 'Removed',
          },
          { label: 'Secrets', before: 'Stored', after: 'Deleted' },
        ],
        action: {
          kind: 'pipeline_connection.remove',
          workspaceId,
          connectionId: row.id,
        },
      })
    }
  }
}

export type { LabToolContext }
