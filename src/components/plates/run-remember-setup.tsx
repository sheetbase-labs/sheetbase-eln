/**
 * Remembering a run's settings for the next plate of the assay, from the run's
 * Analysis settings: on the design the run follows, or as a new assay when it
 * follows none.
 */
import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import type { PlateAssayConfig } from '#/lib/plate-assay'
import {
  assayDesignKeys,
  controlColumnsOfWells,
  createAssayDesign,
  fetchAssayDesigns,
  saveAssaySetup,
} from '#/lib/plate-assay-setup'
import type { PlateRunRow } from '#/lib/plate-runs'

const client = notebookDataClient

export function useRememberFromRun({
  run,
  open,
}: {
  run: PlateRunRow
  open: boolean
}) {
  const { auth } = useRouteContext({ from: '__root__' })
  const workspaceId = auth?.workspace?.id ?? ''

  const designs =
    useQuery({
      queryKey: assayDesignKeys.all,
      queryFn: () => fetchAssayDesigns(client),
      staleTime: 30_000,
      enabled: open,
    }).data ?? []

  const design = designs.find((d) => d.id === run.design_id) ?? null
  const [choice, setChoice] = useState<boolean | null>(null)
  const [name, setName] = useState('')

  // A design with nothing remembered yet is offered the settings; one that
  // already has a setup keeps it unless the person asks to replace it.
  const onDesign = design !== null && (choice ?? design.setup === null)
  const asNew = run.design_id === null && name.trim() !== ''

  async function remember(config: PlateAssayConfig): Promise<string | null> {
    const controls = controlColumnsOfWells(run.wells)

    const setup = {
      config,
      negativeColumns: controls.negative,
      positiveColumns: controls.positive,
    }

    if (onDesign) {
      await saveAssaySetup(client, {
        designId: design.id,
        setup,
        runId: run.id,
      })

      return design.name
    }

    if (asNew) {
      await createAssayDesign(client, {
        workspaceId,
        name,
        format: run.format,
        setup,
        runId: run.id,
      })

      return name.trim()
    }

    return null
  }

  const field = design ? (
    <label className="flex items-center gap-2 text-label md:col-span-2">
      <Checkbox
        checked={onDesign}
        onCheckedChange={(value) => setChoice(value === true)}
      />
      {t('features.plateRuns.setup.rememberFromRun', { design: design.name })}
    </label>
  ) : run.design_id === null ? (
    <div className="md:col-span-2">
      <Field
        label={t('features.plateRuns.setup.rememberFromRunNew')}
        hint={t('features.plateRuns.setup.rememberFromRunNewHint')}
      >
        <Input
          value={name}
          maxLength={200}
          placeholder={t('features.plateRuns.setup.rememberNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </div>
  ) : null

  return {
    field,
    remember,
    reset: () => {
      setChoice(null)
      setName('')
    },
  }
}
