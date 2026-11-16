import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { NewRunDialog } from '#/components/plates/new-run-dialog'
import { PlateCompare } from '#/components/plates/plate-compare'
import { PlateRunSummary } from '#/components/plates/plate-run-summary'
import { WorklistBuilderDialog } from '#/components/plates/worklist-dialogs'
import type { MapView } from '#/components/plates/plates-shared'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { FileDrop } from '#/components/ui/file-drop'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  addPlateRunToExperiment,
  findPlateRunBlock,
} from '#/lib/plate-experiment-run'
import {
  fetchPlateRunsForRecord,
  messageOf,
  plateRunKeys,
  plateRunReference,
} from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'
import { t } from '#/copy'

const client = notebookDataClient

/** Whether the notebook already shows a run in a plate run block. */
function useInNotebook(recordId: string, runId: string) {
  return useQuery({
    queryKey: ['plate-runs', 'in-notebook', recordId, runId],
    queryFn: () => findPlateRunBlock(client, recordId, runId),
    staleTime: 5_000,
  })
}

function PlateRunCard({
  run,
  expId,
  canWrite,
}: {
  run: PlateRunRow
  expId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<MapView>('hits')
  const [worklist, setWorklist] = useState(false)
  const inNotebook = useInNotebook(expId, run.id)

  const add = useMutation({
    mutationFn: () =>
      addPlateRunToExperiment(client, { runId: run.id, recordId: expId }),
    onSuccess: () => {
      toast.success(t('features.plateRuns.tab.addedToNotebook'))
      void queryClient.invalidateQueries({
        queryKey: ['plate-runs', 'in-notebook', expId, run.id],
      })
    },
    onError: (error) =>
      toast.error(messageOf(error, t('features.plateRuns.tab.couldNotAdd'))),
  })

  return (
    <section
      aria-label={plateRunReference(run.number)}
      className="flex flex-col gap-3 border-t border-border-subtle pt-5"
    >
      <PlateRunSummary run={run} view={view} onViewChange={setView} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
        {inNotebook.data ? (
          <>
            <Status tone="ok">{t('features.plateRuns.tab.inNotebook')}</Status>
            <Button
              size="sm"
              variant="quiet"
              nativeButton={false}
              render={
                <Link to="/experiments/$expId/notebook" params={{ expId }} />
              }
            >
              {t('features.plateRuns.tab.notebook')}
            </Button>
          </>
        ) : inNotebook.isSuccess && canWrite ? (
          <>
            <Status tone="none">
              {t('features.plateRuns.tab.notInNotebook')}
            </Status>
            <Button
              size="sm"
              disabled={add.isPending}
              onClick={() => add.mutate()}
            >
              {t('features.plateRuns.tab.addToNotebook')}
            </Button>
          </>
        ) : null}
        {canWrite && run.status !== 'draft' ? (
          <Button size="sm" onClick={() => setWorklist(true)}>
            {t('features.plateRuns.tab.makeWorklist')}
          </Button>
        ) : null}
      </div>
      {worklist ? (
        <WorklistBuilderDialog
          run={run}
          open={worklist}
          onOpenChange={setWorklist}
        />
      ) : null}
    </section>
  )
}

/** The Plates section of an experiment's Data tab: every plate run that belongs to it. */
export function ExperimentPlates({
  expId,
  canWrite,
}: {
  expId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [dropped, setDropped] = useState<File | null>(null)
  // The drop zone keeps the file it was given; a new key clears it once the dialog is done.
  const [dropKey, setDropKey] = useState(0)

  const runs = useQuery({
    queryKey: plateRunKeys.forRecord(expId),
    queryFn: () => fetchPlateRunsForRecord(client, expId),
    staleTime: 10_000,
  })

  const add = canWrite ? (
    <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
      {t('features.plateRuns.tab.add')}
    </Button>
  ) : null

  const data = runs.data ?? []

  // Two or more analysed plates are read against each other.
  const analysed = useMemo(
    () => (runs.data ?? []).filter((run) => run.results !== null),
    [runs.data],
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-6 py-4 max-md:px-4">
      <div className="flex items-center gap-3">
        <h2 className="m-0 flex-1 font-heading text-doc font-semibold">
          {t('features.plateRuns.tab.title')}
        </h2>
        {data.length > 0 ? add : null}
      </div>
      {canWrite && data.length > 0 ? (
        <FileDrop
          key={dropKey}
          label={t('features.plateRuns.drop.title')}
          hint={t('features.plateRuns.drop.hint')}
          accept=".csv,.tsv,.txt,.xlsx"
          onFile={(file) => {
            setDropped(file)
            setAdding(true)
          }}
        />
      ) : null}
      {analysed.length > 1 ? <PlateCompare runs={analysed} /> : null}
      {runs.isSuccess && data.length === 0 ? (
        <EmptyState
          icon="grid"
          title={t('features.plateRuns.tab.empty')}
          description={t('features.plateRuns.tab.emptyHint')}
          action={add}
        />
      ) : null}
      {data.map((run) => (
        <PlateRunCard
          key={run.id}
          run={run}
          expId={expId}
          canWrite={canWrite}
        />
      ))}
      {adding ? (
        <NewRunDialog
          open={adding}
          onOpenChange={(open) => {
            setAdding(open)

            if (!open) {
              setDropped(null)
              setDropKey((key) => key + 1)
            }
          }}
          experimentId={expId}
          initialFile={dropped}
          onCreated={(created) => {
            void addPlateRunToExperiment(client, {
              runId: created.id,
              recordId: expId,
            }).finally(() => {
              void queryClient.invalidateQueries({
                queryKey: plateRunKeys.all,
              })
            })
          }}
        />
      ) : null}
    </div>
  )
}
