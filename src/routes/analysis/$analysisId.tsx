import { t } from '#/copy'
import { listAnalysisVersions } from '#/lib/analysis-versions'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  AnalysisTabs,
  ChartSettings,
  ChartStack,
  FieldsPane,
  exclusionCounts,
} from '#/components/v3/analysis/analysis-document'
import { toast } from '#/components/v3/ui/sonner'
import {
  ANALYSIS_MAX_CHARTS,
  nextChart,
  withYColumn,
} from '#/lib/analysis-charts'
import type { ChartSpec } from '#/lib/chart-spec'
import {
  PageHeader,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { resolveChartDataset, materialiseLiveChart } from '#/lib/chart-data'
import {
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  fetchAnalysisViewCitations,
  fetchAnalysisViewSourceStatus,
  updateAnalysisView,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import { DuplicateAnalysisDialog } from '#/components/v3/analysis/duplicate-analysis-dialog'
import { CitationList } from '#/components/viz/citation-list'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useDatasetSummaries } from '#/components/v3/datasets/datasets-data'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'

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

function AnalysisView() {
  const { analysisId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const [duplicating, setDuplicating] = useState(false)
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
          trail={[
            ...(source
              ? [
                  ...(sourceProjectId
                    ? [
                        {
                          label:
                            sourceProject.data?.title ??
                            t('data.analysisPage.project'),
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
              : [
                  {
                    label: t('data.analysisPage.analysis'),
                    link: { to: '/analysis' as const },
                  },
                ]),
            { label: view.display_id ?? `v${view.version}`, mono: true },
          ]}
          title={view.name}
          meta={
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
                  <Status tone="warn">
                    {t('data.analysisPage.sourcesChanged')}
                  </Status>
                ) : (
                  <Status tone="ok">{t('data.analysisPage.upDate')}</Status>
                )}
              </span>
              <span>
                {t('data.analysisPage.savedVersion')} {view.version}
              </span>
              <span className="max-lg:hidden">
                {t('data.analysisPage.updated', {
                  slice: view.updated_at.slice(0, 10),
                })}
              </span>
            </>
          }
          actions={
            <>
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
                    .then(() =>
                      navigator.clipboard.writeText(window.location.href),
                    )
                    .then(() => toast(t('data.analysisPage.linkCopied')))
                    .catch(() => toast(t('data.analysisPage.couldCopyLink')))
                }}
              >
                {t('common.actions.share')}
              </Button>
              {datasetId ? (
                <Button onClick={() => setDuplicating(true)}>
                  {t('data.analysisPage.runOtherData')}
                </Button>
              ) : null}
              <Link
                to="/analysis/new"
                search={{ view: view.id, dataset: datasetId }}
                className={buttonVariants({
                  variant: dirty ? 'secondary' : 'primary',
                })}
              >
                {t('data.analysisPage.editStudio')}
              </Link>
              {dirty ? (
                <Button
                  variant="primary"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {t('data.analysisPage.saveV', { value: view.version + 1 })}
                </Button>
              ) : null}
              <AskAiButton />
            </>
          }
        />
        <div className="flex min-h-0 flex-1">
          <FieldsPane dataset={datasetQuery.data ?? null} charts={charts} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
            {movedSources.map((item) => (
              <Notice key={item.datasetId} tone="warn">
                {item.detail}
              </Notice>
            ))}
            {statusQuery.error ? (
              <Notice tone="warn">
                {t('data.analysisPage.canonicalSourceCheckCould', {
                  value: String(statusQuery.error),
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
                {status.citedByCount} record
                {status.citedByCount === 1 ? '' : 's'}{' '}
                {status.citedByCount === 1 ? 'cites' : 'cite'}{' '}
                {t('data.analysisPage.analysisSoKeepsVersions')}
              </Notice>
            ) : null}
            {specCheck?.ok ? (
              <ChartStack
                charts={charts}
                selected={Math.min(selected, charts.length - 1)}
                onSelect={setSelected}
                dataset={datasetQuery.data ?? null}
                loading={datasetQuery.isLoading}
                title={view.name}
                onAdd={
                  charts.length < ANALYSIS_MAX_CHARTS &&
                  nextChart(charts, columns)
                    ? () => {
                        const next = nextChart(charts, columns)
                        if (!next) return
                        setEdited([...charts, next])
                        setSelected(charts.length)
                      }
                    : null
                }
              />
            ) : (
              <Notice tone="warn" title={t('data.analysisPage.savedSpecValid')}>
                {t('data.analysisPage.openStudioRepairStored')}
              </Notice>
            )}
            <AnalysisTabs
              charts={charts}
              dataset={datasetQuery.data ?? null}
              version={view.version}
              updatedAt={view.updated_at}
              earlier={versionsQuery.data ?? []}
              savedCharts={base}
              onRestore={(restored) => {
                setEdited(restored)
                setSelected(0)
                toast.message(t('data.analysisPage.loadedEarlierChartsSave'))
              }}
              diagnostics={
                <div className="flex flex-col gap-1">
                  {specCheck && !specCheck.ok ? (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
                      {specCheck.errors.slice(0, 5).map((message, i) => (
                        <li key={i} className="text-warning-text">
                          {message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Status tone="ok">
                      {t('data.analysisPage.specValid')}
                    </Status>
                  )}
                  {materialised ? (
                    <Muted>
                      {t('data.analysisPage.rowsPlottedSeries', {
                        length: materialised.rows.length,
                        length2: materialised.series.length,
                      })}
                      {materialised.droppedPoints
                        ? t('data.analysisPage.pointsDropped', {
                            droppedPoints: materialised.droppedPoints,
                          })
                        : ''}
                    </Muted>
                  ) : null}
                </div>
              }
            />
          </div>
        </div>
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

      <Inspector
        aria-label={t('data.analysisPage.ariaAnalysisDetails')}
        className="w-[320px]"
      >
        <ChartSettings
          charts={charts}
          selected={Math.min(selected, charts.length - 1)}
          columns={columns}
          editable={specCheck?.ok === true}
          onYChange={(columnId) => {
            const column = columns.find((c) => c.id === columnId)
            if (!column) return
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
        <InspectorSection title={t('data.analysisPage.exclusions')}>
          <Muted>
            {flagged.values === 0
              ? t('data.analysisPage.flaggedValuesFieldsThese')
              : t('data.analysisPage.flaggedLeftOutEvery', {
                  values: flagged.values,
                  value:
                    flagged.values === 1
                      ? t('data.analysisPage.valueIs')
                      : t('data.analysisPage.valuesAre'),
                  rows: flagged.rows,
                  value2: flagged.rows === 1 ? 'row' : 'rows',
                })}
          </Muted>
        </InspectorSection>
        <InspectorSection title={t('data.analysisPage.usedIn')}>
          <CitationList
            citations={citationsQuery.data ?? []}
            loading={citationsQuery.isLoading}
            error={citationsQuery.error ? String(citationsQuery.error) : null}
          />
          <Muted className="mt-1">
            {t('data.analysisPage.embeddedFiguresUpdateWhen')}
          </Muted>
        </InspectorSection>
      </Inspector>
    </>
  )
}
