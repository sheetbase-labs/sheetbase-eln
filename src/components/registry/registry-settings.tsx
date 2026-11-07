/**
 * Registry settings for a model that has the Registry feature: which fields make
 * two entries the same thing, which one holds a sequence and which holds a
 * drawn structure, if any. The feature itself is switched on from Features.
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
import { featureKeys } from '#/lib/features/data'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  indexExistingStructures,
  setModelChemistry,
} from '#/lib/compound-registry'
import { loadOcl } from '#/lib/chemistry-draw'
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
  const [keyFields, setKeyFields] = useState<string[]>(
    model.registry_key_fields ?? [],
  )
  const [sequenceField, setSequenceField] = useState(
    model.registry_sequence_field ?? '',
  )
  const [structureField, setStructureField] = useState(
    model.registry_structure_field ?? '',
  )
  const [lotKind, setLotKind] = useState(model.registry_lot_kind ?? '')
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
    setKeyFields(model.registry_key_fields ?? [])
    setSequenceField(model.registry_sequence_field ?? '')
    setStructureField(model.registry_structure_field ?? '')
    setLotKind(model.registry_lot_kind ?? '')
  }, [open, model])

  const save = useMutation({
    mutationFn: async () => {
      await setModelRegistry(notebookDataClient, {
        modelKey: model.key,
        isRegistry: true,
        keyFields,
        sequenceField: sequenceField || null,
      })
      await setModelChemistry(notebookDataClient, {
        modelKey: model.key,
        structureField: structureField || null,
        lotKind: structureField && lotKind ? lotKind : null,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['registry'] })
      void queryClient.invalidateQueries({ queryKey: featureKeys.all })
      void queryClient.invalidateQueries({
        queryKey: recordModelQueryKeys.model(model.key),
      })
      toast.success(t('registry.settings.saved'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.settings.couldNotSave'))),
  })

  const readExisting = useMutation({
    mutationFn: async () => {
      const ocl = await loadOcl()
      return indexExistingStructures(notebookDataClient, ocl, {
        key: model.key,
        registry_structure_field: model.registry_structure_field ?? '',
      })
    },
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: ['compounds'] })
      toast.success(
        count === 0
          ? t('registry.chemistry.settings.readNothing')
          : t('registry.chemistry.settings.readDone', { count }),
      )
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.chemistry.settings.couldNotRead'))),
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
                            disabled={!on && keyFields.length >= MAX_KEY_FIELDS}
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
              {fields.length > 0 ? (
                <Field
                  label={t('registry.chemistry.settings.structureField')}
                  hint={t('registry.chemistry.settings.structureFieldHint')}
                >
                  <Select
                    value={structureField}
                    onChange={(e) => setStructureField(e.target.value)}
                  >
                    <option value="">
                      {t('registry.chemistry.settings.structureNone')}
                    </option>
                    {fields.map((field) => (
                      <option key={field.fieldName} value={field.fieldName}>
                        {field.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {structureField ? (
                <>
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
                  {model.registry_structure_field === structureField ? (
                    <div className="flex flex-col items-start gap-1">
                      <Button
                        type="button"
                        disabled={readExisting.isPending}
                        onClick={() => readExisting.mutate()}
                      >
                        {readExisting.isPending
                          ? t('registry.chemistry.settings.reading')
                          : t('registry.chemistry.settings.readExisting')}
                      </Button>
                      <span className="text-label text-fg-muted">
                        {t('registry.chemistry.settings.readExistingHint')}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
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
