import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { createAmendment, sign002DataClient } from '#/lib/sign-002'

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Amend Notebook</DialogTitle>
          <DialogDescription>
            The submitted evidence stays frozen and a new working copy is opened
            so you can edit this Notebook again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label className="space-y-1">
            <span>Note (optional)</span>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label="Amendment note"
            />
          </Label>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
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
