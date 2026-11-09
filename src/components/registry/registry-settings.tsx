/**
 * The Registry box on a model: tick it and the model's records become registry
 * entries. Choose which fields make two entries the same thing, and which one
 * holds a sequence, if any.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { messageOf, setModelRegistry } from '#/lib/bio-registry'
import { notebookDataClient } from '#/lib/notebook-data'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import {
  getSamenessRule,
  samenessKeys,
  setSamenessRule,
} from '#/lib/registry-sameness'
import {
  recordModelQueryKeys,
  useRecordModelFields,
} from '#/components/models/models-data'
import type { WorkspaceRecordModel } from '#/components/models/models-data'

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

  const [lotKind, setLotKind] = useState(model.registry_lot_kind ?? '')
  // A same-thing rule from a plugin: which plugin function names the key.
  const points = useExtensionPoints()
  const rules = points.data['sameness-keys']

  const savedRule = useQuery({
    queryKey: samenessKeys.rule(model.key),
    queryFn: () => getSamenessRule(notebookDataClient, model.key),
    enabled: open,
    staleTime: 10_000,
  })

  const [samenessItem, setSamenessItem] = useState('')
  useEffect(() => {
    if (open) setSamenessItem(savedRule.data ?? '')
  }, [open, savedRule.data])
  const chosenRule = rules.find((item) => item.name === samenessItem)

  const missingRuleFields = chosenRule
    ? chosenRule.declaration.fields.filter(
        (input) =>
          input.name.toLowerCase() !== 'title' &&
          !fields.some(
            (f) => f.fieldName.toLowerCase() === input.name.toLowerCase(),
          ),
      )
    : []

  const otherModels = useQuery({
    queryKey: ['registry', 'lot-models'],
    queryFn: () =>
      notebookDataClient.list<{ key: string; name: string }>(
        'record_models',
        '?select=key,name&order=name.asc',
      ),
    enabled: open,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!open) return
    setIsRegistry(Boolean(model.is_registry))
    setKeyFields(model.registry_key_fields ?? [])
    setSequenceField(model.registry_sequence_field ?? '')
    setLotKind(model.registry_lot_kind ?? '')
  }, [open, model])

  const save = useMutation({
    mutationFn: async () => {
      await setModelRegistry(notebookDataClient, {
        modelKey: model.key,
        isRegistry,
        keyFields: isRegistry ? keyFields : [],
        sequenceField: isRegistry && sequenceField ? sequenceField : null,
      })
      await notebookDataClient.rpc('set_registry_lot_kind', {
        p_model_key: model.key,
        p_lot_kind: isRegistry && lotKind ? lotKind : null,
      })
      const wanted = isRegistry ? samenessItem || null : null

      if (wanted !== (savedRule.data ?? null))
        await setSamenessRule(notebookDataClient, model.key, wanted)
    },
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
                {rules.length > 0 || samenessItem ? (
                  <Field
                    label={t('registry.sameness.label')}
                    hint={t('registry.sameness.hint')}
                  >
                    <Select
                      value={samenessItem}
                      onChange={(e) => setSamenessItem(e.target.value)}
                    >
                      <option value="">{t('registry.sameness.none')}</option>
                      {samenessItem && !chosenRule ? (
                        <option value={samenessItem}>
                          {t('registry.sameness.gone')}
                        </option>
                      ) : null}
                      {rules.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.declaration.title} ({item.extensionName})
                        </option>
                      ))}
                    </Select>
                    {chosenRule ? (
                      <span className="mt-1 block text-label text-fg-muted">
                        {missingRuleFields.length > 0
                          ? t('registry.sameness.missingFields', {
                              fields: missingRuleFields
                                .map((f) => f.label ?? f.name)
                                .join(', '),
                            })
                          : t('registry.sameness.reads', {
                              fields: chosenRule.declaration.fields
                                .map((f) => f.label ?? f.name)
                                .join(', '),
                            })}
                      </span>
                    ) : null}
                  </Field>
                ) : null}
                <Field
                  label={t('registry.chemistry.settings.lotKind')}
                  hint={t('registry.chemistry.settings.lotKindHint')}
                >
                  <Select
                    value={lotKind}
                    onChange={(e) => setLotKind(e.target.value)}
                  >
                    <option value="">
                      {t('registry.chemistry.settings.lotNone')}
                    </option>
                    {(otherModels.data ?? [])
                      .filter((m) => m.key !== model.key)
                      .map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.name}
                        </option>
                      ))}
                  </Select>
                </Field>
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
