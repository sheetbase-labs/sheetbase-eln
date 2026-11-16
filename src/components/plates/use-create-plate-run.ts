/**
 * Saving a plate run: create it, analyse it, and, when it belongs to an
 * experiment, put it in that experiment's notebook.
 */
import { useRouteContext } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import type {
  AssayWell,
  PlateAssayConfig,
  PlateReadout,
} from '#/lib/plate-assay'
import {
  assayDesignKeys,
  createAssayDesign,
  saveAssaySetup,
} from '#/lib/plate-assay-setup'
import type { RememberRequest } from '#/lib/plate-assay-setup'
import { addPlateRunToExperiment } from '#/lib/plate-experiment-run'
import type { PlateFormat } from '#/lib/plate-map'
import {
  analyseAndSavePlateRun,
  createPlateRun,
  messageOf,
  plateRunKeys,
  plateRunReference,
  resolveSampleIds,
} from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

const client = notebookDataClient

export interface PlateRunDraft {
  name: string
  format: PlateFormat | null
  wells: AssayWell[]
  readout: PlateReadout
  projectId: string
  designId: string
  experimentId: string
  /** The caller puts the run in the notebook itself. */
  experimentFixed: boolean
  addToNotebook: boolean
  analyseNow: boolean
  /** How the plate is analysed: the assay's remembered settings, or the defaults. */
  config: PlateAssayConfig
  /** The control columns the plate was read with. */
  negativeColumns: string
  positiveColumns: string
  /** Remember the controls and settings on a design once the run is saved. */
  remember: RememberRequest
}

export function useCreatePlateRun(
  draft: PlateRunDraft,
  done: (run: PlateRunRow) => void,
) {
  const queryClient = useQueryClient()
  const { auth } = useRouteContext({ from: '__root__' })
  const workspaceId = auth?.workspace?.id ?? ''
  const { name, format, experimentId, experimentFixed, addToNotebook } = draft
  const fixedExperimentId = experimentFixed ? experimentId : ''
  const parsed = { wells: draft.wells, readout: draft.readout }
  const { projectId, designId, analyseNow, config, remember } = draft

  return useMutation({
    mutationFn: async () => {
      if (!format) throw new Error(t('plates.form.previewNothing'))

      const labels = parsed.wells.flatMap((w) =>
        w.role === 'sample' && w.sampleLabel ? [w.sampleLabel] : [],
      )

      const ids = labels.length
        ? await resolveSampleIds(client, labels).catch(
            () => new Map<string, string>(),
          )
        : new Map<string, string>()

      const wells = parsed.wells.map((w) => ({
        ...w,
        sampleId:
          w.sampleLabel && ids.has(w.sampleLabel)
            ? (ids.get(w.sampleLabel) ?? null)
            : (w.sampleId ?? null),
      }))

      const unlinked = new Set(
        wells
          .filter((w) => w.sampleLabel && !w.sampleId)
          .map((w) => w.sampleLabel),
      ).size

      let run = await createPlateRun(client, {
        name,
        format,
        wells,
        readout: parsed.readout,
        config,
        projectId: projectId || null,
        designId: designId || null,
        recordId: experimentId || null,
      })

      if (analyseNow) {
        run = (await analyseAndSavePlateRun(client, run)).run
      }

      // The controls and settings are kept for the next plate of the assay. The
      // run is saved either way, so a failure here is said, not thrown.
      let remembered = remember === null ? null : false

      if (remember) {
        const setup = {
          config,
          negativeColumns: draft.negativeColumns.trim(),
          positiveColumns: draft.positiveColumns.trim(),
        }

        try {
          if (remember.kind === 'design')
            await saveAssaySetup(client, {
              designId: remember.designId,
              setup,
              runId: run.id,
            })
          else
            await createAssayDesign(client, {
              workspaceId,
              name: remember.name,
              format,
              setup,
              runId: run.id,
            })
          remembered = true
        } catch {
          remembered = false
        }
      }

      // The experiment's notebook shows the run without anyone asking for it.
      let inNotebook = false

      if (experimentId && !fixedExperimentId && addToNotebook) {
        try {
          await addPlateRunToExperiment(client, {
            runId: run.id,
            recordId: experimentId,
          })
          inNotebook = true
        } catch {
          inNotebook = false
        }
      }

      return { run, unlinked, inNotebook, remembered }
    },
    onSuccess: ({ run, unlinked, inNotebook, remembered }) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      void queryClient.invalidateQueries({ queryKey: assayDesignKeys.all })
      toast.success(
        experimentId && inNotebook
          ? t('features.plateRuns.form.createdInNotebook', {
              reference: plateRunReference(run.number),
            })
          : t('plates.form.created', {
              reference: plateRunReference(run.number),
            }),
      )

      if (experimentId && !fixedExperimentId && addToNotebook && !inNotebook)
        toast.message(t('features.plateRuns.form.notebookNotUpdated'))

      if (remembered === true && remember)
        toast.message(
          t('features.plateRuns.setup.saved', {
            design: remember.name,
          }),
        )

      if (remembered === false)
        toast.message(t('features.plateRuns.setup.couldNotRemember'))

      if (unlinked > 0)
        toast.message(t('plates.form.unlinkedSamples', { count: unlinked }))
      done(run)
    },
    onError: (error) =>
      toast.error(messageOf(error, t('plates.form.couldNotSave'))),
  })
}
