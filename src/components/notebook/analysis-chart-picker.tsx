import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  analysisDefinitionQueryKeys,
  composeAnalysisDefinition,
  analysisDefinitionsDataClient,
} from '#/lib/analysis-definitions-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import {
  analysisStudioDataClient,
  fetchAnalysisViews,
} from '#/lib/analysis-studio-data'

/**
 * Adds a saved chart to an analysis block. The chart is one of the workspace's
 * saved chart views; it joins the block's statistic when one is chosen, or
 * becomes the whole analysis when none is. Choosing saves a new analysis that
 * holds the chart, so the saved view and the statistic are left as they were.
 */
export function AnalysisChartPicker({
  statistic,
  disabled = false,
  onComposed,
}: {
  /** The saved analysis the block uses now, if any. */
  statistic: Pick<AnalysisDefinitionWire, 'id' | 'name'> | null
  disabled?: boolean
  onComposed: (definition: AnalysisDefinitionWire) => void
}) {
  const queryClient = useQueryClient()
  const [viewId, setViewId] = useState('')
  const views = useQuery({
    queryKey: ['analysis-views', 'list'] as const,
    queryFn: () => fetchAnalysisViews(analysisStudioDataClient),
    staleTime: 10_000,
  })
  const list = views.data ?? []
  const chosen = list.find((view) => view.id === viewId)
  const compose = useMutation({
    mutationFn: () =>
      composeAnalysisDefinition(analysisDefinitionsDataClient, {
        chartViewId: viewId,
        statisticDefinitionId: statistic?.id ?? null,
        name: statistic
          ? `${statistic.name} with ${chosen?.name ?? 'chart'}`
          : (chosen?.name ?? 'Chart'),
      }),
    onSuccess: (definition) => {
      void queryClient.invalidateQueries({
        queryKey: analysisDefinitionQueryKeys.all,
      })
      setViewId('')
      onComposed(definition)
    },
  })

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <PickerSelect
          noun="saved chart"
          aria-label="Saved chart"
          value={viewId}
          onChange={(id) => setViewId(id)}
          disabled={disabled || views.isLoading}
          placeholder={
            views.isLoading
              ? 'Loading saved charts…'
              : list.length === 0
                ? 'No saved charts'
                : statistic
                  ? 'Add a chart beside this analysis'
                  : 'Use a saved chart'
          }
          options={list.map((view) => ({ id: view.id, label: view.name }))}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || !viewId || compose.isPending}
          onClick={() => compose.mutate()}
        >
          {compose.isPending ? 'Adding…' : 'Add chart'}
        </Button>
      </div>
      {compose.isError ? (
        <p role="alert" className="text-xs text-danger-text">
          {compose.error instanceof Error
            ? compose.error.message
            : 'Could not add the chart.'}
        </p>
      ) : null}
    </div>
  )
}
