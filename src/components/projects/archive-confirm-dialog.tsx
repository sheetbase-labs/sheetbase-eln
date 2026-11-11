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
import { t } from '#/copy'

import type { useProjectSelection } from './use-project-selection'

/** The question the list asks before it archives the ticked projects. */
export function ArchiveConfirmDialog({
  selection,
}: {
  selection: ReturnType<typeof useProjectSelection>
}) {
  return (
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
  )
}
