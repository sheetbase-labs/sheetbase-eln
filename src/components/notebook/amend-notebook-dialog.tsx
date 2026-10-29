import { t } from '#/copy'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Textarea } from '#/components/v3/inventory/list'
import { DataClientError } from '#/lib/data-client'
import { createAmendment, sign002DataClient } from '#/lib/sign-002'
import type { CreateAmendmentResult } from '#/lib/sign-002'

/**
 * The one amend dialog: the notebook header and the review page both open it.
 * An amendment unlocks signed work, so it states why before it starts; the
 * reason is recorded with the amendment in the audit trail.
 */
export function AmendNotebookDialog({
  open,
  onOpenChange,
  recordId,
  onAmended,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  onAmended: (result: CreateAmendmentResult) => void | Promise<void>
}) {
  const [note, setNote] = useState('')
  const amend = useMutation({
    mutationFn: () =>
      createAmendment(sign002DataClient, {
        recordId,
        note: note.trim(),
      }),
    onSuccess: async (result) => {
      setNote('')
      // The caller refreshes what the amendment changed before the dialog
      // closes, so a failed refresh is still visible here.
      await onAmended(result)
      onOpenChange(false)
    },
  })

  const errorMessage =
    amend.error instanceof DataClientError
      ? amend.error.message
      : amend.error instanceof Error
        ? amend.error.message
        : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('notebook.amendNotebookDialog.title')}
          description={t('notebook.amendNotebookDialog.description')}
        />
        <DialogBody>
          <Field label={t('notebook.amendNotebookDialog.label')}>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label={t('notebook.amendNotebookDialog.label')}
              aria-required="true"
              placeholder={t('notebook.amendNotebookDialog.placeholder')}
            />
          </Field>
          {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={amend.isPending || !note.trim()}
            onClick={() => amend.mutate()}
          >
            {t('notebook.amendNotebookDialog.confirmAmendment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
