import type { DataClient } from './data-client'
import {
  analyseAndSavePlateRun,
  createPlateWorklist,
  fetchPlateRun,
} from './plate-runs'
import { buildWorklist } from './plate-worklist'
import type { DestinationWell } from './plate-worklist'
import type { PlatesAction, PlatesActionResult } from './assistant-plates'

/** The wells a worklist fills: everything but blanks and empty wells. */
export function destinationsOf(
  wells: Array<{
    wellCode: string
    role: string
    sampleId?: string | null
    sampleLabel?: string | null
    volumeUl?: number | null
  }>,
): DestinationWell[] {
  return wells
    .filter((w) => w.role !== 'empty' && w.role !== 'blank')
    .map((w) => ({
      wellCode: w.wellCode,
      sampleId: w.sampleId ?? null,
      label: w.sampleLabel ?? w.role.replaceAll('_', ' '),
      volumeUl: w.volumeUl ?? null,
    }))
}

/** Runs a plates card's action. Loaded only in the browser, when a button is pressed. */
export async function runPlatesAction(
  client: DataClient,
  action: PlatesAction,
): Promise<PlatesActionResult | undefined> {
  const run = await fetchPlateRun(client, action.runId)
  if (!run) throw new Error('That plate run could not be found.')
  switch (action.kind) {
    case 'plate.analyse':
      await analyseAndSavePlateRun(client, run)
      return { openHref: `/plates?run=${run.id}` }
    case 'worklist.create': {
      const plan = buildWorklist(destinationsOf(run.wells), {
        mode: action.mode,
        sourcePlate: action.sourcePlate,
        sourceFormat: run.format,
        destFormat: run.format,
        destPlate: `PLR-${String(run.number).padStart(4, '0')}`,
        ...(action.volumeUl ? { defaultVolumeUl: action.volumeUl } : {}),
      })
      if (plan.transfers.length === 0)
        throw new Error('No transfers to make: give the wells a volume.')
      await createPlateWorklist(client, {
        name: `PLR-${String(run.number).padStart(4, '0')} ${run.name}`,
        format: action.format,
        mode: action.mode,
        sourcePlate: action.sourcePlate,
        sourceFormat: run.format,
        destPlate: `PLR-${String(run.number).padStart(4, '0')}`,
        destFormat: run.format,
        transfers: plan.transfers,
        runId: run.id,
        recordId: run.record_id,
      })
      return { openHref: '/plates' }
    }
  }
}
