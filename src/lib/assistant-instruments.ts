import { z } from 'zod'

/**
 * Instruments, runs and connectors from the assistant: add an instrument,
 * retire it or bring it back, record a calibration, qualify a person on it or
 * take their qualification away, start or finish an instrument run, and
 * pause or resume a connector. Reading all of these is the lab list tool
 * (`instruments`, `instrument_runs`, `calibrations`, `qualifications`,
 * `connectors` and more).
 *
 * Like the other cards, the model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button. The button calls the ordinary RPC as the signed-in
 * person, so permissions and the audit trail are the page's own. Approving a
 * parser version stays with people.
 */

export const INSTRUMENT_ADD_TOOL = 'sheetbase.instrument.add'
export const INSTRUMENT_RETIRE_TOOL = 'sheetbase.instrument.retire'
export const INSTRUMENT_CALIBRATE_TOOL = 'sheetbase.instrument.calibrate'
export const INSTRUMENT_QUALIFY_TOOL = 'sheetbase.instrument.qualify'
export const RUN_CREATE_TOOL = 'sheetbase.run.create'
export const RUN_UPDATE_TOOL = 'sheetbase.run.update'
export const CONNECTOR_SET_TOOL = 'sheetbase.connector.set_status'

export const INSTRUMENTS_PROPOSE_TOOL_NAMES = [
  INSTRUMENT_ADD_TOOL,
  INSTRUMENT_RETIRE_TOOL,
  INSTRUMENT_CALIBRATE_TOOL,
  INSTRUMENT_QUALIFY_TOOL,
  RUN_CREATE_TOOL,
  RUN_UPDATE_TOOL,
  CONNECTOR_SET_TOOL,
] as const

export type InstrumentsProposeToolName =
  (typeof INSTRUMENTS_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

const instrument = z
  .string()
  .min(1)
  .max(200)
  .describe('The instrument, by name or INS number.')

export const proposeInstrumentAddSchema = z.strictObject({
  title,
  summary,
  name: z.string().min(1).max(200).describe('What the instrument is called.'),
  instrumentType: z
    .enum(['qpcr', 'sequencer', 'spectrophotometer', 'other'])
    .optional()
    .describe('The kind of instrument. Leave out when unsure.'),
  model: z.string().max(200).optional(),
  serialNumber: z.string().max(200).optional(),
  vendor: z.string().max(200).optional(),
  location: z.string().max(200).optional().describe('Where it is.'),
})

export const proposeInstrumentRetireSchema = z.strictObject({
  title,
  summary,
  instrument,
  retire: z
    .boolean()
    .optional()
    .describe('false to bring a retired instrument back. Default true.'),
})

export const proposeInstrumentCalibrateSchema = z.strictObject({
  title,
  summary,
  instrument,
  performedOn: day.describe('The day it was calibrated.'),
  dueOn: day.describe('When the next calibration is due.'),
  notes: z.string().max(500).optional(),
})

export const proposeInstrumentQualifySchema = z.strictObject({
  title,
  summary,
  instrument,
  person: z
    .string()
    .min(1)
    .max(200)
    .describe('The person, by their name as it shows in the workspace.'),
  revoke: z
    .boolean()
    .optional()
    .describe('true to take their qualification away. Default false.'),
  validUntil: day
    .optional()
    .describe('Until when they may use it. Ask when granting.'),
  qualifiedFor: z
    .string()
    .max(200)
    .optional()
    .describe('What they may do on it, if the person said.'),
})

export const proposeRunCreateSchema = z.strictObject({
  title,
  summary,
  instrument,
  name: z.string().min(1).max(200).describe('What to call the run.'),
  runIdentifier: z
    .string()
    .max(100)
    .optional()
    .describe('The run’s own number or barcode, when they gave one.'),
  protocol: z.string().max(200).optional(),
  operator: z.string().max(200).optional(),
})

export const proposeRunUpdateSchema = z.strictObject({
  title,
  summary,
  run: z
    .string()
    .min(1)
    .max(200)
    .describe('The open run, by its identifier or words from its name.'),
  status: z
    .enum(['running', 'completed', 'failed'])
    .describe('What happened to it.'),
  error: z
    .string()
    .max(500)
    .optional()
    .describe('What went wrong, for failed.'),
})

export const proposeConnectorSetSchema = z.strictObject({
  title,
  summary,
  connector: z
    .string()
    .min(1)
    .max(200)
    .describe('The connector, by words from its name or its key.'),
  status: z
    .enum(['active', 'paused', 'archived'])
    .describe('paused stops it running; active resumes it.'),
})

/** What an instrument card does when its button is pressed. */
export type InstrumentsAction =
  | {
      kind: 'instrument.add'
      workspaceId: string
      name: string
      instrumentType: string | null
      model: string | null
      serialNumber: string | null
      vendor: string | null
      location: string | null
    }
  | { kind: 'instrument.retire'; instrumentId: string; retired: boolean }
  | {
      kind: 'instrument.calibrate'
      instrumentId: string
      performedAt: string
      dueAt: string
      notes: string | null
    }
  | {
      kind: 'instrument.qualify'
      instrumentId: string
      userId: string
      /** `null` takes the qualification away. */
      validUntil: string | null
      qualifiedFor: string | null
    }
  | {
      kind: 'run.create'
      workspaceId: string
      instrumentId: string
      name: string
      runIdentifier: string
      protocolName: string | null
      operator: string | null
    }
  | {
      kind: 'run.update'
      workspaceId: string
      runId: string
      status: 'running' | 'completed' | 'failed'
      error: string | null
    }
  | {
      kind: 'connector.set'
      workspaceId: string
      connectorId: string
      status: 'active' | 'paused' | 'archived'
    }

export type InstrumentsActionKind = InstrumentsAction['kind']

const KINDS: readonly string[] = [
  'instrument.add',
  'instrument.retire',
  'instrument.calibrate',
  'instrument.qualify',
  'run.create',
  'run.update',
  'connector.set',
]

export function isInstrumentsAction(action: {
  kind: string
}): action is InstrumentsAction {
  return KINDS.includes(action.kind)
}

export interface InstrumentsActionResult {
  openHref?: string
}
