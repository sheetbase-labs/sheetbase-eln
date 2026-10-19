/**
 * Projects, pipelines and analyses in search.
 *
 * `api.search` indexes records, files, datasets, sheets, templates and
 * comments. A person looking for a project, a pipeline or a saved analysis by
 * name or identifier would otherwise find nothing, so those three are looked up
 * by name and identifier through the same RLS-bound reads their own lists use
 * and shown beside the RPC rows. A failure of this lookup never costs the
 * person the RPC rows: the extra rows are simply absent.
 */
import type { DataClient } from '#/lib/data-client'
import { objectPath } from '#/lib/navigation'
import { executeSearch } from '#/lib/search'
import type {
  SearchFilters,
  SearchResult,
  WorkObjectResultType,
} from '#/lib/search'

/** Rows read per object class; the palette and page show far fewer. */
export const WORK_OBJECT_LIMIT = 6

/** Result groups (the results-page type facet) that hold work objects. */
export const WORK_OBJECT_GROUPS = ['Projects', 'Pipelines', 'Analyses'] as const

interface ProjectRow {
  id: string
  key: string
  title: string
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

interface PipelineRow {
  id: string
  key: string
  name: string
  description: string | null
  lifecycle: string
  created_at: string
  updated_at: string
  created_by_user_id: string | null
}

interface AnalysisViewRow {
  id: string
  display_id: string | null
  name: string
  owner_user_id: string
  created_at: string
  updated_at: string
}

interface AnalysisDefinitionRow {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  updated_at: string
}

/** The term as a PostgREST `ilike` pattern, without the characters that would end the filter. */
export function workObjectPattern(term: string): string | null {
  const cleaned = term
    .trim()
    .replace(/[,()*%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? encodeURIComponent(`*${cleaned}*`) : null
}

/** The first occurrence of the term wrapped in `<b>`, the way the RPC marks a hit. */
export function markMatch(text: string, term: string): string {
  const needle = term.trim()
  if (!needle) return text
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return text
  return `${text.slice(0, at)}<b>${text.slice(at, at + needle.length)}</b>${text.slice(at + needle.length)}`
}

function toResult(
  resultType: WorkObjectResultType,
  base: {
    id: string
    identifier: string
    title: string
    status: string
    projectId: string | null
    archived: boolean
    createdByUserId: string
    createdAt: string
    updatedAt: string
    context: string
  },
  term: string,
): SearchResult | null {
  const deepLink = objectPath(resultType, base.id)
  if (!deepLink) return null
  const identifierHit = base.identifier
    .toLowerCase()
    .includes(term.trim().toLowerCase())
  const titleHit = base.title.toLowerCase().includes(term.trim().toLowerCase())
  return {
    resultType,
    recordId: base.id,
    kind: resultType,
    identifier: base.identifier,
    title: base.title,
    status: base.status,
    projectId: base.projectId,
    archived: base.archived,
    createdByUserId: base.createdByUserId,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    matchedContext: markMatch(
      identifierHit && !titleHit ? base.identifier : base.context,
      term,
    ),
    matchedField: identifierHit && !titleHit ? 'identifier' : 'title',
    rank: 0,
    deepLink,
    totalCount: 0,
  }
}

async function findProjects(
  client: DataClient,
  pattern: string,
  term: string,
  includeArchived: boolean,
): Promise<SearchResult[]> {
  const rows = await client.list<ProjectRow>(
    'projects',
    `?select=id,key,title,status,created_at,updated_at,archived_at` +
      `&or=(title.ilike.${pattern},key.ilike.${pattern})` +
      (includeArchived ? '' : '&archived_at=is.null') +
      `&order=updated_at.desc&limit=${WORK_OBJECT_LIMIT}`,
  )
  return rows.flatMap((row) => {
    const result = toResult(
      'project',
      {
        id: row.id,
        identifier: row.key,
        title: row.title,
        status: row.status,
        projectId: row.id,
        archived: Boolean(row.archived_at),
        createdByUserId: '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        context: row.title,
      },
      term,
    )
    return result ? [result] : []
  })
}

async function findPipelines(
  client: DataClient,
  pattern: string,
  term: string,
  includeArchived: boolean,
): Promise<SearchResult[]> {
  const rows = await client.list<PipelineRow>(
    'pipeline_definitions',
    `?select=id,key,name,description,lifecycle,created_at,updated_at,created_by_user_id` +
      `&or=(name.ilike.${pattern},key.ilike.${pattern},description.ilike.${pattern})` +
      (includeArchived ? '' : '&lifecycle=neq.archived') +
      `&order=updated_at.desc&limit=${WORK_OBJECT_LIMIT}`,
  )
  return rows.flatMap((row) => {
    const result = toResult(
      'pipeline',
      {
        id: row.id,
        identifier: row.key,
        title: row.name,
        status: row.lifecycle,
        projectId: null,
        archived: row.lifecycle === 'archived',
        createdByUserId: row.created_by_user_id ?? '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        context: row.description || row.name,
      },
      term,
    )
    return result ? [result] : []
  })
}

async function findAnalyses(
  client: DataClient,
  pattern: string,
  term: string,
): Promise<SearchResult[]> {
  const [views, definitions] = await Promise.all([
    client.list<AnalysisViewRow>(
      'analysis_views',
      `?select=id,display_id,name,owner_user_id,created_at,updated_at` +
        `&or=(name.ilike.${pattern},display_id.ilike.${pattern})` +
        `&order=updated_at.desc&limit=${WORK_OBJECT_LIMIT}`,
    ),
    client.list<AnalysisDefinitionRow>(
      'analysis_definitions',
      `?select=id,name,owner_user_id,created_at,updated_at` +
        `&name=ilike.${pattern}&order=updated_at.desc&limit=${WORK_OBJECT_LIMIT}`,
    ),
  ])
  const rows: {
    id: string
    displayId: string | null
    row: AnalysisDefinitionRow
  }[] = [
    ...views.map((row) => ({ id: row.id, displayId: row.display_id, row })),
    ...definitions.map((row) => ({ id: row.id, displayId: null, row })),
  ]
  const out: SearchResult[] = []
  for (const { id, displayId, row } of rows) {
    const result = toResult(
      'analysis',
      {
        id,
        identifier: displayId ?? id.slice(0, 8),
        title: row.name,
        status: '',
        projectId: null,
        archived: false,
        createdByUserId: row.owner_user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        context: row.name,
      },
      term,
    )
    if (result) out.push(result)
  }
  return out
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, WORK_OBJECT_LIMIT)
}

/**
 * Projects, pipelines and analyses whose name or identifier contains the term.
 * Each class fails alone: one that cannot be read is left out.
 */
export async function searchWorkObjects(
  client: DataClient,
  term: string,
  options: { includeArchived?: boolean; classes?: WorkObjectResultType[] } = {},
): Promise<SearchResult[]> {
  const pattern = workObjectPattern(term)
  if (!pattern) return []
  const wanted = options.classes ?? ['project', 'pipeline', 'analysis']
  const includeArchived = options.includeArchived === true
  const lookups: Promise<SearchResult[]>[] = []
  if (wanted.includes('project'))
    lookups.push(findProjects(client, pattern, term, includeArchived))
  if (wanted.includes('pipeline'))
    lookups.push(findPipelines(client, pattern, term, includeArchived))
  if (wanted.includes('analysis'))
    lookups.push(findAnalyses(client, pattern, term))
  const settled = await Promise.allSettled(lookups)
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

/**
 * Narrowing the RPC cannot honour for these classes: a record kind or status,
 * or an object-class facet that excludes them, leaves them out of the search.
 */
export function workObjectClassesFor(
  filters: Pick<SearchFilters, 'kind' | 'status' | 'resultType'>,
  typeFacet: string[] = [],
): WorkObjectResultType[] {
  if (filters.kind || filters.status || filters.resultType) return []
  const all: [string, WorkObjectResultType][] = [
    ['Projects', 'project'],
    ['Pipelines', 'pipeline'],
    ['Analyses', 'analysis'],
  ]
  if (typeFacet.length === 0) return all.map(([, c]) => c)
  return all.filter(([group]) => typeFacet.includes(group)).map(([, c]) => c)
}

/**
 * The RPC rows plus the work objects that match, the latter only on the first
 * page. The work objects carry the RPC's total so paging by `totalCount` is
 * unchanged.
 */
export async function executeSearchWithWorkObjects(
  client: DataClient,
  filters: SearchFilters,
  typeFacet: string[] = [],
): Promise<SearchResult[]> {
  const classes =
    (filters.offset ?? 0) > 0 ? [] : workObjectClassesFor(filters, typeFacet)
  const [rows, extra] = await Promise.all([
    executeSearch(client, filters),
    classes.length
      ? searchWorkObjects(client, filters.query, {
          includeArchived: filters.includeArchived,
          classes,
        })
      : Promise.resolve([] as SearchResult[]),
  ])
  const total = rows.at(0)?.totalCount ?? 0
  return [...rows, ...extra.map((r) => ({ ...r, totalCount: total }))]
}
