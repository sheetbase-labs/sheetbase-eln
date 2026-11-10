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
import { Button } from '#/components/ui/button'
import { Tabs } from '#/components/ui/tabs'
import { DatasetContractBadge } from '#/components/contracts/dataset-contract-badge'
import { Status } from '#/components/ui/status'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { hasCapability } from '#/lib/capability'
import { DatasetUsedByTab } from '#/components/datasets/dataset-used-by-tab'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { ObjectLink } from '#/components/ui/object-link'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'
import { useRecentViewTracking } from '#/lib/recents'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

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
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const navigate = useNavigate()
  const summaries = useDatasetSummaries()
  const versions = useDatasetVersions(datasetId)
  // File formats that plugins add to downloads.
  const pluginExporters = useExtensionPoints().data.exporters
  // Other systems that plugins can send the rows to.
  const pluginPublishers = useExtensionPoints().data.publishers

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

  if (!dataset) return <DatasetUnavailable summaries={summaries} />

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

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        // Where the dataset sits: its project and the experiment that made it,
        // then itself; a dataset with neither keeps the Datasets list as root.
        trail={datasetTrail(dataset, projectId, project.data?.title ?? null)}
        title={dataset.name}
        meta={
          <DatasetMeta
            dataset={dataset}
            currentUserId={context.user.id}
            currentUserName={context.user.name}
          />
        }
        actions={
          <DatasetActions
            dataset={dataset}
            role={context.workspace?.role}
            current={current}
            pluginExporters={pluginExporters}
            pluginPublishers={pluginPublishers}
            pipelineRuns={pipelineRuns}
            latestVersionId={latestVersionId}
          />
        }
        tabs={
          <DatasetTabs
            rows={dataset.rows}
            versionCount={versions.data?.length ?? 0}
            current={current}
            params={params}
          />
        }
      />
      <DatasetSection datasetId={dataset.uuid} view={search.view} />
    </div>
  )
}

/** Where the dataset sits, from the Datasets list down to itself. */
function datasetTrail(
  dataset: DatasetListRow,
  projectId: string | null,
  projectTitle: string | null,
) {
  if (!projectId && !dataset.experimentId) {
    return [
      {
        label: t('data.datasetPage.datasets'),
        link: { to: '/datasets' as const },
      },
      { label: dataset.id, mono: true },
    ]
  }

  return [
    ...(projectId
      ? [
          {
            label: projectTitle ?? t('data.datasetPage.project'),
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
    { label: dataset.id, mono: true },
  ]
}

/** The dataset's status, schema, contract and owner, under its name. */
function DatasetMeta({
  dataset,
  currentUserId,
  currentUserName,
}: {
  dataset: DatasetListRow
  currentUserId: string
  currentUserName: string
}) {
  const validation = datasetValidation(dataset)

  return (
    <>
      <span className="text-fg">
        <Status tone={validation.tone}>{validation.label}</Status>
      </span>
      <span>
        {t('data.datasetPage.datasetSchema')} {dataset.model}
      </span>
      <DatasetContractBadge datasetId={dataset.uuid} />
      {dataset.experimentId ? (
        <ObjectLink kind="experiment" identifier={dataset.experimentId} />
      ) : null}
      <span>
        {t('data.datasetPage.owner')}{' '}
        {dataset.createdByUserId === currentUserId ? currentUserName : '—'}
      </span>
    </>
  )
}

/** The dataset's sections: its own screens and the three data views. */
function DatasetTabs({
  rows,
  versionCount,
  current,
  params,
}: {
  rows: number
  versionCount: number
  current: string
  params: { datasetId: string }
}) {
  return (
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
          link: {
            to: '/datasets/$datasetId',
            params,
            search: { view: 'history' },
          },
        },
      ]}
    />
  )
}

/** The dataset's overflow menu: exports, plugin actions, then Archive. */
function DatasetMenu({
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
  if (!exportable && !canArchive) return null

  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Everything the dataset page can do: open it elsewhere, export it, archive it. */
function DatasetActions({
  dataset,
  role,
  current,
  pluginExporters,
  pluginPublishers,
  pipelineRuns,
  latestVersionId,
}: {
  dataset: DatasetListRow
  role: string | null | undefined
  current: string
  pluginExporters: ResolvedRunnerPoints['data']['exporters']
  pluginPublishers: ResolvedRunnerPoints['data']['publishers']
  pipelineRuns: ReturnType<typeof useDatasetPipelineRuns>
  latestVersionId: string | null
}) {
  const navigate = useNavigate()
  const [publishing, setPublishing] = useState<PublisherItem | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const canArchive = hasCapability(role, 'record.create')
  const exportable = !dataset.archived && current !== 'compare'

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
      <DatasetMenu
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
