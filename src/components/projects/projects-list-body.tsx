import { useRowFilter } from '#/components/inventory/row-filter'
import type { RowFilterOptions } from '#/components/inventory/row-filter'
import { ProjectsFooter } from './projects-footer'
import { groupedProjects } from './projects-page-model'
import type { ProjectsSearch, projectsView } from './projects-page-model'
import { ProjectsTable } from './projects-table'
import { ProjectsToolbar } from './projects-toolbar'
import type { useProjectSelection } from './use-project-selection'
import type { ProjectRow } from './types'

/** Plumbing the rows carry that is not something to filter by. */
const PROJECT_FILTER: RowFilterOptions = { hide: ['updated', 'lead'] }

/** The loaded list: its controls, the table and the footer. */
export function ProjectsListBody({
  view,
  projects,
  search,
  setSearch,
  selection,
  openProject,
  peekId,
  onPeek,
}: {
  view: ReturnType<typeof projectsView>
  projects: readonly ProjectRow[]
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
  selection: ReturnType<typeof useProjectSelection>
  openProject: (project: ProjectRow, event?: React.MouseEvent) => void
  peekId: string | null
  onPeek: (project: ProjectRow) => void
}) {
  const { tab, archived, sort, group, hidden, archivedMatches, columns } = view

  const { filter, rows } = useRowFilter(view.rows, projects, PROJECT_FILTER)
  const grouped = groupedProjects(rows, group)

  return (
    <>
      <ProjectsToolbar
        sort={sort}
        group={group}
        hidden={hidden}
        filter={filter}
        archived={archived}
        search={search}
        setSearch={setSearch}
      />

      <ProjectsTable
        rows={rows}
        grouped={grouped}
        columns={columns}
        canBulkArchive={selection.canBulkArchive}
        checked={selection.checked}
        search={search}
        tab={tab}
        archived={archived}
        archivedMatches={archivedMatches}
        openProject={openProject}
        peekId={peekId}
        onPeek={onPeek}
        onToggleAll={selection.toggleAll}
        onToggleRow={selection.toggleRow}
        onIncludeArchived={() => setSearch({ archived: 'include' })}
        onClearFilters={() =>
          setSearch({
            q: undefined,
            filter: undefined,
          })
        }
      />

      <ProjectsFooter
        count={rows.length}
        archivedHidden={archivedMatches}
        bulkError={selection.bulkError}
        selected={selection.checked.size}
        archivable={selection.archivable}
        restorable={selection.restorable}
        pending={selection.bulk.isPending}
        onArchive={() => selection.setConfirmArchive(true)}
        onRestore={() => selection.bulk.mutate('restore')}
        onClear={selection.clear}
      />
    </>
  )
}
