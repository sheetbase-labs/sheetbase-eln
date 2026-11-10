import { t } from '#/copy'

export function statusTone(status: string) {
  switch (status) {
    case 'in_review':
      return 'review' as const
    case 'complete':
      return 'ok' as const
    case 'on_hold':
      return 'warn' as const
    case 'archived':
      return 'draft' as const
    default:
      return 'progress' as const
  }
}

export function statusLabel(status: string) {
  switch (status) {
    case 'in_progress':
      return t('projects.projectsRoute.status.inProgress')
    case 'in_review':
      return t('projects.projectsRoute.status.inReview')
    case 'complete':
      return t('projects.projectsRoute.status.complete')
    case 'on_hold':
      return t('projects.projectsRoute.status.onHold')
    case 'archived':
      return t('projects.projectsRoute.status.archived')
    default:
      return t('projects.projectsRoute.status.active')
  }
}
