/**
 * Lab lookups for agents and the assistant: the SOPs and protocols a request
 * would follow, the reagents and materials it would use with what is on hand,
 * and the templates and record models it could start from.
 *
 * Each one is a read of tables that are already on the API (records, blocks,
 * record links, protocol versions, reagent movements, notebook templates and
 * record models), put together so an agent finds, for example, "the PicoGreen
 * SOP" and its steps in one call instead of five. They run as the caller, so
 * row-level security decides what is found, and they write nothing.
 */
import { z } from 'zod'

import type { DataClient } from '../data-client'

export const PROTOCOL_READ_TOOL = 'sheetbase.protocol.read'
export const STOCK_READ_TOOL = 'sheetbase.stock.read'
export const TEMPLATE_LIST_TOOL = 'sheetbase.template.list'

export const LOOKUP_TOOL_NAMES = [
  PROTOCOL_READ_TOOL,
  STOCK_READ_TOOL,
  TEMPLATE_LIST_TOOL,
] as const

export function isLookupTool(name: string): boolean {
  return LOOKUP_TOOL_NAMES.some((tool) => tool === name)
}

const words = z.string().trim().min(1).max(120)

export const protocolReadSchema = z
  .strictObject({
    query: words
      .optional()
      .describe('Words in the protocol’s name or number, such as "PicoGreen".'),
    recordId: z
      .string()
      .uuid()
      .optional()
      .describe('A protocol record’s id, to read that one.'),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .refine(
    (value) => value.query !== undefined || value.recordId !== undefined,
    {
      message: 'Send a query or a recordId.',
    },
  )

export const stockReadSchema = z.strictObject({
  query: words.describe(
    'Words in the reagent or material’s name or number, such as "PicoGreen" or "MAT-0419".',
  ),
  limit: z.number().int().min(1).max(20).optional(),
})

export const templateListSchema = z.strictObject({
  query: words
    .optional()
    .describe('Words in a template or record model’s name.'),
  limit: z.number().int().min(1).max(50).optional(),
})

export function lookupMcpTools(grants: { templates: boolean }) {
  const read = (title: string) => ({
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  })

  return [
    {
      name: PROTOCOL_READ_TOOL,
      description:
        'Find a protocol or SOP by name or number and read it: its status and versions, its steps in order, its text, and the materials and records it links to. Look here first when a request follows a lab procedure (a PicoGreen assay, a transfection) so what you propose matches the lab’s own SOP. Give a recordId to read one protocol; with a query, the best matches are read.',
      inputSchema: z.toJSONSchema(protocolReadSchema, { io: 'input' }),
      annotations: read('Read a protocol or SOP'),
    },
    {
      name: STOCK_READ_TOOL,
      description:
        'Find a reagent or material by name or number and see what is on hand: each lot with its quantity left, unit, expiry, supplier and catalogue number, from the latest stock movement. Use it to check the lab has what a plan needs, and to name the lot.',
      inputSchema: z.toJSONSchema(stockReadSchema, { io: 'input' }),
      annotations: read('Read reagent and material stock'),
    },
    {
      name: TEMPLATE_LIST_TOOL,
      description: grants.templates
        ? 'List the notebook templates a new experiment could start from, and the record models (kinds of record) the lab has, narrowed by name. Use it to pick the template and model a request should use.'
        : 'List the record models (kinds of record) the lab has, narrowed by name. Use it to pick the model a request should use.',
      inputSchema: z.toJSONSchema(templateListSchema, { io: 'input' }),
      annotations: read('List templates and record models'),
    },
  ]
}

/** A value to match inside a PostgREST filter: no list or wildcard characters. */
function like(value: string): string {
  return encodeURIComponent(`*${value.replaceAll(/[*%,()\\]/g, ' ').trim()}*`)
}

function matching(columns: readonly string[], value: string): string {
  return `or=(${columns.map((column) => `${column}.ilike.${like(value)}`).join(',')})`
}

const recordRow = z.object({
  id: z.string(),
  kind: z.string(),
  identifier: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
})

const blockRow = z.object({
  type: z.string(),
  payload: z.json(),
})

interface TextNode {
  text?: string
  content?: TextNode[]
}

const textNode: z.ZodType<TextNode> = z.lazy(() =>
  z.object({
    text: z.string().optional(),
    content: z.array(textNode).optional(),
  }),
)

const procedureStep = z.object({
  text: z.string(),
  stepNumber: z.number().optional(),
})

const richText = z.object({ doc: textNode })

function flatten(node: TextNode): string {
  if (node.text !== undefined) return node.text

  return (node.content ?? []).map(flatten).join(' ')
}

const MAX_STEP_CHARS = 500
const MAX_TEXT_CHARS = 3000

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export interface ProtocolContent {
  steps: { number: number | null; text: string }[]
  text: string[]
}

/** The readable content of a protocol's blocks: its steps in order and its prose. */
export function protocolContent(
  blocks: readonly z.infer<typeof blockRow>[],
): ProtocolContent {
  const steps: ProtocolContent['steps'] = []
  const text: string[] = []

  for (const block of blocks) {
    const step = procedureStep.safeParse(block.payload)

    if (block.type === 'procedure_step' && step.success) {
      steps.push({
        number: step.data.stepNumber ?? null,
        text: clip(step.data.text, MAX_STEP_CHARS),
      })

      continue
    }

    const prose = richText.safeParse(block.payload)

    if (prose.success) {
      const plain = flatten(prose.data.doc).replaceAll(/\s+/g, ' ').trim()

      if (plain !== '') text.push(clip(plain, MAX_TEXT_CHARS))
    }
  }

  steps.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))

  return { steps, text }
}

const versionRow = z.object({
  version: z.number(),
  status: z.string().nullable(),
  effective_at: z.string().nullable(),
  review_due_at: z.string().nullable(),
})

const linkRow = z.object({
  target_kind: z.string().nullable(),
  target_identifier: z.string().nullable(),
  link_type: z.string().nullable(),
})

async function readRows<T>(
  client: DataClient,
  resource: string,
  query: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const rows = await client.list<unknown>(resource, query)

  return z.array(schema).parse(rows)
}

export async function readProtocols(
  input: z.infer<typeof protocolReadSchema>,
  client: DataClient,
): Promise<{ protocols: object[]; note?: string }> {
  const limit = input.limit ?? 5
  const select = 'id,kind,identifier,title,status'

  const filter = input.recordId
    ? `id=eq.${input.recordId}`
    : `${matching(['title', 'identifier'], input.query ?? '')}`

  const records = await readRows(
    client,
    'records',
    `?select=${select}&kind=ilike.protocol*&archived_at=is.null&${filter}&order=title.asc&limit=${limit}`,
    recordRow,
  )

  const protocols = await Promise.all(
    records.map(async (record) => {
      const id = encodeURIComponent(record.id)

      const [blocks, versions, links] = await Promise.all([
        readRows(
          client,
          'blocks',
          `?select=type,payload&record_id=eq.${id}&order=order.asc&limit=200`,
          blockRow,
        ),
        readRows(
          client,
          'protocol_versions',
          `?select=version,status,effective_at,review_due_at&protocol_record_id=eq.${id}&order=version.desc&limit=3`,
          versionRow,
        ),
        readRows(
          client,
          'record_links',
          `?select=target_kind,target_identifier,link_type&source_record_id=eq.${id}&limit=100`,
          linkRow,
        ),
      ])

      return {
        id: record.id,
        identifier: record.identifier,
        title: record.title,
        status: record.status,
        versions,
        ...protocolContent(blocks),
        linkedRecords: links.map((link) => ({
          kind: link.target_kind,
          identifier: link.target_identifier,
          link: link.link_type,
        })),
      }
    }),
  )

  return protocols.length === 0
    ? {
        protocols,
        note: 'No protocol or SOP matched. Say so; do not invent one.',
      }
    : { protocols }
}

const movementRow = z.object({
  reagent_record_id: z.string(),
  lot: z.string().nullable(),
  resulting_quantity: z.number().nullable(),
  unit: z.string().nullable(),
  expiry: z.string().nullable(),
  supplier: z.string().nullable(),
  catalog_no: z.string().nullable(),
  created_at: z.string(),
})

/** The latest movement of each lot says how much of it is left. */
export function lotsOnHand(movements: readonly z.infer<typeof movementRow>[]) {
  const latest = new Map<string, z.infer<typeof movementRow>>()

  for (const movement of movements) {
    const key = movement.lot ?? ''
    const seen = latest.get(key)

    if (!seen || seen.created_at < movement.created_at) {
      latest.set(key, movement)
    }
  }

  return [...latest.values()].map((movement) => ({
    lot: movement.lot,
    quantityLeft: movement.resulting_quantity,
    unit: movement.unit,
    expiry: movement.expiry,
    supplier: movement.supplier,
    catalogueNumber: movement.catalog_no,
    asOf: movement.created_at,
  }))
}

export async function readStock(
  input: z.infer<typeof stockReadSchema>,
  client: DataClient,
): Promise<{ items: object[]; note?: string }> {
  const limit = input.limit ?? 10

  const records = await readRows(
    client,
    'records',
    `?select=id,kind,identifier,title,status&archived_at=is.null&${matching(['title', 'identifier'], input.query)}&order=title.asc&limit=${limit * 3}`,
    recordRow,
  )

  if (records.length === 0) {
    return { items: [], note: 'Nothing matched. Say so; do not guess.' }
  }

  const ids = records.map((record) => encodeURIComponent(record.id)).join(',')

  const movements = await readRows(
    client,
    'reagent_movements',
    `?select=reagent_record_id,lot,resulting_quantity,unit,expiry,supplier,catalog_no,created_at&reagent_record_id=in.(${ids})&order=created_at.desc&limit=500`,
    movementRow,
  )

  const items = records
    .map((record) => ({
      id: record.id,
      identifier: record.identifier,
      title: record.title,
      kind: record.kind,
      lots: lotsOnHand(
        movements.filter(
          (movement) => movement.reagent_record_id === record.id,
        ),
      ),
    }))
    .filter((item) => item.lots.length > 0)
    .slice(0, limit)

  return items.length === 0
    ? {
        items,
        note: 'Records matched but none has stock movements, so there is no stock to report. Say so.',
      }
    : { items }
}

const templateRow = z.object({
  id: z.string(),
  key: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  lifecycle: z.string().nullable(),
  display_id: z.string().nullable(),
})

const templateVersionRow = z.object({
  template_id: z.string(),
  version: z.number(),
  lifecycle: z.string().nullable(),
})

const modelRow = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  identifier_prefix: z.string().nullable(),
  lifecycle: z.string().nullable(),
  current_version: z.number().nullable(),
})

function latestPublished(
  versions: readonly z.infer<typeof templateVersionRow>[],
  templateId: string,
) {
  const own = versions.filter((version) => version.template_id === templateId)

  return (
    own.find((version) => version.lifecycle === 'published') ?? own[0] ?? null
  )
}

export async function listTemplates(
  input: z.infer<typeof templateListSchema>,
  client: DataClient,
  grants: { templates: boolean },
): Promise<{ templates: object[]; models: object[] }> {
  const limit = input.limit ?? 20
  const filter = input.query ? `&${matching(['name'], input.query)}` : ''

  const models = await readRows(
    client,
    'record_models',
    `?select=id,key,name,description,identifier_prefix,lifecycle,current_version${filter}&order=name.asc&limit=${limit}`,
    modelRow,
  )

  if (!grants.templates) return { templates: [], models }

  const templates = await readRows(
    client,
    'notebook_templates',
    `?select=id,key,name,description,lifecycle,display_id${filter}&order=name.asc&limit=${limit}`,
    templateRow,
  )

  const versions =
    templates.length === 0
      ? []
      : await readRows(
          client,
          'notebook_template_versions',
          `?select=template_id,version,lifecycle&template_id=in.(${templates.map((template) => encodeURIComponent(template.id)).join(',')})&order=version.desc&limit=500`,
          templateVersionRow,
        )

  return {
    templates: templates.map((template) => ({
      ...template,
      // The version people start from is the newest published one.
      latestVersion: latestPublished(versions, template.id),
    })),
    models,
  }
}

/** Runs one lookup tool; the text is JSON for the model or agent. */
export async function runLookup(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP transport input is decoded by the tool's schema before any read.
  args: unknown,
  context: { client: DataClient; grants: { templates: boolean } },
): Promise<{ text: string; isError: boolean }> {
  if (name === PROTOCOL_READ_TOOL) {
    const parsed = protocolReadSchema.safeParse(args)

    return parsed.success
      ? {
          text: JSON.stringify(
            await readProtocols(parsed.data, context.client),
          ),
          isError: false,
        }
      : {
          text: 'Send a query (words in the name) or a recordId.',
          isError: true,
        }
  }

  if (name === STOCK_READ_TOOL) {
    const parsed = stockReadSchema.safeParse(args)

    return parsed.success
      ? {
          text: JSON.stringify(await readStock(parsed.data, context.client)),
          isError: false,
        }
      : {
          text: 'Send a query: words in the reagent or material’s name.',
          isError: true,
        }
  }

  const parsed = templateListSchema.safeParse(args)

  return parsed.success
    ? {
        text: JSON.stringify(
          await listTemplates(parsed.data, context.client, context.grants),
        ),
        isError: false,
      }
    : { text: 'Send an optional query and limit.', isError: true }
}
