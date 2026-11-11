import { useEffect, useRef, useState } from 'react'

import { toast } from '#/components/ui/sonner'
import { useHasProjectAccess } from './project-access'
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
import { ProjectsListBody } from './projects-list-body'
import { ProjectsHeader } from './projects-header'
import { ArchiveConfirmDialog } from './archive-confirm-dialog'
import { ProjectPeek } from './project-peek'
import { useProjectPeek } from './use-project-peek'
import { useOpenProject } from './use-project-open'
import { ImportProjectsDialog } from './import-projects-dialog'
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
  const openProject = useOpenProject(onOpenProject)
  const hasProjectAccess = useHasProjectAccess()
  const view = projectsView(projects, search, me, meId)

  const { tab, counts, rows } = view

  const intent = useProjectCreateIntent({
    canCreate,
    requested: search.new,
    createdProjectId,
    setSearch,
  })

  // A create intent the role cannot honour says so, rather than leaving the link
  // or bookmark that carried it apparently dead. The guard resets once the
  // intent is gone, so a later link is answered too, and a param that outlives
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

  const { peeked, setPeek } = useProjectPeek(rows)
  const [importing, setImporting] = useState(false)

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
          onImport={() => setImporting(true)}
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
            <ProjectsListBody
              view={view}
              projects={projects}
              search={search}
              setSearch={setSearch}
              selection={selection}
              openProject={openProject}
              peekId={peeked?.id ?? null}
              onPeek={(project) => setPeek(project.id)}
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

      {peeked && !loading && !error ? (
        <ProjectPeek project={peeked} onClose={() => setPeek(false)} />
      ) : null}

      <ArchiveConfirmDialog selection={selection} />

      <ImportProjectsDialog
        open={importing}
        onOpenChange={setImporting}
        clientOptions={clientOptions}
        memberOptions={memberOptions}
      />

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
