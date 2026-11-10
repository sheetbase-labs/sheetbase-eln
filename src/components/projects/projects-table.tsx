import { Checkbox } from '#/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'

import { MobileList, stickyCol } from './mobile-list'
import type {
  ArchivedMode,
  ProjectColumnKey,
  ProjectsSearch,
  ProjectsTab,
} from './projects-page-model'
import { ProjectsNoResults } from './projects-page-states'
import { ProjectsTableRow } from './projects-table-row'
import type { ProjectRow } from './types'

/**
 * The projects list: a phone list below the medium breakpoint and the table
 * above it, both fed by the same rows. The table's first column is the bulk
 * selection, which exists only for a role the server will accept; the band row
 * above each group spans exactly the columns on screen, so a grouped list lines
 * up with its headings however many columns are shown.
 */
export function ProjectsTable({
  rows,
  grouped,
  columns,
  canBulkArchive,
  checked,
  colSpan,
  search,
  tab,
  archived,
  archivedMatches,
  openProject,
  onToggleAll,
  onToggleRow,
  onIncludeArchived,
  onClearFilters,
}: {
  rows: readonly ProjectRow[]
  grouped: readonly [string | null, ProjectRow[]][]
  columns: readonly { key: ProjectColumnKey; label: string }[]
  canBulkArchive: boolean
  checked: ReadonlySet<string>
  colSpan: number
  search: ProjectsSearch
  tab: ProjectsTab
  archived: ArchivedMode
  archivedMatches: number
  openProject: (project: ProjectRow, event?: React.MouseEvent) => void
  onToggleAll: (on: boolean) => void
  onToggleRow: (id: string, on: boolean) => void
  onIncludeArchived: () => void
  onClearFilters: () => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto border-t border-border max-md:pb-20">
      <MobileList
        className="md:hidden"
        label={t('projects.projectsPage.title')}
        rows={rows.map((p) => ({
          key: p.id,
          title: p.name,
          meta: (
            <>
              <span className="mono">{p.id}</span> · {p.client} · {p.lead}
            </>
          ),
          status: p.status,
          link: {
            to: '/projects/$projectId',
            params: { projectId: p.uuid },
            onClick: (event: React.MouseEvent) => openProject(p, event),
          },
        }))}
      />
      <Table
        aria-label={t('projects.projectsPage.title')}
        className="max-md:hidden"
      >
        <TableHeader>
          <TableRow>
            {canBulkArchive ? (
              <TableHead className="w-9 max-xl:hidden">
                <Checkbox
                  aria-label={t('projects.projectsPage.selectAll')}
                  checked={
                    rows.length > 0 && rows.every((r) => checked.has(r.id))
                  }
                  onCheckedChange={onToggleAll}
                />
              </TableHead>
            ) : null}
            <TableHead className="max-xl:hidden">
              {t('projects.projectsPage.columns.id')}
            </TableHead>
            <TableHead className={stickyCol}>
              {t('projects.projectsPage.columns.project')}
            </TableHead>
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={c.key === 'modality' ? 'lg:hidden' : undefined}
                align={c.key === 'experiments' ? 'right' : undefined}
              >
                {c.label}
              </TableHead>
            ))}
            <TableHead>{t('projects.projectsPage.columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length
            ? grouped.map(([g, list]) => [
                g ? (
                  <TableRow key={`g-${g}`}>
                    <TableCell
                      colSpan={colSpan}
                      className="bg-surface-muted text-label font-medium text-fg-muted"
                    >
                      {g} <span className="font-normal">{list.length}</span>
                    </TableCell>
                  </TableRow>
                ) : null,
                ...list.map((p) => (
                  <ProjectsTableRow
                    key={p.id}
                    project={p}
                    columns={columns}
                    canBulkArchive={canBulkArchive}
                    checked={checked.has(p.id)}
                    onToggle={onToggleRow}
                    onOpen={openProject}
                  />
                )),
              ])
            : null}
        </TableBody>
      </Table>
      {!rows.length ? (
        <ProjectsNoResults
          q={search.q}
          tab={tab}
          archived={archived}
          archivedMatches={archivedMatches}
          onIncludeArchived={onIncludeArchived}
          onClear={onClearFilters}
        />
      ) : null}
    </div>
  )
}
