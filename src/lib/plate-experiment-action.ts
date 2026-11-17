import type { DataClient } from './data-client'
import { experimentPath } from './navigation'
import {
  controlColumnsOfWells,
  createAssayDesign,
  saveAssaySetup,
} from './plate-assay-setup'
import { addPlateRunToExperiment } from './plate-experiment-run'
import type {
  PlateExperimentAction,
  PlateExperimentActionResult,
} from './plate-experiment'
import { fetchPlateRun, publishPlateRunMeasurements } from './plate-runs'

/** Runs the card's action as the person who pressed the button. */
export async function runPlateExperimentAction(
  client: DataClient,
  action: PlateExperimentAction,
): Promise<PlateExperimentActionResult> {
  if (action.kind === 'plate.remember_setup') {
    const run = await fetchPlateRun(client, action.runId)

    if (!run) throw new Error('That plate run is no longer available.')

    const controls = controlColumnsOfWells(run.wells)

    const setup = {
      config: run.config,
      negativeColumns: controls.negative,
      positiveColumns: controls.positive,
    }

    if (action.designId)
      await saveAssaySetup(client, {
        designId: action.designId,
        setup,
        runId: run.id,
      })
    else
      await createAssayDesign(client, {
        workspaceId: action.workspaceId,
        name: action.designName,
        format: run.format,
        setup,
        runId: run.id,
      })

    return { openHref: '/plates?run=' + run.id }
  }

  if (action.kind === 'plate.publish_measurements') {
    await publishPlateRunMeasurements(
      client,
      action.runId,
      action.name ?? undefined,
    )

    return { openHref: '/plates?run=' + action.runId }
  }

  await addPlateRunToExperiment(client, {
    runId: action.runId,
    recordId: action.recordId,
    stepBlockId: action.stepBlockId,
  })

  return { openHref: experimentPath(action.recordId) }
}
