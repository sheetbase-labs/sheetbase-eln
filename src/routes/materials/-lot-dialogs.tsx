/**
 * The lot page's three dialogs: registering the lot that replaces this one,
 * taking stock from it, and quarantining it. Each one holds only the form; the
 * page keeps the mutation and closes the dialog when it answers.
 */
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
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/inventory/list'
import { ReplacementForm } from '../-materials-page'
import { t } from '#/copy'

import { UseForm } from './-lot-use-form'

export function ReplacementLotDialog({
  open,
  onOpenChange,
  identifier,
  title,
  unit,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  identifier: string
  title: string
  unit: string | null
  busy: boolean
  onSubmit: (input: {
    lot: string
    expiry: string
    quantity: number
    unit?: string
    reason?: string
  }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.materials.lot.registerReplacementLot')}
          description={`${identifier} · ${title}`}
        />
        <DialogBody>
          <ReplacementForm busy={busy} unit={unit} onSubmit={onSubmit} />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="replacement-lot-form"
            disabled={busy}
          >
            {busy
              ? t('library.materials.lot.registering')
              : t('library.materials.lot.register')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UseLotDialog({
  open,
  onOpenChange,
  identifier,
  title,
  stock,
  available,
  unit,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  identifier: string
  title: string
  stock: string
  available: number | null
  unit: string | null
  busy: boolean
  onSubmit: (input: { quantity: number; reason?: string }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.materials.lot.useFromThisLot')}
          description={t('library.materials.lot.left', {
            identifier,
            title,
            stock,
          })}
        />
        <DialogBody>
          <UseForm
            busy={busy}
            available={available}
            unit={unit}
            onSubmit={onSubmit}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="use-lot-form"
            disabled={busy}
          >
            {busy
              ? t('library.materials.lot.recording')
              : t('library.materials.lot.use')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function QuarantineLotDialog({
  open,
  onOpenChange,
  identifier,
  title,
  reason,
  onReasonChange,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  identifier: string
  title: string
  reason: string
  onReasonChange: (reason: string) => void
  busy: boolean
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('library.materials.lot.quarantineThisLot')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('library.materials.lot.aQuarantinedLotIsHeld', {
              identifier,
              title,
            })}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <Textarea
          className="mx-5 my-3 box-border min-h-[70px] w-[calc(100%-2.5rem)]"
          placeholder={t('library.materials.lot.whyIsThisLotHeld')}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('common.actions.cancel')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction disabled={busy} onClick={onConfirm}>
            {busy
              ? t('library.materials.lot.quarantining')
              : t('library.materials.lot.quarantine2')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
