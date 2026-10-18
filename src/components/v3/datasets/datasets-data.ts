import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the dataset registry from dataset_list_summary. */

export type DatasetReviewState = 'locked' | 'in_review' | null

export interface DatasetListRow {
  id: string
  uuid: string
  name: string
  model: string
  projectId: string | null
  createdByUserId: string | null
  rows: number
  issues: number
  /** Active out-of-range flags (design: "1 out of range"). */
  outOfRange: number
  /** Active missing-unit flags, one per column (design: "2 columns missing units"). */
  missingUnit: number
  /** Labels of the columns with a missing unit, for the issues inspector. */
  missingUnitFields: string[]
  /** Experiment that produced the dataset (design's Experiment column). */
  experimentId: string | null
  /** Producing experiment's lifecycle, as the design's Validation suffix shows. */
  reviewState: DatasetReviewState
  updated: string
  updatedAt: string
  archived: boolean
}

interface DatasetSummaryWire {
  id: string
  display_id: string | null
  name: string
  model: string | null
  project_id: string | null
  created_by_user_id: string | null
  row_count: string | number
  issue_count: string | number
  out_of_range_count: string | number
  missing_unit_count: string | number
  missing_unit_fields: string[] | null
  experiment_display_id: string | null
  review_state: DatasetReviewState
  updated_at: string
  archived_at: string | null
}

export function toDatasetListRow(row: DatasetSummaryWire): DatasetListRow {
  return {
    id: row.display_id ?? row.id.slice(0, 8),
    uuid: row.id,
    name: row.name,
    model: row.model ?? '—',
    projectId: row.project_id,
    createdByUserId: row.created_by_user_id,
    rows: Number(row.row_count),
    issues: Number(row.issue_count),
    outOfRange: Number(row.out_of_range_count),
    missingUnit: Number(row.missing_unit_count),
    missingUnitFields: row.missing_unit_fields ?? [],
    experimentId: row.experiment_display_id,
    reviewState: row.review_state,
    updated: row.updated_at.slice(0, 10),
    updatedAt: row.updated_at,
    archived: row.archived_at != null,
  }
}

const reviewSuffix: Record<Exclude<DatasetReviewState, null>, string> = {
  locked: ' · locked',
  in_review: ' · in review',
}

/** The design's Validation column: issue wording by kind, then the review state. */
export function datasetValidation(row: DatasetListRow): {
  tone: Tone
  label: string
} {
  if (row.issues === 0) {
    return {
      tone: 'ok',
      label: `Valid${row.reviewState ? reviewSuffix[row.reviewState] : ''}`,
    }
  }
  if (row.missingUnit > 0) {
    const n = row.missingUnit
    return {
      tone: 'bad',
      label: n === 1 ? '1 column missing a unit' : `${n} columns missing units`,
    }
  }
  if (row.outOfRange > 0) {
    return { tone: 'bad', label: `${row.outOfRange} out of range` }
  }
  return {
    tone: 'bad',
    label: `${row.issues} ${row.issues === 1 ? 'issue' : 'issues'}`,
  }
}

/** The issues inspector's sentence: what is wrong and what it blocks. */
export function datasetIssueSummary(row: DatasetListRow): string {
  if (row.missingUnitFields.length > 0) {
    const names = row.missingUnitFields.map((name) => `“${name}”`)
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    const verb = names.length === 1 ? 'has' : 'have'
    const blocker = row.experimentId
      ? ` Units are required before ${row.experimentId} can be submitted.`
      : ' Units are required before the dataset can be submitted.'
    return `${list} ${verb} no unit.${blocker} A model owner or admin sets the unit on the model's field, or re-import with a unit column.`
  }
  if (row.outOfRange > 0) {
    const n = row.outOfRange
    return `${n} value${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} outside the model's allowed range.`
  }
  return 'This dataset has unresolved issues.'
}

export const datasetListQueryKeys = {
  page: ['ui-port', 'datasets', 'page'] as const,
}

export function useDatasetSummaries(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: datasetListQueryKeys.page,
    queryFn: async () => {
      const rows = await client.rpc<DatasetSummaryWire[]>(
        'dataset_list_summary',
        {},
      )
      return rows.map(toDatasetListRow)
    },
    staleTime: 15_000,
  })
}
