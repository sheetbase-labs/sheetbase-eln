import type { DataClient } from '#/lib/data-client'
import { defaultAssayConfig } from '#/lib/plate-assay'
import { analyseAndSavePlateRun, createPlateRun } from '#/lib/plate-runs'

import type { PlateFromFileAction } from './plate'

/** Makes the plate run, as the person, through the ordinary plate RPCs. */
export async function createPlateFromFile(
  client: DataClient,
  action: PlateFromFileAction,
): Promise<{ openHref: string }> {
  const run = await createPlateRun(client, {
    name: action.name,
    format: action.format,
    wells: action.wells,
    readout: action.readout,
    config: defaultAssayConfig(),
  })

  const final = action.analyse
    ? (await analyseAndSavePlateRun(client, run)).run
    : run

  return { openHref: `/plates?run=${final.id}` }
}
