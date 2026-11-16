/**
 * The experiment a plate run belongs to, on the run's own page: which one, and
 * how to add the run to one, move it or take it out.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ExperimentPicker } from '#/components/record-picker/experiment-picker'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field } from '#/components/ui/input'
import { ObjectLink } from '#/components/ui/object-link'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import { addPlateRunToExperiment } from '#/lib/plate-experiment-run'
import {
  linkPlateRun,
  messageOf,
  plateRunKeys,
  plateRunReference,
} from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

const client = notebookDataClient

interface ExperimentRow {
  id: string
  identifier: string
  title: string
}

export function RunExperimentLink({
  run,
  canWrite,
}: {
  run: PlateRunRow
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [choosing, setChoosing] = useState(false)
  const [picked, setPicked] = useState('')
  const reference = plateRunReference(run.number)

  const experiment = useQuery({
    queryKey: ['plate-runs', 'experiment', run.record_id],
    enabled: Boolean(run.record_id),
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await client.list<ExperimentRow>(
        'records',
        `?id=eq.${encodeURIComponent(run.record_id ?? '')}&select=id,identifier,title&limit=1`,
      )

      return rows.at(0) ?? null
    },
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: plateRunKeys.all })

  const link = useMutation({
    mutationFn: (recordId: string) =>
      addPlateRunToExperiment(client, { runId: run.id, recordId }),
    onSuccess: () => {
      toast.success(t('features.plateRuns.link.linked', { reference }))
      setChoosing(false)
      setPicked('')
      void refresh()
    },
    onError: (error) =>
      toast.error(messageOf(error, t('features.plateRuns.link.couldNotLink'))),
  })

  const unlink = useMutation({
    mutationFn: () => linkPlateRun(client, run.id, null),
    onSuccess: () => {
      toast.success(t('features.plateRuns.link.unlinked', { reference }))
      void refresh()
    },
    onError: (error) =>
      toast.error(messageOf(error, t('features.plateRuns.link.couldNotLink'))),
  })

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-6 py-2 text-label max-md:px-4">
      <span className="text-fg-muted">
        {t('features.plateRuns.link.label')}
      </span>
      {run.record_id ? (
        <span className="flex min-w-0 items-center gap-2">
          <ObjectLink
            kind="experiment"
            id={run.record_id}
            identifier={experiment.data?.identifier}
          />
          <span className="truncate">{experiment.data?.title}</span>
        </span>
      ) : (
        <span className="text-fg-muted">
          {t('features.plateRuns.link.none')}
        </span>
      )}
      {canWrite ? (
        <>
          <Button size="sm" variant="quiet" onClick={() => setChoosing(true)}>
            {run.record_id
              ? t('features.plateRuns.link.change')
              : t('features.plateRuns.link.link')}
          </Button>
          {run.record_id ? (
            <Button
              size="sm"
              variant="quiet"
              disabled={unlink.isPending}
              onClick={() => unlink.mutate()}
            >
              {t('features.plateRuns.link.unlink')}
            </Button>
          ) : null}
        </>
      ) : null}
      {choosing ? (
        <Dialog open={choosing} onOpenChange={setChoosing}>
          <DialogContent className="w-[min(520px,calc(100vw-32px))]">
            <DialogHeader
              title={t('features.plateRuns.link.title', { reference })}
            />
            <DialogBody>
              <Field
                label={t('features.plateRuns.link.label')}
                hint={t('features.plateRuns.link.hint')}
              >
                <ExperimentPicker value={picked} onChange={setPicked} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button variant="quiet" />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={!picked || link.isPending}
                onClick={() => link.mutate(picked)}
              >
                {t('features.plateRuns.link.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
