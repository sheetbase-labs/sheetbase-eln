import { z } from 'zod'

/**
 * Putting a plate run in an experiment, from the assistant. The model names the
 * run and the experiment the way people do, the server finds both and sends a
 * card, and nothing changes until the person presses the button. The button
 * attaches the run and adds a plate run block to the experiment's notebook, as
 * the person.
 */

export const PLATE_ADD_TOOL = 'sheetbase.plate.add_to_experiment'

export const PLATE_REMEMBER_TOOL = 'sheetbase.plate.remember_setup'

export const PLATE_PUBLISH_TOOL = 'sheetbase.plate.publish_measurements'

export const PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES = [
  PLATE_ADD_TOOL,
  PLATE_REMEMBER_TOOL,
  PLATE_PUBLISH_TOOL,
] as const

export type PlateExperimentProposeToolName =
  (typeof PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES)[number]

export const proposePlateAddSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  run: z
    .string()
    .min(1)
    .max(200)
    .describe('The plate run by number (PLR-0012) or words from its name.'),
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment by identifier (EXP-0042) or words from its title.',
    ),
  step: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The protocol step the plate was run for, by words from it (such as "ELISA"). Leave it out and the plate goes in the first open step that names plates, else at the end of the notebook.',
    ),
})

export const proposePlatePublishSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  run: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The plate run, read by a standard curve, by number (PLR-0012) or words from its name.',
    ),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'What the result is called on each sample, such as "Capsid titre". Leave it out to use the assay’s name.',
    ),
})

export const proposePlateRememberSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  run: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The plate run whose controls and settings are remembered, by number (PLR-0012) or words from its name.',
    ),
  design: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The assay design to remember them on, by name. Leave it out to use the design the run already follows. A name that matches no design makes a new assay with that name.',
    ),
})

/** What the card does when its button is pressed. */
export type PlateExperimentAction =
  | {
      kind: 'plate.add_to_experiment'
      runId: string
      recordId: string
      /** The protocol step to put the run in; null puts it at the end of the notebook. */
      stepBlockId?: string | null
    }
  | {
      kind: 'plate.publish_measurements'
      runId: string
      name: string | null
    }
  | {
      kind: 'plate.remember_setup'
      runId: string
      /** The design to remember the setup on; null makes a new assay named `designName`. */
      designId: string | null
      designName: string
      workspaceId: string
    }

export function isPlateExperimentAction(action: {
  kind: string
}): action is PlateExperimentAction {
  return (
    action.kind === 'plate.add_to_experiment' ||
    action.kind === 'plate.remember_setup' ||
    action.kind === 'plate.publish_measurements'
  )
}

export interface PlateExperimentActionResult {
  openHref?: string
}
