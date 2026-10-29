import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import {
  DescriptionList,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { Notice } from '#/components/v3/ui/alert'
import { Field } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { builtInModel, saveAddedFieldValues } from '#/lib/built-in-models'
import type { BuiltInModel } from '#/lib/built-in-models'
import {
  displayModelFieldValue,
  modelFieldColumnId,
  modelFieldValuesFromInput,
} from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import {
  changedModelFieldValues,
  describeFieldEditError,
  initialModelFieldValues,
} from '#/lib/model-record-edit'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import {
  setModelType,
  typeForVersion,
  valuesForType,
} from '#/lib/model-subtypes'
import type { FieldGroup, ModelType, TypeOption } from '#/lib/model-subtypes'
import type { DataClient } from '#/lib/data-client'
import {
  builtInModelQueryKeys,
  useAddedFieldValues,
  useBuiltInModelFields,
} from './built-in-model-data'
import { modelFieldErrorMessage, modelFieldInputErrors } from './models-data'
import {
  describeTypeError,
  useModelTypes,
  usePickableTypes,
  useTypeFields,
} from './model-subtype-data'
import { t } from '#/copy'

/** A field's value as the record pages show it. */
export function addedFieldDisplay(
  field: ModelFieldDefinition,
  raw: unknown,
): string {
  if (field.logicalType === 'date')
    return raw == null || raw === '' ? '—' : formatDate(String(raw))
  if (field.logicalType === 'timestamp')
    return raw == null || raw === ''
      ? '—'
      : formatDate(String(raw)) +
          ` ${new Date(String(raw)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return displayModelFieldValue(field, raw)
}

/** Fields grouped under their page heading, in first-appearance order; the
 * unnamed group takes the model's own "… details" heading and comes first. */
export function groupAddedFields(
  fields: readonly ModelFieldDefinition[],
  defaultHeading: string,
): Array<{ heading: string; fields: ModelFieldDefinition[] }> {
  const groups = new Map<string, ModelFieldDefinition[]>()
  for (const field of fields) {
    const heading = field.section?.trim() || defaultHeading
    groups.set(heading, [...(groups.get(heading) ?? []), field])
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === defaultHeading ? -1 : b === defaultHeading ? 1 : 0,
    )
    .map(([heading, grouped]) => ({ heading, fields: grouped }))
}

/**
 * The fields a workspace added to a built-in model, shown on one record's
 * page under the headings the model gives them, with an Edit action. An
 * object with a subtype also shows its type and every field its type chain
 * adds, and can change type until it is signed. Renders nothing while the
 * model has no added fields and no subtypes, so a workspace that never
 * extends a model sees its pages unchanged.
 */
export function AddedFields({
  modelKey,
  objectId,
  variant = 'inspector',
  labelWidth = 110,
  editable = true,
  exclude,
}: {
  modelKey: string
  objectId: string
  /** `inspector` for a side panel, `section` for the page body. */
  variant?: 'inspector' | 'section'
  labelWidth?: number
  editable?: boolean
  /** Field keys the page already shows in its own layout. */
  exclude?: readonly string[]
}) {
  const model = builtInModel(modelKey)
  const values = useAddedFieldValues(model, objectId)
  const family = usePickableTypes(modelKey)
  const pinned = typeForVersion(family.types, values.data?.modelVersionId)
  const builtInFields = useBuiltInModelFields(modelKey, {
    enabled: Boolean(model),
  })
  const typeFields = useTypeFields(
    family.types,
    modelKey,
    pinned?.key ?? null,
    values.data?.modelVersionId ?? null,
    { enabled: Boolean(model && pinned) },
  )
  const [editing, setEditing] = useState(false)
  const [changingType, setChangingType] = useState(false)
  if (!model) return null

  const keep = (field: ModelFieldDefinition) =>
    !exclude?.includes(field.fieldName)
  // The built-in model's own added fields keep their headings; each subtype's
  // fields sit under the subtype's name unless a field names a heading.
  const fieldGroups = pinned
    ? (typeFields.data ?? []).flatMap((group) =>
        group.modelKey === model.key
          ? groupAddedFields(group.fields.filter(keep), `${model.name} details`)
          : groupAddedFields(group.fields.filter(keep), group.modelName),
      )
    : groupAddedFields(
        (builtInFields.data ?? []).filter(keep),
        `${model.name} details`,
      )
  const groups = fieldGroups.filter((group) => group.fields.length > 0)
  const hasTypes = family.options.length > 0 || pinned !== null
  if (groups.length === 0 && !hasTypes) return null

  const stored = values.data?.customFields ?? {}
  const locked = values.data?.locked ?? false
  const canEdit = editable && !locked && values.isSuccess
  const allFields = groups.flatMap((group) => group.fields)
  const typeName = pinned?.name ?? model.name
  const actions =
    canEdit && (allFields.length > 0 || hasTypes) ? (
      <span className="flex flex-wrap gap-1">
        {allFields.length > 0 ? (
          <Button
            size="sm"
            variant="quiet"
            icon="edit"
            onClick={() => setEditing(true)}
          >
            {t('common.actions.edit')}
          </Button>
        ) : null}
        {hasTypes ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setChangingType(true)}
          >
            {t('library.models.addedFields.changeType')}
          </Button>
        ) : null}
      </span>
    ) : null

  const shown = groups.length
    ? groups
    : [{ heading: `${model.name} details`, fields: [] }]
  // The type reads best beside its own fields, under the subtype's heading.
  const typeRow = Math.max(
    0,
    shown.findIndex((group) => group.heading === typeName),
  )
  const body = (group: (typeof shown)[number], index: number) =>
    values.isError ? (
      <Muted>{t('library.models.addedFields.theseDetailsCouldNotBe')}</Muted>
    ) : (
      <DescriptionList
        labelWidth={labelWidth}
        items={[
          ...(index === typeRow && hasTypes
            ? [
                [
                  t('library.models.addedFields.type'),
                  values.isLoading ? '…' : typeName,
                ] as [React.ReactNode, React.ReactNode],
              ]
            : []),
          ...group.fields.map<[React.ReactNode, React.ReactNode]>((field) => [
            field.label,
            values.isLoading
              ? '…'
              : addedFieldDisplay(field, stored[field.fieldName]),
          ]),
        ]}
      />
    )

  return (
    <>
      {shown.map((group, index) =>
        variant === 'section' ? (
          <Section
            key={group.heading}
            title={group.heading}
            action={index === 0 ? actions : undefined}
          >
            {body(group, index)}
          </Section>
        ) : (
          <InspectorSection key={group.heading} title={group.heading}>
            {body(group, index)}
            {index === shown.length - 1 && actions ? (
              <div className="mt-2">{actions}</div>
            ) : null}
          </InspectorSection>
        ),
      )}
      {locked ? (
        <Muted>
          {t('library.models.addedFields.thisIsSignedSoIts', {
            name: model.name.toLowerCase(),
          })}
        </Muted>
      ) : null}
      {editing ? (
        <AddedFieldsEditDialog
          model={model}
          objectId={objectId}
          fields={allFields}
          stored={stored}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {changingType ? (
        <ChangeTypeDialog
          model={model}
          objectId={objectId}
          types={family.types}
          options={family.options}
          current={pinned}
          currentGroups={
            pinned
              ? (typeFields.data ?? [])
              : [
                  {
                    modelKey: model.key,
                    modelName: model.name,
                    fields: builtInFields.data ?? [],
                  },
                ]
          }
          stored={stored}
          onClose={() => setChangingType(false)}
        />
      ) : null}
    </>
  )
}

/**
 * Pick another type for an object. What the new type keeps carries over, the
 * values it would drop are named before saving, and its fields can be filled
 * in straight away. The object takes the new type's ID.
 */
function ChangeTypeDialog({
  model,
  objectId,
  types,
  options,
  current,
  currentGroups,
  stored,
  onClose,
  client = notebookDataClient,
}: {
  model: BuiltInModel
  objectId: string
  types: readonly ModelType[]
  options: readonly TypeOption[]
  current: ModelType | null
  currentGroups: readonly FieldGroup[]
  stored: Record<string, unknown>
  onClose: () => void
  client?: DataClient
}) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<string>(current?.key ?? '')
  const targetKey = target || null
  const targetFields = useTypeFields(types, model.key, targetKey)
  const groups = targetFields.data ?? []
  const fields = useMemo(
    () => groups.flatMap((group) => group.fields),
    [groups],
  )
  const { kept, dropped } = useMemo(
    () => valuesForType(stored, currentGroups, groups),
    [stored, currentGroups, groups],
  )
  const initial = useMemo(
    () => initialModelFieldValues(fields, kept),
    [fields, kept],
  )
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const merged = useMemo(() => ({ ...initial, ...values }), [initial, values])
  const errors = useMemo(
    () => modelFieldInputErrors(fields, merged),
    [fields, merged],
  )
  const unchanged = targetKey === (current?.key ?? null)

  const save = useMutation({
    mutationFn: () =>
      setModelType(
        client,
        model.host,
        objectId,
        targetKey,
        modelFieldValuesFromInput(fields, merged, true),
      ),
    onSuccess: ({ identifier }) => {
      // The object's ID changes with its type, so every view of it refreshes.
      void queryClient.invalidateQueries()
      toast(
        identifier
          ? t('library.models.addedFields.typeChangedItsIdIs', { identifier })
          : t('library.models.addedFields.typeChanged'),
      )
      onClose()
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.models.addedFields.changeType')}
          description={t('library.models.addedFields.pickWhatKindOfThis', {
            name: model.name.toLowerCase(),
          })}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label={t('library.models.addedFields.type')}>
              <Select
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value)
                  setValues({})
                }}
              >
                <option value="">{model.name}</option>
                {options.map(({ type, depth }) => (
                  <option key={type.key} value={type.key}>
                    {`${'\u2003'.repeat(depth - 1)}${type.name}`}
                  </option>
                ))}
              </Select>
            </Field>
            {!unchanged && dropped.length > 0 ? (
              <Notice
                tone="warn"
                title={t('library.models.addedFields.someValuesWillBeRemoved')}
              >
                {t(
                  dropped.length === 1
                    ? 'library.models.addedFields.isntPartOfTheNewType'
                    : 'library.models.addedFields.arentPartOfTheNewType',
                  { dropped: dropped.join(', ') },
                )}
              </Notice>
            ) : null}
            {!unchanged && fields.length > 0 ? (
              <AddedFieldInputs
                fields={fields}
                values={merged}
                errors={errors}
                showErrors
                onChange={(name, value) =>
                  setValues((currentValues) => ({
                    ...currentValues,
                    [name]: value,
                  }))
                }
              />
            ) : null}
            {save.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {describeTypeError(save.error)}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={
              unchanged ||
              targetFields.isLoading ||
              Object.keys(errors).length > 0 ||
              save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('library.models.addedFields.changing')
              : t('library.models.addedFields.changeType')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddedFieldsEditDialog({
  model,
  objectId,
  fields,
  stored,
  onClose,
  client = notebookDataClient,
}: {
  model: BuiltInModel
  objectId: string
  fields: ModelFieldDefinition[]
  stored: Record<string, unknown>
  onClose: () => void
  client?: DataClient
}) {
  const queryClient = useQueryClient()
  const initial = useMemo(
    () => initialModelFieldValues(fields, stored),
    [fields, stored],
  )
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const merged = useMemo(() => ({ ...initial, ...values }), [initial, values])
  const errors = useMemo(
    () => modelFieldInputErrors(fields, merged),
    [fields, merged],
  )
  const changes = changedModelFieldValues(fields, initial, merged)
  const dirty = Object.keys(changes).length > 0

  const save = useMutation({
    mutationFn: () => saveAddedFieldValues(client, model, objectId, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: builtInModelQueryKeys.values(model.key, objectId),
      })
      void queryClient.invalidateQueries({
        queryKey: addedFieldListQueryKey(model.key),
      })
      toast(t('library.models.addedFields.detailsSaved'))
      onClose()
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.models.addedFields.editDetails')}
          description={t('library.models.addedFields.changeThisSDetailsThe', {
            name: model.name.toLowerCase(),
          })}
        />
        <DialogBody>
          <AddedFieldInputs
            fields={fields}
            values={merged}
            errors={errors}
            showErrors
            onChange={(name, value) =>
              setValues((current) => ({ ...current, [name]: value }))
            }
          />
          {save.isError ? (
            <p role="alert" className="mt-3 mb-0 text-label text-danger-text">
              {describeFieldEditError(save.error)}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={
              !dirty || Object.keys(errors).length > 0 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('common.states.saving')
              : t('library.models.addedFields.saveDetails')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Inputs for a set of added fields, labelled the way form fields are. */
export function AddedFieldInputs({
  fields,
  values,
  errors,
  showErrors,
  onChange,
}: {
  fields: readonly ModelFieldDefinition[]
  values: Record<string, string | boolean>
  errors: Record<string, string>
  showErrors: boolean
  onChange: (fieldName: string, value: string | boolean) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const error = showErrors ? errors[field.fieldName] : undefined
        const value =
          values[field.fieldName] ??
          (field.logicalType === 'boolean' ? false : '')
        return (
          <div key={field.id} className="flex flex-col gap-1 text-label">
            {field.logicalType === 'boolean' ? (
              <ModelFieldInput
                definition={field}
                value={value}
                onChange={(next) => onChange(field.fieldName, next)}
              />
            ) : (
              <>
                <span className="font-medium text-fg">
                  {field.label}
                  {!field.nullable ? (
                    <span aria-hidden="true" className="text-fg-muted">
                      {' '}
                      *
                    </span>
                  ) : null}
                </span>
                <ModelFieldInput
                  definition={field}
                  value={value}
                  showLabel={false}
                  onChange={(next) => onChange(field.fieldName, next)}
                />
              </>
            )}
            {error ? (
              <span role="alert" className="text-danger-text">
                {modelFieldErrorMessage(error)}
              </span>
            ) : field.description ? (
              <span className="text-fg-muted">{field.description}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * State for a create form's added fields: the type picked (when the model has
 * subtypes), the fields that type asks for on create, what has been typed,
 * what is wrong with it, and the values to save once the new object exists.
 */
export function useAddedFieldDraft(modelKey: string) {
  const builtInFields = useBuiltInModelFields(modelKey)
  const family = usePickableTypes(modelKey)
  const [typeKey, setTypeKey] = useState<string | null>(null)
  const typeFields = useTypeFields(family.types, modelKey, typeKey, null, {
    enabled: typeKey !== null,
  })
  const source = typeKey
    ? (typeFields.data ?? []).flatMap((group) => group.fields)
    : (builtInFields.data ?? [])
  const asked = useMemo(
    () => source.filter((field) => field.askOnCreate !== false),
    [source],
  )
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const errors = useMemo(
    () => modelFieldInputErrors(asked, values),
    [asked, values],
  )
  const rootKeys = new Set(
    (builtInFields.data ?? []).map((field) => field.fieldName),
  )
  return {
    fields: asked,
    values,
    errors,
    typeKey,
    typeOptions: family.options,
    modelName:
      builtInModel(modelKey)?.name ?? t('library.models.addedFields.standard'),
    /** The picked type's own name, or the model's. */
    typeName:
      family.options.find((option) => option.type.key === typeKey)?.type.name ??
      null,
    valid:
      Object.keys(errors).length === 0 &&
      (typeKey === null || typeFields.isSuccess),
    setType: (key: string | null) => setTypeKey(key),
    setValue: (name: string, value: string | boolean) =>
      setValues((current) => ({ ...current, [name]: value })),
    /** What to write onto the new object; blanks are left to defaults. */
    payload: () => modelFieldValuesFromInput(asked, values, true),
    /** Only the built-in model's own fields, for a form that writes them as
     * it creates the object (the type and its fields follow). */
    rootPayload: () =>
      modelFieldValuesFromInput(
        asked.filter((field) => rootKeys.has(field.fieldName)),
        values,
        true,
      ),
  }
}

/** The create-form block for a model's type and added fields; nothing when it
 * has neither. */
export function AddedFieldsFormSection({
  draft,
  showErrors,
}: {
  draft: ReturnType<typeof useAddedFieldDraft>
  showErrors: boolean
}) {
  if (draft.fields.length === 0 && draft.typeOptions.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {draft.typeOptions.length > 0 ? (
        <Field label={t('library.models.addedFields.type')}>
          <Select
            value={draft.typeKey ?? ''}
            onChange={(event) => draft.setType(event.target.value || null)}
          >
            <option value="">{draft.modelName}</option>
            {draft.typeOptions.map(({ type, depth }) => (
              <option key={type.key} value={type.key}>
                {`${'\u2003'.repeat(depth - 1)}${type.name}`}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {draft.fields.length > 0 ? (
        <AddedFieldInputs
          fields={draft.fields}
          values={draft.values}
          errors={draft.errors}
          showErrors={showErrors}
          onChange={draft.setValue}
        />
      ) : null}
    </div>
  )
}

export function addedFieldListQueryKey(modelKey: string) {
  return [...builtInModelQueryKeys.all, 'list-values', modelKey] as const
}

/** List columns for the added fields marked "show as a column". */
export function addedFieldColumns<T extends object>(
  fields: readonly ModelFieldDefinition[] | undefined,
  customFieldsOf: (row: T) => Record<string, unknown> | null | undefined,
): RegistryColumn<T>[] {
  return (fields ?? [])
    .filter((field) => field.showInList)
    .map((field) => ({
      id: modelFieldColumnId(field.fieldName),
      header: field.label,
      cell: ({ row }) => {
        const value = customFieldsOf(row.original)?.[field.fieldName]
        return (
          <span
            className={
              value == null || value === '' ? 'text-fg-muted' : undefined
            }
          >
            {addedFieldDisplay(field, value)}
          </span>
        )
      },
    }))
}

const LIST_HOST: Record<BuiltInModel['host'], string> = {
  record: 'records',
  project: 'projects',
  instrument: 'instruments',
}

/**
 * List columns for a built-in model's added fields marked "show as a column",
 * led by a Type column once the model has subtypes, with their values read in
 * one request beside the list's own query. Nothing is read while there is
 * neither a listed field nor a subtype.
 */
export function useAddedFieldListColumns<T extends object>(
  modelKey: string,
  /** The row property holding the object's id. */
  idField: keyof T,
  client: DataClient = notebookDataClient,
): RegistryColumn<T>[] {
  const model = builtInModel(modelKey)
  const fields = useBuiltInModelFields(modelKey, { enabled: Boolean(model) })
  const family = usePickableTypes(modelKey)
  const typed = family.options.length > 0
  const listed = useMemo(
    () => (fields.data ?? []).filter((field) => field.showInList),
    [fields.data],
  )
  const values = useQuery({
    queryKey: addedFieldListQueryKey(modelKey),
    queryFn: async () => {
      const rows = await client.list<{
        id: string
        custom_fields: Record<string, unknown> | null
        model_version_id: string | null
      }>(
        LIST_HOST[model!.host],
        model!.host === 'record'
          ? `?kind=eq.${encodeURIComponent(modelKey)}&select=id,custom_fields,model_version_id`
          : '?select=id,custom_fields,model_version_id',
      )
      return new Map(rows.map((row) => [row.id, row]))
    },
    enabled: Boolean(model) && (listed.length > 0 || typed),
    staleTime: 15_000,
  })
  const byId = values.data
  const types = family.types
  return useMemo(() => {
    const columns = addedFieldColumns<T>(
      listed,
      (row) => byId?.get(String(row[idField]))?.custom_fields,
    )
    if (!typed || !model) return columns
    const typeColumn: RegistryColumn<T> = {
      id: 'model_type',
      header: t('library.models.addedFields.type'),
      cell: ({ row }) => {
        const type = typeForVersion(
          types,
          byId?.get(String(row.original[idField]))?.model_version_id,
        )
        return type ? (
          <span>{type.name}</span>
        ) : (
          <span className="text-fg-muted">{model.name}</span>
        )
      },
    }
    return [typeColumn, ...columns]
  }, [listed, byId, idField, typed, model, types])
}

/** The list's own columns with the added ones placed before its last column
 * (status, owner or updated), which stays at the end. */
export function withAddedColumns<T extends object>(
  base: RegistryColumn<T>[],
  added: RegistryColumn<T>[],
): RegistryColumn<T>[] {
  if (added.length === 0) return base
  return [...base.slice(0, -1), ...added, ...base.slice(-1)]
}

/** The name of an object's type: its subtype when it has one, else `fallback`. */
export function ObjectTypeName({
  modelKey,
  objectId,
  fallback,
}: {
  modelKey: string
  objectId: string
  fallback: React.ReactNode
}) {
  const model = builtInModel(modelKey)
  const values = useAddedFieldValues(model, objectId)
  const types = useModelTypes()
  const pinned = typeForVersion(types.data ?? [], values.data?.modelVersionId)
  return <>{pinned?.name ?? fallback}</>
}
