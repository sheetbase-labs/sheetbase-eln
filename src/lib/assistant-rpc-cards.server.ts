import { z } from 'zod'

import type { ProviderToolDef } from './ai-providers/types'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import { pick } from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import type { RpcArgs } from './assistant-rpc-cards'
import type { DataClient } from './data-client'
import type { FeatureProposalOutcome } from '../features/define.server'

/**
 * The server half of the RPC cards (see `assistant-rpc-cards.ts`): a card is
 * declared once with its tool, its words for the model, its arguments and a
 * `build` that finds what was named and says what will change. Nothing here
 * writes.
 */

/** What a builder returns: the card's lines and the call its button runs. */
export interface BuiltCard {
  target: string
  deepLink: string | null
  changes: ProposalChange[]
  rpc: string
  args: RpcArgs
  openHref?: string | null
}

export type Built = Lookup<BuiltCard>

export const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

const cardTitle = z.string().min(1).max(120)
const cardSummary = z.string().min(1).max(400)

/** The arguments every card takes, then its own. */
export function cardSchema<
  TFields extends Parameters<typeof z.strictObject>[0],
>(fields: TFields) {
  return z.strictObject({ title: cardTitle, summary: cardSummary, ...fields })
}

export interface RpcCard<TTool extends string = string> {
  tool: TTool
  covers: readonly string[]
  /** The tool as the model sees it. */
  def: () => ProviderToolDef
  /** Finds what was named and builds the card, or says what is missing. */
  propose: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the card's own schema before any field is read.
    args: unknown,
    context: LabToolContext,
  ) => Promise<FeatureProposalOutcome>
}

export function rpcCard<
  TTool extends string,
  TSchema extends z.ZodType<{ title: string; summary: string }>,
>(spec: {
  tool: TTool
  covers: readonly string[]
  /** What the tool does, for the model. The note about the button is added. */
  description: string
  schema: TSchema
  build: (input: z.output<TSchema>, context: LabToolContext) => Promise<Built>
}): RpcCard<TTool> {
  return {
    tool: spec.tool,
    covers: spec.covers,
    def: () => toolDef(spec.tool, `${spec.description} ${NOTE}`, spec.schema),
    async propose(args, context) {
      const parsed = spec.schema.safeParse(args)

      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }

      const built = await spec.build(parsed.data, context)

      if (!built.ok) return { ok: false, message: built.message }
      const { title, summary } = parsed.data

      // SAFETY: `TTool` is one of the card tool names the feature declares with `defineAssistant`, and the action kind is that same name, so both are members of the proposal's unions.
      const proposal = {
        tool: spec.tool,
        title,
        summary,
        target: built.value.target,
        deepLink: built.value.deepLink,
        changes: built.value.changes,
        action: {
          kind: spec.tool,
          rpc: built.value.rpc,
          args: built.value.args,
          openHref: built.value.openHref ?? built.value.deepLink,
        },
      } as AssistantProposal

      return { ok: true, proposal }
    },
  }
}

/** The proposal tools, builder and test of one family of cards. */
export function rpcFamily(cards: ReadonlyArray<RpcCard>) {
  const byTool = new Map(cards.map((card) => [card.tool, card]))

  return {
    defs: (): ProviderToolDef[] => cards.map((card) => card.def()),
    is: (name: string): boolean => byTool.has(name),
    build: (
      name: string,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; each card parses them with its own schema.
      args: unknown,
      context: LabToolContext,
    ): Promise<FeatureProposalOutcome> => {
      const card = byTool.get(name)

      return card
        ? card.propose(args, context)
        : Promise.resolve({ ok: false, message: 'Unknown tool.' })
    },
  }
}

// ---------------------------------------------------------------------------
// Lookups by the words people use: a display ID (DS-0311) or a name.
// ---------------------------------------------------------------------------

const isUuid = (text: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    text.trim(),
  )

const same = (a: string | null | undefined, b: string): boolean =>
  a?.trim().toLowerCase() === b.trim().toLowerCase()

export interface FoundSheet {
  id: string
  name: string
  display_id: string | null
  revision: number
  project_id: string | null
  notebook_record_id: string | null
  lifecycle: string
}

export const sheetLabel = (row: {
  name: string
  display_id: string | null
}): string => (row.display_id ? `${row.display_id} · ${row.name}` : row.name)

export async function findSheet(
  client: DataClient,
  wanted: string,
  archived = false,
): Promise<Lookup<FoundSheet>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundSheet>(
    'sheet_instances',
    `?lifecycle=${archived ? 'eq' : 'neq'}.archived&or=(name.ilike.${like},display_id.ilike.${like}${isUuid(wanted) ? `,id.eq.${wanted.trim()}` : ''})&select=id,name,display_id,revision,project_id,notebook_record_id,lifecycle&order=updated_at.desc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'sheet',
    sheetLabel,
    (row) => same(row.name, wanted) || same(row.display_id, wanted),
  )
}

export interface FoundDataset {
  id: string
  name: string
  display_id: string | null
  revision: number
  schema_version_id: string
  lifecycle: string
}

export async function findDataset(
  client: DataClient,
  wanted: string,
): Promise<Lookup<FoundDataset>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundDataset>(
    'datasets',
    `?or=(name.ilike.${like},display_id.ilike.${like}${isUuid(wanted) ? `,id.eq.${wanted.trim()}` : ''})&select=id,name,display_id,revision,schema_version_id,lifecycle&order=updated_at.desc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'dataset',
    sheetLabel,
    (row) => same(row.name, wanted) || same(row.display_id, wanted),
  )
}

export interface FoundTable {
  id: string
  key: string
  name: string
  display_id: string | null
  lifecycle: string
}

/** A measurement table (the columns a dataset is made of). */
export async function findTable(
  client: DataClient,
  wanted: string,
): Promise<Lookup<FoundTable>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundTable>(
    'dataset_schema_definitions',
    `?or=(name.ilike.${like},key.ilike.${like},display_id.ilike.${like})&select=id,key,name,display_id,lifecycle&order=name.asc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'measurement table',
    (row) => row.name,
    (row) =>
      same(row.name, wanted) ||
      same(row.key, wanted) ||
      same(row.display_id, wanted),
  )
}

export interface FoundLayout {
  id: string
  key: string
  name: string
  lifecycle: string
  revision: number
}

/** A sheet layout (what the app calls a sheet definition). */
export async function findLayout(
  client: DataClient,
  wanted: string,
): Promise<Lookup<FoundLayout>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundLayout>(
    'sheet_definitions',
    `?or=(name.ilike.${like},key.ilike.${like})&select=id,key,name,lifecycle,revision&order=name.asc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'sheet layout',
    (row) => `${row.name} (${row.key})`,
    (row) => same(row.name, wanted) || same(row.key, wanted),
  )
}

export interface FoundLayoutVersion {
  id: string
  version: number
  lifecycle: string
  revision: number
}

/** A layout's versions, newest first. */
export function layoutVersions(
  client: DataClient,
  definitionId: string,
): Promise<FoundLayoutVersion[]> {
  return client.list<FoundLayoutVersion>(
    'sheet_definition_versions',
    `?definition_id=eq.${encodeURIComponent(definitionId)}&select=id,version,lifecycle,revision&order=version.desc`,
  )
}

export interface FoundRecord {
  id: string
  identifier: string
  title: string
  kind: string
  project_id: string | null
}

/** A record by its ID (EXP-0004) or its name. */
export async function findRecord(
  client: DataClient,
  wanted: string,
  extra = '',
): Promise<Lookup<FoundRecord>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundRecord>(
    'records',
    `?deleted_at=is.null${extra}&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,kind,project_id&order=identifier.asc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'record',
    (row) => `${row.identifier} · ${row.title}`,
    (row) => same(row.identifier, wanted) || same(row.title, wanted),
  )
}

export const recordLabel = (row: FoundRecord): string =>
  `${row.identifier} · ${row.title}`

export interface FoundBlock {
  id: string
  type: string
  version: number
  order: number
}

/**
 * A block of a notebook: the record it is in, the kind of block, and which
 * one of that kind (1 is the first). Several of one kind need a position.
 */
export async function findBlock(
  client: DataClient,
  record: FoundRecord,
  types: readonly string[],
  position: number | undefined,
): Promise<Lookup<FoundBlock>> {
  const rows = await client.list<FoundBlock>(
    'blocks',
    `?record_id=eq.${record.id}&type=in.(${types.join(',')})&select=id,type,version,order&order=order.asc`,
  )

  if (rows.length === 0) {
    return {
      ok: false,
      message: `${recordLabel(record)} has no ${types.join(' or ')} block.`,
    }
  }

  if (position !== undefined) {
    const block = rows.at(position - 1)

    return block
      ? { ok: true, value: block }
      : {
          ok: false,
          message: `${recordLabel(record)} has only ${rows.length} such block(s).`,
        }
  }

  if (rows.length === 1) return { ok: true, value: rows[0] }

  return {
    ok: false,
    message: `${recordLabel(record)} has ${rows.length} such blocks. Ask the person which one, by position (1 to ${rows.length}).`,
  }
}

export async function findProjectId(
  client: DataClient,
  wanted: string,
): Promise<Lookup<{ id: string; title: string }>> {
  const like = likeValue(wanted)

  const rows = await client.list<{
    id: string
    key: string
    title: string
    display_id: string | null
  }>(
    'projects',
    `?archived_at=is.null&or=(key.ilike.${like},title.ilike.${like},display_id.ilike.${like})&select=id,key,title,display_id&order=title.asc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'project',
    (row) => row.title,
    (row) =>
      same(row.key, wanted) ||
      same(row.title, wanted) ||
      same(row.display_id, wanted),
  )
}

// ---------------------------------------------------------------------------
// A sheet's state, as far as these cards read it.
// ---------------------------------------------------------------------------

const stateSchema = z.looseObject({
  localFields: z
    .array(
      z.looseObject({
        fieldId: z.string(),
        key: z.string(),
        label: z.string(),
        lifecycle: z.string(),
      }),
    )
    .default([]),
  localValues: z.record(z.string(), z.record(z.string(), z.json())).default({}),
  instanceCalculations: z
    .array(
      z.looseObject({
        id: z.string(),
        key: z.string(),
        label: z.string(),
        lifecycle: z.string(),
      }),
    )
    .default([]),
})

export type SheetState = z.infer<typeof stateSchema>

export interface SheetDetail {
  state: SheetState
  sourceVersionId: string | null
}

export async function readSheet(
  client: DataClient,
  id: string,
): Promise<SheetDetail> {
  const rows = await client.list<{
    state: unknown
    source_definition_version_id: string | null
  }>(
    'sheet_instances',
    `?id=eq.${id}&select=state,source_definition_version_id&limit=1`,
  )

  const parsed = stateSchema.safeParse(rows.at(0)?.state ?? {})

  return {
    state: parsed.success ? parsed.data : stateSchema.parse({}),
    sourceVersionId: rows.at(0)?.source_definition_version_id ?? null,
  }
}

export const activeFields = (state: SheetState) =>
  state.localFields.filter((field) => field.lifecycle === 'active')

export function fieldNamed(state: SheetState, label: string) {
  return activeFields(state).find((field) => same(field.label, label))
}

export const changed = (
  label: string,
  before: string | null,
  after: string,
): ProposalChange => ({ label, before, after })

export const fail = (message: string) => ({ ok: false as const, message })

export const ok = (value: BuiltCard): Built => ({ ok: true, value })

export { same }
