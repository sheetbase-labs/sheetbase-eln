import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  isBrowserClick,
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import { projectPath } from '#/lib/navigation'
import { useHasProjectAccess } from './project-access'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { DialogBody } from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'

import {
  createDisabledBodyText,
  createDisabledReasonText,
  projectsView,
} from './projects-page-model'
import type { NewProjectInput, ProjectsSearch } from './projects-page-model'
import {
  ProjectsEmptyState,
  ProjectsLoadFailure,
  ProjectsLoading,
} from './projects-page-states'
import { ProjectsFilterChips } from './projects-filter-chips'
import { ProjectsFooter } from './projects-footer'
import { ProjectsHeader } from './projects-header'
import { ProjectsTable } from './projects-table'
import { ProjectsToolbar } from './projects-toolbar'
import { NewProjectDialog } from './new-project-dialog'
import { useProjectCreateIntent } from './use-project-create-intent'
import { useProjectSelection } from './use-project-selection'
import type { ProjectRow } from './types'

export type { ProjectRow } from './types'

export type {
  ArchivedMode,
  NewProjectInput,
  ProjectsSearch,
  ProjectsSort,
  ProjectsTab,
} from './projects-page-model'

export { archivedModeFor } from './projects-page-filters'

/**
 * No client or member options: one array, so a page that passes none does not
 * hand the create dialog a new one on every render.
 */
const NO_OPTIONS: { id: string; label: string }[] = []

/**
 * UI port (branch roadmap-4/ui-app3): sheetbase-app-3's Projects screen, wired
 * to real data by the route. Layout and classes are app-3's; the data is
 * `project_list_summary`.
 *
 * The page is the composition: what the filters select is
 * `projects-page-model.ts`, the create intent and the bulk selection are their
 * own hooks, and the header, toolbar, chips, table, footer and create dialog
 * are modules beside it.
 */
export function ProjectsPage({
  projects,
  me,
  meId,
  canCreate = true,
  loading = false,
  error = null,
  onRetry,
  onOpenProject,
  search,
  setSearch,
  onCreate,
  creating = false,
  createError = null,
  createdProjectId = null,
  clientOptions = NO_OPTIONS,
  memberOptions = NO_OPTIONS,
  canCreateClient = false,
}: {
  projects: ProjectRow[]
  me: string
  meId?: string
  canCreate?: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** Opening a project is the route's job: it owns navigation. */
  onOpenProject?: (p: ProjectRow) => void
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
  onCreate: (input: NewProjectInput) => void
  creating?: boolean
  createError?: string | null
  /** The project the last create produced, from the route's mutation. A create
   * that lands ends the dialog: the route drops `?new=true`, and this closes
   * the dialog the click opened, exactly as the design's `onCreated` closes
   * its URL-gated dialog. */
  createdProjectId?: string | null
  clientOptions?: { id: string; label: string }[]
  memberOptions?: { id: string; label: string }[]
  /** Workspace admins can add the client a project is for as they create it. */
  canCreateClient?: boolean
}) {
  const workspace = useWorkspaceNavigation()
  const navigate = useNavigate()

  const openProject = (project: ProjectRow, event?: React.MouseEvent) => {
    event?.stopPropagation()

    if (event && isBrowserClick(event)) return
    const href = projectPath(project.uuid)

    if (openBesideOnAlt(workspace, href, event, project.name)) return

    if (!event) {
      if (onOpenProject) onOpenProject(project)
      else void navigate({ href })
    }
  }

  const hasProjectAccess = useHasProjectAccess()
  const view = projectsView(projects, search, me, meId)

  const {
    tab,
    archived,
    sort,
    group,
    hidden,
    counts,
    rows,
    archivedMatches,
    filterCount,
    columns,
    grouped,
  } = view

  const intent = useProjectCreateIntent({
    canCreate,
    requested: search.new,
    createdProjectId,
    setSearch,
  })

  // A create intent the role cannot honour says so, rather than leaving the link
  // or bookmark that carried it apparently dead. The guard resets once the
  // intent is gone, so a later link is answered too — and a param that outlives
  // its navigation is answered once, not on every render.
  const refusedNewProject = useRef(false)

  useEffect(() => {
    if (!search.new) {
      refusedNewProject.current = false

      return
    }

    if (canCreate || refusedNewProject.current) return
    refusedNewProject.current = true
    toast.error(createDisabledReasonText(), {
      description: createDisabledBodyText(),
    })
    setSearch({ new: undefined })
  }, [search.new, canCreate, setSearch])

  const selection = useProjectSelection({ meId, rows })
  const colSpan = (selection.canBulkArchive ? 4 : 3) + columns.length

  // A disabled control has to say why (QA2-projects-1): the header button was
  // disabled with no stated reason.
  const createDisabledReason = !canCreate
    ? createDisabledReasonText()
    : loading
      ? t('projects.projectsPage.waitingForList')
      : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ProjectsHeader
          hasProjects={projects.length > 0}
          count={projects.length}
          loading={loading}
          error={error}
          canCreate={canCreate}
          createDisabledReason={createDisabledReason}
          onNew={intent.request}
          onTab={(next) => setSearch({ tab: next })}
          tab={tab}
          counts={counts}
          search={search}
        />

        {error ? (
          <ProjectsLoadFailure error={error} onRetry={onRetry} />
        ) : loading ? (
          <ProjectsLoading />
        ) : projects.length ? (
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
              colSpan={colSpan}
              search={search}
              tab={tab}
              archived={archived}
              archivedMatches={archivedMatches}
              openProject={openProject}
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
        ) : (
          <ProjectsEmptyState
            noAccess={hasProjectAccess === false}
            canCreate={canCreate}
            onNew={intent.request}
          />
        )}
      </div>

      <ConfirmDialog
        open={selection.confirmArchive}
        onOpenChange={selection.setConfirmArchive}
      >
        <ConfirmDialogContent className="w-[min(480px,calc(100vw-32px))]">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('projects.projectsPage.confirmArchive.title', {
                count: selection.archivable.length,
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('projects.projectsPage.confirmArchive.description', {
                ids: selection.archivable.map((p) => p.id).join(', '),
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <DialogBody>
            <p className="m-0 text-body leading-5">
              {t('projects.projectsPage.confirmArchive.body')}
            </p>
          </DialogBody>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={selection.bulk.isPending} />
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={selection.bulk.isPending}
              onClick={() => selection.bulk.mutate('archive')}
            >
              {t('projects.projectsPage.confirmArchive.action', {
                count: selection.archivable.length,
              })}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <NewProjectDialog
        open={intent.open}
        onOpenChange={(open) => {
          if (open) return
          intent.close()
        }}
        onCreate={onCreate}
        creating={creating}
        error={createError}
        clientOptions={clientOptions}
        memberOptions={memberOptions}
        meId={meId}
        canCreateClient={canCreateClient}
      />
    </div>
  )
}
