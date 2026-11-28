import { z } from 'zod'

import { outcomeFromOutput } from './assistant-card-outcomes'
import { readRecordLinks, readUsedIn } from './assistant-record-links.server'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Full reads for the assistant, so it can see what it made.
 *
 * - `sheetbase.record.read` opens one thing by the ID the app shows (EXP-4302,
 *   PRJ-0008, TPL-0004), or by its name, and answers with its content: the
 *   notebook text, the parts (milestones) and their steps, the plate layout and
 *   worklists, the samples set aside, or a template's blocks.
 * - `sheetbase.assistant.created` lists what the assistant's cards made for the
 *   person in earlier chats, from the outcomes saved with those chats.
 *
 * Both read as the signed-in person, so row-level security decides what shows.
 */

export const RECORD_READ_TOOL = 'sheetbase.record.read'
export const ASSISTANT_CREATED_TOOL = 'sheetbase.assistant.created'

export const RECORD_READ_TOOL_NAMES = [
  RECORD_READ_TOOL,
  ASSISTANT_CREATED_TOOL,
] as const

const recordName = z.string().min(1).max(200)

export const recordReadSchema = z.strictObject({
  record: recordName
    .optional()
    .describe(
      'What to open: its ID as the app shows it (EXP-4302, PRJ-0008, TPL-0004, SMP-0012), or words from its name.',
    ),
  records: z
    .array(recordName)
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Several things to open at once, up to five, each by ID or name. Use this instead of one call per record.',
    ),
})

export const assistantCreatedSchema = z.strictObject({
  limit: z.number().int().min(1).max(30).optional(),
})

export function recordReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      RECORD_READ_TOOL,
      'Open one experiment, project, template, sample, material or other record and read it in full: what it is linked to and what links to it (linksTo, linkedFrom), where a material is used (usedIn), its notebook text, its parts (milestones) with their days, status and steps, its plate layout and worklists, the samples set aside for it, and its links. Use it whenever the person asks what is in something, "what did you make", "are the milestones filled in", or means the page they have open. Name it by ID or words from its name; to look at several, pass them together in `records` rather than one call each. Never say you cannot see a record before trying this.',
      recordReadSchema,
    ),
    toolDef(
      ASSISTANT_CREATED_TOOL,
      'List what your cards did for this person in their earlier chats: each card, whether it was applied, dismissed or failed, and the record it made. Use it when they refer to something you made or ask what you have done, and before ever saying you did not create something.',
      assistantCreatedSchema,
    ),
  ]
}

export function isRecordReadTool(name: string): boolean {
  return RECORD_READ_TOOL_NAMES.some((candidate) => candidate === name)
}

type Result = { text: string; isError: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SKIP_KEYS = new Set([
  'id',
  'type',
  'kind',
  'blockType',
  'uuid',
  'mark',
  'marks',
  'attrs',
  'order',
])

/** The words inside a block's payload, whatever its type, in reading order. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Block payloads are untyped JSON; this walks them for their text.
export function textOf(value: unknown, depth = 0): string[] {
  if (depth > 12) return []

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Same walk over untyped JSON.
  if (typeof value === 'string')
    return value.trim() === '' ? [] : [value.trim()]

  if (Array.isArray(value)) return value.flatMap((v) => textOf(v, depth + 1))

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Same walk over untyped JSON.
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) =>
      SKIP_KEYS.has(key) ? [] : textOf(v, depth + 1),
    )
  }

  return []
}

const clipText = (parts: string[], max: number) => {
  const text = parts.join(' ').replaceAll(/\s+/g, ' ')

  return text.length <= max ? text : `${text.slice(0, max)}…`
}

interface BlockRow {
  id: string
  type: string
  order: number
  payload: z.core.util.JSONType
  part_id?: string | null
}

async function safe<T>(job: Promise<T>, fallback: T): Promise<T> {
  try {
    return await job
  } catch {
    return fallback
  }
}

async function readTemplate(
  context: LabToolContext,
  text: string,
): Promise<Result | null> {
  const { client } = context
  const like = likeValue(text)
  const lower = text.trim().toLowerCase()

  const rows = await safe(
    client.list<{
      id: string
      display_id: string | null
      name: string
      description: string | null
      lifecycle: string
    }>(
      'notebook_templates',
      `?or=(display_id.ilike.${like},name.ilike.${like},key.ilike.${like})&select=id,display_id,name,description,lifecycle&order=updated_at.desc&limit=5`,
    ),
    [],
  )

  const exact = rows.filter(
    (row) =>
      row.display_id?.toLowerCase() === lower ||
      row.name.toLowerCase() === lower,
  )

  const picked =
    exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null

  if (!picked) return null

  const versions = await safe(
    client.list<{
      version: number
      lifecycle: string
      configuration: {
        placements?: Array<{
          kind?: string
          blockType?: string
          payload?: z.core.util.JSONType
        }>
      }
    }>(
      'notebook_template_versions',
      `?template_id=eq.${picked.id}&select=version,lifecycle,configuration&order=version.desc&limit=1`,
    ),
    [],
  )

  const latest = versions.at(0)

  return {
    isError: false,
    text: JSON.stringify({
      template: picked.display_id ?? picked.name,
      name: picked.name,
      description: picked.description,
      state: picked.lifecycle,
      version: latest?.version ?? null,
      versionState: latest?.lifecycle ?? null,
      blocks: (latest?.configuration.placements ?? []).map((placement) => ({
        type: placement.blockType ?? placement.kind,
        text: clipText(textOf(placement.payload), 600),
      })),
    }),
  }
}

interface FoundRecord {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  project_id: string | null
  properties: z.core.util.JSONType
  created_at: string
  created_by_user_id: string | null
  source_notebook_template_version_id: string | null
}

const RECORD_COLUMNS =
  'id,identifier,title,kind,status,project_id,properties,created_at,created_by_user_id,source_notebook_template_version_id'

async function findAny(
  context: LabToolContext,
  text: string,
): Promise<FoundRecord | { message: string }> {
  const { client } = context

  const records = UUID.test(text.trim())
    ? await client.list<FoundRecord>(
        'records',
        `?id=eq.${text.trim()}&deleted_at=is.null&select=${RECORD_COLUMNS}&limit=1`,
      )
    : await client.list<FoundRecord>(
        'records',
        `?deleted_at=is.null&or=(identifier.ilike.${likeValue(text)},title.ilike.${likeValue(text)})&select=${RECORD_COLUMNS}&order=updated_at.desc&limit=6`,
      )

  // Projects are not records: they have their own table and their own ID
  // (PRJ-0008), so a project named or numbered here is looked up there.
  const projects = await safe(
    client.list<{
      id: string
      display_id: string | null
      title: string
      status: string
      created_at: string
    }>(
      'projects',
      `?or=(display_id.ilike.${likeValue(text)},title.ilike.${likeValue(text)})&select=id,display_id,title,status,created_at&order=updated_at.desc&limit=6`,
    ),
    [],
  )

  const rows: FoundRecord[] = [
    ...records,
    ...projects.map((project): FoundRecord => ({
      id: project.id,
      identifier: project.display_id ?? '',
      title: project.title,
      kind: 'project',
      status: project.status,
      project_id: project.id,
      properties: {},
      created_at: project.created_at,
      created_by_user_id: null,
      source_notebook_template_version_id: null,
    })),
  ]

  const lower = text.trim().toLowerCase()

  const exact = rows.filter(
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )

  if (exact.length === 1 && exact[0]) return exact[0]

  if (rows.length === 1 && rows[0]) return rows[0]

  if (rows.length === 0) return { message: `Nothing is called "${text}".` }

  return {
    message: `More than one thing fits "${text}": ${rows
      .map((row) => `${row.identifier} ${row.title}`)
      .join(', ')}. Ask which one.`,
  }
}

export async function readRecord(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments; recordReadSchema decodes them before use.
  args: unknown,
  context: LabToolContext,
): Promise<Result> {
  const parsed = recordReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  const names = [
    ...new Set([
      ...(parsed.data.record ? [parsed.data.record] : []),
      ...(parsed.data.records ?? []),
    ]),
  ]

  const [only = '', ...rest] = names

  if (names.length === 0) {
    return { text: 'Name the record to open.', isError: true }
  }

  if (rest.length === 0) return readOneRecord(only, context)

  // Several at once: each is read the way a single one is, side by side.
  const results = await Promise.all(
    names.map((name) => readOneRecord(name, context)),
  )

  // Each result is already JSON text, so it is joined as it is.
  const items = results.map((result, index) =>
    result.isError
      ? JSON.stringify({ asked: names[index], problem: result.text })
      : `{"asked":${JSON.stringify(names[index])},"record":${result.text}}`,
  )

  return {
    isError: results.every((result) => result.isError),
    text: `{"records":[${items.join(',')}]}`,
  }
}

async function readOneRecord(
  text: string,
  context: LabToolContext,
): Promise<Result> {
  const { client } = context

  if (/^TPL-/i.test(text.trim()) || /template/i.test(text)) {
    const template = await readTemplate(context, text)

    if (template) return template
  }

  const found = await findAny(context, text)

  if ('message' in found) {
    // A template may be named without saying so.
    const template = await readTemplate(context, text)

    return template ?? { text: found.message, isError: true }
  }

  // A project reads as its list of records.
  if (found.kind === 'project') {
    const members = await safe(
      client.list<{
        identifier: string
        title: string
        kind: string
        status: string
      }>(
        'records',
        `?project_id=eq.${found.id}&deleted_at=is.null&select=identifier,title,kind,status&order=created_at.asc&limit=60`,
      ),
      [],
    )

    return {
      isError: false,
      text: JSON.stringify({
        id: found.identifier,
        title: found.title,
        kind: 'project',
        status: found.status,
        records: members,
      }),
    }
  }

  const [
    blocks,
    parts,
    plates,
    worklists,
    reservations,
    project,
    related,
    usedIn,
  ] = await Promise.all([
    safe(
      client.list<BlockRow>(
        'blocks',
        `?record_id=eq.${found.id}&select=id,type,order,payload,part_id&order=order.asc&limit=80`,
      ),
      [],
    ),
    safe(
      client.rpc<
        Array<{
          part_number: number
          title: string
          day_offset: number
          due_on: string | null
          status: string
          is_current: boolean
          step_count: number
          steps_done: number
          block_count: number
          result_count: number
        }>
      >('record_parts', { p_record_id: found.id }),
      [],
    ),
    safe(
      client.list<{
        name: string
        format: string
        wells: z.core.util.JSONType
        status: string
      }>(
        'plate_runs',
        `?record_id=eq.${found.id}&select=name,format,wells,status&limit=10`,
      ),
      [],
    ),
    safe(
      client.list<{
        name: string
        format: string
        source_plate: string
        transfers: z.core.util.JSONType
      }>(
        'plate_worklists',
        `?record_id=eq.${found.id}&select=name,format,source_plate,transfers&limit=10`,
      ),
      [],
    ),
    safe(
      client.list<{
        quantity: number
        unit: string | null
        state: string
        sample: { identifier: string; title: string } | null
      }>(
        'sample_reservations',
        `?experiment_record_id=eq.${found.id}&select=quantity,unit,state,sample:records!sample_record_id(identifier,title)&limit=40`,
      ),
      [],
    ),
    found.project_id
      ? safe(
          client.list<{ key: string; title: string }>(
            'projects',
            `?id=eq.${found.project_id}&select=key,title&limit=1`,
          ),
          [],
        )
      : Promise.resolve([]),
    readRecordLinks(client, found.id),
    readUsedIn(client, found.identifier),
  ])

  const wellCount = (wells: z.core.util.JSONType) =>
    Array.isArray(wells) ? wells.length : 0

  const wellRoles = z.array(z.looseObject({ role: z.string().optional() }))

  const roleCounts = (wells: z.core.util.JSONType) => {
    const counts: Record<string, number> = {}
    const roles = wellRoles.safeParse(wells)

    for (const well of roles.success ? roles.data : []) {
      const role = well.role ?? 'sample'

      counts[role] = (counts[role] ?? 0) + 1
    }

    return counts
  }

  const body = blocks.map((block) => ({
    type: block.type,
    part: block.part_id ?? null,
    text: clipText(textOf(block.payload), 700),
  }))

  return {
    isError: false,
    text: JSON.stringify({
      id: found.identifier,
      title: found.title,
      kind: found.kind,
      status: found.status,
      project: project.at(0)?.title ?? null,
      madeAt: found.created_at,
      startedFromTemplate: found.source_notebook_template_version_id !== null,
      milestones: parts.map((part) => ({
        number: part.part_number,
        title: part.title,
        day: part.day_offset,
        date: part.due_on,
        status: part.status,
        current: part.is_current,
        steps: part.step_count,
        stepsDone: part.steps_done,
        blocks: part.block_count,
        results: part.result_count,
      })),
      notebook:
        body.length === 0
          ? 'The notebook has no content yet: no blocks, steps or text.'
          : body,
      plates: plates.map((plate) => ({
        name: plate.name,
        format: plate.format,
        status: plate.status,
        wells: wellCount(plate.wells),
        roles: roleCounts(plate.wells),
      })),
      worklists: worklists.map((worklist) => ({
        name: worklist.name,
        format: worklist.format,
        sourcePlate: worklist.source_plate,
        transfers: wellCount(worklist.transfers),
      })),
      samplesSetAside: reservations.map((reservation) => ({
        sample: reservation.sample
          ? `${reservation.sample.identifier} ${reservation.sample.title}`
          : null,
        quantity: reservation.quantity,
        unit: reservation.unit,
        state: reservation.state,
      })),
      linksTo: related.linksTo,
      linkedFrom: related.linkedFrom,
      usedIn,
      properties: found.properties,
    }),
  }
}

interface SavedPart {
  type?: string
  toolCallId?: string
  state?: string
  output?: unknown
}

interface SavedMessage {
  role?: string
  parts?: SavedPart[]
}

/** What the assistant's cards did in this person's saved chats. */
export async function readCreated(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments; assistantCreatedSchema decodes them before use.
  args: unknown,
  context: LabToolContext,
): Promise<Result> {
  const parsed = assistantCreatedSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const limit = parsed.data.limit ?? 20

  const chats = await safe(
    context.client.list<{
      title: string
      updated_at: string
      messages: SavedMessage[]
    }>(
      'assistant_conversations',
      `?workspace_id=eq.${context.workspaceId}&select=title,updated_at,messages&order=updated_at.desc&limit=12`,
    ),
    [],
  )

  const items = chats.flatMap((chat) =>
    chat.messages.flatMap((message) =>
      (message.parts ?? []).flatMap((part) => {
        const outcome = outcomeFromOutput(part.output)

        return outcome
          ? [
              {
                chat: chat.title,
                card: outcome.title,
                result: outcome.status,
                made: outcome.made
                  ? `${outcome.made.identifier} ${outcome.made.title}`
                  : null,
                reason: outcome.reason ?? null,
                at: outcome.at,
              },
            ]
          : []
      }),
    ),
  )

  items.sort((a, b) => b.at.localeCompare(a.at))

  return {
    isError: false,
    text: JSON.stringify({
      cards: items.slice(0, limit),
      note:
        items.length === 0
          ? 'No applied or dismissed cards are saved yet. Cards applied in a chat that was never saved are not listed.'
          : 'These are cards you showed and what the person did with them. Applied means the record exists.',
    }),
  }
}
