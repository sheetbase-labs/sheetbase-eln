import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { rich, t } from '#/copy'

/** The reads behind the form, said at the foot of it so the author can retry. */
export function FormNotes({
  createError,
  projectsLoading,
  projectsFailed,
  onRetryProjects,
  accessPending,
  accessFailed,
  onRetryAccess,
  noProjects,
  noUsableProject,
}: {
  createError: string | undefined
  projectsLoading: boolean
  projectsFailed: boolean
  onRetryProjects: () => void
  accessPending: boolean
  accessFailed: boolean
  onRetryAccess: () => void
  noProjects: boolean
  noUsableProject: boolean
}) {
  return (
    <>
      {createError ? (
        <p role="alert" className="m-0 text-label text-danger-text">
          {createError}
        </p>
      ) : null}
      {projectsLoading ? (
        <Muted>{t('projects.newExperiment.loadingNote')}</Muted>
      ) : null}
      {projectsFailed ? (
        <span className="flex items-center gap-2">
          <Muted>{t('projects.newExperiment.listFailed')}</Muted>
          <Button size="sm" variant="quiet" onClick={onRetryProjects}>
            {t('common.actions.tryAgain')}
          </Button>
        </span>
      ) : null}
      {accessPending ? (
        <Muted>{t('projects.newExperiment.checkingNote')}</Muted>
      ) : null}
      {accessFailed ? (
        <span className="flex items-center gap-2">
          <Muted>{t('projects.newExperiment.accessFailed')}</Muted>
          <Button size="sm" variant="quiet" onClick={onRetryAccess}>
            {t('common.actions.tryAgain')}
          </Button>
        </span>
      ) : null}
      {noProjects ? (
        <Muted>
          {rich('projects.newExperiment.needsProject', {
            link: (text) => (
              <Link to="/projects" search={{ new: true }} className="text-link">
                {text}
              </Link>
            ),
          })}
        </Muted>
      ) : null}
      {noUsableProject ? (
        <Muted>{t('projects.newExperiment.noUsable')}</Muted>
      ) : null}
    </>
  )
}
