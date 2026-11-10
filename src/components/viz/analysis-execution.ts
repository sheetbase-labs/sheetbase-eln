import { useMemo } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { t } from '#/copy'
import {
  runAnalysis,
  validateAnalysisDefinition,
} from '#/lib/analysis-definition'
import type { ResolvedDataset } from '#/lib/chart-data'
import type { DefinitionDraft } from './analysis-draft'

/** Run only complete, untruncated examined inputs; preserve the kernel's refusal. */
export function useAnalysisExecution({
  draft,
  selectedDatasetId,
  rowsQuery,
}: {
  draft: DefinitionDraft
  selectedDatasetId: string
  rowsQuery: UseQueryResult<ResolvedDataset | null>
}) {
  const validation = useMemo(
    () =>
      draft.definition
        ? validateAnalysisDefinition(draft.definition)
        : [
            {
              code: 'missing_field' as const,
              message: t('data.analysisPanel.definitionYet'),
            },
          ],
    [draft.definition],
  )

  const runnable =
    draft.definition !== null &&
    validation.length === 0 &&
    Boolean(selectedDatasetId) &&
    !rowsQuery.isLoading &&
    !rowsQuery.isError

  const execution = useMemo(() => {
    const resolved = rowsQuery.data

    if (!runnable || !draft.definition || !resolved || resolved.truncated)
      return null

    return runAnalysis(
      draft.definition,
      resolved.source.columns,
      resolved.rows,
      resolved.flags,
    )
  }, [runnable, draft.definition, rowsQuery.data])

  return { validation, runnable, execution }
}
