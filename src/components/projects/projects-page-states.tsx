import { Button } from '#/components/ui/button'
import { t } from '#/copy'

import { NO_PROJECT_ACCESS_BODY, noProjectAccessTitle } from './project-access'
import { createDisabledBodyText, tabLabel } from './projects-page-model'
import type { ArchivedMode, ProjectsTab } from './projects-page-model'

/**
 * The four things this screen shows instead of a list of projects: a read that
 * has not answered, a read that failed, no projects at all (which may be access
 * rather than absence), and a filter or search that matched nothing. Each says
 * what happened and what can be done about it.
 */

export function ProjectsLoading() {
  return (
    <p role="status" className="px-6 py-10 text-fg-muted">
      {t('projects.projectsPage.loading')}
    </p>
  )
}

export function ProjectsLoadFailure({
  error,
  onRetry,
}: {
  error: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-4 py-14 text-center"
    >
      <h2 className="text-doc">{t('projects.projectsPage.loadFailed')}</h2>
      <p className="m-0 text-fg-muted">{error}</p>
      <Button onClick={onRetry}>{t('common.actions.tryAgain')}</Button>
    </div>
  )
}

export function ProjectsEmptyState({
  onNew,
  noAccess,
  canCreate,
}: {
  onNew: () => void
  noAccess: boolean
  canCreate: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center md:px-6">
      <h2 className="text-doc">
        {noAccess
          ? noProjectAccessTitle('projects')
          : t('projects.projectsPage.empty.title')}
      </h2>
      <p className="m-0 max-w-[460px] leading-[19px] text-fg-muted">
        {noAccess
          ? NO_PROJECT_ACCESS_BODY
          : t('projects.projectsPage.empty.body')}
      </p>
      {!noAccess && !canCreate ? (
        <p className="m-0 max-w-[460px] leading-[19px] text-fg-muted">
          {createDisabledBodyText()}
        </p>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <Button variant="primary" disabled={!canCreate} onClick={onNew}>
          {t('projects.projectsPage.newProject')}
        </Button>
      </div>
    </div>
  )
}

export function ProjectsNoResults({
  q,
  tab,
  archived,
  archivedMatches,
  onIncludeArchived,
  onClear,
}: {
  q?: string
  tab: ProjectsTab
  archived: ArchivedMode
  archivedMatches: number
  onIncludeArchived: () => void
  onClear: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
    >
      <div className="text-prose font-semibold">
        {q
          ? t('projects.projectsPage.noResults.matching', { q })
          : t('projects.projectsPage.noResults.inTab', {
              tab: tabLabel(tab).toLowerCase(),
            })}
      </div>
      <div className="max-w-[460px] leading-[19px] text-fg-muted">
        {q ? (
          <>
            {archived === 'exclude'
              ? t('projects.projectsPage.noResults.searchedCurrent')
              : t('projects.projectsPage.noResults.searchedAll')}
            {archivedMatches
              ? ` ${t('projects.projectsPage.noResults.archivedMatch', { count: archivedMatches })}`
              : ''}
          </>
        ) : archivedMatches ? (
          t('projects.projectsPage.noResults.archivedHidden', {
            count: archivedMatches,
          })
        ) : (
          t('projects.projectsPage.noResults.nothing')
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        {archivedMatches ? (
          <Button onClick={onIncludeArchived}>
            {t('projects.projectsPage.noResults.includeArchived', {
              count: archivedMatches,
            })}
          </Button>
        ) : null}
        {q ? (
          <Button onClick={onClear}>
            {t('projects.projectsPage.noResults.clearSearch')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
