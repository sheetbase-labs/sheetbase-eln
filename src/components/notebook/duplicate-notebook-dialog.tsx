import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { DataClientError } from '#/lib/data-client'
import { duplicateExperiment } from '#/lib/notebook-experience'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): duplicate a notebook, app-3's v3 kit. */
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
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Duplicate Notebook"
          description="Creates a new working Notebook. Sheets are copied; submitted evidence stays with the original."
        />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            duplicate.mutate()
          }}
        >
          <DialogBody>
            <Field label="Title">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Notebook title"
              />
            </Field>
            {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={duplicate.isPending}
            >
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
