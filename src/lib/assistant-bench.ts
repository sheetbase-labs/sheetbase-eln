import { z } from 'zod'

/**
 * Everyday bench jobs from the assistant: order a reagent, log samples, use,
 * move or split a sample, report an incident, send a request to the lab, move
 * a sample to its next stage, take an instrument out of service.
 *
 * The model names things the way people do; the server finds them and sends
 * back a card. Nothing happens until the person presses the card's button,
 * which calls the same RPC the page calls, as the signed-in person, so
 * permissions, versions and the audit trail are the page's own. Signing,
 * approving, deciding requests and releasing samples are not here: those stay
 * with people on the page.
 */

export const REAGENT_ORDER_TOOL = 'sheetbase.reagent.order'
export const REAGENT_RECEIVE_TOOL = 'sheetbase.reagent.receive'
export const REAGENT_PLACE_TOOL = 'sheetbase.reagent.mark_ordered'
export const INSTRUMENT_RATE_TOOL = 'sheetbase.instrument.set_rate'
export const SAMPLES_LOG_TOOL = 'sheetbase.sample.log'
export const SAMPLE_USE_TOOL = 'sheetbase.sample.use'
export const SAMPLE_MOVE_TOOL = 'sheetbase.sample.move'
export const SAMPLE_SPLIT_TOOL = 'sheetbase.sample.split'
export const INCIDENT_REPORT_TOOL = 'sheetbase.incident.report'
export const REQUEST_SEND_TOOL = 'sheetbase.request.send'
export const SAMPLE_ADVANCE_TOOL = 'sheetbase.sample.advance'
export const INSTRUMENT_SERVICE_TOOL = 'sheetbase.instrument.out_of_service'
export const STORAGE_READING_TOOL = 'sheetbase.storage.log_reading'

export const BENCH_PROPOSE_TOOL_NAMES = [
  REAGENT_ORDER_TOOL,
  REAGENT_RECEIVE_TOOL,
  REAGENT_PLACE_TOOL,
  INSTRUMENT_RATE_TOOL,
  SAMPLES_LOG_TOOL,
  SAMPLE_USE_TOOL,
  SAMPLE_MOVE_TOOL,
  SAMPLE_SPLIT_TOOL,
  INCIDENT_REPORT_TOOL,
  REQUEST_SEND_TOOL,
  SAMPLE_ADVANCE_TOOL,
  INSTRUMENT_SERVICE_TOOL,
  STORAGE_READING_TOOL,
] as const

export type BenchProposeToolName = (typeof BENCH_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

const sampleRef = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The sample as the person names it: its identifier (S-0142) or name.',
  )

const fieldValues = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .describe(
    'Answers for the form, keyed by the field names the person sees. Only fields they gave you.',
  )

export const proposeReagentOrderSchema = z.strictObject({
  title,
  summary,
  material: z
    .string()
    .min(1)
    .max(200)
    .describe('The reagent or material by name or identifier.'),
  quantity: z.number().positive().describe('How many units to order.'),
  unit: z
    .string()
    .max(40)
    .optional()
    .describe(
      'The unit, such as "bottles" or "mL". Leave out to use the material’s.',
    ),
  note: z
    .string()
    .max(500)
    .optional()
    .describe('Supplier or catalogue note for whoever places the order.'),
})

export const proposeReagentReceiveSchema = z.strictObject({
  title,
  summary,
  order: z
    .string()
    .min(1)
    .max(200)
    .describe('The order by number (RO-0007) or the material it is for.'),
  lot: z.string().min(1).max(100).describe('The lot number on the bottle.'),
  expiry: day.describe('Expiry date, YYYY-MM-DD.'),
  quantity: z
    .number()
    .positive()
    .optional()
    .describe('Amount received. Leave out when it is what was ordered.'),
})

export const proposeReagentPlaceSchema = z.strictObject({
  title,
  summary,
  order: z
    .string()
    .min(1)
    .max(200)
    .describe('The open order by number (RO-0007) or the material it is for.'),
  supplier: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Who it was bought from, as the person says it. Matched to the lab’s supplier list when there is one.',
    ),
  reference: z
    .string()
    .max(100)
    .optional()
    .describe('Purchase order or reference number.'),
  price: z
    .number()
    .min(0)
    .optional()
    .describe('What the whole order cost, including tax and carriage.'),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Use a three-letter code such as GBP.')
    .optional()
    .describe('Three-letter currency code. Needed with a price.'),
  expectedOn: day.optional().describe('When it should arrive, YYYY-MM-DD.'),
})

export const proposeInstrumentRateSchema = z.strictObject({
  title,
  summary,
  instrument: z
    .string()
    .min(1)
    .max(200)
    .describe('The instrument as the person names it: its name or INS number.'),
  ratePerHour: z
    .number()
    .min(0)
    .nullable()
    .describe('What each booked hour is charged. Null to stop charging.'),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Use a three-letter code such as GBP.')
    .optional()
    .describe('Three-letter currency code. Needed with a rate.'),
})

export const proposeSamplesLogSchema = z.strictObject({
  title,
  summary,
  project: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The project by name. Leave out only when the lab has one project.',
    ),
  samples: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        sampleType: z.string().max(100).optional(),
        quantity: z.number().positive().optional(),
        quantityUnit: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(96),
  box: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The box to file them in, by name (or code). They fill its free positions in order.',
    ),
  place: z
    .string()
    .max(200)
    .optional()
    .describe('A place typed in words, when there is no box to file them in.'),
})

export const proposeSampleUseSchema = z.strictObject({
  title,
  summary,
  sample: sampleRef,
  quantity: z
    .number()
    .positive()
    .describe('How much was used, in the sample’s unit.'),
  experiment: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('The experiment it was used for, by identifier or name.'),
  notes: z.string().max(500).optional(),
})

export const proposeSampleMoveSchema = z.strictObject({
  title,
  summary,
  samples: z
    .array(sampleRef)
    .min(1)
    .max(24)
    .describe(
      'The samples to move. Each goes to its own position when a box is named.',
    ),
  box: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'A box by name or code: samples fill its free positions in order.',
    ),
  place: z
    .string()
    .max(200)
    .optional()
    .describe(
      'A place in words, such as "-80 freezer, shelf 2", when it is not a box.',
    ),
  notes: z.string().max(500).optional(),
})

export const proposeSampleSplitSchema = z.strictObject({
  title,
  summary,
  sample: sampleRef,
  count: z.number().int().min(2).max(96).describe('How many tubes to make.'),
  quantityEach: z.number().positive().describe('Amount in each tube.'),
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment the tubes are for. Ask the person if they have not said.',
    ),
  notes: z.string().max(500).optional(),
})

export const proposeIncidentSchema = z.strictObject({
  title,
  summary,
  form: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('The incident form by name. Leave out when the lab has one.'),
  project: z.string().min(1).max(200).optional(),
  incidentTitle: z
    .string()
    .min(1)
    .max(200)
    .describe('A short title for the incident, in the person’s words.'),
  fields: fieldValues.optional(),
})

export const proposeRequestSchema = z.strictObject({
  title,
  summary,
  form: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The request form by name, such as the sequencing core’s. List requests first to see the forms.',
    ),
  requestTitle: z.string().min(1).max(200),
  project: z.string().min(1).max(200).optional(),
  note: z.string().max(1_000).optional(),
  fields: fieldValues.optional(),
})

export const proposeSampleAdvanceSchema = z.strictObject({
  title,
  summary,
  sample: sampleRef,
  toStage: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('The stage to move to. Leave out when only one stage follows.'),
  notes: z.string().max(500).optional(),
})

export const proposeInstrumentServiceSchema = z.strictObject({
  title,
  summary,
  instrument: z
    .string()
    .min(1)
    .max(200)
    .describe('The instrument as the person names it: its name or INS number.'),
  outOfService: z
    .boolean()
    .default(true)
    .describe('False to put it back in service.'),
  reason: z
    .string()
    .max(500)
    .optional()
    .describe(
      'What is wrong, in the person’s words. Needed when taking it out of service.',
    ),
  expectedBackOn: day
    .optional()
    .describe('When it should be back, YYYY-MM-DD.'),
  workDone: z
    .string()
    .max(500)
    .optional()
    .describe('The repair done, when putting it back in service.'),
})

export const proposeStorageReadingSchema = z.strictObject({
  title,
  summary,
  place: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The freezer, fridge, incubator or room as the person names it: its name or code.',
    ),
  measurement: z
    .string()
    .max(80)
    .default('Temperature')
    .describe('What was measured, such as "Temperature" or "Humidity".'),
  value: z.number().describe('The number read.'),
  unit: z
    .string()
    .max(20)
    .optional()
    .describe('The unit, such as "°C". Leave out to use the one already kept.'),
})

/**
 * What a bench card does when its button is pressed. Plain data, built and
 * checked on the server, run in the browser as the person.
 */
export type BenchAction =
  | {
      kind: 'reagent.order'
      materialRecordId: string
      quantity: number
      unit: string | null
      note: string | null
    }
  | {
      kind: 'reagent.receive'
      orderId: string
      lot: string
      expiry: string
      quantity: number | null
    }
  | {
      kind: 'reagent.place'
      orderId: string
      supplier: string | null
      supplierRecordId: string | null
      reference: string | null
      price: number | null
      currency: string | null
      expectedOn: string | null
    }
  | {
      kind: 'instrument.rate'
      instrumentId: string
      ratePerHour: number | null
      currency: string | null
    }
  | {
      kind: 'samples.log'
      projectId: string
      samples: Array<{
        title: string
        sampleType?: string
        quantity?: number
        quantityUnit?: string
        storageLocation?: string
      }>
      /** One free position per sample, in order; empty when not filed in a box. */
      positionIds: string[]
    }
  | {
      kind: 'sample.use'
      recordId: string
      quantity: number
      expectedMetadataVersion: number
      purposeRecordId: string | null
      notes: string | null
    }
  | {
      kind: 'sample.move'
      moves: Array<{
        recordId: string
        expectedMetadataVersion: number
        positionId: string | null
        toLocation: string | null
      }>
      notes: string | null
    }
  | {
      kind: 'sample.split'
      recordId: string
      count: number
      quantityEach: number
      unit: string | null
      purposeExperimentId: string
      expectedMetadataVersion: number
      notes: string | null
    }
  | {
      kind: 'record.create'
      projectId: string
      modelKey: string
      title: string
      customFields: Record<string, unknown>
    }
  | {
      kind: 'request.send'
      projectId: string | null
      modelKey: string
      title: string
      customFields: Record<string, unknown>
      note: string
    }
  | {
      kind: 'sample.advance'
      runId: string
      toStageId: string
      notes: string | null
    }
  | {
      kind: 'instrument.service'
      instrumentId: string
      outOfService: boolean
      reason: string | null
      expectedBackOn: string | null
      workDone: string | null
    }
  | {
      kind: 'storage.reading'
      placeKind: 'unit' | 'room'
      placeId: string
      feed: string
      value: number
      unit: string | null
    }

export type BenchActionKind = BenchAction['kind']

/** Plain words for why an action failed. */
export function describeActionError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message

  return 'Something went wrong. Try again.'
}
