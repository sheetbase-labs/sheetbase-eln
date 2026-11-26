import { z } from 'zod'

import { cardWords } from '#/lib/assistant-call-cards'
import type { RpcCardAction } from '#/lib/assistant-call-cards'

/**
 * Instrument set-up from the assistant: robot jobs and settings, live-feed
 * limits, who is qualified, bookings copied forward, bookable resources,
 * connectors and parsers. Like every write, each is a card: the model names
 * things the way the lab does (an instrument by name or INS number), the
 * server finds them and sends back a card that says what will change, and
 * nothing happens until the person presses its button, which calls the
 * ordinary RPC as them. The tool names are on the gateway allowlist through
 * `agent-tool-catalogue.ts`.
 */

/** Each card's kind, the tool that proposes it, and the function it calls. */
export const INSTRUMENT_SETUP_CARDS = {
  'instrument.job_queue': {
    tool: 'sheetbase.instrument.queue_job',
    rpc: 'queue_instrument_job',
  },
  'instrument.job_start': {
    tool: 'sheetbase.instrument.start_job',
    rpc: 'start_instrument_job',
  },
  'instrument.job_cancel': {
    tool: 'sheetbase.instrument.cancel_job',
    rpc: 'cancel_instrument_job',
  },
  'instrument.robot_set': {
    tool: 'sheetbase.instrument.set_robot',
    rpc: 'set_instrument_robot',
  },
  'instrument.robot_clear': {
    tool: 'sheetbase.instrument.clear_robot',
    rpc: 'clear_instrument_robot',
  },
  'instrument.feed_limits': {
    tool: 'sheetbase.instrument.set_feed_limits',
    rpc: 'set_instrument_feed_limits',
  },
  'instrument.feed_remove': {
    tool: 'sheetbase.instrument.remove_feed',
    rpc: 'remove_instrument_feed',
  },
  'instrument.gate_mode': {
    tool: 'sheetbase.instrument.set_gate_mode',
    rpc: 'set_instrument_gate_mode',
  },
  'instrument.intake_method': {
    tool: 'sheetbase.instrument.set_intake_method',
    rpc: 'set_instrument_intake_method',
  },
  'instrument.connection': {
    tool: 'sheetbase.instrument.set_connection',
    rpc: 'update_instrument_connection',
  },
  'instrument.qualification_request': {
    tool: 'sheetbase.instrument.request_qualification',
    rpc: 'request_instrument_qualification',
  },
  'instrument.qualification_dismiss': {
    tool: 'sheetbase.instrument.dismiss_qualification_request',
    rpc: 'dismiss_instrument_qualification_request',
  },
  'booking.duplicate': {
    tool: 'sheetbase.booking.duplicate',
    rpc: 'duplicate_booking',
  },
  'resource.create': {
    tool: 'sheetbase.resource.create',
    rpc: 'create_calendar_resource',
  },
  'connector.register': {
    tool: 'sheetbase.connector.register',
    rpc: 'register_connector',
  },
  'connector.update': {
    tool: 'sheetbase.connector.update',
    rpc: 'update_connector',
  },
  'parser.create_converter': {
    tool: 'sheetbase.parser.create_converter',
    rpc: 'create_converter_parser',
  },
  'parser.create_webhook': {
    tool: 'sheetbase.parser.create_webhook',
    rpc: 'create_webhook_parser',
  },
  'parser.create_version': {
    tool: 'sheetbase.parser.create_version',
    rpc: 'create_parser_version',
  },
  'parser.save_mapping': {
    tool: 'sheetbase.parser.save_mapping',
    rpc: 'save_parser_mapping',
  },
  'parser.request_update': {
    tool: 'sheetbase.parser.request_update',
    rpc: 'request_parser_update',
  },
} as const

export type InstrumentSetupKind = keyof typeof INSTRUMENT_SETUP_CARDS

export type InstrumentSetupProposeToolName =
  (typeof INSTRUMENT_SETUP_CARDS)[InstrumentSetupKind]['tool']

export type InstrumentSetupAction = RpcCardAction<InstrumentSetupKind>

export const INSTRUMENT_SETUP_PROPOSE_TOOL_NAMES: readonly string[] =
  Object.values(INSTRUMENT_SETUP_CARDS).map((card) => card.tool)

const instrument = z
  .string()
  .min(1)
  .max(200)
  .describe('The instrument, by name or INS number.')

const dateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .describe('YYYY-MM-DDTHH:MM on the person’s clock.')

const key = (what: string) =>
  z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,48}$/)
    .describe(
      `${what}: lowercase letters, digits and hyphens, starting with a letter.`,
    )

const parserKey = z
  .string()
  .min(1)
  .max(200)
  .describe('The parser, by its key or name.')

const FORMATS = ['csv', 'tsv', 'xlsx', 'json'] as const

const WORKLIST_FORMATS = [
  'csv',
  'echo',
  'tecan_gwl',
  'hamilton',
  'opentrons',
] as const

const json = z.record(z.string(), z.json())

export const instrumentSetupSchemas = {
  jobQueue: z.strictObject({
    ...cardWords,
    instrument,
    worklist: z
      .string()
      .min(1)
      .max(200)
      .describe('The planned worklist, by WL number or name.'),
    note: z.string().max(500).optional(),
  }),
  jobStart: z.strictObject({
    ...cardWords,
    instrument,
    job: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The job number, if the instrument has more than one waiting.'),
  }),
  jobCancel: z.strictObject({
    ...cardWords,
    instrument,
    job: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The job number, if the instrument has more than one open.'),
  }),
  robotSet: z.strictObject({
    ...cardWords,
    instrument,
    driver: z
      .enum(['opentrons', 'file'])
      .describe(
        'opentrons: sent to the robot. file: a worklist file for someone to load.',
      ),
    worklistFormat: z.enum(WORKLIST_FORMATS).optional(),
    labware: json
      .optional()
      .describe(
        'Where plates sit on the deck, as the robot settings page has them.',
      ),
    minTransferUl: z.number().nonnegative().optional(),
    maxTransferUl: z.number().positive().optional(),
  }),
  robotClear: z.strictObject({ ...cardWords, instrument }),
  feedLimits: z.strictObject({
    ...cardWords,
    instrument,
    feed: z.string().min(1).max(80).describe('The live feed, by name.'),
    low: z
      .number()
      .nullable()
      .describe('Lowest allowed reading; null for none.'),
    high: z
      .number()
      .nullable()
      .describe('Highest allowed reading; null for none.'),
    unit: z.string().max(20).optional(),
  }),
  feedRemove: z.strictObject({
    ...cardWords,
    instrument,
    feed: z.string().min(1).max(80).describe('The live feed, by name.'),
  }),
  gateMode: z.strictObject({
    ...cardWords,
    mode: z
      .enum(['off', 'warn', 'block'])
      .describe(
        'What happens when someone uses an instrument they are not qualified on or that is overdue calibration: off, warn, or block.',
      ),
  }),
  intakeMethod: z.strictObject({
    ...cardWords,
    instrument,
    method: z
      .enum(['filedrop', 'webhook', 'manual', 'none'])
      .describe('How the instrument’s data gets into the lab.'),
  }),
  connection: z.strictObject({
    ...cardWords,
    instrument,
    status: z.enum(['connected', 'disconnected', 'error']),
  }),
  qualificationRequest: z.strictObject({
    ...cardWords,
    instrument,
    note: z.string().max(500).optional(),
  }),
  qualificationDismiss: z.strictObject({
    ...cardWords,
    instrument,
    person: z
      .string()
      .max(200)
      .optional()
      .describe('Who asked, if more than one request is open.'),
  }),
  bookingDuplicate: z.strictObject({
    ...cardWords,
    bookingId: z
      .string()
      .uuid()
      .describe('The booking, from a schedule lookup.'),
    start: dateTime,
    end: dateTime,
    bookingTitle: z.string().min(1).max(200).optional(),
  }),
  resourceCreate: z.strictObject({
    ...cardWords,
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(40).describe('A short code, such as ROOM-2.'),
    resourceType: z.enum(['room', 'equipment', 'instrument']).default('room'),
    location: z.string().max(200).optional(),
    capacity: z.number().int().positive().max(1000).optional(),
    timezone: z.string().max(60).optional(),
  }),
  connectorRegister: z.strictObject({
    ...cardWords,
    key: key('The connector’s short key'),
    name: z.string().min(1).max(200),
    connectorType: z
      .enum(['instrument', 'storage', 'webhook', 'database', 'custom'])
      .default('custom'),
    direction: z
      .enum(['inbound', 'outbound', 'bidirectional'])
      .default('inbound'),
    parser: z
      .string()
      .max(100)
      .optional()
      .describe('The parser key, for an instrument connector.'),
  }),
  connectorUpdate: z.strictObject({
    ...cardWords,
    connector: z.string().min(1).max(200).describe('By key or name.'),
    name: z.string().min(1).max(200).optional(),
    parser: z.string().max(100).optional().describe('A parser key to use.'),
    clearParser: z.boolean().optional().describe('true stops using a parser.'),
  }),
  parserConverter: z.strictObject({
    ...cardWords,
    key: parserKey,
    name: z.string().min(1).max(200),
    format: z.enum(FORMATS),
    version: z.number().int().positive().default(1),
    vendor: z
      .string()
      .regex(/^[A-Z0-9_]{2,80}$/)
      .describe(
        'The converter’s vendor name in capitals, such as AGILENT_GEN5.',
      ),
    instrument: instrument.optional(),
  }),
  parserWebhook: z.strictObject({
    ...cardWords,
    key: parserKey,
    name: z.string().min(1).max(200),
    format: z.enum(FORMATS),
    version: z.number().int().positive().default(1),
    url: z.string().url().max(2048),
    instrument: instrument.optional(),
  }),
  parserVersion: z.strictObject({
    ...cardWords,
    key: parserKey,
    name: z.string().min(1).max(200),
    format: z.enum(FORMATS),
    version: z.number().int().positive(),
    signature: json.describe('What a file must look like for this parser.'),
    mapping: json.optional().describe('How its columns map to fields.'),
    instrument: instrument.optional(),
  }),
  parserMapping: z.strictObject({
    ...cardWords,
    parser: parserKey,
    target: z.string().min(1).max(200).describe('What the mapping fills.'),
    mapping: json,
  }),
  parserRequestUpdate: z.strictObject({
    ...cardWords,
    file: z
      .string()
      .min(1)
      .max(200)
      .describe('The file that failed to parse, by file name.'),
  }),
}
