import { describeSlot, instantFromLocal } from '#/lib/assistant-booking'
import {
  instrumentLabel,
  likeValue,
  memberNames,
  resolveInstrument,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import {
  cardSpec,
  cardDefs,
  buildCard,
} from '#/lib/assistant-call-cards.server'
import type { CardBuilt } from '#/lib/assistant-call-cards.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { CalendarBookingWire } from '#/lib/calendar'
import { worklistReference } from '#/lib/plate-runs'
import type { RpcArgument } from '#/lib/assistant-call-cards'

import { INSTRUMENT_SETUP_CARDS, instrumentSetupSchemas } from './cards'
import type {
  InstrumentSetupKind,
  InstrumentSetupProposeToolName,
} from './cards'

/**
 * The instrument set-up cards (see `cards.ts`). Each builder finds what the
 * model named under the signed-in person's own access and returns a card that
 * says exactly what will change. Nothing is written here.
 */

const S = instrumentSetupSchemas
const C = INSTRUMENT_SETUP_CARDS

const OPEN_JOB = ['queued', 'staged', 'starting', 'running'] as const

interface Instrument {
  id: string
  label: string
}

async function findInstrument(
  context: LabToolContext,
  text: string,
): Promise<Lookup<Instrument>> {
  const found = await resolveInstrument(
    context.client,
    context.workspaceId,
    text,
  )

  return found.ok
    ? {
        ok: true,
        value: {
          id: found.instrument.id,
          label: instrumentLabel(found.instrument),
        },
      }
    : { ok: false, message: found.message }
}

const quote = (text: string) => encodeURIComponent(text)

const contains = (text: string, part: string) => text.includes(part)

const norm = (text: string) => text.trim().toLowerCase()

/** One row of a table, by the words the person used for it. */
async function findRow<TRow>(
  context: LabToolContext,
  table: string,
  query: string,
  what: string,
  wanted: string,
  label: (row: TRow) => string,
  names: (row: TRow) => readonly (string | null)[],
): Promise<Lookup<TRow>> {
  const rows = await context.client.list<TRow>(table, query)
  const lower = norm(wanted)

  return pick(rows, wanted, what, label, (row) =>
    names(row).some((name) => name !== null && norm(name) === lower),
  )
}

const some = <T>(
  value: T | null | undefined,
): value is Exclude<T, null | undefined> =>
  value !== null && value !== undefined

/** Only the arguments the person actually gave, so the database keeps the rest. */
function given(params: Readonly<Record<string, RpcArgument | undefined>>) {
  const out: Record<string, RpcArgument> = {}

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) out[name] = value
  }

  return out
}

const built = (
  target: string,
  changes: CardBuilt['changes'],
  params: CardBuilt['params'],
  openHref: string | null,
): CardBuilt => ({ target, changes, params, openHref })

const add = (label: string, after: string | number | null | undefined) =>
  some(after) && after !== ''
    ? [{ label, before: null, after: String(after) }]
    : []

const INSTRUMENTS = '/instruments'
const INTEGRATIONS = '/settings/workspace/integrations'

interface JobRow {
  id: string
  number: number
  status: string
}

async function findJob(
  context: LabToolContext,
  instrument: Instrument,
  statuses: readonly string[],
  number: number | undefined,
): Promise<Lookup<JobRow>> {
  const rows = await context.client.list<JobRow>(
    'instrument_jobs',
    `?instrument_id=eq.${quote(instrument.id)}&status=in.(${statuses.join(',')})${number ? `&number=eq.${number}` : ''}&select=id,number,status&order=number.desc&limit=8`,
  )

  return pick(
    rows,
    number ? `job ${number}` : instrument.label,
    `${statuses.includes('running') ? 'open' : 'waiting'} job on ${instrument.label}`,
    (row) => `Job ${row.number} (${row.status})`,
    (row) => row.number === number,
  )
}

interface WorklistRow {
  id: string
  number: number
  name: string
}

async function findWorklist(
  context: LabToolContext,
  text: string,
): Promise<Lookup<WorklistRow>> {
  const number = /^wl-?0*(\d+)$/i.exec(text.trim())?.[1]

  const filter = number
    ? `number=eq.${number}`
    : `name=ilike.${likeValue(text)}`

  return findRow<WorklistRow>(
    context,
    'plate_worklists',
    `?${filter}&status=eq.planned&select=id,number,name&order=number.desc&limit=6`,
    'planned worklist',
    text,
    (row) => `${worklistReference(row.number)} ${row.name}`,
    (row) => [row.name, worklistReference(row.number)],
  )
}

interface FeedRow {
  id: string
  name: string
  unit: string | null
  low_limit: number | null
  high_limit: number | null
}

async function findFeed(
  context: LabToolContext,
  instrument: Instrument,
  text: string,
): Promise<Lookup<FeedRow>> {
  return findRow<FeedRow>(
    context,
    'instrument_feeds',
    `?instrument_id=eq.${quote(instrument.id)}&name=ilike.${likeValue(text)}&select=id,name,unit,low_limit,high_limit&order=name.asc&limit=6`,
    `live feed on ${instrument.label}`,
    text,
    (row) => row.name,
    (row) => [row.name],
  )
}

interface ParserRow {
  id: string
  key: string
  name: string
}

async function findParser(
  context: LabToolContext,
  text: string,
): Promise<Lookup<ParserRow>> {
  return findRow<ParserRow>(
    context,
    'parsers',
    `?or=(key.ilike.${likeValue(text)},name.ilike.${likeValue(text)})&select=id,key,name&order=name.asc&limit=6`,
    'parser',
    text,
    (row) => `${row.name} (${row.key})`,
    (row) => [row.name, row.key],
  )
}

interface ConnectorRow {
  id: string
  key: string
  name: string
  status: string
  parser_id: string | null
}

async function findConnector(
  context: LabToolContext,
  text: string,
): Promise<Lookup<ConnectorRow>> {
  return findRow<ConnectorRow>(
    context,
    'connectors',
    `?status=neq.archived&or=(key.ilike.${likeValue(text)},name.ilike.${likeValue(text)})&select=id,key,name,status,parser_id&order=name.asc&limit=6`,
    'connector',
    text,
    (row) => `${row.name} (${row.key})`,
    (row) => [row.name, row.key],
  )
}

const failed = (message: string) => message

/** Resolves an instrument, or hands its message back as the card's answer. */
async function withInstrument(
  context: LabToolContext,
  text: string,
  then: (instrument: Instrument) => Promise<CardBuilt | string>,
): Promise<CardBuilt | string> {
  const found = await findInstrument(context, text)

  return found.ok ? then(found.value) : found.message
}

const specs = [
  cardSpec({
    tool: C['instrument.job_queue'].tool,
    kind: 'instrument.job_queue' as const,
    description:
      'Propose sending a planned worklist to a liquid-handling robot, so it is waiting for someone to press Start. Find the worklist by its WL number or name.',
    schema: S.jobQueue,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const worklist = await findWorklist(context, input.worklist)

        if (!worklist.ok) return worklist.message

        return built(
          instrument.label,
          [
            ...add(
              'Worklist',
              `${worklistReference(worklist.value.number)} · ${worklist.value.name}`,
            ),
            ...add('Note', input.note),
          ],
          given({
            p_instrument_id: instrument.id,
            p_worklist_id: worklist.value.id,
            p_note: input.note?.trim() || null,
          }),
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.job_start'].tool,
    kind: 'instrument.job_start' as const,
    description:
      'Propose starting a robot job that is waiting on an instrument. Starting makes the robot move, so only propose it when the person asks.',
    schema: S.jobStart,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const job = await findJob(
          context,
          instrument,
          ['queued', 'staged'],
          input.job,
        )

        if (!job.ok) return job.message

        return built(
          instrument.label,
          [{ label: 'Job', before: job.value.status, after: 'Started' }],
          { p_job_id: job.value.id },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.job_cancel'].tool,
    kind: 'instrument.job_cancel' as const,
    description:
      'Propose cancelling a robot job that is queued or running on an instrument.',
    schema: S.jobCancel,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const job = await findJob(context, instrument, OPEN_JOB, input.job)

        if (!job.ok) return job.message

        return built(
          instrument.label,
          [{ label: 'Job', before: job.value.status, after: 'Cancelled' }],
          { p_job_id: job.value.id },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.robot_set'].tool,
    kind: 'instrument.robot_set' as const,
    description:
      'Propose setting an instrument up as a liquid-handling robot: how worklists reach it, their file format, the deck layout and the smallest and largest transfer it can do.',
    schema: S.robotSet,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        if (
          input.minTransferUl !== undefined &&
          input.maxTransferUl !== undefined &&
          input.minTransferUl > input.maxTransferUl
        )
          return failed('The smallest transfer is larger than the largest.')

        const before = await context.client
          .list<{ driver: string }>(
            'instrument_robot_settings',
            `?instrument_id=eq.${quote(instrument.id)}&select=driver&limit=1`,
          )
          .catch(() => [])

        return built(
          instrument.label,
          [
            {
              label: 'Sends worklists by',
              before: before.at(0)?.driver ?? null,
              after: input.driver,
            },
            ...add('Format', input.worklistFormat),
            ...add('Smallest transfer (µL)', input.minTransferUl),
            ...add('Largest transfer (µL)', input.maxTransferUl),
          ],
          given({
            p_instrument_id: instrument.id,
            p_driver: input.driver,
            p_worklist_format: input.worklistFormat ?? null,
            p_labware: input.labware ?? {},
            p_min_transfer_ul: input.minTransferUl ?? null,
            p_max_transfer_ul: input.maxTransferUl ?? null,
          }),
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.robot_clear'].tool,
    kind: 'instrument.robot_clear' as const,
    description:
      'Propose taking the robot set-up off an instrument, so it is an ordinary instrument again.',
    schema: S.robotClear,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const before = await context.client.list<{ driver: string }>(
          'instrument_robot_settings',
          `?instrument_id=eq.${quote(instrument.id)}&select=driver&limit=1`,
        )

        if (before.length === 0)
          return `${instrument.label} is not set up as a robot.`

        return built(
          instrument.label,
          [{ label: 'Robot set-up', before: before[0].driver, after: 'None' }],
          { p_instrument_id: instrument.id },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.feed_limits'].tool,
    kind: 'instrument.feed_limits' as const,
    description:
      'Propose changing the limits on an instrument’s live feed (a temperature or pressure reading), so readings outside them are flagged.',
    schema: S.feedLimits,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const feed = await findFeed(context, instrument, input.feed)

        if (!feed.ok) return feed.message

        if (input.low !== null && input.high !== null && input.low > input.high)
          return failed('The lowest limit is above the highest.')

        const range = (low: number | null, high: number | null) =>
          `${low ?? 'no minimum'} to ${high ?? 'no maximum'}`

        return built(
          `${feed.value.name} · ${instrument.label}`,
          [
            {
              label: 'Limits',
              before: range(feed.value.low_limit, feed.value.high_limit),
              after: range(input.low, input.high),
            },
          ],
          given({
            p_feed_id: feed.value.id,
            p_low: input.low,
            p_high: input.high,
            p_unit: input.unit ?? feed.value.unit,
          }),
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.feed_remove'].tool,
    kind: 'instrument.feed_remove' as const,
    description:
      'Propose removing a live feed from an instrument, with the readings it has kept.',
    schema: S.feedRemove,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const feed = await findFeed(context, instrument, input.feed)

        if (!feed.ok) return feed.message

        return built(
          `${feed.value.name} · ${instrument.label}`,
          [{ label: 'Live feed', before: 'Kept', after: 'Removed' }],
          { p_feed_id: feed.value.id },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.gate_mode'].tool,
    kind: 'instrument.gate_mode' as const,
    description:
      'Propose how strictly the lab holds people to instrument rules (being qualified, calibration not overdue): off, warn or block. For people who manage instruments.',
    schema: S.gateMode,
    build: async (input, context) => {
      const before = await context.client
        .list<{ instrument_gate_mode: string | null }>(
          'workspace_settings',
          `?workspace_id=eq.${quote(context.workspaceId)}&select=instrument_gate_mode&limit=1`,
        )
        .catch(() => [])

      return built(
        'Instrument rules',
        [
          {
            label: 'When rules are not met',
            before: before.at(0)?.instrument_gate_mode ?? null,
            after: input.mode,
          },
        ],
        { p_workspace_id: context.workspaceId, p_mode: input.mode },
        '/settings/lab/instruments',
      )
    },
  }),
  cardSpec({
    tool: C['instrument.intake_method'].tool,
    kind: 'instrument.intake_method' as const,
    description:
      'Propose changing how an instrument’s data gets into the lab: a watched folder, a webhook, entered by hand, or none.',
    schema: S.intakeMethod,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const before = await context.client.list<{ intake_method: string }>(
          'instruments',
          `?id=eq.${quote(instrument.id)}&select=intake_method&limit=1`,
        )

        return built(
          instrument.label,
          [
            {
              label: 'Data comes in by',
              before: before.at(0)?.intake_method ?? null,
              after: input.method,
            },
          ],
          { p_instrument_id: instrument.id, p_intake_method: input.method },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.connection'].tool,
    kind: 'instrument.connection' as const,
    description:
      'Propose marking an instrument’s connection as connected, disconnected or in error.',
    schema: S.connection,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const before = await context.client.list<{ connection_status: string }>(
          'instruments',
          `?id=eq.${quote(instrument.id)}&select=connection_status&limit=1`,
        )

        return built(
          instrument.label,
          [
            {
              label: 'Connection',
              before: before.at(0)?.connection_status ?? null,
              after: input.status,
            },
          ],
          {
            p_workspace_id: context.workspaceId,
            p_instrument_id: instrument.id,
            p_connection_status: input.status,
            p_last_connected_at:
              input.status === 'connected'
                ? (context.now ?? new Date()).toISOString()
                : null,
          },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['instrument.qualification_request'].tool,
    kind: 'instrument.qualification_request' as const,
    description:
      'Propose the person asking to be qualified on an instrument they are not yet qualified on. The people who manage instruments see the request.',
    schema: S.qualificationRequest,
    build: (input, context) =>
      withInstrument(context, input.instrument, (instrument) =>
        Promise.resolve(
          built(
            instrument.label,
            [
              { label: 'Request', before: null, after: 'Ask to be qualified' },
              ...add('Note', input.note),
            ],
            given({
              p_instrument_id: instrument.id,
              p_note: input.note?.trim() || null,
            }),
            INSTRUMENTS,
          ),
        ),
      ),
  }),
  cardSpec({
    tool: C['instrument.qualification_dismiss'].tool,
    kind: 'instrument.qualification_dismiss' as const,
    description:
      'Propose dismissing someone’s request to be qualified on an instrument, without qualifying them. Qualifying them is a separate tool. For people who manage instruments.',
    schema: S.qualificationDismiss,
    build: (input, context) =>
      withInstrument(context, input.instrument, async (instrument) => {
        const [rows, names] = await Promise.all([
          context.client.list<{ id: string; user_id: string }>(
            'instrument_qualification_requests',
            `?instrument_id=eq.${quote(instrument.id)}&status=eq.pending&select=id,user_id&order=created_at.asc&limit=20`,
          ),
          memberNames(context.client),
        ])

        const who = (row: { user_id: string }) =>
          names.get(row.user_id) ?? 'Someone'

        const wanted = input.person ? norm(input.person) : null

        const matches = wanted
          ? rows.filter((row) => contains(norm(who(row)), wanted))
          : rows

        const request = pick(
          matches,
          input.person ?? instrument.label,
          `open qualification request on ${instrument.label}`,
          who,
          () => false,
        )

        if (!request.ok) return request.message

        return built(
          instrument.label,
          [
            {
              label: `${who(request.value)}’s request`,
              before: 'Open',
              after: 'Dismissed',
            },
          ],
          { p_request_id: request.value.id },
          INSTRUMENTS,
        )
      }),
  }),
  cardSpec({
    tool: C['booking.duplicate'].tool,
    kind: 'booking.duplicate' as const,
    description:
      'Propose copying an existing booking to another time, keeping its instrument, project and notes. Use the schedule lookup to find the booking’s ID first.',
    schema: S.bookingDuplicate,
    build: async (input, context) => {
      const rows = await context.client.list<CalendarBookingWire>(
        'calendar_bookings',
        `?id=eq.${quote(input.bookingId)}&limit=1`,
      )

      const booking = rows.at(0)

      if (!booking) return 'No booking with that ID is visible to the person.'

      const startsAt = instantFromLocal(input.start, context.timeZone)
      const endsAt = instantFromLocal(input.end, context.timeZone)

      if (endsAt.getTime() <= startsAt.getTime())
        return 'The end must be after the start.'

      const title = input.bookingTitle ?? booking.title

      return built(
        booking.title,
        [
          {
            label: 'Copied to',
            before: null,
            after: describeSlot(startsAt, endsAt, context.timeZone),
          },
          ...add('Title', title),
        ],
        {
          p_booking_id: booking.id,
          p_starts_at: startsAt.toISOString(),
          p_ends_at: endsAt.toISOString(),
          p_title: title,
        },
        '/calendar',
      )
    },
  }),
  cardSpec({
    tool: C['resource.create'].tool,
    kind: 'resource.create' as const,
    description:
      'Propose adding something that can be booked on the calendar that is not an instrument, such as a room or a bench.',
    schema: S.resourceCreate,
    build: (input, context) =>
      Promise.resolve(
        built(
          input.name.trim(),
          [
            { label: 'Bookable', before: null, after: input.name.trim() },
            ...add('Code', input.code),
            ...add('Kind', input.resourceType),
            ...add('Where', input.location),
            ...add('Capacity', input.capacity),
          ],
          given({
            p_workspace_id: context.workspaceId,
            p_name: input.name.trim(),
            p_code: input.code.trim(),
            p_resource_type: input.resourceType,
            p_location: input.location?.trim() || null,
            p_capacity: input.capacity ?? 1,
            p_timezone: input.timezone ?? context.timeZone,
          }),
          '/calendar',
        ),
      ),
  }),
  cardSpec({
    tool: C['connector.register'].tool,
    kind: 'connector.register' as const,
    description:
      'Propose adding a connector that brings data in from, or sends data out to, another system. For people who manage integrations.',
    schema: S.connectorRegister,
    build: (input, context) =>
      Promise.resolve(
        built(
          input.name.trim(),
          [
            { label: 'Connector', before: null, after: input.name.trim() },
            ...add('Key', input.key),
            ...add('Kind', input.connectorType),
            ...add('Direction', input.direction),
            ...add('Parser', input.parser),
          ],
          given({
            p_workspace_id: context.workspaceId,
            p_key: input.key,
            p_name: input.name.trim(),
            p_connector_type: input.connectorType,
            p_direction: input.direction,
            p_config: {},
            p_parser_id: input.parser ?? null,
          }),
          INTEGRATIONS,
        ),
      ),
  }),
  cardSpec({
    tool: C['connector.update'].tool,
    kind: 'connector.update' as const,
    description:
      'Propose renaming a connector or changing the parser it uses. To pause, resume or archive one, use the connector status tool.',
    schema: S.connectorUpdate,
    build: async (input, context) => {
      if (!input.name && !input.parser && !input.clearParser)
        return failed('Say what to change: a new name or a parser.')

      const found = await findConnector(context, input.connector)

      if (!found.ok) return found.message

      return built(
        `${found.value.name} (${found.value.key})`,
        [
          ...(input.name
            ? [
                {
                  label: 'Name',
                  before: found.value.name,
                  after: input.name.trim(),
                },
              ]
            : []),
          ...(input.parser || input.clearParser
            ? [
                {
                  label: 'Parser',
                  before: found.value.parser_id,
                  after: input.clearParser ? 'None' : (input.parser ?? ''),
                },
              ]
            : []),
        ],
        given({
          p_workspace_id: context.workspaceId,
          p_connector_id: found.value.id,
          p_name: input.name?.trim(),
          p_parser_id: input.parser,
          p_clear_parser: input.clearParser,
        }),
        INTEGRATIONS,
      )
    },
  }),
  cardSpec({
    tool: C['parser.create_converter'].tool,
    kind: 'parser.create_converter' as const,
    description:
      'Propose adding a parser that reads an instrument’s files with one of the built-in vendor converters. A new version starts as a draft that a person approves.',
    schema: S.parserConverter,
    build: (input, context) =>
      newParser(context, input, { p_vendor: input.vendor }, [
        ...add('Converter', input.vendor),
      ]),
  }),
  cardSpec({
    tool: C['parser.create_webhook'].tool,
    kind: 'parser.create_webhook' as const,
    description:
      'Propose adding a parser that sends an instrument’s files to a web address to be read. A new version starts as a draft that a person approves.',
    schema: S.parserWebhook,
    build: (input, context) =>
      newParser(context, input, { p_url: input.url }, [
        ...add('Address', input.url),
      ]),
  }),
  cardSpec({
    tool: C['parser.create_version'].tool,
    kind: 'parser.create_version' as const,
    description:
      'Propose adding a version of a parser, with what a file must look like and how its columns map to fields. It starts as a draft that a person approves.',
    schema: S.parserVersion,
    build: (input, context) =>
      newParser(
        context,
        input,
        { p_signature: input.signature, p_mapping: input.mapping ?? {} },
        [],
      ),
  }),
  cardSpec({
    tool: C['parser.save_mapping'].tool,
    kind: 'parser.save_mapping' as const,
    description:
      'Propose saving how a parser’s columns map to fields, for one target.',
    schema: S.parserMapping,
    build: async (input, context) => {
      const parser = await findParser(context, input.parser)

      if (!parser.ok) return parser.message

      return built(
        `${parser.value.name} (${parser.value.key})`,
        [
          { label: 'Mapping for', before: null, after: input.target },
          {
            label: 'Columns',
            before: null,
            after: mappingSummary(input.mapping),
          },
        ],
        {
          p_parser_id: parser.value.id,
          p_target_key: input.target.trim(),
          p_mapping: input.mapping,
        },
        INTEGRATIONS,
      )
    },
  }),
  cardSpec({
    tool: C['parser.request_update'].tool,
    kind: 'parser.request_update' as const,
    description:
      'Propose asking for a parser to be updated, for a file that failed to parse.',
    schema: S.parserRequestUpdate,
    build: async (input, context) => {
      const file = await findRow<{ id: string; filename: string }>(
        context,
        'dataset_import_files',
        `?status=eq.failed&filename=ilike.${likeValue(input.file)}&select=id,filename&order=created_at.desc&limit=6`,
        'failed file',
        input.file,
        (row) => row.filename,
        (row) => [row.filename],
      )

      if (!file.ok) return file.message

      return built(
        file.value.filename,
        [
          {
            label: 'Parser',
            before: 'Failed to read it',
            after: 'Update asked for',
          },
        ],
        { p_file_id: file.value.id },
        INTEGRATIONS,
      )
    },
  }),
]

const mappingSummary = (
  mapping: Readonly<Record<string, RpcArgument>>,
): string => {
  const keys = Object.keys(mapping)

  return keys.length <= 6
    ? keys.join(', ') || 'none'
    : `${keys.slice(0, 6).join(', ')} and ${keys.length - 6} more`
}

interface ParserInput {
  key: string
  name: string
  format: string
  version: number
  instrument?: string
}

/** A new parser, or a new version of one: the same call with different extras. */
async function newParser(
  context: LabToolContext,
  input: ParserInput,
  extra: Record<string, RpcArgument>,
  changes: CardBuilt['changes'],
): Promise<CardBuilt | string> {
  let instrumentId: string | undefined
  let instrumentLine: CardBuilt['changes'] = []

  if (input.instrument) {
    const instrument = await findInstrument(context, input.instrument)

    if (!instrument.ok) return instrument.message
    instrumentId = instrument.value.id
    instrumentLine = add('For', instrument.value.label)
  }

  return built(
    `${input.name.trim()} (${input.key})`,
    [
      {
        label: 'Parser',
        before: null,
        after: `${input.name.trim()} v${input.version}`,
      },
      ...add('Reads', input.format),
      ...instrumentLine,
      ...changes,
    ],
    given({
      p_workspace_id: context.workspaceId,
      p_key: input.key,
      p_name: input.name.trim(),
      p_format: input.format,
      p_version: input.version,
      p_instrument_id: instrumentId,
      ...extra,
    }),
    INTEGRATIONS,
  )
}

export function isInstrumentSetupProposalTool(
  name: string,
): name is InstrumentSetupProposeToolName {
  return specs.some((spec) => spec.tool === name)
}

export const instrumentSetupProposalDefs = () => cardDefs(specs)

export const buildInstrumentSetupProposal = (
  name: InstrumentSetupProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; each spec parses them with its own schema before reading a field.
  args: unknown,
  context: LabToolContext,
) =>
  buildCard<InstrumentSetupProposeToolName, InstrumentSetupKind>(
    specs,
    name,
    args,
    context,
  )

// Referenced so a card added to the table without a builder fails typecheck here.
export const BUILT_KINDS: readonly InstrumentSetupKind[] = specs.map(
  (spec) => spec.kind,
)
