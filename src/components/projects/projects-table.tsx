import { Link } from '@tanstack/react-router'
import { functionalUpdate } from '@tanstack/react-table'

import { ObjectLink } from '#/components/ui/object-link'
import { RegistryGrid, bandRow } from '#/components/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/inventory/registry-grid'
import type { BulkSelection } from '#/components/inventory/bulk-selection'
import {
  ownerColumn,
  statusColumn,
  updatedColumn,
} from '#/components/inventory/list-columns'
import { t } from '#/copy'

import { MobileList } from './mobile-list'
import type {
  ArchivedMode,
  ProjectColumnKey,
  ProjectsSearch,
  ProjectsTab,
} from './projects-page-model'
import { ProjectsNoResults } from './projects-page-states'
import type { ProjectRow } from './types'

/** How wide each optional column starts; the project's name takes the rest. */
const COLUMN_SIZE: Record<ProjectColumnKey, number> = {
  client: 100,
  modality: 110,
  stage: 170,
  lead: 140,
  experiments: 110,
}

/** The columns every list keeps while narrower ones give way. */
const KEEP_COLUMNS = ['status', 'owner', 'updated']

/** Who leads a project: the person when the server names one, else the name. */
const leadKey = (p: ProjectRow) => p.leadUserId ?? p.lead

/**
 * The projects list: a phone list below the medium breakpoint and the shared
 * grid above it, both fed by the same rows. The grid's first column is the bulk
 * selection, which exists only for a role the server will accept; a band above
 * each group spans the columns on screen. The page's own Sort, Group and
 * Columns menus order and trim the list, so the headers do not sort.
 */
export function ProjectsTable({
  rows,
  grouped,
  columns,
  canBulkArchive,
  checked,
  search,
  tab,
  archived,
  archivedMatches,
  openProject,
  peekId,
  onPeek,
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
  search: ProjectsSearch
  tab: ProjectsTab
  archived: ArchivedMode
  archivedMatches: number
  openProject: (project: ProjectRow, event?: React.MouseEvent) => void
  /** The project whose details the side panel shows. */
  peekId: string | null
  onPeek: (project: ProjectRow) => void
  onToggleAll: (on: boolean) => void
  onToggleRow: (id: string, on: boolean) => void
  onIncludeArchived: () => void
  onClearFilters: () => void
}) {
  const gridRows: RegistryRow<ProjectRow>[] = grouped.flatMap(([g, list]) =>
    g ? [bandRow(g, list.length), ...list] : list,
  )

  const bulk: BulkSelection = {
    ids: [...checked],
    count: checked.size,
    has: (id) => checked.has(id),
    toggle: (id) => onToggleRow(id, !checked.has(id)),
    setMany: (_ids, on) => onToggleAll(on),
    // The page's own selection prunes itself.
    retain: () => undefined,
    replace: () => undefined,
    clear: () => onToggleAll(false),
  }

  const gridColumns: RegistryColumn<ProjectRow>[] = [
    {
      id: 'id',
      header: t('projects.projectsPage.columns.id'),
      size: 110,
      cell: ({ row }) => (
        <ObjectLink
          kind="project"
          id={row.original.uuid}
          identifier={row.original.id}
        />
      ),
      meta: {
        headerClassName: 'max-xl:hidden',
        cellClassName: 'max-xl:hidden',
      },
    },
    {
      id: 'project',
      header: t('projects.projectsPage.columns.project'),
      size: 220,
      cell: ({ row }) => {
        const p = row.original

        return (
          <>
            <Link
              to="/projects/$projectId"
              params={{ projectId: p.uuid }}
              onClick={(event) => openProject(p, event)}
              className="cursor-pointer text-inherit underline-offset-2 hover:underline"
            >
              {p.name}
            </Link>
            <span className="mono block text-[11px] leading-none text-fg-muted xl:hidden">
              {p.id}
            </span>
          </>
        )
      },
    },
    ...columns
      .filter((c) => c.key !== 'lead')
      .map((c): RegistryColumn<ProjectRow> => ({
        id: c.key,
        header: c.label,
        size: COLUMN_SIZE[c.key],
        cell: ({ row }) =>
          c.key === 'experiments'
            ? row.original.experiments
            : String(row.original[c.key]),
        meta: {
          headerClassName: [
            c.key === 'experiments' && 'text-right',
            c.key === 'modality' && 'lg:hidden',
          ]
            .filter(Boolean)
            .join(' '),
          cellClassName: [
            c.key === 'experiments' && 'num text-right',
            c.key === 'modality' && 'lg:hidden',
          ]
            .filter(Boolean)
            .join(' '),
        },
      })),
    statusColumn((p) => p.status),
    ...(columns.some((c) => c.key === 'lead')
      ? [
          ownerColumn(
            leadKey,
            new Map(rows.map((p) => [leadKey(p), p.lead])),
            t('projects.projectsPage.columns.lead'),
          ),
        ]
      : []),
    updatedColumn((p) =>
      p.updated ? new Date(p.updated).toISOString() : null,
    ),
  ]

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
      {rows.length ? (
        <RegistryGrid
          className="max-md:hidden"
          label={t('projects.projectsPage.title')}
          sortable={false}
          stableWidths
          keepColumns={KEEP_COLUMNS}
          rows={gridRows}
          columns={gridColumns}
          getRowId={(p) => p.id}
          bulk={canBulkArchive ? bulk : undefined}
          rowLabel={(p) => p.id}
          rowSelection={peekId ? { [peekId]: true } : {}}
          // A click opens the project, as on every other list; moving along the
          // rows with the keyboard keeps the side preview following.
          onRowClick={(p) => openProject(p)}
          onRowSelectionChange={(next) => {
            const chosen = Object.keys(
              functionalUpdate(next, peekId ? { [peekId]: true as const } : {}),
            ).at(0)

            const project = rows.find((p) => p.id === chosen)

            if (project) onPeek(project)
          }}
        />
      ) : null}
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
