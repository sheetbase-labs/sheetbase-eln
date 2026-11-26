import type { FeatureProposalOutcome } from '#/features/define.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import { likeValue } from '#/lib/assistant-lab-tools.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

/**
 * Small helpers the card builders of the feature folders share: finding a
 * thing by the words a person uses (its name or its ID), and building the card.
 * Nothing here writes anything.
 */

export const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

export const same = (a: string | null | undefined, b: string): boolean =>
  a !== null &&
  a !== undefined &&
  a.trim().toLowerCase() === b.trim().toLowerCase()

/** A date the person gave, as noon UTC so it never slips a day. */
export const atNoon = (day: string): string => `${day}T12:00:00Z`

/** A card: what will change, and the action the button runs. */
export function card(
  tool: AssistantProposal['tool'],
  input: { title: string; summary: string },
  target: string,
  deepLink: string | null,
  changes: ProposalChange[],
  action: NonNullable<AssistantProposal['action']>,
): FeatureProposalOutcome {
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      target,
      deepLink,
      changes,
      action,
    },
  }
}

interface FindSpec<TRow> {
  /** The table to look in. */
  table: string
  /** The columns the words are matched against (name, ID, key). */
  match: readonly string[]
  /** The columns to read; they must cover what `label` and `exact` use. */
  select: string
  /** What the thing is called in a message ("study"). */
  what: string
  label: (row: TRow) => string
  /** The values a row answers to exactly (its name, its ID). */
  names: (row: TRow) => readonly (string | null | undefined)[]
  /** Extra filters, such as `&archived_at=is.null`. */
  extra?: string
  order?: string
}

/** The one row a person means by a name or an ID, or why it is not clear. */
export async function find<TRow>(
  client: DataClient,
  wanted: string,
  spec: FindSpec<TRow>,
): Promise<Lookup<TRow>> {
  const like = likeValue(wanted)

  const matches = spec.match
    .map((column) => `${column}.ilike.${like}`)
    .join(',')

  const rows = await client.list<TRow>(
    spec.table,
    `?or=(${matches})${spec.extra ?? ''}&select=${spec.select}&order=${spec.order ?? `${spec.match[0]}.asc`}&limit=6`,
  )

  return pick(rows, wanted, spec.what, spec.label, (row) =>
    spec.names(row).some((name) => same(name, wanted)),
  )
}

export interface RecordRow {
  id: string
  identifier: string
  title: string
  kind: string
  metadata_version: number
}

/** A record by its ID (STU-0004, EXP-0012) or its title, of the kinds given. */
export function findRecordOf(
  client: DataClient,
  wanted: string,
  what: string,
  kinds: readonly string[],
): Promise<Lookup<RecordRow>> {
  return find<RecordRow>(client, wanted, {
    table: 'records',
    match: ['identifier', 'title'],
    select: 'id,identifier,title,kind,metadata_version',
    what,
    extra: `&deleted_at=is.null&archived_at=is.null&kind=in.(${kinds.map(encodeURIComponent).join(',')})`,
    order: 'identifier.asc',
    label: (row) => `${row.identifier} · ${row.title}`,
    names: (row) => [row.identifier, row.title],
  })
}

export interface MemberRow {
  user_id: string
  name: string
}

/** A person of the workspace by their name. */
export async function findMemberNamed(
  client: DataClient,
  wanted: string,
): Promise<Lookup<MemberRow>> {
  const members = await client.rpc<MemberRow[]>('workspace_members_list', {})
  const lower = wanted.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)

  const matches = members.filter((member) =>
    words.every((word) => member.name.toLowerCase().includes(word)),
  )

  return pick(
    matches,
    wanted,
    'person',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower || row.user_id === wanted.trim(),
  )
}

/** A day (YYYY-MM-DD) or nothing, as a line for a card. */
export const dayText = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10) : 'None'
