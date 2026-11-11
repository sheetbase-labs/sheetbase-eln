/**
 * Feedback for something a person just did that can be taken back: the
 * confirmation carries an Undo that reverses it. Undo runs once; it says
 * "Undone" when it worked and says so when it could not.
 */
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'

export function undoToast<Undone>(
  message: string,
  undo: () => Promise<Undone> | Undone,
  /** Runs after a successful undo, e.g. to reload the list. */
  onUndone?: () => void,
): void {
  toast(message, {
    action: {
      label: t('common.actions.undo'),
      onClick: () => {
        void (async () => {
          try {
            await undo()
            toast(t('common.states.undone'))
            onUndone?.()
          } catch (error) {
            toast.error(t('common.states.couldNotUndo'), {
              description: error instanceof Error ? error.message : undefined,
            })
          }
        })()
      },
    },
  })
}
