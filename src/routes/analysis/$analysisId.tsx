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
      toast.success(`Saved as v${saved.version}`)
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
          trail={[{ label: 'Analysis', link: { to: '/analysis' } }]}
          title="Loading analysis…"
        />
      </div>
    )
  }
  if (!view) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Analysis', link: { to: '/analysis' } }]}
          title="Analysis not found"
        />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="chart"
            title="This analysis does not exist"
            description="It may have been deleted, or it belongs to another workspace."
            action={
              <Button nativeButton={false} render={<Link to="/analysis/new" />}>
                Open the studio
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
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[
            ...(source
              ? [
                  ...(sourceProjectId
                    ? [
                        {
                          label: sourceProject.data?.title ?? 'Project',
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
              : [{ label: 'Analysis', link: { to: '/analysis' as const } }]),
            { label: view.display_id ?? `v${view.version}`, mono: true },
          ]}
          title={view.name}
          meta={
            <>
              <span className="text-fg">
                {statusQuery.isPending ? (
                  <Status tone="progress">Checking sources…</Status>
                ) : !status ? (
                  <Status tone="none">Source check unavailable</Status>
                ) : status.state === 'stale' ? (
                  <Status tone="warn">Sources changed</Status>
                ) : (
                  <Status tone="ok">Up to date</Status>
                )}
              </span>
              <span>Saved version {view.version}</span>
              <span className="max-lg:hidden">
                Updated {view.updated_at.slice(0, 10)}
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
                  toast('Re-running on the current data')
                }}
              >
                Re-run
              </Button>
              <Button
                icon="link"
                onClick={() => {
                  void Promise.resolve()
                    .then(() =>
                      navigator.clipboard.writeText(window.location.href),
                    )
                    .then(() => toast('Link copied'))
                    .catch(() => toast('Could not copy the link'))
                }}
              >
                Share
              </Button>
              {datasetId ? (
                <Button onClick={() => setDuplicating(true)}>
                  Run on other data
                </Button>
              ) : null}
              <Link
                to="/analysis/new"
                search={{ view: view.id, dataset: datasetId }}
                className={buttonVariants({
                  variant: dirty ? 'secondary' : 'primary',
                })}
              >
                Edit in studio
              </Link>
              {dirty ? (
                <Button
                  variant="primary"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {`Save as v${view.version + 1}`}
                </Button>
              ) : null}
              <AskAiButton />
            </>
          }
        />
        <div className="flex min-h-0 flex-1">
          <FieldsPane dataset={datasetQuery.data ?? null} charts={charts} />
          <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 md:px-6">
            {movedSources.map((item) => (
              <Notice key={item.datasetId} tone="warn">
                {item.detail}
              </Notice>
            ))}
            {statusQuery.error ? (
              <Notice tone="warn">
                The canonical source check could not be read:{' '}
                {String(statusQuery.error)}
              </Notice>
            ) : null}
            {status?.acknowledged ? (
              <Notice tone="info">
                Keeping the pinned versions — acknowledged{' '}
                {status.acknowledged.at.slice(0, 10)} at v
                {status.acknowledged.viewVersion}. The sources it cites are
                unchanged.
              </Notice>
            ) : null}
            {status && status.citedByCount > 0 ? (
              <Notice tone="info">
                {status.citedByCount} record
                {status.citedByCount === 1 ? '' : 's'}{' '}
                {status.citedByCount === 1 ? 'cites' : 'cite'} this analysis, so
                it keeps the versions it cited. Save a new analysis and cite
                that to move on.
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
              <Notice tone="warn" title="This saved spec is not valid">
                Open it in the studio to repair it. The stored spec is kept as
                it was saved.
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
                toast.message(
                  'Loaded the earlier charts. Save to keep them as the new version.',
                )
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
                    <Status tone="ok">Spec is valid</Status>
                  )}
                  {materialised ? (
                    <Muted>
                      {materialised.rows.length} rows plotted ·{' '}
                      {materialised.series.length} series
                      {materialised.droppedPoints
                        ? ` · ${materialised.droppedPoints} points dropped`
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

      <Inspector aria-label="Analysis details" className="w-[320px]">
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
        <InspectorSection title="Exclusions">
          <Muted>
            {flagged.values === 0
              ? 'No flagged values in the fields these charts use.'
              : `${flagged.values} flagged ${flagged.values === 1 ? 'value is' : 'values are'} left out of every chart, on ${flagged.rows} ${flagged.rows === 1 ? 'row' : 'rows'}. The Data tab shows which.`}
          </Muted>
        </InspectorSection>
        <InspectorSection title="Used in">
          <CitationList
            citations={citationsQuery.data ?? []}
            loading={citationsQuery.isLoading}
            error={citationsQuery.error ? String(citationsQuery.error) : null}
          />
          <Muted className="mt-1">
            Embedded figures update when you save a new version. Signed records
            keep the version they cite.
          </Muted>
        </InspectorSection>
      </Inspector>
    </>
  )
}
