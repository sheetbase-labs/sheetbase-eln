import { t } from '#/copy'

/** What the list's Next step column says about one experiment. */
export interface ListNextStep {
  label: string
  /** Whether the move is the viewer's, so the row can stand out. */
  yours: boolean
}

/**
 * The next move on an experiment, read from its status and who is looking.
 * The experiment page works out its main button from far more (the lock, the
 * lab's regulated switch, write rights); the list only needs the plain next
 * move, which depends on the status and on whether the viewer is its author
 * or reviewer.
 */
export function listNextStep(
  row: {
    statusKey: string
    ownerId: string
    assigneeId?: string | null
    reviewerId: string | null
    archived?: boolean
  },
  userId: string,
): ListNextStep | null {
  if (row.archived) return null

  const author = row.ownerId === userId || row.assigneeId === userId
  const reviewer = row.reviewerId === userId

  switch (row.statusKey) {
    case 'draft':
    case 'planned':
      return { label: t('projects.experimentsList.next.start'), yours: author }
    case 'in_progress':
      return {
        label: t('projects.experimentsList.next.finish'),
        yours: author,
      }
    case 'returned':
      return {
        label: t('projects.experimentsList.next.changes'),
        yours: author,
      }
    case 'in_review':
      return reviewer
        ? { label: t('projects.experimentsList.next.review'), yours: true }
        : { label: t('projects.experimentsList.next.waiting'), yours: false }
    case 'paused':
    case 'on_hold':
      return { label: t('projects.experimentsList.next.resume'), yours: author }
    default:
      return null
  }
}
