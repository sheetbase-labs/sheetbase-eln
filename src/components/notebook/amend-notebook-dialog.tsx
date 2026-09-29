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

/** UI port (roadmap-4/ui-app3): amend a signed notebook, app-3's v3 kit. */
export function AmendNotebookDialog({
  open,
  onOpenChange,
  recordId,
  onAmended,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  onAmended: () => void
}) {
  const [note, setNote] = useState('')
  const amend = useMutation({
    mutationFn: () =>
      createAmendment(sign002DataClient, {
        recordId,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setNote('')
      onOpenChange(false)
      onAmended()
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
          title="Amend Notebook"
          description="The submitted evidence stays frozen and a new working copy is opened so you can edit this Notebook again."
        />
        <DialogBody>
          <Field label="Note (optional)">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label="Amendment note"
            />
          </Field>
          {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={amend.isPending}
            onClick={() => amend.mutate()}
          >
            Confirm amendment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
