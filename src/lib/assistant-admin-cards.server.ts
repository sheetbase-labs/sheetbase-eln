import type {
  ProposalChange,
  AssistantProposal,
} from '#/lib/assistant-proposals'
import type { DataClient } from '#/lib/data-client'
import { likeValue } from '#/lib/assistant-lab-tools.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'

import type { FeatureProposalOutcome } from '../features/define.server'

/** Lookups and the card builder shared by the people, project and settings cards. */

export const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

/**
 * Field names in card wording, as plain words: `requireChangeReason` and
 * `p_require_change_reason` both read "require change reason". The person never
 * sees an identifier, whatever the model wrote.
 */
export function plainWords(text: string): string {
  return text
    .replaceAll(/\b(?:p_)?[a-z]+(?:_[a-z0-9]+)+\b/g, (word) =>
      word.replace(/^p_/, '').replaceAll('_', ' '),
    )
    .replaceAll(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, (word) =>
      word.replaceAll(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`),
    )
}

export function adminCard(
  input: { title: string; summary: string },
  rest: {
    tool: AssistantProposal['tool']
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: NonNullable<AssistantProposal['action']>
  },
): FeatureProposalOutcome {
  return {
    ok: true,
    proposal: {
      tool: rest.tool,
      title: plainWords(input.title),
      summary: plainWords(input.summary),
      target: rest.target,
      deepLink: rest.deepLink,
      changes: rest.changes,
      action: rest.action,
    },
  }
}

/** A yes/no as the card says it. */
export const onOff = (value: boolean | null | undefined): string | null =>
  value === null || value === undefined ? null : value ? 'On' : 'Off'

export interface MemberRow {
  user_id: string
  name: string
  role: string
}

/** A workspace member by name, or by their user id. */
export async function findMember(
  client: DataClient,
  text: string,
): Promise<Lookup<MemberRow>> {
  const members = await client.rpc<MemberRow[]>('workspace_members_list', {})
  const lower = text.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)

  const matches = members.filter((member) =>
    words.every((word) => member.name.toLowerCase().includes(word)),
  )

  return pick(
    matches,
    text,
    'member',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower || row.user_id === text.trim(),
  )
}

export interface GroupRow {
  id: string
  name: string
}

export async function findGroup(
  client: DataClient,
  text: string,
): Promise<Lookup<GroupRow>> {
  const rows = await client.list<GroupRow>(
    'workspace_groups',
    `?name=ilike.${likeValue(text)}&select=id,name&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'group',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

export interface ClientRow {
  id: string
  code: string
  name: string
  archived_at: string | null
}

/** A client by name or code; `archived` picks only archived or only live ones. */
export async function findClient(
  client: DataClient,
  text: string,
  archived: boolean,
): Promise<Lookup<ClientRow>> {
  const like = likeValue(text)

  const rows = await client.list<ClientRow>(
    'clients',
    `?archived_at=${archived ? 'not.is.null' : 'is.null'}&or=(name.ilike.${like},code.ilike.${like})&select=id,code,name,archived_at&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'client',
    (row) => `${row.name} (${row.code})`,
    (row) =>
      row.name.toLowerCase() === lower || row.code.toLowerCase() === lower,
  )
}
