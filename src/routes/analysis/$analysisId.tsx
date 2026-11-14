import { t } from '#/copy'
import { listAnalysisVersions } from '#/lib/analysis-versions'
import type { AnalysisVersionWire } from '#/lib/analysis-versions'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  AnalysisTabs,
  ChartSettings,
  ChartStack,
  FieldsPane,
} from '#/components/analysis/analysis-document'
import { exclusionCounts } from '#/components/analysis/analysis-exclusions'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { toast } from '#/components/ui/sonner'
import {
  ANALYSIS_MAX_CHARTS,
  nextChart,
  withYColumn,
} from '#/lib/analysis-charts'
import type {
  ChartColumn,
  ChartSpec,
  MaterialisedChart,
} from '#/lib/chart-spec'
import {
  PageHeader,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { Status } from '#/components/ui/status'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { Button, buttonVariants } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { resolveChartDataset, materialiseLiveChart } from '#/lib/chart-data'
import type { ResolvedDataset } from '#/lib/chart-data'
import {
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  fetchAnalysisViewCitations,
  fetchAnalysisViewSourceStatus,
  updateAnalysisView,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisViewCitation,
  AnalysisViewSourceStatus,
  AnalysisViewWire,
} from '#/lib/analysis-studio-data'
import { DuplicateAnalysisDialog } from '#/components/analysis/duplicate-analysis-dialog'
import { CitationList } from '#/components/viz/citation-list'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useDatasetSummaries } from '#/components/datasets/datasets-data'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import type { Crumb } from '#/components/ui/breadcrumb'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'
import { formatDate } from '#/lib/format-date'

/** UI port (roadmap-4/ui-app3): a saved analysis view, rebuilt from its stored
 * ChartSpec and the current source dataset. The studio at /analysis is the
 * authoring surface; this route is the shareable, read-only view. */
export const Route = createFileRoute('/analysis/$analysisId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    await resolveIdentifierParam({
      entity: 'analysis',
      ref: params.analysisId,
      href: location.href,
    })

    return { context }
  },
  component: AnalysisView,
})

/** What the stored spec's own check answered. */
type AnalysisSpecCheck = ReturnType<typeof validateAnalysisSpec>

/** The breadcrumb from the analysis back through its dataset, experiment and project. */
function analysisTrail({
  view,
  source,
  sourceProjectId,
  sourceProjectTitle,
}: {
  view: AnalysisViewWire
  source: DatasetListRow | null
  sourceProjectId: string | null
  sourceProjectTitle: string | null
}): Crumb[] {
  const fromAnalysis: Crumb = {
    label: t('data.analysisPage.analysis'),
    link: { to: '/analysis' },
  }

  return [
    ...(source
      ? [
          ...(sourceProjectId
            ? [
                {
                  label: sourceProjectTitle ?? t('data.analysisPage.project'),
                  link: {
                    to: '/projects/$projectId' as const,
                    params: { projectId: sourceProjectId },
                  },
                },
              ]
            : []),
          ...(source.experimentId
            ? [
                {
                  label: source.experimentId,
                  mono: true,
                  link: {
                    to: '/experiments/$expId' as const,
                    params: { expId: source.experimentId },
                  },
                },
              ]
            : []),
          {
            label: source.id,
            mono: true,
            link: {
              to: '/datasets/$datasetId' as const,
              params: { datasetId: source.uuid },
            },
          },
        ]
      : [fromAnalysis]),
    { label: view.display_id ?? `v${view.version}`, mono: true },
  ]
}

/** The source check's answer, the saved version and when it was last updated. */
function AnalysisMeta({
  statusQuery,
  status,
  version,
  updatedAt,
}: {
  statusQuery: { isPending: boolean }
  status: AnalysisViewSourceStatus | null
  version: number
  updatedAt: string
}) {
  return (
    <>
      <span className="text-fg">
        {statusQuery.isPending ? (
          <Status tone="progress">
            {t('data.analysisPage.checkingSources')}
          </Status>
        ) : !status ? (
          <Status tone="none">
            {t('data.analysisPage.sourceCheckUnavailable')}
          </Status>
        ) : status.state === 'stale' ? (
          <Status tone="warn">{t('data.analysisPage.sourcesChanged')}</Status>
        ) : (
          <Status tone="ok">{t('data.analysisPage.upDate')}</Status>
        )}
      </span>
      <span>
        {t('data.analysisPage.savedVersion')} {version}
      </span>
      <span className="max-lg:hidden">
        {t('data.analysisPage.updated', { slice: formatDate(updatedAt) })}
      </span>
    </>
  )
}

/** Everything the header can do with the analysis it is showing. */
function AnalysisActions({
  analysisId,
  view,
  datasetId,
  dirty,
  savePending,
  onSave,
  onDuplicate,
}: {
  analysisId: string
  view: AnalysisViewWire
  datasetId: string | null
  dirty: boolean
  savePending: boolean
  onSave: () => void
  onDuplicate: () => void
}) {
  const queryClient = useQueryClient()

  return (
    <>
      <FavouriteToggle kind="analysis_view" objectId={view.id} />
      <Button
        icon="play"
        onClick={() => {
          void queryClient.invalidateQueries({
            queryKey: ['ui-port', 'analysis'],
          })
          void queryClient.invalidateQueries({
            queryKey: analysisStudioQueryKeys.sourceStatus(analysisId),
          })
          toast(t('data.analysisPage.reRunningCurrentData'))
        }}
      >
        {t('data.analysisPage.reRun')}
      </Button>
      <Button
        icon="link"
        onClick={() => {
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(window.location.href))
            .then(() => toast(t('data.analysisPage.linkCopied')))
            .catch(() => toast.error(t('data.analysisPage.couldCopyLink')))
        }}
      >
        {t('common.actions.share')}
      </Button>
      {datasetId ? (
        <Button onClick={onDuplicate}>
          {t('data.analysisPage.runOtherData')}
        </Button>
      ) : null}
      <Link
        to="/analysis/new"
        search={{ view: view.id, dataset: datasetId ?? undefined }}
        className={buttonVariants({
          variant: dirty ? 'secondary' : 'primary',
        })}
      >
        {t('data.analysisPage.editStudio')}
      </Link>
      {dirty ? (
        <Button variant="primary" disabled={savePending} onClick={onSave}>
          {t('data.analysisPage.saveV', { value: view.version + 1 })}
        </Button>
      ) : null}
      <AskAiButton />
    </>
  )
}

/** What the source check, and any acknowledgement of it, has to say. */
function SourceNotices({
  movedSources,
  status,
  checkError,
}: {
  movedSources: AnalysisViewSourceStatus['sources']
  status: AnalysisViewSourceStatus | null
  checkError: Error | null
}) {
  return (
    <>
      {movedSources.map((item) => (
        <Notice key={item.datasetId} tone="warn">
          {item.detail}
        </Notice>
      ))}
      {checkError ? (
        <Notice tone="warn">
          {t('data.analysisPage.canonicalSourceCheckCould', {
            error: String(checkError),
          })}
        </Notice>
      ) : null}
      {status?.acknowledged ? (
        <Notice tone="info">
          {t('data.analysisPage.keepingPinnedVersionsAcknowledged', {
            slice: status.acknowledged.at.slice(0, 10),
            viewVersion: status.acknowledged.viewVersion,
          })}
        </Notice>
      ) : null}
      {status && status.citedByCount > 0 ? (
        <Notice tone="info">
          {t('data.analysisPage.citedByRecords', {
            count: status.citedByCount,
          })}
        </Notice>
      ) : null}
    </>
  )
}

/** The stored spec's problems, and how much of the data the chart plotted. */
function ChartDiagnostics({
  specCheck,
  materialised,
}: {
  specCheck: AnalysisSpecCheck | null
  materialised: {
    rows: unknown[]
    series: unknown[]
    droppedPoints: number
  } | null
}) {
  return (
    <div className="flex flex-col gap-1">
      {specCheck && !specCheck.ok ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
          {specCheck.errors.slice(0, 5).map((message, i) => (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- A specification problem is its sentence; the list is ordered and has no other identity.
            <li key={i} className="text-warning-text">
              {message}
            </li>
          ))}
        </ul>
      ) : (
        <Status tone="ok">{t('data.analysisPage.specValid')}</Status>
      )}
      {materialised ? (
        <Muted>
          {[
            t('data.analysisPage.rowsPlotted', {
              count: materialised.rows.length,
            }),
            t('data.analysisPage.seriesPlotted', {
              count: materialised.series.length,
            }),
            materialised.droppedPoints
              ? t('data.analysisPage.pointsDropped', {
                  count: materialised.droppedPoints,
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Muted>
      ) : null}
    </div>
  )
}

/** The charts, their tabs and the inspector: everything beside the field list. */
function AnalysisDocument({
  charts,
  selected,
  onSelect,
  dataset,
  datasetLoading,
  title,
  version,
  updatedAt,
  earlier,
  savedCharts,
  movedSources,
  status,
  checkError,
  specOk,
  specCheck,
  materialised,
  onAddChart,
  onRestore,
}: {
  charts: ChartSpec[]
  selected: number
  onSelect: (index: number) => void
  dataset: ResolvedDataset | null
  datasetLoading: boolean
  title: string
  version: number
  updatedAt: string
  earlier: AnalysisVersionWire[]
  savedCharts: ChartSpec[]
  movedSources: AnalysisViewSourceStatus['sources']
  status: AnalysisViewSourceStatus | null
  checkError: Error | null
  specOk: boolean
  specCheck: AnalysisSpecCheck | null
  materialised: MaterialisedChart | null
  onAddChart: (() => void) | null
  onRestore: (charts: ChartSpec[]) => void
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <FieldsPane dataset={dataset} charts={charts} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
        <SourceNotices
          movedSources={movedSources}
          status={status}
          checkError={checkError}
        />
        {specOk ? (
          <ChartStack
            charts={charts}
            selected={Math.min(selected, charts.length - 1)}
            onSelect={onSelect}
            dataset={dataset}
            loading={datasetLoading}
            title={title}
            onAdd={onAddChart}
          />
        ) : (
          <Notice tone="warn" title={t('data.analysisPage.savedSpecValid')}>
            {t('data.analysisPage.openStudioRepairStored')}
          </Notice>
        )}
        <AnalysisTabs
          charts={charts}
          dataset={dataset}
          version={version}
          updatedAt={updatedAt}
          earlier={earlier}
          savedCharts={savedCharts}
          onRestore={onRestore}
          diagnostics={
            <ChartDiagnostics
              specCheck={specCheck ?? null}
              materialised={materialised}
            />
          }
        />
      </div>
    </div>
  )
}

/** The inspector beside the document: the selected chart, exclusions and citations. */
function AnalysisInspector({
  charts,
  selected,
  columns,
  editable,
  flagged,
  citations,
  citationsLoading,
  citationsError,
  onYChange,
  onRemove,
}: {
  charts: ChartSpec[]
  selected: number
  columns: ChartColumn[]
  editable: boolean
  flagged: { values: number; rows: number }
  citations: AnalysisViewCitation[]
  citationsLoading: boolean
  citationsError: string | null
  onYChange: (column: ChartColumn) => void
  onRemove: (() => void) | null
}) {
  return (
    <Inspector
      aria-label={t('data.analysisPage.ariaAnalysisDetails')}
      className="w-[320px]"
    >
      <ChartSettings
        charts={charts}
        selected={Math.min(selected, charts.length - 1)}
        columns={columns}
        editable={editable}
        onYChange={(columnId) => {
          const column = columns.find((c) => c.id === columnId)

          if (column) onYChange(column)
        }}
        onRemove={onRemove}
      />
      <InspectorSection title={t('data.analysisPage.exclusions')}>
        <Muted>
          {flagged.values === 0
            ? t('data.analysisPage.flaggedValuesFieldsThese')
            : t('data.analysisPage.flaggedLeftOutEvery', {
                count: flagged.values,
                rows: t('common.counts.rows', { count: flagged.rows }),
              })}
        </Muted>
      </InspectorSection>
      <InspectorSection title={t('data.analysisPage.usedIn')}>
        <CitationList
          citations={citations}
          loading={citationsLoading}
          error={citationsError}
        />
        <Muted className="mt-1">
          {t('data.analysisPage.embeddedFiguresUpdateWhen')}
        </Muted>
      </InspectorSection>
    </Inspector>
  )
}

/** Everything this page reads, and every edit it can make, for one saved analysis. */
function useAnalysisView(analysisId: string) {
  const viewQuery = useQuery({
    queryKey: ['ui-port', 'analysis', 'view', analysisId],
    queryFn: () =>
      analysisStudioDataClient
        .list<AnalysisViewWire>(
          'analysis_views',
          `?id=eq.${encodeURIComponent(analysisId)}&limit=1`,
        )
        .then((rows) => rows[0] ?? null),
  })

  const view = viewQuery.data

  const datasetQuery = useQuery({
    queryKey: ['ui-port', 'analysis', 'dataset', view?.id, view?.version],
    queryFn: () =>
      resolveChartDataset(analysisStudioDataClient, view!.charts[0]),
    enabled: Boolean(view),
  })

  const queryClient = useQueryClient()

  const versionsQuery = useQuery({
    queryKey: ['ui-port', 'analysis', 'versions', view?.id, view?.version],
    queryFn: () => listAnalysisVersions(analysisStudioDataClient, view!.id),
    enabled: Boolean(view),
  })

  const [edited, setEdited] = useState<ChartSpec[] | null>(null)
  const [selected, setSelected] = useState(0)
  const base = useMemo(() => (view ? view.charts : []), [view])
  const charts = edited ?? base

  const dirty =
    edited !== null && JSON.stringify(edited) !== JSON.stringify(base)

  const columns = datasetQuery.data?.source.columns ?? []

  const save = useMutation({
    mutationFn: () =>
      updateAnalysisView(analysisStudioDataClient, view!.id, {
        name: view!.name,
        charts,
        source_revisions: view!.source_revisions,
        export_settings: view!.export_settings,
      }),
    onSuccess: async (saved) => {
      setEdited(null)
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'analysis', 'view', analysisId],
      })
      toast.success(t('data.analysisPage.savedV', { version: saved.version }))
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  })

  const flagged = exclusionCounts(datasetQuery.data ?? null, charts)

  const specCheck = useMemo(
    () => (view ? validateAnalysisSpec(view.charts[0]) : null),
    [view],
  )

  const materialised = useMemo(
    () =>
      view && specCheck?.ok
        ? materialiseLiveChart(view.charts[0], datasetQuery.data ?? null)
        : null,
    [view, specCheck, datasetQuery.data],
  )

  // R5-STUDIO-03: the canonical staleness answer and the citation list, both
  // from the database boundary, so this read-only view agrees with the studio.
  const statusQuery = useQuery({
    queryKey: analysisStudioQueryKeys.sourceStatus(analysisId),
    queryFn: () =>
      fetchAnalysisViewSourceStatus(analysisStudioDataClient, analysisId),
    enabled: Boolean(view),
    staleTime: 5_000,
  })

  const citationsQuery = useQuery({
    queryKey: analysisStudioQueryKeys.citations(analysisId),
    queryFn: () =>
      fetchAnalysisViewCitations(analysisStudioDataClient, analysisId),
    enabled: Boolean(view),
    staleTime: 5_000,
  })

  // Where the analysis sits, for the trail: the dataset it draws on, the
  // experiment that made it and that experiment's project.
  const summaries = useDatasetSummaries()
  const sourceId = view ? specSourceDatasetId(view.charts[0]) : null
  const source = summaries.data?.find((d) => d.uuid === sourceId) ?? null
  const sourceProjectId = source?.projectId ?? null

  const sourceProject = useQuery({
    queryKey: ['ui-port', 'analysis', 'source-project', sourceProjectId ?? ''],
    queryFn: () =>
      sourceProjectId
        ? fetchProject(notebookDataClient, sourceProjectId)
        : null,
    enabled: Boolean(sourceProjectId),
  })

  const status = statusQuery.data ?? null

  const movedSources =
    status?.sources.filter((item) => item.status !== 'current') ?? []

  const addChart =
    charts.length < ANALYSIS_MAX_CHARTS && nextChart(charts, columns)
      ? () => {
          const next = nextChart(charts, columns)

          if (!next) return
          setEdited([...charts, next])
          setSelected(charts.length)
        }
      : null

  return {
    view,
    viewQuery,
    datasetQuery,
    versionsQuery,
    edited,
    setEdited,
    selected,
    setSelected,
    base,
    charts,
    dirty,
    columns,
    save,
    flagged,
    specCheck,
    materialised,
    statusQuery,
    citationsQuery,
    source,
    sourceProject,
    sourceProjectId,
    status,
    movedSources,
    addChart,
  }
}

function AnalysisView() {
  const { analysisId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const [duplicating, setDuplicating] = useState(false)
  const page = useAnalysisView(analysisId)

  const {
    view,
    viewQuery,
    datasetQuery,
    versionsQuery,
    setEdited,
    selected,
    setSelected,
    base,
    charts,
    dirty,
    columns,
    save,
    flagged,
    specCheck,
    materialised,
    statusQuery,
    citationsQuery,
    source,
    sourceProject,
    sourceProjectId,
    status,
    movedSources,
    addChart,
  } = page

  if (viewQuery.isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('data.analysisPage.analysis'),
              link: { to: '/analysis' },
            },
          ]}
          title={t('data.analysisPage.loadingAnalysis')}
        />
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('data.analysisPage.analysis'),
              link: { to: '/analysis' },
            },
          ]}
          title={t('data.analysisPage.analysisFound')}
        />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="chart"
            title={t('data.analysisPage.analysisDoesExist')}
            description={t('data.analysisPage.mayHaveBeenDeleted')}
            action={
              <Button nativeButton={false} render={<Link to="/analysis/new" />}>
                {t('data.analysisPage.openStudio')}
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const datasetId = specSourceDatasetId(view.charts[0])

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader
          trail={analysisTrail({
            view,
            source,
            sourceProjectId,
            sourceProjectTitle: sourceProject.data?.title ?? null,
          })}
          title={view.name}
          meta={
            <AnalysisMeta
              statusQuery={statusQuery}
              status={status}
              version={view.version}
              updatedAt={view.updated_at}
            />
          }
          actions={
            <AnalysisActions
              analysisId={analysisId}
              view={view}
              datasetId={datasetId ?? null}
              dirty={dirty}
              savePending={save.isPending}
              onSave={() => save.mutate()}
              onDuplicate={() => setDuplicating(true)}
            />
          }
        />
        <AnalysisDocument
          charts={charts}
          selected={selected}
          onSelect={setSelected}
          dataset={datasetQuery.data ?? null}
          datasetLoading={datasetQuery.isLoading}
          title={view.name}
          version={view.version}
          updatedAt={view.updated_at}
          earlier={versionsQuery.data ?? []}
          savedCharts={base}
          movedSources={movedSources}
          status={status}
          checkError={statusQuery.error ?? null}
          specOk={specCheck?.ok === true}
          specCheck={specCheck ?? null}
          materialised={materialised}
          onAddChart={addChart}
          onRestore={(restored) => {
            setEdited(restored)
            setSelected(0)
            toast.message(t('data.analysisPage.loadedEarlierChartsSave'))
          }}
        />
      </div>

      {duplicating ? (
        <DuplicateAnalysisDialog
          view={view}
          workspaceId={context.workspace?.id ?? ''}
          userId={context.user.id}
          open
          onOpenChange={setDuplicating}
        />
      ) : null}

      <AnalysisInspector
        charts={charts}
        selected={selected}
        columns={columns}
        editable={specCheck?.ok === true}
        flagged={flagged}
        citations={citationsQuery.data ?? []}
        citationsLoading={citationsQuery.isLoading}
        citationsError={
          citationsQuery.error ? String(citationsQuery.error) : null
        }
        onYChange={(column) => {
          const at = Math.min(selected, charts.length - 1)
          setEdited(
            charts.map((c, i) => (i === at ? withYColumn(c, column) : c)),
          )
        }}
        onRemove={
          selected > 0 && charts.length > 1
            ? () => {
                setEdited(charts.filter((_, i) => i !== selected))
                setSelected(0)
              }
            : null
        }
      />
    </>
  )
}
