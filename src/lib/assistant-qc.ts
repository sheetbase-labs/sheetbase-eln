import { z } from 'zod'

/**
 * Quality control from the assistant: set the control limits of a tracked
 * series and acknowledge a breach. Reading series is the lab list tool's `qc`
 * area. Like the other cards, the model names the series the way people do,
 * the server finds it and sends back a card, and nothing happens until the
 * person presses the button. The button runs the ordinary quality control RPCs
 * as the signed-in person.
 */

export const QC_SET_BASELINE_TOOL = 'sheetbase.qc.set_baseline'
export const QC_ACKNOWLEDGE_TOOL = 'sheetbase.qc.acknowledge'

export const QC_PROPOSE_TOOL_NAMES = [
  QC_SET_BASELINE_TOOL,
  QC_ACKNOWLEDGE_TOOL,
] as const

export type QcProposeToolName = (typeof QC_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const series = z
  .string()
  .min(1)
  .max(200)
  .describe('The tracked quality control series, by words from its name.')

export const proposeQcBaselineSchema = z
  .object({
    title,
    summary,
    series,
    mean: z.number().optional().describe('The centre line, when they gave it.'),
    sd: z
      .number()
      .positive()
      .optional()
      .describe('The standard deviation, when they gave it. Needs the mean.'),
    firstN: z
      .number()
      .int()
      .min(3)
      .max(1000)
      .optional()
      .describe(
        'Take the mean and SD from the first N points instead, when they asked for a baseline period.',
      ),
  })
  .strict()

export const proposeQcAcknowledgeSchema = z
  .object({
    title,
    summary,
    series,
    note: z
      .string()
      .min(1)
      .max(500)
      .describe('What was done about it, in the person’s words.'),
    exclude: z
      .boolean()
      .optional()
      .describe(
        'true when they said to leave the point out of the limits (a known fault, not a real shift). false otherwise.',
      ),
  })
  .strict()

/** What a quality control card does when its button is pressed. */
export type QcAction =
  | {
      kind: 'qc.set_baseline'
      seriesId: string
      limits: { mean: number; sd: number } | { firstN: number }
    }
  | {
      kind: 'qc.acknowledge'
      pointIds: string[]
      note: string
      exclude: boolean
    }

export type QcActionKind = QcAction['kind']

const KINDS: readonly string[] = ['qc.set_baseline', 'qc.acknowledge']

export function isQcAction(action: { kind: string }): action is QcAction {
  return KINDS.includes(action.kind)
}

export interface QcActionResult {
  openHref?: string
}
