import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import {
  createPlateDesign,
  savePlateDesign,
  savePlateLayoutTemplate,
} from '#/lib/plate-designer'
import { addPlateRunToExperiment } from '#/lib/plate-experiment-run'
import { defaultAssayConfig } from '#/lib/plate-assay'
import {
  archivePlateRun,
  cancelPlateWorklist,
  completePlateWorklist,
  createPlateRun,
  updatePlateRun,
} from '#/lib/plate-runs'
import type { PlateWorklistRow } from '#/lib/plate-runs'
import { trackPlateAssayQc } from '#/lib/run-qc'

import type { FeatureActionResult } from '../define'
import type { PlateAssaysAction } from './cards'

const storedLayout = z.record(z.string(), z.json())

/** Runs the card in the person's own session, so their access applies. */
export async function runPlateAssaysAction(
  client: DataClient,
  action: PlateAssaysAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'plate_run.create': {
      const run = await createPlateRun(client, {
        name: action.name,
        format: action.format,
        wells: action.wells,
        readout: {},
        config: defaultAssayConfig(),
        projectId: action.projectId,
        recordId: action.experimentId,
      })

      // The notebook shows the run without anyone asking, as the dialog does.
      if (action.experimentId) {
        await addPlateRunToExperiment(client, {
          runId: run.id,
          recordId: action.experimentId,
        }).catch(() => undefined)
      }

      return { openHref: `/plates?run=${run.id}` }
    }

    case 'plate_run.update': {
      const patch = {
        name: action.name ?? undefined,
        config: action.config ?? undefined,
      }

      await updatePlateRun(client, action.runId, patch, action.metadataVersion)

      return { openHref: `/plates?run=${action.runId}` }
    }

    case 'plate_run.archive':
      await archivePlateRun(client, action.runId)

      return { openHref: '/plates' }

    case 'plate_design.create':
      await createPlateDesign(client, {
        workspaceId: action.workspaceId,
        name: action.name,
        format: action.format,
        projectId: action.projectId ?? undefined,
      })

      return { openHref: '/plates' }

    case 'plate_design.fill':
      await savePlateDesign(client, {
        designId: action.designId,
        wells: action.wells,
        expectedMetadataVersion: action.metadataVersion,
      })

      return { openHref: '/plates' }

    case 'plate_layout.save':
      await savePlateLayoutTemplate(client, {
        workspaceId: action.workspaceId,
        name: action.name,
        description: action.description ?? undefined,
        format: action.format,
        rows: action.rows,
        cols: action.cols,
        // Stored as JSONB, so it has to be plain JSON.
        layout: storedLayout.parse(action.layout),
      })

      return { openHref: '/plates' }

    case 'plate_design.track_qc':
      await trackPlateAssayQc(client, action.designId, action.instrumentId)

      return { openHref: '/quality' }

    case 'worklist.cancel':
      await cancelPlateWorklist(client, action.worklistId)

      return { openHref: '/plates' }

    case 'worklist.complete': {
      const rows = await client.list<PlateWorklistRow>(
        'plate_worklists',
        `?id=eq.${encodeURIComponent(action.worklistId)}&select=id,transfers&limit=1`,
      )

      const worklist = rows.at(0)

      if (!worklist) throw new Error('That worklist could not be found.')

      // No robot log: every transfer is taken as done, as the dialog does.
      await completePlateWorklist(client, {
        worklistId: worklist.id,
        reconciled: worklist.transfers.map((transfer) => ({
          sourceWell: transfer.sourceWell,
          destWell: transfer.destWell,
          volumeUl: transfer.volumeUl,
          movedUl: transfer.volumeUl,
          status: 'done',
          label: transfer.label,
          sampleId: transfer.sampleId ?? null,
        })),
        purposeRecordId: action.experimentId,
        recordWithdrawals: action.recordWithdrawals,
      })

      return { openHref: '/plates' }
    }
  }
}
