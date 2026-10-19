import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import {
  fetchRecordModelFieldValues,
  updateRecordModelFieldValues,
} from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import {
  changedModelFieldValues,
  describeFieldEditError,
  initialModelFieldValues,
} from '#/lib/model-record-edit'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  modelFieldErrorMessage,
  modelFieldInputErrors,
  recordModelDetailQueryKeys,
} from './models-data'

/**
 * Edit a model record's field values in place. The form is the same generated
 * input the new-record page uses; the save sends only what changed, with the
 * metadata version the page last read, so a concurrent edit is refused rather
 * than overwritten.
 */
export function RecordModelEditDialog({
  open,
  onOpenChange,
  recordId,
  fields,
  stored,
  client = notebookDataClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  fields: ModelFieldDefinition[]
  stored: Record<string, unknown> | null | undefined
  client?: typeof notebookDataClient
}) {
  const queryClient = useQueryClient()
  const initial = useMemo(
    () => initialModelFieldValues(fields, stored),
    [fields, stored],
  )
  const [values, setValues] =
    useState<Record<string, string | boolean>>(initial)
  const merged = useMemo(() => ({ ...initial, ...values }), [initial, values])
  const errors = useMemo(
    () => modelFieldInputErrors(fields, merged),
    [fields, merged],
  )
  const changes = changedModelFieldValues(fields, initial, merged)
  const dirty = Object.keys(changes).length > 0

  const save = useMutation({
    mutationFn: async () => {
      const current = await fetchRecordModelFieldValues(client, recordId)
      if (current.locked) {
        throw Object.assign(new Error('locked'), { code: 'SB011' })
      }
      return updateRecordModelFieldValues(
        client,
        recordId,
        current.metadataVersion,
        changes,
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: recordModelDetailQueryKeys.record(recordId),
      })
      void queryClient.invalidateQueries({
        queryKey: recordModelDetailQueryKeys.timeline(recordId),
      })
      toast('Details saved')
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Edit details"
          description="Change the field values on this record. The change is written to its history."
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            {fields.map((field) => (
              <div key={field.id} className="flex flex-col gap-1">
                <ModelFieldInput
                  definition={field}
                  value={merged[field.fieldName]}
                  onChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      [field.fieldName]: value,
                    }))
                  }
                />
                {errors[field.fieldName] ? (
                  <span
                    role="alert"
                    className="text-[0.65rem] text-danger-text"
                  >
                    {modelFieldErrorMessage(errors[field.fieldName])}
                  </span>
                ) : null}
              </div>
            ))}
            {save.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {describeFieldEditError(save.error)}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={
              !dirty || Object.keys(errors).length > 0 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save details'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
