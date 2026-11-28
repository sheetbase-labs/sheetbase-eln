import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { t } from '#/copy'
import { PublishDialog } from '#/components/plugins/publish-dialog'
import type { PublisherItem } from '#/components/plugins/publish-dialog'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { ExplainThis } from '#/components/assist/explain-this'
import { PageHeader } from '#/components/ui/layout'
import type { Crumb } from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import type { TabsProps } from '#/components/ui/tabs'
import { DatasetContractBadge } from '#/components/contracts/dataset-contract-badge'
import { RecordPage } from '#/components/record-page/record-page'
import { RecordStateLine } from '#/components/record-page/record-state-line'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/datasets/datasets-data'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import type { ResolvedRunnerPoints } from '#/lib/extensions/runner-points'
import { isDatasetDetailTab } from '#/components/datasets/dataset-detail-tabs'
import type { DatasetDetailTab } from '#/components/datasets/dataset-detail-tabs'
import { DatasetHistoryTab } from '#/components/datasets/dataset-history-tab'
import { DatasetArchive } from '#/components/datasets/dataset-archive'
import { DatasetImportsTab } from '#/components/datasets/dataset-imports-tab'
import { DatasetModelUpgrade } from '#/components/datasets/dataset-model-upgrade'
import {
  DatasetPipelineMenuItems,
  useDatasetPipelineRuns,
} from '#/components/datasets/dataset-run-pipeline'
import {
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
} from '#/components/ui/dropdown-menu'
import { hasCapability } from '#/lib/capability'
import { DatasetUsedByTab } from '#/components/datasets/dataset-used-by-tab'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'
import { useRecentViewTracking } from '#/lib/recents'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useUserNames } from '#/lib/user-names'

import { datasetFacts } from './-dataset-facts'
import { DatasetSidePanel } from './-dataset-side'

/** UI port (roadmap-4/ui-app3): the dataset detail frame. Rows, Snapshots and
 * Compare are child routes; R5-SURF-01 adds Imports, Used by and History,
 * selected by the `view` search parameter so each is a linkable, reloadable URL
 * without a second route tree. The index child is the Overview screen. */
/** The detail view the URL asks for: rows, snapshots, compare, imports… */
interface DatasetDetailSearch {
  view?: DatasetDetailTab
}

export const Route = createFileRoute('/datasets/$datasetId')({
  validateSearch: (search): DatasetDetailSearch => ({
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

// react-doctor-disable-next-line react-doctor/only-export-components -- The dataset's child routes read the same versions query, so the hook and its key live with the frame; nothing here holds state Fast Refresh could preserve.
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
  const summaries = useDatasetSummaries()
  const dataset = summaries.data?.find((d) => d.uuid === datasetId)

  useRecentViewTracking('dataset', dataset?.uuid)

  if (!dataset) return <DatasetUnavailable summaries={summaries} />

  return <DatasetRecord dataset={dataset} />
}

/** The dataset once it has loaded: its header, tabs and side panel. */
function DatasetRecord({ dataset }: { dataset: DatasetListRow }) {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const navigate = useNavigate()
  const versions = useDatasetVersions(dataset.uuid)

  // File formats that plugins add to downloads, and other systems that
  // plugins can send the rows to.
  const { exporters: pluginExporters, publishers: pluginPublishers } =
    useExtensionPoints().data

  const [publishing, setPublishing] = useState<PublisherItem | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const latestVersionId = latestVersion(versions.data)
  const projectTitle = useDatasetProjectTitle(dataset.projectId)

  const { userLabel } = useUserNames(
    dataset.createdByUserId ? [dataset.createdByUserId] : [],
  )

  const pipelineRuns = useDatasetPipelineRuns({
    workspaceId: context.workspace?.id ?? '',
    latestVersionId,
    onStarted: (started) =>
      void navigate({
        to: '/pipelines/runs/$runId',
        params: { runId: started.id },
      }),
  })

  const params = { datasetId: dataset.uuid }
  const current = datasetSection(pathname, search.view)

  const role = context.workspace?.role
  const canArchive = hasCapability(role, 'record.create')
  const exportable = !dataset.archived && current !== 'compare'
  // The grid and the comparison want the whole width and their own scroll.
  const wide = current === 'rows' || current === 'compare'

  return (
    <RecordPage
      recordId={null}
      // Where the dataset sits: its project and the experiment that made it,
      // then itself; a dataset with neither keeps the Datasets list as root.
      trail={datasetTrail(dataset, projectTitle)}
      title={dataset.name}
      identifier={dataset.id}
      status={datasetValidation(dataset)}
      facts={datasetFacts(dataset, userLabel)}
      marks={<DatasetContractBadge datasetId={dataset.uuid} />}
      actions={
        <DatasetActions dataset={dataset} role={role} exportable={exportable} />
      }
      moreLabel={t('data.datasetPage.ariaMoreDatasetActions')}
      more={
        exportable || canArchive ? (
          <DatasetMoreItems
            dataset={dataset}
            exportable={exportable}
            canArchive={canArchive}
            pluginExporters={pluginExporters}
            pluginPublishers={pluginPublishers}
            pipelineRuns={pipelineRuns}
            latestVersionId={latestVersionId}
            onPublish={setPublishing}
            onArchive={() => setArchiveOpen(true)}
          />
        ) : null
      }
      stateLine={
        dataset.archived ? (
          <DatasetArchivedLine
            canRestore={canArchive}
            onRestore={() => setArchiveOpen(true)}
          />
        ) : null
      }
      tabs={datasetTabs({
        rows: dataset.rows,
        versionCount: versions.data?.length ?? 0,
        current,
        params,
      })}
      sideLabel={t('data.datasetPage.datasetContext')}
      side={
        wide ? null : (
          <DatasetSidePanel dataset={dataset} versions={versions.data ?? []} />
        )
      }
      overlays={
        <>
          {pipelineRuns.dialog}
          {publishing ? (
            <PublishDialog
              publisher={publishing}
              datasetName={dataset.name}
              datasetId={dataset.uuid}
              onClose={() => setPublishing(null)}
            />
          ) : null}
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
        </>
      }
      flush
      fill={wide}
    >
      <DatasetSection datasetId={dataset.uuid} view={search.view} />
    </RecordPage>
  )
}

/** The title of the project the dataset belongs to, once it has loaded. */
function useDatasetProjectTitle(projectId: string | null): string | null {
  const project = useQuery({
    queryKey: ['ui-port', 'dataset-project', projectId ?? ''],
    queryFn: () =>
      projectId ? fetchProject(notebookDataClient, projectId) : null,
    enabled: Boolean(projectId),
  })

  return project.data?.title ?? null
}

/** The newest snapshot, which pipelines run on. */
function latestVersion(versions: DatasetVersion[] | undefined): string | null {
  return (
    [...(versions ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]?.id ?? null
  )
}

/**
 * The active section: the child routes from the path, the three data tabs
 * from the search parameter, and the index (whose screen is the Overview) as
 * Overview.
 */
function datasetSection(pathname: string, view: string | undefined): string {
  if (view) return view

  const section = pathname.split('/').filter(Boolean).pop()

  return section === 'rows' || section === 'snapshots' || section === 'compare'
    ? section
    : 'overview'
}

/** An archived dataset says so above its tabs, with the way back. */
function DatasetArchivedLine({
  canRestore,
  onRestore,
}: {
  canRestore: boolean
  onRestore: () => void
}) {
  return (
    <RecordStateLine
      tone="info"
      action={
        canRestore ? (
          <Button size="sm" onClick={onRestore}>
            {t('data.datasetPage.restoreDataset')}
          </Button>
        ) : null
      }
    >
      {t('data.datasetPage.archivedLine')}
    </RecordStateLine>
  )
}

/** Where the dataset sits, from the Datasets list down to itself. */
function datasetTrail(
  dataset: DatasetListRow,
  projectTitle: string | null,
): Crumb[] {
  const projectId = dataset.projectId

  if (!projectId && !dataset.experimentId) {
    return [
      {
        label: t('data.datasetPage.datasets'),
        link: { to: '/datasets' },
      },
      { label: dataset.id, mono: true },
    ]
  }

  const projectCrumbs: Crumb[] = projectId
    ? [
        {
          label: projectTitle ?? t('data.datasetPage.project'),
          link: { to: '/projects/$projectId', params: { projectId } },
        },
      ]
    : []

  const experimentCrumbs: Crumb[] = dataset.experimentId
    ? [
        {
          label: dataset.experimentId,
          mono: true,
          link: {
            to: '/experiments/$expId',
            params: { expId: dataset.experimentId },
          },
        },
      ]
    : []

  return [
    ...projectCrumbs,
    ...experimentCrumbs,
    { label: dataset.id, mono: true },
  ]
}

/** The dataset's sections, Overview first and History at the far end. */
function datasetTabs({
  rows,
  versionCount,
  current,
  params,
}: {
  rows: number
  versionCount: number
  current: string
  params: { datasetId: string }
}): TabsProps {
  return {
    mode: 'url',
    label: t('data.datasetPage.datasetSections'),
    value: current,
    items: [
      {
        key: 'overview',
        label: t('data.datasetPage.overview'),
        link: { to: '/datasets/$datasetId', params },
      },
      {
        key: 'rows',
        label: t('data.datasetPage.data'),
        count: rows,
        link: { to: '/datasets/$datasetId/rows', params },
      },
      {
        key: 'snapshots',
        label: t('data.datasetPage.snapshots'),
        count: versionCount,
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
        end: true,
        link: {
          to: '/datasets/$datasetId',
          params,
          search: { view: 'history' },
        },
      },
    ],
  }
}

/**
 * Everything else under ⋯: Chart, downloads, plugin actions and pipelines,
 * then Archive or Restore last.
 */
function DatasetMoreItems({
  dataset,
  exportable,
  canArchive,
  pluginExporters,
  pluginPublishers,
  pipelineRuns,
  latestVersionId,
  onPublish,
  onArchive,
}: {
  dataset: DatasetListRow
  exportable: boolean
  canArchive: boolean
  pluginExporters: ResolvedRunnerPoints['data']['exporters']
  pluginPublishers: ResolvedRunnerPoints['data']['publishers']
  pipelineRuns: ReturnType<typeof useDatasetPipelineRuns>
  latestVersionId: string | null
  onPublish: (publisher: PublisherItem) => void
  onArchive: () => void
}) {
  return (
    <>
      {exportable ? (
        <>
          <DropdownMenuItem
            icon="chart"
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
          </DropdownMenuItem>
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
          {pluginExporters.map((item) => (
            <DropdownMenuLinkItem
              key={item.name}
              icon="download"
              render={
                // react-doctor-disable-next-line react-doctor/anchor-has-content -- The menu item's own label is the anchor's content through Base UI's render prop.
                <a
                  href={`/api/export/dataset/${dataset.uuid}?format=${encodeURIComponent(item.name)}`}
                />
              }
            >
              {t('plugins.export.download', {
                name: item.declaration.title,
                extension: item.declaration.extension,
              })}
            </DropdownMenuLinkItem>
          ))}
          {canArchive
            ? pluginPublishers.map((item) => (
                <DropdownMenuItem
                  key={item.name}
                  icon="upload"
                  onClick={() => onPublish(item)}
                >
                  {t('plugins.publish.menu', {
                    name: item.declaration.title,
                  })}
                </DropdownMenuItem>
              ))
            : null}
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
            onClick={() => onArchive()}
          >
            {dataset.archived
              ? t('data.datasetPage.restoreDataset')
              : t('data.datasetPage.archiveDataset')}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}

/**
 * Favourite, then Open in a sheet and Analyse, the main one; Explain and Ask
 * sit beside them.
 */
function DatasetActions({
  dataset,
  role,
  exportable,
}: {
  dataset: DatasetListRow
  role: string | null | undefined
  exportable: boolean
}) {
  return (
    <>
      <FavouriteToggle kind="dataset" objectId={dataset.uuid} />
      {exportable ? (
        <>
          <DatasetModelUpgrade
            datasetId={dataset.uuid}
            canEdit={hasCapability(role, 'schema.edit')}
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
      <ExplainThis
        subject="dataset"
        facts={`Dataset "${dataset.name}" (schema ${dataset.model}): ${dataset.rows} rows, ${dataset.issues} unresolved flags.`}
        objectRefs={[{ kind: 'dataset', id: dataset.uuid }]}
        className="max-md:hidden"
      />
      <AskAiButton />
    </>
  )
}

/** The dataset cannot be read: say why, and offer the way back. */
function DatasetUnavailable({
  summaries,
}: {
  summaries: ReturnType<typeof useDatasetSummaries>
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: t('data.datasetPage.datasets'), link: { to: '/datasets' } },
        ]}
        title={
          summaries.isLoading
            ? t('data.datasetPage.loadingDataset')
            : t('data.datasetPage.datasetFound')
        }
      />
      <RecordUnavailable
        query={summaries}
        what={t('settings.uiKit.recordUnavailable.dataset')}
        back={{
          to: '/datasets',
          label: t('settings.uiKit.recordUnavailable.backToDatasets'),
        }}
      />
    </div>
  )
}

/** The open section: the three data views, or whichever child route. */
function DatasetSection({
  datasetId,
  view,
}: {
  datasetId: string
  view: DatasetDetailTab | undefined
}) {
  if (view === 'imports') return <DatasetImportsTab datasetId={datasetId} />

  if (view === 'used-by') return <DatasetUsedByTab datasetId={datasetId} />

  if (view === 'history') return <DatasetHistoryTab datasetId={datasetId} />

  return (
    <div className="flex min-h-0 flex-1">
      <Outlet />
    </div>
  )
}
