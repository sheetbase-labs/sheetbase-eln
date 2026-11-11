/**
 * What the Plates page shows under its tabs: the run list, the potency panel,
 * the quality panel, or the worklists — each with its own loading, failure and
 * empty state.
 */
import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { ReadOnlyNote } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { EmptyState } from '#/components/ui/empty-state'
import { RunQcPanel } from '#/components/quality/run-qc-panel'
import { messageOf } from '#/lib/plate-runs'
import type { PlateRunRow, PlateWorklistRow } from '#/lib/plate-runs'
import { t } from '#/copy'

import { PotencyPanel } from './potency-panel'
import type { PlatesTab } from './-plates-columns'

export function PlatesBody({
  tab,
  runs,
  worklists,
  allRuns,
  visibleRuns,
  visibleWorklists,
  runColumns,
  worklistColumns,
  needle,
  canWrite,
  workspaceId,
  newButton,
  onOpenRun,
  onOpenWorklist,
}: {
  tab: PlatesTab
  runs: UseQueryResult<PlateRunRow[]>
  worklists: UseQueryResult<PlateWorklistRow[]>
  allRuns: PlateRunRow[]
  visibleRuns: PlateRunRow[]
  visibleWorklists: PlateWorklistRow[]
  runColumns: RegistryColumn<PlateRunRow>[]
  worklistColumns: RegistryColumn<PlateWorklistRow>[]
  needle: string
  canWrite: boolean
  workspaceId: string
  newButton: ReactNode
  onOpenRun: (id: string) => void
  onOpenWorklist: (worklist: PlateWorklistRow) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {tab === 'potency' ? (
        <PotencyPanel runs={allRuns} />
      ) : tab === 'quality' ? (
        <div className="p-6">
          <RunQcPanel
            scope={{}}
            workspaceId={workspaceId}
            canWrite={canWrite}
          />
        </div>
      ) : tab === 'worklists' ? (
        <PlateWorklistsTab
          worklists={worklists}
          visibleWorklists={visibleWorklists}
          columns={worklistColumns}
          needle={needle}
          onOpen={onOpenWorklist}
        />
      ) : (
        <PlateRunsTab
          runs={runs}
          visibleRuns={visibleRuns}
          columns={runColumns}
          needle={needle}
          newButton={newButton}
          onOpenRun={onOpenRun}
        />
      )}
      {!canWrite && !runs.isPending ? (
        <div className="px-6 pb-4">
          <ReadOnlyNote>{t('plates.readOnly')}</ReadOnlyNote>
        </div>
      ) : null}
    </div>
  )
}

/** The runs table, with its loading, failure and empty states. */
function PlateRunsTab({
  runs,
  visibleRuns,
  columns,
  needle,
  newButton,
  onOpenRun,
}: {
  runs: UseQueryResult<PlateRunRow[]>
  visibleRuns: PlateRunRow[]
  columns: RegistryColumn<PlateRunRow>[]
  needle: string
  newButton: ReactNode
  onOpenRun: (id: string) => void
}) {
  if (runs.isError) {
    return (
      <div className="p-6">
        <Notice tone="bad" title={t('plates.loadError')}>
          {messageOf(runs.error, '')}
        </Notice>
      </div>
    )
  }

  if (runs.isPending || visibleRuns.length > 0) {
    return (
      <RegistryGrid
        label={t('plates.tableLabel')}
        rows={visibleRuns}
        columns={columns}
        getRowId={(r) => r.id}
        selectable
        onRowClick={(r) => onOpenRun(r.id)}
        isLoading={runs.isPending}
      />
    )
  }

  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon="flask"
        title={needle ? t('plates.empty.filtered') : t('plates.empty.runs')}
        description={needle ? undefined : t('plates.empty.runsBody')}
        action={needle ? undefined : (newButton ?? undefined)}
      />
    </div>
  )
}

/** The worklists table, with its loading, failure and empty states. */
function PlateWorklistsTab({
  worklists,
  visibleWorklists,
  columns,
  needle,
  onOpen,
}: {
  worklists: UseQueryResult<PlateWorklistRow[]>
  visibleWorklists: PlateWorklistRow[]
  columns: RegistryColumn<PlateWorklistRow>[]
  needle: string
  onOpen: (worklist: PlateWorklistRow) => void
}) {
  if (worklists.isError) {
    return (
      <div className="p-6">
        <Notice tone="bad" title={t('plates.worklists.loadError')}>
          {messageOf(worklists.error, '')}
        </Notice>
      </div>
    )
  }

  if (worklists.isPending || visibleWorklists.length > 0) {
    return (
      <RegistryGrid
        label={t('plates.worklists.tableLabel')}
        rows={visibleWorklists}
        columns={columns}
        getRowId={(w) => w.id}
        selectable
        onRowClick={onOpen}
        isLoading={worklists.isPending}
      />
    )
  }

  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon="flask"
        title={
          needle ? t('plates.empty.filtered') : t('plates.empty.worklists')
        }
        description={needle ? undefined : t('plates.empty.worklistsBody')}
      />
    </div>
  )
}
