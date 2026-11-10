import { declaredRunInputs } from '#/components/pipelines/pipelines-data'
import type { PipelineListRow } from '#/components/pipelines/pipelines-data'

/** Pipelines that can start from a dataset: a live version that reads an input. */
export function pipelinesThatReadADataset(rows: PipelineListRow[]) {
  return rows.flatMap((row) =>
    row.current &&
    row.current.lifecycle !== 'draft' &&
    declaredRunInputs(row.current).inputs.length > 0
      ? [{ ...row, current: row.current }]
      : [],
  )
}
