import { Button } from '#/components/ui/button'
import { DialogClose, DialogFooter } from '#/components/ui/dialog'
import { t } from '#/copy'

/** Creation dialogs replace the form actions with Done after revealing their result. */
export function CreationDialogFooter({
  complete,
  pending,
  ready,
  onCreate,
  createLabel,
  pendingLabel,
}: {
  complete: boolean
  pending: boolean
  ready: boolean
  onCreate: () => void
  createLabel: string
  pendingLabel: string
}) {
  return (
    <DialogFooter>
      {complete ? (
        <DialogClose render={<Button variant="primary" />}>
          {t('common.actions.done')}
        </DialogClose>
      ) : (
        <>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || pending}
            onClick={onCreate}
          >
            {pending ? pendingLabel : createLabel}
          </Button>
        </>
      )}
    </DialogFooter>
  )
}
