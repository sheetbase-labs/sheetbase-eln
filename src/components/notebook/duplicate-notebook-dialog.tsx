import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { duplicateExperiment } from '#/lib/notebook-experience'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

export function DuplicateNotebookDialog({
  open,
  onOpenChange,
  source,
  blocks,
  onDuplicated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: NotebookRecord
  blocks: NotebookBlock[]
  onDuplicated: (record: NotebookRecord) => void
}) {
  const defaultTitle = `${source.title} copy`
  const [title, setTitle] = useState(defaultTitle)

  useEffect(() => {
    if (open) setTitle(`${source.title} copy`)
  }, [open, source.title])

  const duplicate = useMutation({
    mutationFn: () =>
      duplicateExperiment(notebookDataClient, {
        source,
        blocks,
        title,
      }),
    onSuccess: ({ record }) => {
      onOpenChange(false)
      onDuplicated(record)
    },
  })

  const errorMessage =
    duplicate.error instanceof DataClientError
      ? duplicate.error.message
      : duplicate.error instanceof Error
        ? duplicate.error.message
        : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Notebook</DialogTitle>
          <DialogDescription>
            Creates a new working Notebook. Sheets are copied; submitted
            evidence stays with the original.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            duplicate.mutate()
          }}
        >
          <Label className="space-y-1">
            <span>Title</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Notebook title"
            />
          </Label>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={duplicate.isPending}>
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
