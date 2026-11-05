/**
 * The Registry box on a model: tick it and the model's records become registry
 * entries. Choose which fields make two entries the same thing, and which one
 * holds a sequence, if any.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { t } from '#/copy'
import { messageOf, setModelRegistry } from '#/lib/bio-registry'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  recordModelQueryKeys,
  useRecordModelFields,
} from '#/components/v3/models/models-data'
import type { WorkspaceRecordModel } from '#/components/v3/models/models-data'

const MAX_KEY_FIELDS = 4

export function RegistrySettingsDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: WorkspaceRecordModel
}) {
  const queryClient = useQueryClient()
  const fieldsQuery = useRecordModelFields(model.key)
  const fields = (fieldsQuery.data ?? []).filter(
    (f) => f.lifecycle === 'active',
  )
  const [isRegistry, setIsRegistry] = useState(Boolean(model.is_registry))
  const [keyFields, setKeyFields] = useState<string[]>(
    model.registry_key_fields ?? [],
  )
  const [sequenceField, setSequenceField] = useState(
    model.registry_sequence_field ?? '',
  )

  useEffect(() => {
    if (!open) return
    setIsRegistry(Boolean(model.is_registry))
    setKeyFields(model.registry_key_fields ?? [])
    setSequenceField(model.registry_sequence_field ?? '')
  }, [open, model])

  const save = useMutation({
    mutationFn: () =>
      setModelRegistry(notebookDataClient, {
        modelKey: model.key,
        isRegistry,
        keyFields: isRegistry ? keyFields : [],
        sequenceField: isRegistry && sequenceField ? sequenceField : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['registry'] })
      void queryClient.invalidateQueries({
        queryKey: recordModelQueryKeys.model(model.key),
      })
      toast.success(t('registry.settings.saved'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.settings.couldNotSave'))),
  })

  function toggle(name: string, on: boolean) {
    setKeyFields((current) =>
      on
        ? [...current, name].slice(0, MAX_KEY_FIELDS)
        : current.filter((k) => k !== name),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('registry.settings.title')} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2 text-body">
              <Checkbox
                checked={isRegistry}
                onCheckedChange={(checked) => setIsRegistry(checked === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="font-medium">
                  {t('registry.settings.tick')}
                </span>
                <span className="text-label text-fg-muted">
                  {t('registry.settings.tickHint')}
                </span>
              </span>
            </label>
            {isRegistry ? (
              <>
                <Field
                  label={t('registry.settings.keyFields')}
                  hint={t('registry.settings.keyFieldsHint')}
                >
                  {fields.length === 0 ? (
                    <span className="text-label text-fg-muted">
                      {t('registry.settings.noFields')}
                    </span>
                  ) : (
                    <span className="flex flex-col gap-1.5">
                      {fields.map((field) => {
                        const on = keyFields.includes(field.fieldName)
                        return (
                          <label
                            key={field.fieldName}
                            className="flex items-center gap-2 text-body"
                          >
                            <Checkbox
                              checked={on}
                              disabled={
                                !on && keyFields.length >= MAX_KEY_FIELDS
                              }
                              onCheckedChange={(checked) =>
                                toggle(field.fieldName, checked === true)
                              }
                            />
                            {field.label}
                          </label>
                        )
                      })}
                    </span>
                  )}
                </Field>
                {fields.length > 0 ? (
                  <Field
                    label={t('registry.settings.sequenceField')}
                    hint={t('registry.settings.sequenceFieldHint')}
                  >
                    <Select
                      value={sequenceField}
                      onChange={(e) => setSequenceField(e.target.value)}
                    >
                      <option value="">
                        {t('registry.settings.sequenceNone')}
                      </option>
                      {fields.map((field) => (
                        <option key={field.fieldName} value={field.fieldName}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('registry.settings.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('registry.settings.saving')
              : t('registry.settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
