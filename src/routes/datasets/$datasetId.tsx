import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { t } from '#/copy'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { PageHeader } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Tabs } from '#/components/v3/ui/tabs'
import { Status } from '#/components/v3/ui/status'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import { isDatasetDetailTab } from '#/components/v3/datasets/dataset-detail-tabs'
import type { DatasetDetailTab } from '#/components/v3/datasets/dataset-detail-tabs'
import { DatasetHistoryTab } from '#/components/v3/datasets/dataset-history-tab'
import { DatasetArchive } from '#/components/v3/datasets/dataset-archive'
import { DatasetImportsTab } from '#/components/v3/datasets/dataset-imports-tab'
import { DatasetModelUpgrade } from '#/components/v3/datasets/dataset-model-upgrade'
import {
  DatasetPipelineMenuItems,
  useDatasetPipelineRuns,
} from '#/components/v3/datasets/dataset-run-pipeline'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { hasCapability } from '#/lib/capability'
import { DatasetUsedByTab } from '#/components/v3/datasets/dataset-used-by-tab'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'
import { useRecentViewTracking } from '#/lib/recents'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): the dataset detail frame. Rows, Snapshots and
 * Compare are child routes; R5-SURF-01 adds Imports, Used by and History,
 * selected by the `view` search parameter so each is a linkable, reloadable URL
 * without a second route tree. The index child is the Overview screen. */
export const Route = createFileRoute('/datasets/$datasetId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: DatasetDetailTab } => ({
    view: isDatasetDetailTab(search.view) ? search.view : undefined,
  }),
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'dataset',
      ref: params.datasetId,
      href: location.href,
    })
    return { context }
  },
  component: DatasetLayout,
})

export interface DatasetVersion {
  id: string
  label: string
  createdAt: string
  createdByUserId: string | null
  sourceDatasetRevision: number
  rowCount: number
}

export const datasetVersionsQueryKey = (datasetId: string) =>
  ['ui-port', 'dataset-versions', datasetId] as const

export function useDatasetVersions(datasetId: string) {
  return useQuery({
    queryKey: datasetVersionsQueryKey(datasetId),
    queryFn: () =>
      notebookDataClient.rpc<DatasetVersion[]>('dataset_version_list', {
        p_dataset_id: datasetId,
      }),
  })
}

function DatasetLayout() {
  const { datasetId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const navigate = useNavigate()
  const summaries = useDatasetSummaries()
  const versions = useDatasetVersions(datasetId)
  const latestVersionId =
    [...(versions.data ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]?.id ?? null
  const dataset = summaries.data?.find((d) => d.uuid === datasetId)
  const projectId = dataset?.projectId ?? null
  const project = useQuery({
    queryKey: ['ui-port', 'dataset-project', projectId ?? ''],
    queryFn: () =>
      projectId ? fetchProject(notebookDataClient, projectId) : null,
    enabled: Boolean(projectId),
  })
  useRecentViewTracking('dataset', dataset?.uuid)
  const pipelineRuns = useDatasetPipelineRuns({
    workspaceId: context.workspace?.id ?? '',
    latestVersionId,
    onStarted: (started) =>
      void navigate({
        to: '/pipelines/runs/$runId',
        params: { runId: started.id },
      }),
  })
  const [archiveOpen, setArchiveOpen] = useState(false)
  const canArchive = hasCapability(context.workspace?.role, 'record.create')

  if (!dataset) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('data.datasetPage.datasets'),
              link: { to: '/datasets' },
            },
          ]}
          title={
            summaries.isLoading
              ? t('data.datasetPage.loadingDataset')
              : t('data.datasetPage.datasetFound')
          }
        />
      </div>
    )
  }

  const params = { datasetId: dataset.uuid }
  // The active section: the child routes from the path, the three data tabs
  // from the search parameter, and the index — whose screen is the Overview —
  // as Overview.
  const section = pathname.split('/').filter(Boolean).pop()
  const current =
    search.view ??
    (section === 'rows' || section === 'snapshots' || section === 'compare'
      ? section
      : 'overview')
  const exportable = !dataset.archived && current !== 'compare'
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        // Where the dataset sits: its project and the experiment that made it,
        // then itself; a dataset with neither keeps the Datasets list as root.
        trail={[
          ...(projectId
            ? [
                {
                  label: project.data?.title ?? t('data.datasetPage.project'),
                  link: {
                    to: '/projects/$projectId' as const,
                    params: { projectId },
                  },
                },
              ]
            : []),
          ...(dataset.experimentId
            ? [
                {
                  label: dataset.experimentId,
                  mono: true,
                  link: {
                    to: '/experiments/$expId' as const,
                    params: { expId: dataset.experimentId },
                  },
                },
              ]
            : []),
          ...(projectId || dataset.experimentId
            ? []
            : [
                {
                  label: t('data.datasetPage.datasets'),
                  link: { to: '/datasets' as const },
                },
              ]),
          { label: dataset.id, mono: true },
        ]}
        title={dataset.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone={datasetValidation(dataset).tone}>
                {datasetValidation(dataset).label}
              </Status>
            </span>
            <span>
              {t('data.datasetPage.datasetSchema')} {dataset.model}
            </span>
            {dataset.experimentId ? (
              <ObjectLink kind="experiment" identifier={dataset.experimentId} />
            ) : null}
            <span>
              {t('data.datasetPage.owner')}{' '}
              {dataset.createdByUserId === context.user.id
                ? context.user.name
                : '—'}
            </span>
          </>
        }
        actions={
          <>
            <FavouriteToggle kind="dataset" objectId={dataset.uuid} />
            {exportable ? (
              <>
                <DatasetModelUpgrade
                  datasetId={dataset.uuid}
                  canEdit={hasCapability(
                    context.workspace?.role,
                    'schema.edit',
                  )}
                />
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to="/sheets/new"
                      search={{
                        dataset: dataset.uuid,
                        returnTo: `/datasets/${dataset.uuid}`,
                      }}
                    />
                  }
                >
                  {t('data.datasetPage.openSheet')}
                </Button>
                {/* Analyse and Chart open the studio on this dataset from any
                    tab, not only the rows, so the next step is always here.
                    Analyse is the main one; the rest of what a dataset can do
                    lives in the menu, with Archive last. */}
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to="/analysis/new"
                      search={{
                        mode: 'chart',
                        dataset: dataset.uuid,
                        returnTo: `/datasets/${dataset.uuid}`,
                      }}
                    />
                  }
                >
                  {t('data.datasetPage.chart')}
                </Button>
                <Button
                  variant="primary"
                  nativeButton={false}
                  render={
                    <Link
                      to="/analysis/new"
                      search={{
                        mode: 'analyse',
                        dataset: dataset.uuid,
                        returnTo: `/datasets/${dataset.uuid}`,
                      }}
                    />
                  }
                >
                  {t('data.datasetPage.analyse')}
                </Button>
              </>
            ) : null}
            {exportable || canArchive ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label={t('data.datasetPage.ariaMoreDatasetActions')}
                      icon="more"
                      variant="secondary"
                    />
                  }
                />
                <DropdownMenuContent align="end">
                  {exportable ? (
                    <>
                      <DropdownMenuLinkItem
                        icon="download"
                        render={
                          <a
                            href={`/api/export/dataset/${dataset.uuid}?format=csv`}
                            aria-label={t('data.datasetPage.ariaDownloadCsv', {
                              name: dataset.name,
                            })}
                          />
                        }
                      >
                        {t('data.datasetPage.downloadCsv')}
                      </DropdownMenuLinkItem>
                      <DatasetPipelineMenuItems
                        runs={pipelineRuns}
                        latestVersionId={latestVersionId}
                      />
                    </>
                  ) : null}
                  {canArchive ? (
                    <>
                      {exportable ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem
                        danger={!dataset.archived}
                        onClick={() => setArchiveOpen(true)}
                      >
                        {dataset.archived
                          ? t('data.datasetPage.restoreDataset')
                          : t('data.datasetPage.archiveDataset')}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {pipelineRuns.dialog}
            <DatasetArchive
              datasetId={dataset.uuid}
              name={dataset.name}
              archived={dataset.archived}
              canEdit={canArchive}
              open={archiveOpen}
              onOpenChange={setArchiveOpen}
              onDone={(nowArchived) => {
                if (nowArchived) void navigate({ to: '/datasets' })
              }}
            />
            <AskAiButton />
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('data.datasetPage.datasetSections')}
            value={current}
            items={[
              {
                key: 'overview',
                label: t('data.datasetPage.overview'),
                link: { to: '/datasets/$datasetId', params },
              },
              {
                key: 'rows',
                label: t('data.datasetPage.data'),
                count: dataset.rows,
                link: { to: '/datasets/$datasetId/rows', params },
              },
              {
                key: 'snapshots',
                label: t('data.datasetPage.snapshots'),
                count: versions.data?.length,
                link: { to: '/datasets/$datasetId/snapshots', params },
              },
              {
                key: 'compare',
                label: t('data.datasetPage.compare'),
                link: { to: '/datasets/$datasetId/compare', params },
              },
              {
                key: 'imports',
                label: t('data.datasetPage.imports'),
                link: {
                  to: '/datasets/$datasetId',
                  params,
                  search: { view: 'imports' },
                },
              },
              {
                key: 'used-by',
                label: t('data.datasetPage.usedBy'),
                link: {
                  to: '/datasets/$datasetId',
                  params,
                  search: { view: 'used-by' },
                },
              },
              {
                key: 'history',
                label: t('data.datasetPage.history'),
                link: {
                  to: '/datasets/$datasetId',
                  params,
                  search: { view: 'history' },
                },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        {search.view === 'imports' ? (
          <DatasetImportsTab datasetId={dataset.uuid} />
        ) : search.view === 'used-by' ? (
          <DatasetUsedByTab datasetId={dataset.uuid} />
        ) : search.view === 'history' ? (
          <DatasetHistoryTab datasetId={dataset.uuid} />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
