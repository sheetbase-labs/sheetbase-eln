import type { z } from 'zod'

import {
  BENCH_PROPOSE_TOOL_NAMES,
  INCIDENT_REPORT_TOOL,
  INSTRUMENT_SERVICE_TOOL,
  REAGENT_ORDER_TOOL,
  REAGENT_RECEIVE_TOOL,
  REQUEST_SEND_TOOL,
  SAMPLES_LOG_TOOL,
  SAMPLE_ADVANCE_TOOL,
  SAMPLE_MOVE_TOOL,
  SAMPLE_SPLIT_TOOL,
  SAMPLE_USE_TOOL,
  proposeIncidentSchema,
  proposeInstrumentServiceSchema,
  proposeReagentOrderSchema,
  proposeReagentReceiveSchema,
  proposeRequestSchema,
  proposeSampleAdvanceSchema,
  proposeSampleMoveSchema,
  proposeSampleSplitSchema,
  proposeSampleUseSchema,
  proposeSamplesLogSchema,
} from './assistant-bench'
import type { BenchAction, BenchProposeToolName } from './assistant-bench'
import {
  findExperiment,
  instrumentLabel,
  invalid,
  likeValue,
  resolveInstrument,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'
import { fetchModelFields } from './model-fields'
import type { ModelFieldDefinition } from './model-fields'
import { fetchSampleRuns } from './sample-workflows'
import {
  fetchBoxChoices,
  fetchBoxPositions,
  freePositions,
} from './storage-positions'
import type { BoxChoice } from './storage-positions'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for everyday bench jobs (see `assistant-bench.ts`). Each builder finds
 * the things the person named, checks what it can, and returns a card that
 * says exactly what will change. Nothing is written here.
 */

export type BenchProposalOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function benchProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      REAGENT_ORDER_TOOL,
      `Propose asking for more of a reagent or material. It becomes an order request the buyer places. Name the material as the person does. ${NOTE}`,
      proposeReagentOrderSchema,
    ),
    toolDef(
      REAGENT_RECEIVE_TOOL,
      `Propose marking a reagent order as received when it arrives, with its lot and expiry. Ask for the lot and expiry if the person has not said. ${NOTE}`,
      proposeReagentReceiveSchema,
    ),
    toolDef(
      SAMPLES_LOG_TOOL,
      `Propose logging new samples, optionally filed in the free positions of a box. ${NOTE}`,
      proposeSamplesLogSchema,
    ),
    toolDef(
      SAMPLE_USE_TOOL,
      `Propose recording that some of a sample was used up. ${NOTE}`,
      proposeSampleUseSchema,
    ),
    toolDef(
      SAMPLE_MOVE_TOOL,
      `Propose moving samples to a box position or to a place in words. ${NOTE}`,
      proposeSampleMoveSchema,
    ),
    toolDef(
      SAMPLE_SPLIT_TOOL,
      `Propose splitting a sample into equal tubes (aliquots) for an experiment. ${NOTE}`,
      proposeSampleSplitSchema,
    ),
    toolDef(
      INCIDENT_REPORT_TOOL,
      `Propose filing an incident or near miss on the lab’s incident form, filled in from what the person said. Do not invent answers. ${NOTE}`,
      proposeIncidentSchema,
    ),
    toolDef(
      REQUEST_SEND_TOOL,
      `Propose sending a request to the lab on one of its request forms (list the requests area to see the forms), filled in from what the person said. Do not invent answers. ${NOTE}`,
      proposeRequestSchema,
    ),
    toolDef(
      SAMPLE_ADVANCE_TOOL,
      `Propose moving a sample to the next stage of its workflow. You cannot release, sign or approve. ${NOTE}`,
      proposeSampleAdvanceSchema,
    ),
    toolDef(
      INSTRUMENT_SERVICE_TOOL,
      `Propose marking an instrument out of service (or back in service). Everyone with a booking ahead is told as usual. ${NOTE}`,
      proposeInstrumentServiceSchema,
    ),
  ]
}

export function isBenchProposalTool(
  name: string,
): name is BenchProposeToolName {
  return (BENCH_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

// ---------------------------------------------------------------------------
// Lookups by the words people use.
// ---------------------------------------------------------------------------

interface FoundRecord {
  id: string
  identifier: string
  title: string
  metadata_version: number
  properties: Record<string, unknown> | null
}

async function findRecord(
  client: DataClient,
  kind: 'sample' | 'material',
  text: string,
): Promise<FoundRecord | string> {
  const like = likeValue(text)
  const rows = await client.list<FoundRecord>(
    'records',
    `?kind=eq.${kind}&deleted_at=is.null&archived_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,metadata_version,properties&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  const exact = rows.filter(
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
  if (exact.length === 1) return exact[0]
  if (rows.length === 1) return rows[0]
  if (rows.length === 0) return `No ${kind} matches "${text}".`
  return `More than one ${kind} matches "${text}": ${rows
    .map((row) => `${row.identifier} ${row.title}`)
    .join(', ')}. Ask which one.`
}

function label(row: { identifier: string; title: string }): string {
  return `${row.identifier} · ${row.title}`
}

function amountOf(row: FoundRecord): { quantity: number | null; unit: string } {
  const props = row.properties ?? {}
  const quantity = typeof props.quantity === 'number' ? props.quantity : null
  const unit = typeof props.quantityUnit === 'string' ? props.quantityUnit : ''
  return { quantity, unit }
}

function amount(quantity: number, unit: string): string {
  return `${quantity}${unit ? ` ${unit}` : ''}`
}

async function findProject(
  client: DataClient,
  name: string | undefined,
): Promise<{ id: string; title: string } | string> {
  const rows = await client.list<{ id: string; title: string }>(
    'projects',
    '?archived_at=is.null&select=id,title&order=title.asc&limit=200',
  )
  if (!name) {
    if (rows.length === 1) return rows[0]
    return rows.length === 0
      ? 'There is no project to put this in yet.'
      : `Which project? Ask the person: ${rows
          .slice(0, 12)
          .map((row) => row.title)
          .join(', ')}.`
  }
  const lower = name.trim().toLowerCase()
  const exact = rows.filter((row) => row.title.toLowerCase() === lower)
  if (exact.length === 1) return exact[0]
  const words = lower.split(/\s+/)
  const partial = rows.filter((row) =>
    words.every((word) => row.title.toLowerCase().includes(word)),
  )
  if (partial.length === 1) return partial[0]
  return partial.length === 0
    ? `No project matches "${name}". The projects are: ${rows
        .slice(0, 12)
        .map((row) => row.title)
        .join(', ')}.`
    : `More than one project matches "${name}": ${partial
        .map((row) => row.title)
        .join(', ')}. Ask which one.`
}

async function findBox(
  client: DataClient,
  name: string,
): Promise<BoxChoice | string> {
  const boxes = await fetchBoxChoices(client)
  const lower = name.trim().toLowerCase()
  const exact = boxes.filter(
    (box) =>
      box.name.toLowerCase() === lower ||
      box.code?.toLowerCase() === lower ||
      box.path.toLowerCase() === lower,
  )
  if (exact.length === 1) return exact[0]
  const words = lower.split(/\s+/)
  const partial = boxes.filter((box) =>
    words.every((word) =>
      `${box.path} ${box.code ?? ''}`.toLowerCase().includes(word),
    ),
  )
  if (partial.length === 1) return partial[0]
  if (partial.length === 0) {
    return `No box matches "${name}". Boxes: ${boxes
      .slice(0, 15)
      .map((box) => box.path)
      .join('; ')}.`
  }
  return `More than one box matches "${name}": ${partial
    .slice(0, 8)
    .map((box) => box.path)
    .join('; ')}. Ask which one.`
}

/** `count` free positions in a box, in reading order, with the words for each. */
async function freeSpots(
  client: DataClient,
  box: BoxChoice,
  count: number,
): Promise<{ ids: string[]; labels: string[] } | string> {
  const free = freePositions(await fetchBoxPositions(client, box.id), count)
  if (free.length < count) {
    return `${box.path} has only ${free.length} free position${free.length === 1 ? '' : 's'}; ${count} needed. Offer another box.`
  }
  return { ids: free.map((cell) => cell.id), labels: free.map((c) => c.label) }
}

// ---------------------------------------------------------------------------
// Form answers, matched to a model's fields.
// ---------------------------------------------------------------------------

function coerceField(
  field: ModelFieldDefinition,
  value: string | number | boolean,
):
  { ok: true; value: unknown; shown: string } | { ok: false; message: string } {
  switch (field.logicalType) {
    case 'integer':
    case 'decimal': {
      const number =
        typeof value === 'number' ? value : Number.parseFloat(String(value))
      return Number.isFinite(number)
        ? { ok: true, value: number, shown: String(number) }
        : { ok: false, message: `${field.label} needs a number.` }
    }
    case 'boolean': {
      const yes =
        value === true || /^(yes|true|y|1)$/i.test(String(value).trim())
      return { ok: true, value: yes, shown: yes ? 'Yes' : 'No' }
    }
    case 'category': {
      const wanted = String(value).trim().toLowerCase()
      const option = field.options.find(
        (candidate) =>
          candidate.lifecycle === 'active' &&
          (candidate.key.toLowerCase() === wanted ||
            candidate.label.toLowerCase() === wanted),
      )
      return option
        ? { ok: true, value: option.key, shown: option.label }
        : {
            ok: false,
            message: `${field.label} must be one of: ${field.options
              .filter((candidate) => candidate.lifecycle === 'active')
              .map((candidate) => candidate.label)
              .join(', ')}.`,
          }
    }
    case 'reference':
      return {
        ok: false,
        message: `${field.label} links to another record, which the assistant cannot fill in. Leave it out and tell the person to add it.`,
      }
    default:
      return { ok: true, value: String(value), shown: String(value) }
  }
}

/** Match the person's answers to the form's fields by name or label. */
function matchFields(
  fields: ModelFieldDefinition[],
  answers: Record<string, string | number | boolean>,
):
  | {
      ok: true
      customFields: Record<string, unknown>
      changes: ProposalChange[]
    }
  | { ok: false; message: string } {
  const customFields: Record<string, unknown> = {}
  const changes: ProposalChange[] = []
  const asked = fields.filter((field) => field.lifecycle === 'active')
  for (const [key, value] of Object.entries(answers)) {
    const lower = key.trim().toLowerCase()
    const field = asked.find(
      (candidate) =>
        candidate.fieldName.toLowerCase() === lower ||
        candidate.label.toLowerCase() === lower,
    )
    if (!field) {
      return {
        ok: false,
        message: `This form has no field "${key}". Its fields are: ${asked
          .map((candidate) => candidate.label)
          .join(', ')}.`,
      }
    }
    const coerced = coerceField(field, value)
    if (!coerced.ok) return coerced
    customFields[field.fieldName] = coerced.value
    changes.push({ label: field.label, before: null, after: coerced.shown })
  }
  const missing = asked.filter(
    (field) =>
      !field.nullable &&
      field.defaultValue === null &&
      field.logicalType !== 'boolean' &&
      !(field.fieldName in customFields),
  )
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Still needed from the person: ${missing
        .map((field) => field.label)
        .join(', ')}. Ask for these, then propose again.`,
    }
  }
  return { ok: true, customFields, changes }
}

/** The one model among `keys` the person named, or the only one. */
async function pickForm(
  client: DataClient,
  keys: string[],
  wanted: string | undefined,
  what: string,
): Promise<{ key: string; name: string } | string> {
  if (keys.length === 0) {
    return `This lab has not set up ${what} yet. It is set up from Settings > Lab setup.`
  }
  const models = await client.list<{ key: string; name: string }>(
    'record_models',
    `?key=in.(${keys.map(encodeURIComponent).join(',')})&select=key,name`,
  )
  if (!wanted) {
    if (models.length === 1) return models[0]
    return `Which form? Ask the person: ${models.map((model) => model.name).join(', ')}.`
  }
  const lower = wanted.trim().toLowerCase()
  const exact = models.filter(
    (model) =>
      model.name.toLowerCase() === lower || model.key.toLowerCase() === lower,
  )
  if (exact.length === 1) return exact[0]
  const words = lower.split(/\s+/)
  const partial = models.filter((model) =>
    words.every((word) => model.name.toLowerCase().includes(word)),
  )
  if (partial.length === 1) return partial[0]
  return `No ${what} form matches "${wanted}". The forms are: ${models
    .map((model) => model.name)
    .join(', ')}.`
}

// ---------------------------------------------------------------------------
// Builders.
// ---------------------------------------------------------------------------

function parse<T extends z.ZodType>(
  schema: T,
  args: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; message: string } {
  const parsed = schema.safeParse(args)
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, message: invalid(parsed.error) }
}

function card(
  tool: BenchProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: BenchAction
  },
): BenchProposalOutcome {
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      ...rest,
    },
  }
}

const fail = (message: string): BenchProposalOutcome => ({ ok: false, message })

export async function buildBenchProposal(
  name: BenchProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<BenchProposalOutcome> {
  const { client, workspaceId } = context
  switch (name) {
    case REAGENT_ORDER_TOOL: {
      const parsed = parse(proposeReagentOrderSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const material = await findRecord(client, 'material', input.material)
      if (typeof material === 'string') return fail(material)
      const unit = input.unit ?? amountOf(material).unit
      const open = await client.list<{ number: number; status: string }>(
        'reagent_orders',
        `?material_record_id=eq.${material.id}&status=in.(requested,ordered)&select=number,status&limit=1`,
      )
      if (open.length > 0) {
        return fail(
          `A reorder is already open for ${material.title} (RO-${String(open[0].number).padStart(4, '0')}, ${open[0].status}). Tell the person rather than proposing another.`,
        )
      }
      const changes: ProposalChange[] = [
        { label: 'Material', before: null, after: label(material) },
        { label: 'Amount', before: null, after: amount(input.quantity, unit) },
      ]
      if (input.note) {
        changes.push({ label: 'Note', before: null, after: input.note })
      }
      return card(name, input, {
        target: 'Reagent order',
        deepLink: '/materials',
        changes,
        action: {
          kind: 'reagent.order',
          materialRecordId: material.id,
          quantity: input.quantity,
          unit: unit || null,
          note: input.note ?? null,
        },
      })
    }

    case REAGENT_RECEIVE_TOOL: {
      const parsed = parse(proposeReagentReceiveSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const number = /^RO-?(\d+)$/i.exec(input.order.trim())
      const like = likeValue(input.order)
      const orders = await client.list<{
        id: string
        number: number
        material_title: string
        quantity: string | number
        unit: string | null
        status: string
      }>(
        'reagent_orders',
        `?status=in.(requested,ordered)&${
          number
            ? `number=eq.${Number(number[1])}`
            : `material_title=ilike.${like}`
        }&select=id,number,material_title,quantity,unit,status&order=number.desc&limit=6`,
      )
      if (orders.length === 0) {
        return fail(`No open order matches "${input.order}".`)
      }
      if (orders.length > 1) {
        return fail(
          `More than one open order matches: ${orders
            .map(
              (o) =>
                `RO-${String(o.number).padStart(4, '0')} ${o.material_title}`,
            )
            .join(', ')}. Ask which one.`,
        )
      }
      const order = orders[0]
      const unit = order.unit ?? ''
      const received = input.quantity ?? Number(order.quantity)
      return card(name, input, {
        target: `RO-${String(order.number).padStart(4, '0')}`,
        deepLink: '/materials',
        changes: [
          { label: 'Material', before: null, after: order.material_title },
          { label: 'Received', before: null, after: amount(received, unit) },
          { label: 'Lot', before: null, after: input.lot },
          { label: 'Expires', before: null, after: input.expiry },
        ],
        action: {
          kind: 'reagent.receive',
          orderId: order.id,
          lot: input.lot,
          expiry: input.expiry,
          quantity: input.quantity ?? null,
        },
      })
    }

    case SAMPLES_LOG_TOOL: {
      const parsed = parse(proposeSamplesLogSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)
      if (typeof project === 'string') return fail(project)
      let spots: { ids: string[]; labels: string[] } | null = null
      let box: BoxChoice | null = null
      if (input.box) {
        const found = await findBox(client, input.box)
        if (typeof found === 'string') return fail(found)
        box = found
        const free = await freeSpots(client, box, input.samples.length)
        if (typeof free === 'string') return fail(free)
        spots = free
      }
      return card(name, input, {
        target: box ? box.path : project.title,
        deepLink: '/samples',
        changes: input.samples.map((sample, index) => ({
          label: sample.name,
          before: null,
          after:
            [
              sample.sampleType,
              sample.quantity !== undefined
                ? amount(sample.quantity, sample.quantityUnit ?? '')
                : null,
              spots ? spots.labels[index] : (input.place ?? null),
            ]
              .filter(Boolean)
              .join(' · ') || 'New sample',
        })),
        action: {
          kind: 'samples.log',
          projectId: project.id,
          samples: input.samples.map((sample) => ({
            title: sample.name,
            ...(sample.sampleType ? { sampleType: sample.sampleType } : {}),
            ...(sample.quantity !== undefined
              ? { quantity: sample.quantity }
              : {}),
            ...(sample.quantityUnit
              ? { quantityUnit: sample.quantityUnit }
              : {}),
            ...(!box && input.place ? { storageLocation: input.place } : {}),
          })),
          positionIds: spots?.ids ?? [],
        },
      })
    }

    case SAMPLE_USE_TOOL: {
      const parsed = parse(proposeSampleUseSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const sample = await findRecord(client, 'sample', input.sample)
      if (typeof sample === 'string') return fail(sample)
      const { quantity: have, unit } = amountOf(sample)
      if (have !== null && input.quantity > have) {
        return fail(
          `${sample.identifier} has only ${amount(have, unit)} left, so ${amount(input.quantity, unit)} cannot be used. Tell the person.`,
        )
      }
      let experiment: { id: string; identifier: string; title: string } | null =
        null
      if (input.experiment) {
        const found = await findExperiment(client, input.experiment)
        if (typeof found === 'string') return fail(found)
        experiment = found
      }
      const changes: ProposalChange[] = [
        {
          label: 'Amount left',
          before: have !== null ? amount(have, unit) : null,
          after:
            have !== null
              ? amount(Math.round((have - input.quantity) * 1e6) / 1e6, unit)
              : `${amount(input.quantity, unit)} less`,
        },
      ]
      if (experiment) {
        changes.push({
          label: 'Used for',
          before: null,
          after: label(experiment),
        })
      }
      return card(name, input, {
        target: label(sample),
        deepLink: null,
        changes,
        action: {
          kind: 'sample.use',
          recordId: sample.id,
          quantity: input.quantity,
          expectedMetadataVersion: sample.metadata_version,
          purposeRecordId: experiment?.id ?? null,
          notes: input.notes ?? null,
        },
      })
    }

    case SAMPLE_MOVE_TOOL: {
      const parsed = parse(proposeSampleMoveSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      if (!input.box && !input.place) {
        return fail('Where should they go? Ask for a box or a place.')
      }
      const samples: FoundRecord[] = []
      for (const text of input.samples) {
        const found = await findRecord(client, 'sample', text)
        if (typeof found === 'string') return fail(found)
        samples.push(found)
      }
      let spots: { ids: string[]; labels: string[] } | null = null
      let box: BoxChoice | null = null
      if (input.box) {
        const found = await findBox(client, input.box)
        if (typeof found === 'string') return fail(found)
        box = found
        const free = await freeSpots(client, box, samples.length)
        if (typeof free === 'string') return fail(free)
        spots = free
      }
      return card(name, input, {
        target: box ? box.path : (input.place ?? ''),
        deepLink: '/samples',
        changes: samples.map((sample, index) => {
          const props = sample.properties ?? {}
          return {
            label: label(sample),
            before:
              typeof props.storageLocation === 'string'
                ? props.storageLocation
                : null,
            after: spots
              ? `${box?.name} · ${spots.labels[index]}`
              : (input.place ?? ''),
          }
        }),
        action: {
          kind: 'sample.move',
          moves: samples.map((sample, index) => ({
            recordId: sample.id,
            expectedMetadataVersion: sample.metadata_version,
            positionId: spots?.ids[index] ?? null,
            toLocation: spots ? null : (input.place ?? null),
          })),
          notes: input.notes ?? null,
        },
      })
    }

    case SAMPLE_SPLIT_TOOL: {
      const parsed = parse(proposeSampleSplitSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const sample = await findRecord(client, 'sample', input.sample)
      if (typeof sample === 'string') return fail(sample)
      const experiment = await findExperiment(client, input.experiment)
      if (typeof experiment === 'string') return fail(experiment)
      const { quantity: have, unit } = amountOf(sample)
      const total = Math.round(input.count * input.quantityEach * 1e6) / 1e6
      if (have !== null && total > have) {
        return fail(
          `${sample.identifier} has ${amount(have, unit)}, but ${input.count} × ${amount(input.quantityEach, unit)} is ${amount(total, unit)}. Tell the person and offer a smaller amount.`,
        )
      }
      return card(name, input, {
        target: label(sample),
        deepLink: null,
        changes: [
          {
            label: 'New tubes',
            before: null,
            after: `${input.count} × ${amount(input.quantityEach, unit)}`,
          },
          {
            label: 'Amount left',
            before: have !== null ? amount(have, unit) : null,
            after:
              have !== null
                ? amount(Math.round((have - total) * 1e6) / 1e6, unit)
                : `${amount(total, unit)} less`,
          },
          { label: 'For', before: null, after: label(experiment) },
        ],
        action: {
          kind: 'sample.split',
          recordId: sample.id,
          count: input.count,
          quantityEach: input.quantityEach,
          unit: unit || null,
          purposeExperimentId: experiment.id,
          expectedMetadataVersion: sample.metadata_version,
          notes: input.notes ?? null,
        },
      })
    }

    case INCIDENT_REPORT_TOOL: {
      const parsed = parse(proposeIncidentSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const forms = await client.list<{ model_key: string }>(
        'model_incident_logs',
        '?select=model_key',
      )
      const form = await pickForm(
        client,
        forms.map((row) => row.model_key),
        input.form,
        'incident log',
      )
      if (typeof form === 'string') return fail(form)
      const project = await findProject(client, input.project)
      if (typeof project === 'string') return fail(project)
      const fields = await fetchModelFields(client, form.key)
      const matched = matchFields(fields, input.fields ?? {})
      if (!matched.ok) return fail(matched.message)
      return card(name, input, {
        target: form.name,
        deepLink: '/incidents',
        changes: [
          { label: 'Title', before: null, after: input.incidentTitle },
          ...matched.changes,
          { label: 'Project', before: null, after: project.title },
        ],
        action: {
          kind: 'record.create',
          projectId: project.id,
          modelKey: form.key,
          title: input.incidentTitle,
          customFields: matched.customFields,
        },
      })
    }

    case REQUEST_SEND_TOOL: {
      const parsed = parse(proposeRequestSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const forms = await client.list<{ model_key: string }>(
        'request_forms',
        '?select=model_key',
      )
      const form = await pickForm(
        client,
        forms.map((row) => row.model_key),
        input.form,
        'request',
      )
      if (typeof form === 'string') return fail(form)
      let project: { id: string; title: string } | null = null
      if (input.project) {
        const found = await findProject(client, input.project)
        if (typeof found === 'string') return fail(found)
        project = found
      }
      const fields = await fetchModelFields(client, form.key)
      const matched = matchFields(fields, input.fields ?? {})
      if (!matched.ok) return fail(matched.message)
      const changes: ProposalChange[] = [
        { label: 'Request', before: null, after: input.requestTitle },
        ...matched.changes,
      ]
      if (project) {
        changes.push({ label: 'Project', before: null, after: project.title })
      }
      if (input.note) {
        changes.push({ label: 'Note', before: null, after: input.note })
      }
      return card(name, input, {
        target: form.name,
        deepLink: '/requests',
        changes,
        action: {
          kind: 'request.send',
          projectId: project?.id ?? null,
          modelKey: form.key,
          title: input.requestTitle,
          customFields: matched.customFields,
          note: input.note ?? '',
        },
      })
    }

    case SAMPLE_ADVANCE_TOOL: {
      const parsed = parse(proposeSampleAdvanceSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const sample = await findRecord(client, 'sample', input.sample)
      if (typeof sample === 'string') return fail(sample)
      const runs = (await fetchSampleRuns(client, sample.id)).filter(
        (run) => !run.completedAt,
      )
      if (runs.length === 0) {
        return fail(
          `${sample.identifier} is not in a workflow, so there is no stage to move it to.`,
        )
      }
      if (runs.length > 1) {
        return fail(
          `${sample.identifier} is in more than one workflow (${runs
            .map((run) => run.workflowName)
            .join(', ')}). Ask which one.`,
        )
      }
      const run = runs[0]
      if (run.moves.length === 0) {
        return fail(
          `${sample.identifier} is at ${run.stageName} with no stage after it.`,
        )
      }
      let next = run.moves[0]
      if (input.toStage) {
        const lower = input.toStage.trim().toLowerCase()
        const found = run.moves.find(
          (move) => move.name.toLowerCase() === lower,
        )
        if (!found) {
          return fail(
            `From ${run.stageName} it can go to: ${run.moves.map((move) => move.name).join(', ')}. "${input.toStage}" is not one of them.`,
          )
        }
        next = found
      } else if (run.moves.length > 1) {
        return fail(
          `From ${run.stageName} it can go to more than one stage: ${run.moves
            .map((move) => move.name)
            .join(', ')}. Ask which one.`,
        )
      }
      const changes: ProposalChange[] = [
        { label: run.workflowName, before: run.stageName, after: next.name },
      ]
      if (next.requiredFields.length > 0) {
        changes.push({
          label: 'Needs filling in first',
          before: null,
          after: next.requiredFields.join(', '),
        })
      }
      return card(name, input, {
        target: label(sample),
        deepLink: null,
        changes,
        action: {
          kind: 'sample.advance',
          runId: run.id,
          toStageId: next.id,
          notes: input.notes ?? null,
        },
      })
    }

    case INSTRUMENT_SERVICE_TOOL: {
      const parsed = parse(proposeInstrumentServiceSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await resolveInstrument(
        client,
        workspaceId,
        input.instrument,
      )
      if (!found.ok) return fail(found.message)
      const instrument = found.instrument
      if (input.outOfService && !input.reason?.trim()) {
        return fail('Ask the person what is wrong with it first.')
      }
      if (input.outOfService && instrument.out_of_service_at) {
        return fail(`${instrumentLabel(instrument)} is already out of service.`)
      }
      if (!input.outOfService && !instrument.out_of_service_at) {
        return fail(`${instrumentLabel(instrument)} is already in service.`)
      }
      const changes: ProposalChange[] = [
        {
          label: 'Status',
          before: instrument.out_of_service_at
            ? 'Out of service'
            : 'In service',
          after: input.outOfService ? 'Out of service' : 'In service',
        },
      ]
      if (input.reason && input.outOfService) {
        changes.push({ label: 'Reason', before: null, after: input.reason })
      }
      if (input.expectedBackOn && input.outOfService) {
        changes.push({
          label: 'Back on',
          before: null,
          after: input.expectedBackOn,
        })
      }
      if (input.workDone && !input.outOfService) {
        changes.push({
          label: 'Work done',
          before: null,
          after: input.workDone,
        })
      }
      return card(name, input, {
        target: instrumentLabel(instrument),
        deepLink: '/instruments',
        changes,
        action: {
          kind: 'instrument.service',
          instrumentId: instrument.id,
          outOfService: input.outOfService,
          reason: input.reason?.trim() || null,
          expectedBackOn: input.expectedBackOn ?? null,
          workDone: input.workDone?.trim() || null,
        },
      })
    }
  }
}
