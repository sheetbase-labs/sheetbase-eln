import { z } from 'zod'

import { WORKLIST_FORMATS, WORKLIST_MODES } from './plate-worklist'
import type { WorklistFormat, WorklistMode } from './plate-worklist'

/**
 * Plates from the assistant: re-analyse a plate run against its controls and
 * make a liquid handler worklist from one. Like the other cards, the model
 * names the run the way people do, the server finds it and sends back a card,
 * and nothing happens until the person presses the button. The button runs the
 * ordinary plate RPCs as the signed-in person.
 *
 * Reading plate runs and worklists is the lab list tool's `plate_runs` and
 * `worklists` areas. Completing a worklist needs the robot's log, so that stays
 * on the Plates page.
 */

export const PLATE_ANALYSE_TOOL = 'sheetbase.plate.analyse'
export const WORKLIST_CREATE_TOOL = 'sheetbase.worklist.create'

export const PLATES_PROPOSE_TOOL_NAMES = [
  PLATE_ANALYSE_TOOL,
  WORKLIST_CREATE_TOOL,
] as const

export type PlatesProposeToolName = (typeof PLATES_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const run = z
  .string()
  .min(1)
  .max(200)
  .describe('The plate run by number (PLR-0012) or words from its name.')

export const proposePlateAnalyseSchema = z.strictObject({ title, summary, run })

export const proposeWorklistCreateSchema = z.strictObject({
  title,
  summary,
  run,
  format: z
    .enum(WORKLIST_FORMATS)
    .optional()
    .describe(
      'The liquid handler the file is for: csv (plain), echo, tecan_gwl, hamilton or opentrons. csv when they did not say.',
    ),
  mode: z
    .enum(WORKLIST_MODES)
    .optional()
    .describe(
      'stamp copies each source well to the same well of the new plate. cherry_pick takes each sample from its own source well. stamp when they did not say.',
    ),
  sourcePlate: z
    .string()
    .max(100)
    .optional()
    .describe('Source plate name or barcode.'),
  volumeUl: z
    .number()
    .positive()
    .max(100_000)
    .optional()
    .describe(
      'Microlitres to move into every well that has no volume of its own.',
    ),
})

/** What a plates card does when its button is pressed. */
export type PlatesAction =
  | { kind: 'plate.analyse'; runId: string }
  | {
      kind: 'worklist.create'
      runId: string
      format: WorklistFormat
      mode: WorklistMode
      sourcePlate: string
      volumeUl: number | null
    }

export type PlatesActionKind = PlatesAction['kind']

const KINDS: readonly string[] = ['plate.analyse', 'worklist.create']

export function isPlatesAction(action: {
  kind: string
}): action is PlatesAction {
  return KINDS.includes(action.kind)
}

export interface PlatesActionResult {
  openHref?: string
}
