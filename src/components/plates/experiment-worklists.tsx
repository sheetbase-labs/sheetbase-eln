/**
 * The worklists made for an experiment, on its Data tab: the transfers a
 * liquid handler was given for its plates, what they move and whether the
 * robot has done them. Opening one completes or cancels it in place.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchExperimentWorklists, messageOf } from '#/lib/plate-runs'
import type { PlateWorklistRow } from '#/lib/plate-runs'

import { usePlateWorklistColumns } from './-plates-columns'
import { WorklistDialog } from './worklist-dialogs'

export function ExperimentWorklists({
  expId,
  canWrite,
}: {
  expId: string
  canWrite: boolean
}) {
  const [open, setOpen] = useState<PlateWorklistRow | null>(null)
  const columns = usePlateWorklistColumns()

  const worklists = useQuery({
    queryKey: ['experiment-worklists', expId],
    queryFn: () => fetchExperimentWorklists(notebookDataClient, expId),
    staleTime: 10_000,
  })

  if (worklists.isError)
    return (
      <div className="p-6">
        <Notice tone="bad" title={t('plates.worklists.loadError')}>
          {messageOf(worklists.error, '')}
        </Notice>
      </div>
    )

  const rows = worklists.data ?? []

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {worklists.isPending || rows.length > 0 ? (
        <RegistryGrid
          label={t('plates.worklists.tableLabel')}
          rows={rows}
          columns={columns}
          getRowId={(w) => w.id}
          onRowClick={setOpen}
          isLoading={worklists.isPending}
        />
      ) : (
        <div role="status" className="flex justify-center px-6">
          <EmptyState
            className="items-center py-14 text-center"
            icon="flask"
            title={t('plates.worklists.experimentEmpty')}
            description={t('plates.worklists.experimentEmptyBody')}
            action={
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/$expId/data/plates"
                    params={{ expId }}
                  />
                }
              >
                {t('plates.worklists.experimentEmptyAction')}
              </Button>
            }
          />
        </div>
      )}
      <WorklistDialog
        worklist={open}
        canWrite={canWrite}
        onClose={() => setOpen(null)}
      />
    </div>
  )
}
