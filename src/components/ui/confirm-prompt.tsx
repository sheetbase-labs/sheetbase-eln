import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { t } from '#/copy'

/**
 * The app's own "are you sure?", for the places that used the browser's
 * `window.confirm`. The browser's box blocks the whole tab, ignores the theme
 * and cannot be styled or tested; this one is a dialog like every other.
 *
 * Render it while the question is open and call `onClose` however it ends;
 * `onConfirm` runs only on the confirm button.
 */
export function ConfirmPrompt({
  message,
  confirmLabel,
  variant = 'primary',
  onConfirm,
  onClose,
}: {
  message: string
  confirmLabel: string
  variant?: 'primary' | 'danger-fill'
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <ConfirmDialog open onOpenChange={(open) => !open && onClose()}>
      <ConfirmDialogContent className="w-[min(440px,calc(100vw-32px))]">
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{message}</ConfirmDialogTitle>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('common.actions.cancel')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction variant={variant} onClick={onConfirm}>
            {confirmLabel}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
