import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  PageHeader,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { resolveChartDataset, materialiseLiveChart } from '#/lib/chart-data'
import {
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  fetchAnalysisViewCitations,
  fetchAnalysisViewSourceStatus,
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
    queryFn: () => resolveChartDataset(analysisStudioDataClient, view!.spec),
    enabled: Boolean(view),
  })

  const specCheck = useMemo(
    () => (view ? validateAnalysisSpec(view.spec) : null),
    [view],
  )
  const materialised = useMemo(
    () =>
      view && specCheck?.ok
        ? materialiseLiveChart(view.spec, datasetQuery.data ?? null)
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
  const sourceId = view ? specSourceDatasetId(view.spec) : null
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

  const datasetId = specSourceDatasetId(view.spec)
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
              {datasetId ? (
                <Button onClick={() => setDuplicating(true)}>
                  Run on other data
                </Button>
              ) : null}
              <Link
                to="/analysis/new"
                search={{ view: view.id, dataset: datasetId }}
                className={buttonVariants({ variant: 'primary' })}
              >
                Edit in studio
              </Link>
            </>
          }
        />
        <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
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
              it keeps the versions it cited. Save a new analysis and cite that
              to move on.
            </Notice>
          ) : null}
          {materialised ? (
            <div className="rounded-md border border-border p-3">
              <ChartRenderer
                title={view.name}
                subtitle={`Analysis view · saved ${view.created_at.slice(0, 10)}`}
                spec={view.spec}
                materialised={materialised}
                frozen={null}
                loading={datasetQuery.isLoading}
              />
            </div>
          ) : (
            <Notice tone="warn" title="This saved spec is not valid">
              Open it in the studio to repair it. The stored spec is kept as it
              was saved.
            </Notice>
          )}
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
        <InspectorSection title="Source">
          {datasetId ? (
            <Link
              to="/datasets/$datasetId/snapshots"
              params={{ datasetId }}
              className="text-link"
            >
              {datasetQuery.data?.source.name ?? 'Dataset'}
            </Link>
          ) : (
            <Muted>No source dataset.</Muted>
          )}
          <Muted className="mt-1">
            {datasetQuery.data
              ? `${datasetQuery.data.totalCount} rows, schema v${datasetQuery.data.source.schemaVersionNumber}`
              : 'The source dataset is not available.'}
          </Muted>
        </InspectorSection>
        <InspectorSection title="Diagnostics">
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
            <Muted className="mt-1">
              {materialised.rows.length} rows plotted ·{' '}
              {materialised.series.length} series
              {materialised.droppedPoints
                ? ` · ${materialised.droppedPoints} points dropped`
                : ''}
            </Muted>
          ) : null}
        </InspectorSection>
        <InspectorSection title="Cited by">
          <CitationList
            citations={citationsQuery.data ?? []}
            loading={citationsQuery.isLoading}
            error={citationsQuery.error ? String(citationsQuery.error) : null}
          />
        </InspectorSection>
        <InspectorSection title="Reproducibility">
          <Muted>
            A view stores its ChartSpec and the source revisions it was authored
            against; feeding the spec back into the studio rebuilds the same
            chart.
          </Muted>
        </InspectorSection>
      </Inspector>
    </>
  )
}
