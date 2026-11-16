import type { DataClient } from './data-client'
import { experimentPath } from './navigation'
import { addPlateRunToExperiment } from './plate-experiment-run'
import type {
  PlateExperimentAction,
  PlateExperimentActionResult,
} from './plate-experiment'

/** Runs the card's action as the person who pressed the button. */
export async function runPlateExperimentAction(
  client: DataClient,
  action: PlateExperimentAction,
): Promise<PlateExperimentActionResult> {
  await addPlateRunToExperiment(client, {
    runId: action.runId,
    recordId: action.recordId,
  })

  return { openHref: experimentPath(action.recordId) }
}
