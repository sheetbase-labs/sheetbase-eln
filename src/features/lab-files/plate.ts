import { z } from 'zod'

import { ASSIGNMENT_ROLES } from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'
import type { AssayWell, PlateReadout } from '#/lib/plate-assay'

/**
 * A plate reader export, read from an attached file and turned into a plate
 * run: the wells, what each held and the plate's format. The card is built
 * from the file's own numbers, never from numbers the model typed, so what
 * the person approves is what was in the file.
 */

export const PLATE_FROM_FILE_TOOL = 'sheetbase.plate.from_file'

export const LAB_FILES_PROPOSE_TOOL_NAMES = [PLATE_FROM_FILE_TOOL] as const

export type LabFilesProposeToolName =
  (typeof LAB_FILES_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposePlateFromFileSchema = z.strictObject({
  title,
  summary,
  file: z
    .string()
    .min(1)
    .max(200)
    .describe('The attached file: F1, F2 ..., its id or words from its name.'),
  name: z
    .string()
    .min(1)
    .max(120)
    .describe('What to call the plate run, such as "PicoGreen plate 3".'),
  sheet: z
    .string()
    .max(100)
    .optional()
    .describe('The sheet holding the plate. The first sheet when left out.'),
  startRow: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'First row of the plate, counting from 1: the row of column numbers for a grid, or the header row of a list. Leave out and the plate is looked for.',
    ),
  endRow: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Last row of the plate. Leave out to read to the end of it.'),
  roles: z
    .array(
      z.strictObject({
        role: z.enum(ASSIGNMENT_ROLES),
        wells: z
          .array(z.string().min(2).max(12))
          .min(1)
          .max(400)
          .describe(
            'Well codes or ranges, such as "A1", "A1:A12", "H1:H12". A range is the rectangle between its corners.',
          ),
      }),
    )
    .max(12)
    .optional()
    .describe(
      'What the wells hold, when the person said (controls, blanks). Every well not named is a sample.',
    ),
  analyse: z
    .boolean()
    .optional()
    .describe(
      'Also analyse the plate against its controls once it is made. Only when there are controls.',
    ),
})

export type PlateFromFileInput = z.infer<typeof proposePlateFromFileSchema>

export interface PlateFromFileAction {
  kind: 'plate.from_file'
  name: string
  format: PlateFormat
  wells: AssayWell[]
  readout: PlateReadout
  analyse: boolean
}

export function isLabFilesAction(action: {
  kind: string
}): action is PlateFromFileAction {
  return action.kind === 'plate.from_file'
}
