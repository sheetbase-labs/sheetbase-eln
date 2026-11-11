/**
 * The Plates page: plate reads checked against their own controls, potency
 * across plates, and the worklists that move liquid for them.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ListHeader, ListToolbar } from '#/components/inventory/list'
import { Button } from '#/components/ui/button'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchPlateRuns,
  fetchPlateWorklists,
  plateRunKeys,
} from '#/lib/plate-runs'
import type { PlateWorklistRow } from '#/lib/plate-runs'

import { NewRunDialog } from './new-run-dialog'
import {
  platesTabSchema,
  usePlateRunColumns,
  usePlateWorklistColumns,
} from './-plates-columns'
import type { PlatesTab } from './-plates-columns'
import { PlatesBody } from './-plates-body'
import { runMatches, worklistMatches } from './plates-shared'
import { RunDetail } from './run-detail'
import { WorklistDialog } from './worklist-dialogs'

export function PlatesPage({
  canWrite,
  workspaceId,
  runId,
  onOpenRun,
}: {
  canWrite: boolean
  workspaceId: string
  runId?: string
  onOpenRun: (id: string | undefined) => void
}) {
  const [tab, setTab] = useState<PlatesTab>('runs')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const [openWorklist, setOpenWorklist] = useState<PlateWorklistRow | null>(
    null,
  )

  const runs = useQuery({
    queryKey: plateRunKeys.list,
    queryFn: () => fetchPlateRuns(notebookDataClient),
    staleTime: 10_000,
  })

  const worklists = useQuery({
    queryKey: plateRunKeys.worklists,
    queryFn: () => fetchPlateWorklists(notebookDataClient),
    staleTime: 10_000,
  })

  const all = useMemo(() => runs.data ?? [], [runs.data])
  const needle = q.trim().toLowerCase()

  const visibleRuns = all.filter((r) => runMatches(r, needle))

  const visibleWorklists = (worklists.data ?? []).filter((w) =>
    worklistMatches(w, needle),
  )

  const runColumns = usePlateRunColumns()
  const worklistColumns = usePlateWorklistColumns()

  if (runId) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <RunDetail
          runId={runId}
          canWrite={canWrite}
          onBack={() => onOpenRun(undefined)}
        />
      </div>
    )
  }

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      {t('plates.newRun')}
    </Button>
  ) : null

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('plates.title')}
        subtitle={t('plates.subtitle')}
        actions={newButton}
        tabs={
          <Tabs
            mode="state"
            variant="strip"
            label={t('plates.title')}
            value={tab}
            onValueChange={(value) => setTab(platesTabSchema.parse(value))}
            items={[
              {
                key: 'runs',
                label: t('plates.tabs.runs'),
                count: runs.isPending ? undefined : all.length,
              },
              { key: 'potency', label: t('plates.tabs.potency') },
              { key: 'quality', label: t('plates.tabs.quality') },
              {
                key: 'worklists',
                label: t('plates.tabs.worklists'),
                count: worklists.isPending
                  ? undefined
                  : (worklists.data ?? []).length,
              },
            ]}
          />
        }
      />
      {tab === 'runs' || tab === 'worklists' ? (
        <ListToolbar
          q={q}
          onSearch={setQ}
          placeholder={t('plates.searchPlaceholder')}
          label={t('plates.searchPlaceholder')}
        />
      ) : null}
      <PlatesBody
        tab={tab}
        runs={runs}
        worklists={worklists}
        allRuns={all}
        visibleRuns={visibleRuns}
        visibleWorklists={visibleWorklists}
        runColumns={runColumns}
        worklistColumns={worklistColumns}
        needle={needle}
        canWrite={canWrite}
        workspaceId={workspaceId}
        newButton={newButton}
        onOpenRun={onOpenRun}
        onOpenWorklist={setOpenWorklist}
      />
      <NewRunDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(run) => onOpenRun(run.id)}
      />
      <WorklistDialog
        worklist={openWorklist}
        canWrite={canWrite}
        onClose={() => setOpenWorklist(null)}
      />
    </div>
  )
}
