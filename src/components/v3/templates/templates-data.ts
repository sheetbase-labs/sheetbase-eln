import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import {
  fetchAllNotebookTemplateVersions,
  fetchNotebookTemplate,
  fetchNotebookTemplateVersions,
  fetchNotebookTemplates,
  notebookTemplateDataClient,
  previewNotebookTemplateUpgrade,
} from '#/lib/notebook-template-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import { chunkIds, listByIds } from '#/lib/chunk-ids'

/**
 * UI port (roadmap-4/ui-app3): the Templates board reads the CORE-06 notebook
 * template catalogue (notebook_templates + immutable published versions), the
 * real counterpart of app-3's template editor. "In use" counts records pinned
 * to one of a template's versions.
 */
export interface TemplateRow extends NotebookTemplate {
  versions: NotebookTemplateVersion[]
  latest: NotebookTemplateVersion | null
  published: NotebookTemplateVersion | null
  sectionCount: number
  inUse: number
}

export function templateLifecycle(lifecycle: string): {
  tone: Tone
  label: string
} {
  switch (lifecycle) {
    case 'active':
      return { tone: 'ok', label: 'Active' }
    case 'retired':
      return { tone: 'stored', label: 'Retired' }
    case 'draft':
      return { tone: 'draft', label: 'Draft' }
    case 'published':
      return { tone: 'ok', label: 'Published' }
    default:
      return { tone: 'none', label: lifecycle }
  }
}

export function latestTemplateVersion(
  versions: NotebookTemplateVersion[],
): NotebookTemplateVersion | undefined {
  return [...versions].sort((a, b) => b.version - a.version).at(0)
}

export function publishedTemplateVersion(
  versions: NotebookTemplateVersion[],
): NotebookTemplateVersion | undefined {
  return latestTemplateVersion(
    versions.filter((v) => v.lifecycle === 'published'),
  )
}

export function buildTemplateRows(
  templates: NotebookTemplate[],
  versions: NotebookTemplateVersion[],
  usedVersionIds: string[],
): TemplateRow[] {
  const byTemplate = new Map<string, NotebookTemplateVersion[]>()
  for (const v of versions) {
    const list = byTemplate.get(v.templateId) ?? []
    list.push(v)
    byTemplate.set(v.templateId, list)
  }
  const versionToTemplate = new Map(versions.map((v) => [v.id, v.templateId]))
  const inUseByTemplate = new Map<string, number>()
  for (const versionId of usedVersionIds) {
    const templateId = versionToTemplate.get(versionId)
    if (!templateId) continue
    inUseByTemplate.set(templateId, (inUseByTemplate.get(templateId) ?? 0) + 1)
  }
  return templates.map((t) => {
    const list = (byTemplate.get(t.id) ?? []).sort(
      (a, b) => a.version - b.version,
    )
    const latest = latestTemplateVersion(list) ?? null
    const published = publishedTemplateVersion(list) ?? null
    const shown = published ?? latest
    return {
      ...t,
      versions: list,
      latest,
      published,
      sectionCount: shown?.configuration.placements.length ?? 0,
      inUse: inUseByTemplate.get(t.id) ?? 0,
    }
  })
}

export const templateDataQueryKeys = {
  list: ['ui-port', 'templates', 'list'] as const,
  template: (id: string) => ['ui-port', 'templates', 'template', id] as const,
  versions: (id: string) => ['ui-port', 'templates', 'versions', id] as const,
  users: (id: string) => ['ui-port', 'templates', 'users', id] as const,
}

export function useTemplateRows(
  client: DataClient = notebookTemplateDataClient,
) {
  return useQuery({
    queryKey: templateDataQueryKeys.list,
    queryFn: async (): Promise<TemplateRow[]> => {
      const [templates, versions] = await Promise.all([
        fetchNotebookTemplates(client, { limit: 200 }),
        fetchAllNotebookTemplateVersions(client),
      ])
      if (templates.length === 0) return []
      const used = await client.list<{
        source_notebook_template_version_id: string | null
      }>(
        'records',
        '?source_notebook_template_version_id=not.is.null&select=source_notebook_template_version_id&limit=1000',
      )
      return buildTemplateRows(
        templates,
        versions,
        used
          .map((r) => r.source_notebook_template_version_id)
          .filter((id): id is string => Boolean(id)),
      )
    },
    staleTime: 15_000,
  })
}

export function useTemplate(
  templateId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  return useQuery({
    queryKey: templateDataQueryKeys.template(templateId),
    queryFn: () => fetchNotebookTemplate(templateId, client),
    staleTime: 15_000,
  })
}

export function useTemplateVersions(
  templateId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  return useQuery({
    queryKey: templateDataQueryKeys.versions(templateId),
    queryFn: () => fetchNotebookTemplateVersions(templateId, client),
    staleTime: 15_000,
  })
}

export interface TemplateUser {
  id: string
  identifier: string
  title: string
  source_notebook_template_version_id: string | null
  status: string
  locked_at: string | null
  project_id: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

const TEMPLATE_USER_SELECT =
  'id,identifier,title,source_notebook_template_version_id,status,locked_at,project_id,created_by_user_id,created_at,updated_at'

/** Rows per request. The in-use set is paged, so no count is taken from a
 * truncated page (R5-CONFIG-04). */
export const TEMPLATE_USERS_PAGE_SIZE = 200

async function fetchTemplateUsers(
  versionIds: string[],
  client: DataClient,
): Promise<TemplateUser[]> {
  const rows: TemplateUser[] = []
  // A long list of versions is read in groups, each paged to its end, then
  // put back in the one order the page shows.
  for (const group of chunkIds([...new Set(versionIds)])) {
    const filter = `source_notebook_template_version_id=in.(${group.map(encodeURIComponent).join(',')})`
    for (let offset = 0; ; offset += TEMPLATE_USERS_PAGE_SIZE) {
      const page = await client.list<TemplateUser>(
        'records',
        `?${filter}&select=${TEMPLATE_USER_SELECT}&order=updated_at.desc,id.asc&limit=${TEMPLATE_USERS_PAGE_SIZE}&offset=${offset}`,
      )
      rows.push(...page)
      if (page.length < TEMPLATE_USERS_PAGE_SIZE) break
    }
  }
  return rows.sort(
    (a, b) =>
      b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  )
}

export function useTemplateUsers(
  versionIds: string[],
  client: DataClient = notebookTemplateDataClient,
) {
  return useQuery({
    queryKey: [
      ...templateDataQueryKeys.users(versionIds.join(',')),
      versionIds,
    ],
    queryFn: () => fetchTemplateUsers(versionIds, client),
    enabled: versionIds.length > 0,
    staleTime: 15_000,
  })
}

/**
 * R5-CONFIG-04: how many records were made from a template's versions at all.
 * `notebook_template_instantiations` is scoped to the workspace rather than to
 * the projects a caller can open, so this count still includes records in
 * projects the caller cannot read — the only proof that a list is short. It
 * never overstates: a record made from a version always keeps an instantiation
 * row, and an upgrade only moves it to another version of the same template.
 */
export function useTemplateMadeCount(
  versionIds: string[],
  client: DataClient = notebookTemplateDataClient,
) {
  const ids = [...new Set(versionIds.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['ui-port', 'templates', 'made-count', ids.join(',')],
    queryFn: async () => {
      const counts = await Promise.all(
        chunkIds(ids).map((group) =>
          client.count(
            'notebook_template_instantiations',
            `?template_version_id=in.(${group.map(encodeURIComponent).join(',')})`,
          ),
        ),
      )
      return counts.reduce((sum, n) => sum + n, 0)
    },
    enabled: ids.length > 0,
    staleTime: 15_000,
  })
}

/**
 * R5-CONFIG-04: names for the projects the in-use records sit in, so the
 * project filter can be read. Only the projects referenced by the loaded rows
 * are requested; the caller passes the ids it already has.
 */
export function useTemplateProjects(
  projectIds: string[],
  client: DataClient = notebookTemplateDataClient,
) {
  const ids = [...new Set(projectIds.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['ui-port', 'templates', 'projects', ids.join(',')],
    queryFn: async () => {
      const rows = await listByIds(ids, (inList) =>
        client.list<{ id: string; title: string }>(
          'projects',
          `?id=in.(${inList})&select=id,title`,
        ),
      )
      return new Map(rows.map((row) => [row.id, row.title]))
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
}

export interface TemplateNotebook {
  id: string
  identifier: string
  title: string
  structure_version: number
  source_notebook_template_version_id: string | null
  locked_at: string | null
}

export function useTemplateNotebook(
  recordId: string | undefined,
  client: DataClient = notebookTemplateDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'templates', 'notebook', recordId ?? ''],
    queryFn: () =>
      client
        .list<TemplateNotebook>(
          'records',
          `?id=eq.${recordId}&select=id,identifier,title,structure_version,source_notebook_template_version_id,locked_at`,
        )
        .then((rows) => rows[0] ?? null),
    enabled: Boolean(recordId),
    staleTime: 15_000,
  })
}

export function useTemplateUpgradePreview(
  recordId: string | undefined,
  targetVersionId: string | undefined,
  client: DataClient = notebookTemplateDataClient,
) {
  return useQuery({
    queryKey: [
      'ui-port',
      'templates',
      'preview',
      recordId ?? '',
      targetVersionId ?? '',
    ],
    queryFn: () =>
      previewNotebookTemplateUpgrade(
        recordId as string,
        targetVersionId as string,
        client,
      ),
    enabled: Boolean(recordId && targetVersionId),
    staleTime: 15_000,
  })
}
