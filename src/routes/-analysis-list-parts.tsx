import { Link, useNavigate } from '@tanstack/react-router'
import type React from 'react'

import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Muted } from '#/components/ui/layout'
import { MobileList, ReadOnlyNote } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { t } from '#/copy'

import { ANALYSIS_MODES, kindLabel } from './-analysis-list-model'
import type { AnalysisEmptyCopy, AnalysisRow } from './-analysis-list-model'

/** What a grid's selection state is, as the shared grid types it. */
type GridSelection = React.ComponentProps<
  typeof RegistryGrid<AnalysisRow>
>['rowSelection']

/** What updating that selection takes. */
type GridSelectionChange = React.ComponentProps<
  typeof RegistryGrid<AnalysisRow>
>['onRowSelectionChange']

/** The New analysis menu: one item per kind, then the recent datasets. */
export function AnalysisNewMenu({
  canWrite,
  recent,
}: {
  canWrite: boolean
  recent: readonly { id: string; name: string }[]
}) {
  const navigate = useNavigate()

  if (!canWrite)
    return (
      <ReadOnlyNote>
        {t('common.readOnly.cannotAdd', {
          things: t('common.readOnly.things.analyses'),
        })}
      </ReadOnlyNote>
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="primary" icon="plus" />}>
        {t('data.analysisList.newAnalysis')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {ANALYSIS_MODES.map((m) => (
          <DropdownMenuItem
            key={m.mode}
            hint={m.label}
            onClick={() =>
              void navigate({
                to: '/analysis/new',
                search: { mode: m.mode },
              })
            }
          >
            {m.body}
          </DropdownMenuItem>
        ))}
        {recent.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t('data.analysisList.startFromRecentDataset')}
              </DropdownMenuLabel>
              {recent.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  onClick={() =>
                    void navigate({
                      to: '/analysis/new',
                      search: { mode: 'chart', dataset: d.id },
                    })
                  }
                >
                  {d.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The list area: loading, the empty state, or the saved analyses. */
export function AnalysisListBody({
  isPending,
  visible,
  columns,
  rowSelection,
  onRowSelectionChange,
  openAnalysis,
  datasetName,
  emptyCopy,
  needle,
  tab,
}: {
  isPending: boolean
  visible: AnalysisRow[]
  columns: RegistryColumn<AnalysisRow>[]
  rowSelection: GridSelection
  onRowSelectionChange: GridSelectionChange
  openAnalysis: (row: AnalysisRow, event?: React.MouseEvent) => void
  datasetName: (id: string | undefined) => string
  emptyCopy: AnalysisEmptyCopy
  needle: string
  tab: 'mine' | 'cited' | 'drafts' | undefined
}) {
  const navigate = useNavigate()

  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {isPending ? (
        <div className="px-4 py-5 md:px-6">
          <Muted>{t('data.analysisList.loadingAnalyses')}</Muted>
        </div>
      ) : visible.length === 0 ? (
        <div role="status" className="flex justify-center px-4 py-5 md:px-6">
          <EmptyState
            icon="chart"
            className="items-center text-center"
            title={emptyCopy.title}
            description={emptyCopy.body}
            action={
              needle ? (
                <Button
                  onClick={() =>
                    void navigate({
                      to: '/analysis',
                      search: { tab },
                      replace: true,
                    })
                  }
                >
                  {t('data.analysisList.clearSearch')}
                </Button>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  {ANALYSIS_MODES.map((m) => (
                    <Button
                      key={m.mode}
                      nativeButton={false}
                      render={
                        <Link to="/analysis/new" search={{ mode: m.mode }} />
                      }
                    >
                      {m.start}
                    </Button>
                  ))}
                </div>
              )
            }
          />
        </div>
      ) : (
        <>
          <RegistryGrid
            className="max-md:hidden"
            label={t('data.analysisList.savedAnalyses')}
            rows={visible}
            columns={columns}
            getRowId={(view) => view.id}
            rowSelection={rowSelection}
            onRowSelectionChange={onRowSelectionChange}
            onRowClick={openAnalysis}
            selectable={false}
          />
          <MobileList
            label={t('data.analysisList.savedAnalyses')}
            items={visible.map((view) => ({
              key: view.id,
              id: view.identifier,
              title: view.name,
              sub: `${kindLabel(view)} · ${datasetName(view.datasetId)}`,
              link:
                view.kind === 'chart'
                  ? {
                      to: '/analysis/$analysisId',
                      params: { analysisId: view.id },
                      onClick: (event: React.MouseEvent) =>
                        openAnalysis(view, event),
                    }
                  : {
                      to: '/analysis/new',
                      search: { mode: 'analyse', definition: view.id },
                      onClick: (event: React.MouseEvent) =>
                        openAnalysis(view, event),
                    },
            }))}
          />
        </>
      )}
    </div>
  )
}

/** The selected analysis's details, beside the list on a wide screen. */
export function AnalysisInspector({
  selected,
  datasetName,
}: {
  selected: AnalysisRow | null
  datasetName: (id: string | undefined) => string
}) {
  if (!selected) return null

  return (
    <aside
      aria-label={`${selected.name} details`}
      className="hidden w-[320px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex"
    >
      <div className="flex flex-col gap-1">
        <span className="mono text-label text-fg-muted">
          {selected.identifier}
        </span>
        <div className="font-heading text-doc font-semibold">
          {selected.name}
        </div>
        <Status tone="analysis">{kindLabel(selected)}</Status>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="primary"
          nativeButton={false}
          render={
            selected.kind === 'chart' ? (
              <Link
                to="/analysis/$analysisId"
                params={{ analysisId: selected.id }}
              />
            ) : (
              <Link
                to="/analysis/new"
                search={{ mode: 'analyse', definition: selected.id }}
              />
            )
          }
        >
          {t('common.actions.open')}
        </Button>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/analysis/new"
              search={{
                mode: 'chart',
                dataset: selected.datasetId,
              }}
            />
          }
        >
          {t('data.analysisList.newFromData')}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg-muted">
          {t('data.analysisList.source')}
        </h3>
        <span className="text-body">{datasetName(selected.datasetId)}</span>
      </div>
      <Muted>{t('data.analysisList.eachSaveAddsVersion')}</Muted>
    </aside>
  )
}
