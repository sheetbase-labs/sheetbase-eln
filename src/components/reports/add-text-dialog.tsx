import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Field, Input } from '#/components/ui/input'
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
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { addTextSection, reportKeys } from '#/lib/reports'
import { t } from '#/copy'

/**
 * Write a section of the report by hand: a title and the words under it. The
 * title is required, and says so once the person has tried to add the section
 * rather than before they have typed anything.
 */
export function AddTextDialog({
  open,
  onOpenChange,
  recordId,
  definitionId,
  workspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  definitionId: string
  workspaceId: string
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [touched, setTouched] = useState(false)

  const add = useMutation({
    mutationFn: () =>
      addTextSection(notebookDataClient, {
        workspaceId,
        definitionId,
        title,
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: reportKeys.detail(recordId),
      })
      setTitle('')
      setBody('')
      setTouched(false)
      onOpenChange(false)
    },
    onError: () => toast.error(t('projects.reports.addText.failed')),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.reports.addText.title')} />
        <DialogBody>
          <Field
            label={t('projects.reports.addText.titleField')}
            required
            error={
              touched && !title.trim()
                ? t('projects.reports.addText.titleError')
                : undefined
            }
          >
            <Input
              autoFocus
              value={title}
              placeholder={t('projects.reports.addText.titlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t('projects.reports.addText.bodyField')}>
            <Textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => {
              setTouched(true)

              if (title.trim()) add.mutate()
            }}
          >
            {add.isPending
              ? t('projects.reports.addText.adding')
              : t('projects.reports.addText.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
