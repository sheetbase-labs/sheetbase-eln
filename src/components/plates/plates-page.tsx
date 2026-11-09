/**
 * The Plates page: plate reads checked against their own controls, potency
 * across plates, and the worklists that move liquid for them.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchPlateRuns,
  fetchPlateWorklists,
  messageOf,
  plateRunKeys,
  plateRunReference,
  worklistReference,
} from '#/lib/plate-runs'
import type { PlateRunRow, PlateWorklistRow } from '#/lib/plate-runs'

import { NewRunDialog } from './new-run-dialog'
import { PotencyPanel } from './potency-panel'
import { qcTone, qualityLabel, runText } from './plates-shared'
import { RunDetail } from './run-detail'
import { WorklistDialog } from './worklist-dialogs'

import { RunQcPanel } from '#/components/quality/run-qc-panel'

export type PlatesTab = 'runs' | 'potency' | 'quality' | 'worklists'

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

  const visibleRuns = all.filter(
    (r) => needle === '' || runText(r).includes(needle),
  )

  const visibleWorklists = (worklists.data ?? []).filter(
    (w) =>
      needle === '' ||
      `${worklistReference(w.number)} ${w.name}`.toLowerCase().includes(needle),
  )

  const runColumns = useMemo<RegistryColumn<PlateRunRow>[]>(
    () => [
      {
        id: 'number',
        header: t('plates.columns.number'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {plateRunReference(row.original.number)}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('plates.columns.name'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'format',
        header: t('plates.columns.format'),
        size: 110,
        cell: ({ row }) => (
          <span>{t(`plates.formats.${row.original.format}`)}</span>
        ),
      },
      {
        id: 'zprime',
        header: t('plates.columns.zPrime'),
        size: 90,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {row.original.results?.qc.zPrime?.toFixed(2) ?? ''}
          </span>
        ),
      },
      {
        id: 'hits',
        header: t('plates.columns.hits'),
        size: 130,
        cell: ({ row }) => {
          const s = row.original.results?.summary

          return (
            <span className="num text-fg-muted">
              {s
                ? t('plates.hitsOf', {
                    hits: s.hitSamples,
                    tested: s.testedSamples,
                  })
                : ''}
            </span>
          )
        },
      },
      {
        id: 'quality',
        header: t('plates.columns.quality'),
        size: 140,
        cell: ({ row }) => (
          <Status
            tone={qcTone(
              row.original.status === 'draft' ? null : row.original.qc_status,
            )}
          >
            {qualityLabel(row.original)}
          </Status>
        ),
      },
      {
        id: 'analysed',
        header: t('plates.columns.analysed'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.analysed_at
              ? formatDate(row.original.analysed_at)
              : ''}
          </span>
        ),
      },
    ],
    [],
  )

  const worklistColumns = useMemo<RegistryColumn<PlateWorklistRow>[]>(
    () => [
      {
        id: 'number',
        header: t('plates.worklists.columns.number'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {worklistReference(row.original.number)}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('plates.worklists.columns.name'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'format',
        header: t('plates.worklists.columns.format'),
        size: 200,
        cell: ({ row }) => (
          <span>{t(`plates.worklist.formats.${row.original.format}`)}</span>
        ),
      },
      {
        id: 'transfers',
        header: t('plates.worklists.columns.transfers'),
        size: 110,
        cell: ({ row }) => (
          <span className="num">{row.original.transfers.length}</span>
        ),
      },
      {
        id: 'status',
        header: t('plates.worklists.columns.status'),
        size: 120,
        cell: ({ row }) => (
          <Status
            tone={
              row.original.status === 'complete'
                ? 'ok'
                : row.original.status === 'cancelled'
                  ? 'draft'
                  : 'progress'
            }
          >
            {t(`plates.worklists.statuses.${row.original.status}`)}
          </Status>
        ),
      },
      {
        id: 'created',
        header: t('plates.worklists.columns.created'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
    ],
    [],
  )

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
            onValueChange={(value) => setTab(value as PlatesTab)}
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
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {tab === 'runs' ? (
          runs.isError ? (
            <div className="p-6">
              <Notice tone="bad" title={t('plates.loadError')}>
                {messageOf(runs.error, '')}
              </Notice>
            </div>
          ) : runs.isPending || visibleRuns.length > 0 ? (
            <RegistryGrid
              label={t('plates.tableLabel')}
              rows={visibleRuns}
              columns={runColumns}
              getRowId={(r) => r.id}
              selectable
              onRowClick={(r) => onOpenRun(r.id)}
              isLoading={runs.isPending}
            />
          ) : (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                className="items-center py-14 text-center"
                icon="flask"
                title={
                  needle ? t('plates.empty.filtered') : t('plates.empty.runs')
                }
                description={needle ? undefined : t('plates.empty.runsBody')}
                action={needle ? undefined : (newButton ?? undefined)}
              />
            </div>
          )
        ) : tab === 'potency' ? (
          <PotencyPanel runs={all} />
        ) : tab === 'quality' ? (
          <div className="p-6">
            <RunQcPanel
              scope={{}}
              workspaceId={workspaceId}
              canWrite={canWrite}
            />
          </div>
        ) : worklists.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('plates.worklists.loadError')}>
              {messageOf(worklists.error, '')}
            </Notice>
          </div>
        ) : worklists.isPending || visibleWorklists.length > 0 ? (
          <RegistryGrid
            label={t('plates.worklists.tableLabel')}
            rows={visibleWorklists}
            columns={worklistColumns}
            getRowId={(w) => w.id}
            selectable
            onRowClick={setOpenWorklist}
            isLoading={worklists.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="flask"
              title={
                needle
                  ? t('plates.empty.filtered')
                  : t('plates.empty.worklists')
              }
              description={needle ? undefined : t('plates.empty.worklistsBody')}
            />
          </div>
        )}
        {!canWrite && !runs.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('plates.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </div>
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
