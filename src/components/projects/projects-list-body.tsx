import { ProjectsFilterChips } from './projects-filter-chips'
import { ProjectsFooter } from './projects-footer'
import type { ProjectsSearch, projectsView } from './projects-page-model'
import { ProjectsTable } from './projects-table'
import { ProjectsToolbar } from './projects-toolbar'
import type { useProjectSelection } from './use-project-selection'
import type { ProjectRow } from './types'

/** The loaded list: its controls, the filter chips, the table and the footer. */
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
  const {
    tab,
    archived,
    sort,
    group,
    hidden,
    rows,
    archivedMatches,
    filterCount,
    columns,
    grouped,
  } = view

  return (
    <>
      <ProjectsToolbar
        sort={sort}
        group={group}
        hidden={hidden}
        filterCount={filterCount}
        archived={archived}
        search={search}
        projects={projects}
        setSearch={setSearch}
      />

      {filterCount ? (
        <ProjectsFilterChips
          archived={archived}
          search={search}
          setSearch={setSearch}
        />
      ) : null}

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
            stage: undefined,
            client: undefined,
            modality: undefined,
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
