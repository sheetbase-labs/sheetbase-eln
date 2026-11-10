import { t } from '#/copy'
import type { ProjectDetailsInput } from './project-data'
import { archivedModeFor } from './projects-page-filters'
import type { ProjectRow } from './types'
import type { ModelFieldRecordValues } from '#/lib/model-fields'

/**
 * The Projects screen's model: what its tabs and sorts are called, which
 * projects belong to a tab, which of those survive the filters and in what
 * order, and the words a refused create uses. The page and its header, toolbar
 * and table all read this, so a tab's count and its rows can never disagree.
 */

export const tabs = [
  'all',
  'mine',
  'inprogress',
  'inreview',
  'archived',
] as const

export type ProjectsTab = (typeof tabs)[number]

export const sorts = ['updated', 'id', 'name'] as const

export type ProjectsSort = (typeof sorts)[number]

/** How a tab treats archived projects. */
export type ArchivedMode = 'include' | 'exclude'

export const tabLabel = (tab: ProjectsTab) =>
  t(`projects.projectsPage.tabs.${tab}`)

export const sortLabel = (sort: ProjectsSort) =>
  t(`projects.projectsPage.sorts.${sort}`)

/** Why a create action cannot run, in one voice wherever it is stated. */
export const createDisabledReasonText = () =>
  t('projects.projectsPage.createDisabled.reason')

export const createDisabledBodyText = () =>
  t('projects.projectsPage.createDisabled.body')

export interface ProjectsSearch {
  tab?: ProjectsTab
  q?: string
  /** The person's own archived choice, overriding the tab's default. */
  archived?: ArchivedMode
  stage?: string
  client?: string
  modality?: string
  fields?: string
  sort?: ProjectsSort
  group?: 'none' | 'stage' | 'lead'
  new?: boolean
}

export type NewProjectInput = ProjectDetailsInput & {
  /** A client that does not exist yet: the route creates it, then the project. */
  newClientName?: string | null
  /** Values for the fields the workspace added to Project. */
  customFields?: ModelFieldRecordValues['customFields']
  /** The project subtype picked on the form, if any. */
  typeKey?: string | null
}

/** Which of a tab's projects the tab lists. */
export function inTab(
  p: ProjectRow,
  tabKey: ProjectsTab,
  me: string,
  meId?: string,
): boolean {
  if (tabKey === 'all') return true

  if (tabKey === 'mine') return meId ? p.leadUserId === meId : p.lead === me

  if (tabKey === 'inprogress') return p.status.tone === 'progress'

  if (tabKey === 'inreview') return p.status.tone === 'review'

  return !!p.archived
}

/**
 * A tab's count is the number of rows it lists, so the strip and the table
 * agree: every tab's rows pass through the same `inTab` and archived test.
 */
export function tabCounts(
  projects: readonly ProjectRow[],
  search: ProjectsSearch,
  me: string,
  meId?: string,
): Map<ProjectsTab, number> {
  return new Map<ProjectsTab, number>(
    tabs.map((tabKey) => [
      tabKey,
      projects.filter(
        (p) =>
          inTab(p, tabKey, me, meId) &&
          ((search.archived ?? archivedModeFor(tabKey)) === 'include' ||
            !p.archived),
      ).length,
    ]),
  )
}

/** Everything the list shows before the archived filter and the sort are applied. */
export function filteredProjects(
  projects: readonly ProjectRow[],
  search: ProjectsSearch,
  me: string,
  meId?: string,
): ProjectRow[] {
  const tab: ProjectsTab = search.tab ?? 'all'
  const q = (search.q ?? '').trim().toLowerCase()

  const matchesQ = (p: ProjectRow) =>
    !q || [p.name, p.id, p.client].some((s) => s.toLowerCase().includes(q))

  return projects.filter(
    (p) =>
      inTab(p, tab, me, meId) &&
      matchesQ(p) &&
      (!search.stage || p.stage === search.stage) &&
      (!search.client || p.client === search.client) &&
      (!search.modality || p.modality === search.modality),
  )
}

/** The rows, archived ones filtered the way the tab or the person asks. */
export function visibleProjects(
  base: readonly ProjectRow[],
  archived: ArchivedMode,
  sort: ProjectsSort,
): ProjectRow[] {
  return base
    .filter((p) => archived === 'include' || !p.archived)
    .sort((a, b) =>
      sort === 'updated'
        ? b.updated - a.updated || b.id.localeCompare(a.id)
        : sort === 'id'
          ? a.id.localeCompare(b.id)
          : a.name.localeCompare(b.name),
    )
}

/** How many matching projects the archived filter is hiding, if it is on. */
export function archivedHiddenBy(
  base: readonly ProjectRow[],
  archived: ArchivedMode,
): number {
  return archived === 'exclude' ? base.filter((p) => p.archived).length : 0
}

/** How many filters are on, for the toolbar's count. */
export function filterCountOf(
  search: ProjectsSearch,
  archived: ArchivedMode,
): number {
  return (
    (archived === 'exclude' ? 1 : 0) +
    (search.stage ? 1 : 0) +
    (search.client ? 1 : 0) +
    (search.modality ? 1 : 0)
  )
}

/** The optional columns, in the order the table and the column chooser list them. */
export const projectColumnKeys = [
  'client',
  'modality',
  'stage',
  'lead',
  'experiments',
] as const

export type ProjectColumnKey = (typeof projectColumnKeys)[number]

export function projectColumns(hidden: ReadonlySet<string>) {
  const columns: { key: ProjectColumnKey; label: string }[] = []

  for (const key of projectColumnKeys)
    if (!hidden.has(key))
      columns.push({ key, label: t(`projects.projectsPage.columns.${key}`) })

  return columns
}

/** The rows with a heading band above each group, or one nameless group. */
export function groupedProjects(
  rows: readonly ProjectRow[],
  group: 'none' | 'stage' | 'lead',
): [string | null, ProjectRow[]][] {
  return group === 'none'
    ? [[null, [...rows]]]
    : [...new Set(rows.map((r) => r[group]))].map((g) => [
        g,
        rows.filter((r) => r[group] === g),
      ])
}

/**
 * Everything the list needs for one search state: the tab, archived mode, sort,
 * grouping and hidden columns that are in force, the counts, the rows and the
 * bands they are grouped into. One call, so the strip, the table and the footer
 * cannot compute different answers from the same URL.
 */
export function projectsView(
  projects: readonly ProjectRow[],
  search: ProjectsSearch,
  me: string,
  meId?: string,
) {
  const tab: ProjectsTab = search.tab ?? 'all'
  const archived: ArchivedMode = search.archived ?? archivedModeFor(tab)
  const sort: ProjectsSort = search.sort ?? 'updated'
  const group = search.group ?? 'none'
  const hidden = new Set(search.fields?.split(',').filter(Boolean) ?? [])
  const base = filteredProjects(projects, search, me, meId)
  const rows = visibleProjects(base, archived, sort)

  return {
    tab,
    archived,
    sort,
    group,
    hidden,
    counts: tabCounts(projects, search, me, meId),
    rows,
    archivedMatches: archivedHiddenBy(base, archived),
    filterCount: filterCountOf(search, archived),
    columns: projectColumns(hidden),
    grouped: groupedProjects(rows, group),
  }
}
