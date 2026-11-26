import { z } from 'zod'

import { NORMALISATIONS } from '#/lib/plate-assay'
import type { AssayWell, PlateAssayConfig } from '#/lib/plate-assay'
import type { PlateWellAssignment } from '#/lib/plate-designer'
import { PLATE_FORMATS } from '#/lib/plate-map'
import type { PlateFormat, PlateMapSpec } from '#/lib/plate-map'

/**
 * Plates from the assistant. The model names runs (PLR-0012), designs,
 * worklists (WL-0004) and samples the way people do, the server finds them
 * under the person's own access and sends back a card, and nothing changes
 * until the person presses its button, which calls the ordinary RPCs as them.
 */

export const PLATE_RUN_CREATE_TOOL = 'sheetbase.plate_run.create'
export const PLATE_RUN_UPDATE_TOOL = 'sheetbase.plate_run.update'
export const PLATE_RUN_ARCHIVE_TOOL = 'sheetbase.plate_run.archive'
export const PLATE_DESIGN_CREATE_TOOL = 'sheetbase.plate_design.create'
export const PLATE_DESIGN_FILL_TOOL = 'sheetbase.plate_design.fill'
export const PLATE_LAYOUT_SAVE_TOOL = 'sheetbase.plate_layout.save'
export const PLATE_QC_TRACK_TOOL = 'sheetbase.plate_design.track_qc'
export const WORKLIST_CANCEL_TOOL = 'sheetbase.worklist.cancel'
export const WORKLIST_COMPLETE_TOOL = 'sheetbase.worklist.complete'

export const PLATE_ASSAYS_PROPOSE_TOOL_NAMES: readonly string[] = [
  PLATE_RUN_CREATE_TOOL,
  PLATE_RUN_UPDATE_TOOL,
  PLATE_RUN_ARCHIVE_TOOL,
  PLATE_DESIGN_CREATE_TOOL,
  PLATE_DESIGN_FILL_TOOL,
  PLATE_LAYOUT_SAVE_TOOL,
  PLATE_QC_TRACK_TOOL,
  WORKLIST_CANCEL_TOOL,
  WORKLIST_COMPLETE_TOOL,
]

export type PlateAssaysProposeToolName =
  | typeof PLATE_RUN_CREATE_TOOL
  | typeof PLATE_RUN_UPDATE_TOOL
  | typeof PLATE_RUN_ARCHIVE_TOOL
  | typeof PLATE_DESIGN_CREATE_TOOL
  | typeof PLATE_DESIGN_FILL_TOOL
  | typeof PLATE_LAYOUT_SAVE_TOOL
  | typeof PLATE_QC_TRACK_TOOL
  | typeof WORKLIST_CANCEL_TOOL
  | typeof WORKLIST_COMPLETE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const shared = { title, summary }

const runRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The plate run by number (PLR-0012) or words from its name.')

const designRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The plate design by name.')

const format = z
  .enum(PLATE_FORMATS)
  .describe('The plate format, such as 96_well or 384_well.')

export const proposePlateRunCreateSchema = z.strictObject({
  ...shared,
  name: z.string().min(1).max(200).describe('The plate run’s name.'),
  format: format.optional().describe('96_well when not said.'),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('The project, by name, key or ID (PRJ-0008).'),
  experiment: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The experiment it belongs to, by ID (EXP-0042) or title. Its notebook then shows the run.',
    ),
  samples: z
    .array(z.string().min(1).max(200))
    .max(1536)
    .optional()
    .describe(
      'Sample IDs (S-0142) or names, in the order they go on the plate. Ones that are sample IDs are linked to the sample.',
    ),
  replicates: z.number().int().min(1).max(12).optional(),
  direction: z
    .enum(['across', 'down'])
    .optional()
    .describe('Fill across the rows or down the columns. Across if not said.'),
  dilution: z
    .number()
    .min(1)
    .optional()
    .describe('How far the samples were diluted; 1 is neat.'),
  blanks: z.number().int().min(0).max(96).optional(),
  standards: z
    .strictObject({
      top: z.number().positive().describe('The highest standard.'),
      unit: z.string().max(40),
      fold: z.number().gt(1).describe('2 means each is half the one above.'),
      points: z.number().int().min(2).max(24),
      replicates: z.number().int().min(1).max(12).optional(),
    })
    .optional()
    .describe('A standard curve down the first columns.'),
})

export const proposePlateRunUpdateSchema = z.strictObject({
  ...shared,
  run: runRef,
  name: z.string().min(1).max(200).optional().describe('A new name.'),
  normalisation: z.enum(NORMALISATIONS).optional(),
  subtractBlank: z
    .boolean()
    .optional()
    .describe('Subtract the mean of the blank wells first.'),
  hitThreshold: z
    .number()
    .optional()
    .describe('A hit is a well past this normalised value.'),
})

export const proposePlateRunArchiveSchema = z.strictObject({
  ...shared,
  run: runRef,
})

export const proposePlateDesignCreateSchema = z.strictObject({
  ...shared,
  name: z.string().min(1).max(200),
  format: format.optional(),
  project: z.string().max(200).optional(),
})

export const proposePlateDesignFillSchema = z.strictObject({
  ...shared,
  design: designRef,
  samples: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(1536)
    .describe('Sample IDs (S-0142) or names, in plate order.'),
  replicates: z.number().int().min(1).max(12).optional(),
  fillDirection: z
    .enum(['row', 'column', 'serpentine', 'column_serpentine'])
    .optional(),
  startWell: z.string().max(8).optional().describe('A1 if not said.'),
  randomize: z.boolean().optional(),
  controls: z
    .array(
      z.strictObject({
        role: z.enum([
          'positive_control',
          'negative_control',
          'blank',
          'standard',
        ]),
        well: z.string().min(2).max(8),
      }),
    )
    .max(200)
    .optional(),
})

export const proposePlateLayoutSaveSchema = z.strictObject({
  ...shared,
  design: designRef.describe('The design whose layout is kept as a template.'),
  name: z.string().min(1).max(200).describe('The template’s name.'),
  description: z.string().max(400).optional(),
})

export const proposePlateQcTrackSchema = z.strictObject({
  ...shared,
  design: designRef.describe('The assay design to keep a quality chart for.'),
  instrument: z
    .string()
    .max(200)
    .optional()
    .describe('The reader, by name or INS number, when it matters.'),
})

const worklistRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The worklist by number (WL-0004) or words from its name.')

export const proposeWorklistCancelSchema = z.strictObject({
  ...shared,
  worklist: worklistRef,
})

export const proposeWorklistCompleteSchema = z.strictObject({
  ...shared,
  worklist: worklistRef,
  experiment: z
    .string()
    .max(200)
    .optional()
    .describe('The experiment the liquid was used for.'),
  recordWithdrawals: z
    .boolean()
    .optional()
    .describe(
      'Also take the moved volumes out of the source samples. Needs an experiment. Not done unless asked.',
    ),
})

/** What a card does when its button is pressed. */
export type PlateAssaysAction =
  | {
      kind: 'plate_run.create'
      name: string
      format: PlateFormat
      projectId: string | null
      experimentId: string | null
      wells: AssayWell[]
    }
  | {
      kind: 'plate_run.update'
      runId: string
      metadataVersion: number
      name: string | null
      config: PlateAssayConfig | null
    }
  | { kind: 'plate_run.archive'; runId: string }
  | {
      kind: 'plate_design.create'
      workspaceId: string
      name: string
      format: PlateFormat
      projectId: string | null
    }
  | {
      kind: 'plate_design.fill'
      designId: string
      metadataVersion: number
      wells: PlateWellAssignment[]
    }
  | {
      kind: 'plate_layout.save'
      workspaceId: string
      name: string
      description: string | null
      format: PlateFormat
      rows: number
      cols: number
      layout: PlateMapSpec
    }
  | {
      kind: 'plate_design.track_qc'
      designId: string
      instrumentId: string | null
    }
  | { kind: 'worklist.cancel'; worklistId: string }
  | {
      kind: 'worklist.complete'
      worklistId: string
      experimentId: string | null
      recordWithdrawals: boolean
    }

const PLATE_ASSAYS_ACTIONS = new Set([
  'plate_run.create',
  'plate_run.update',
  'plate_run.archive',
  'plate_design.create',
  'plate_design.fill',
  'plate_layout.save',
  'plate_design.track_qc',
  'worklist.cancel',
  'worklist.complete',
])

export function isPlateAssaysAction(action: {
  kind: string
}): action is PlateAssaysAction {
  return PLATE_ASSAYS_ACTIONS.has(action.kind)
}
