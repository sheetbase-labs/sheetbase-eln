import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { useDatasetSummaries } from '#/components/datasets/datasets-data'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import type { Crumb } from '#/components/ui/breadcrumb'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'

/** Where a saved analysis sits: the dataset it reads, and that dataset's project. */
export interface AnalysisPlace {
  source: DatasetListRow | null
  projectId: string | null
  projectTitle: string | null
}

/**
 * The dataset a saved analysis reads, the experiment that made it and that
 * experiment's project, for the trail. Shared by saved charts and saved
 * statistics, so both pages lead back the same way.
 */
export function useAnalysisPlace(datasetId: string | null): AnalysisPlace {
  const summaries = useDatasetSummaries()
  const source = summaries.data?.find((d) => d.uuid === datasetId) ?? null
  const projectId = source?.projectId ?? null

  const project = useQuery({
    queryKey: ['ui-port', 'analysis', 'source-project', projectId ?? ''],
    queryFn: () =>
      projectId ? fetchProject(notebookDataClient, projectId) : null,
    enabled: Boolean(projectId),
  })

  return { source, projectId, projectTitle: project.data?.title ?? null }
}

/** The breadcrumb from the analysis back through its dataset, experiment and project. */
export function analysisTrail({
  place,
  label,
}: {
  place: AnalysisPlace
  /** The analysis's own crumb: its AN- number. */
  label: string
}): Crumb[] {
  const { source, projectId, projectTitle } = place

  const fromAnalysis: Crumb = {
    label: t('data.analysisPage.analysis'),
    link: { to: '/analysis' },
  }

  return [
    ...(source
      ? [
          ...(projectId
            ? [
                {
                  label: projectTitle ?? t('data.analysisPage.project'),
                  link: {
                    to: '/projects/$projectId' as const,
                    params: { projectId },
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
    { label, mono: true },
  ]
}
