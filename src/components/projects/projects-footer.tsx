import { Button } from '#/components/ui/button'
import { t } from '#/copy'

import type { ProjectRow } from './types'

/**
 * The list's footer: how many rows there are, how many the archived filter is
 * hiding, and — once rows are ticked — what can be done with them. A partial
 * archive says how many landed, in the same line, rather than in a toast that
 * has gone by the time the person checks.
 */
export function ProjectsFooter({
  count,
  archivedHidden,
  bulkError,
  selected,
  archivable,
  restorable,
  pending,
  onArchive,
  onRestore,
  onClear,
}: {
  count: number
  archivedHidden: number
  bulkError: string | null
  selected: number
  archivable: readonly ProjectRow[]
  restorable: readonly ProjectRow[]
  pending: boolean
  onArchive: () => void
  onRestore: () => void
  onClear: () => void
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
      <span>{t('projects.projectsPage.count', { count })}</span>
      {archivedHidden ? (
        <span className="max-lg:hidden">
          {t('projects.projectsPage.archivedHidden', {
            count: archivedHidden,
          })}
        </span>
      ) : null}
      {bulkError ? (
        <span role="alert" className="text-danger-text">
          {bulkError}
        </span>
      ) : null}
      {selected ? (
        <span className="ml-auto flex items-center gap-2 text-fg">
          <span className="max-xl:hidden">
            {t('common.counts.selected', { count: selected })}
          </span>
          {archivable.length ? (
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={onArchive}
            >
              {t('projects.projectsPage.archiveCount', {
                count: archivable.length,
              })}
            </Button>
          ) : null}
          {restorable.length ? (
            <Button size="sm" disabled={pending} onClick={onRestore}>
              {t('projects.projectsPage.restoreCount', {
                count: restorable.length,
              })}
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" onClick={onClear}>
            {t('common.actions.clear')}
          </Button>
        </span>
      ) : null}
    </div>
  )
}
