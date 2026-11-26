/**
 * Plates from the assistant: set up a plate run, rename or archive it, design a
 * plate and save it as a layout, track an assay's quality over time, and cancel
 * or finish a liquid handler worklist. Analysing a run, making a worklist and
 * adding a run to an experiment have cards in `src/lib/assistant-plates.ts` and
 * `src/lib/plate-experiment.ts`.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'plate-assays',
})
