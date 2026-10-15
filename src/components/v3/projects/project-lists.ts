import { useQuery } from '@tanstack/react-query'

import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'
import { toDatasetListRow } from '#/components/v3/datasets/datasets-data'
import type { DataClient } from '#/lib/data-client'
import type { RecordWire } from '#/lib/notebook-data'
import { notebookDataClient } from '#/lib/notebook-data'
import type { SampleRecord } from '#/lib/samples'
import { toSampleRecord } from '#/lib/samples'

/**
 * R5-SURF-02 — the project-scoped lists behind the project's Experiments,
 * Samples and Datasets tabs, and the header counts that share their queries.
 *
 * **Authoritative project scope, recorded per kind so a later audit does not
 * re-open it:**
 *
 * - **Experiments** — `api.records.project_id` where `kind = 'experiment'`.
 *   A project-scoped object: the record carries its project, `api.records`
 *   indexes `project_id`, and RLS (`records_live_read`) enforces
 *   `internal.can_view_project(project_id)`.
 * - **Samples** — `api.records.project_id` where `kind = 'sample'`. Samples are
 *   model records created through `api.create_model_record`, which writes
 *   `p_project_id`; the sample registry's Project column already reads this
 *   column. The `properties.project` string is display-only and is never used
 *   for scoping.
 * - **Datasets** — `api.datasets.primary_project_id`, the project-scoped column
 *   the dataset RLS, global search and inbox already use. A dataset created
 *   without a project (for example a pipeline output) belongs to no project and
 *   is absent from every project tab; it is not guessed into one.
 *
 * Every read filters at the `/api/db` boundary (PostgREST + RLS for records,
 * the canonical `dataset_list_summary` RPC for datasets), never by filtering a
 * page of results in the browser. Rows and counts share one predicate builder,
 * so a tab's total always equals the header count for that kind.
 */

/** Page size for the project tabs. Exported so the footer can say the bound. */
export const PROJECT_LIST_PAGE_SIZE = 25

export type ProjectRecordKind = 'experiment' | 'sample'

/**
 * PostgREST filter (no leading `?`) for a project's live records of one kind.
 * `archived_at`/`deleted_at` null matches the samples registry and
 * `project_list_summary`'s `experiment_count`, so the header count and the tab
 * total agree.
 */
export function projectRecordFilter(
  projectId: string,
  kind: ProjectRecordKind,
): string {
  return [
    `project_id=eq.${encodeURIComponent(projectId)}`,
    `kind=eq.${kind}`,
    'archived_at=is.null',
    'deleted_at=is.null',
  ].join('&')
}

/** PostgREST filter (no leading `?`) for a project's active datasets. */
export function projectDatasetFilter(projectId: string): string {
  return [
    `primary_project_id=eq.${encodeURIComponent(projectId)}`,
    'archived_at=is.null',
  ].join('&')
}

/** 1-based page from a route search value; anything unusable is page 1. */
export function parseProjectPage(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(n) && n > 1 ? n : 1
}

export function projectPageOffset(page: number): number {
  return (Math.max(1, page) - 1) * PROJECT_LIST_PAGE_SIZE
}

/** Paging arithmetic the tabs render: the 1-based rows shown and the page count. */
export function projectPageSummary(page: number, total: number) {
  const offset = projectPageOffset(page)
  return {
    pageCount: Math.max(1, Math.ceil(total / PROJECT_LIST_PAGE_SIZE)),
    start: total === 0 ? 0 : offset + 1,
    end: Math.min(total, offset + PROJECT_LIST_PAGE_SIZE),
  }
}

export interface ProjectPage<T> {
  rows: T[]
  total: number
  page: number
}

export interface ProjectExperiment {
  id: string
  project_id: string | null
  identifier: string
  title: string
  status: string
  created_by_user_id: string
  created_at: string
  updated_at: string
}

const EXPERIMENT_SELECT =
  'id,project_id,identifier,title,status,created_by_user_id,created_at,updated_at'

const SAMPLE_SELECT =
  'id,workspace_id,project_id,kind,identifier,title,status,tags,structure_version,' +
  'metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,' +
  'updated_by_user_id,properties,custom_fields'

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
  review_state: 'locked' | 'in_review' | null
  updated_at: string
  archived_at: string | null
}

export async function fetchProjectExperimentsPage(
  client: DataClient,
  projectId: string,
  page: number,
): Promise<ProjectPage<ProjectExperiment>> {
  const filter = projectRecordFilter(projectId, 'experiment')
  const offset = projectPageOffset(page)
  const [rows, total] = await Promise.all([
    client.list<ProjectExperiment>(
      'records',
      `?${filter}&order=updated_at.desc,id.asc&limit=${PROJECT_LIST_PAGE_SIZE}&offset=${offset}&select=${EXPERIMENT_SELECT}`,
    ),
    client.count('records', `?${filter}`),
  ])
  return { rows, total, page }
}

export async function fetchProjectSamplesPage(
  client: DataClient,
  projectId: string,
  page: number,
): Promise<ProjectPage<SampleRecord>> {
  const filter = projectRecordFilter(projectId, 'sample')
  const offset = projectPageOffset(page)
  const [rows, total] = await Promise.all([
    client
      .list<RecordWire>(
        'records',
        `?${filter}&order=updated_at.desc,id.asc&limit=${PROJECT_LIST_PAGE_SIZE}&offset=${offset}&select=${SAMPLE_SELECT}`,
      )
      .then((rs) => rs.map(toSampleRecord)),
    client.count('records', `?${filter}`),
  ])
  return { rows, total, page }
}

export async function fetchProjectDatasetsPage(
  client: DataClient,
  projectId: string,
  page: number,
): Promise<ProjectPage<DatasetListRow>> {
  const offset = projectPageOffset(page)
  const [rows, total] = await Promise.all([
    client.rpc<DatasetSummaryWire[]>('dataset_list_summary', {
      p_project_id: projectId,
      p_include_archived: false,
      p_limit: PROJECT_LIST_PAGE_SIZE,
      p_offset: offset,
    }),
    client.count('datasets', `?${projectDatasetFilter(projectId)}`),
  ])
  return { rows: rows.map(toDatasetListRow), total, page }
}

export async function fetchProjectRecordCount(
  client: DataClient,
  projectId: string,
  kind: ProjectRecordKind,
): Promise<number> {
  return client.count('records', `?${projectRecordFilter(projectId, kind)}`)
}

export async function fetchProjectDatasetCount(
  client: DataClient,
  projectId: string,
): Promise<number> {
  return client.count('datasets', `?${projectDatasetFilter(projectId)}`)
}

export const projectListQueryKeys = {
  experiments: (projectId: string, page: number) =>
    ['ui-port', 'project-lists', 'experiment', projectId, page] as const,
  samples: (projectId: string, page: number) =>
    ['ui-port', 'project-lists', 'sample', projectId, page] as const,
  datasets: (projectId: string, page: number) =>
    ['ui-port', 'project-lists', 'dataset', projectId, page] as const,
  recordCount: (projectId: string, kind: ProjectRecordKind) =>
    ['ui-port', 'project-lists', 'count', kind, projectId] as const,
  datasetCount: (projectId: string) =>
    ['ui-port', 'project-lists', 'count', 'dataset', projectId] as const,
}

export function useProjectExperimentsPage(
  projectId: string,
  page: number,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: projectListQueryKeys.experiments(projectId, page),
    queryFn: () => fetchProjectExperimentsPage(client, projectId, page),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })
}

export function useProjectSamplesPage(
  projectId: string,
  page: number,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: projectListQueryKeys.samples(projectId, page),
    queryFn: () => fetchProjectSamplesPage(client, projectId, page),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })
}

export function useProjectDatasetsPage(
  projectId: string,
  page: number,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: projectListQueryKeys.datasets(projectId, page),
    queryFn: () => fetchProjectDatasetsPage(client, projectId, page),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })
}

export function useProjectRecordCount(
  projectId: string,
  kind: ProjectRecordKind,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: projectListQueryKeys.recordCount(projectId, kind),
    queryFn: () => fetchProjectRecordCount(client, projectId, kind),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })
}

export function useProjectDatasetCount(
  projectId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: projectListQueryKeys.datasetCount(projectId),
    queryFn: () => fetchProjectDatasetCount(client, projectId),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })
}
