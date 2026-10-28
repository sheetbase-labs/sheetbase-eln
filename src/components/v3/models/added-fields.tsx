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
import type { DataClient } from '#/lib/data-client'
import {
  builtInModelQueryKeys,
  useAddedFieldValues,
  useBuiltInModelFields,
} from './built-in-model-data'
import { modelFieldErrorMessage, modelFieldInputErrors } from './models-data'

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
 * page under the headings the model gives them, with an Edit action. Renders
 * nothing while the model has no added fields, so a workspace that never
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
  const fields = useBuiltInModelFields(modelKey, { enabled: Boolean(model) })
  const values = useAddedFieldValues(model, objectId)
  const [editing, setEditing] = useState(false)
  const active = (fields.data ?? []).filter(
    (field) => !exclude?.includes(field.fieldName),
  )
  if (!model || active.length === 0) return null

  const stored = values.data?.customFields ?? {}
  const locked = values.data?.locked ?? false
  const canEdit = editable && !locked && values.isSuccess
  const groups = groupAddedFields(active, `${model.name} details`)
  const editButton = canEdit ? (
    <Button
      size="sm"
      variant="quiet"
      icon="edit"
      onClick={() => setEditing(true)}
    >
      Edit
    </Button>
  ) : null

  const body = (group: (typeof groups)[number]) =>
    values.isError ? (
      <Muted>These details could not be loaded.</Muted>
    ) : (
      <DescriptionList
        labelWidth={labelWidth}
        items={group.fields.map<[React.ReactNode, React.ReactNode]>((field) => [
          field.label,
          values.isLoading
            ? '…'
            : addedFieldDisplay(field, stored[field.fieldName]),
        ])}
      />
    )

  return (
    <>
      {groups.map((group, index) =>
        variant === 'section' ? (
          <Section
            key={group.heading}
            title={group.heading}
            action={index === 0 ? editButton : undefined}
          >
            {body(group)}
          </Section>
        ) : (
          <InspectorSection key={group.heading} title={group.heading}>
            {body(group)}
            {index === groups.length - 1 && editButton ? (
              <div className="mt-2">{editButton}</div>
            ) : null}
          </InspectorSection>
        ),
      )}
      {locked ? (
        <Muted>
          This {model.name.toLowerCase()} is signed, so its details can’t be
          changed.
        </Muted>
      ) : null}
      {editing ? (
        <AddedFieldsEditDialog
          model={model}
          objectId={objectId}
          fields={active}
          stored={stored}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
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
      toast('Details saved')
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
          title="Edit details"
          description={`Change this ${model.name.toLowerCase()}’s details. The change is written to its history.`}
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
 * State for a create form's added fields: the fields the model asks for on
 * create, what has been typed, what is wrong with it, and the values to save
 * once the new record exists.
 */
export function useAddedFieldDraft(modelKey: string) {
  const fields = useBuiltInModelFields(modelKey)
  const asked = useMemo(
    () => (fields.data ?? []).filter((field) => field.askOnCreate !== false),
    [fields.data],
  )
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const errors = useMemo(
    () => modelFieldInputErrors(asked, values),
    [asked, values],
  )
  return {
    fields: asked,
    values,
    errors,
    valid: Object.keys(errors).length === 0,
    setValue: (name: string, value: string | boolean) =>
      setValues((current) => ({ ...current, [name]: value })),
    /** What to write onto the new record; blanks are left to defaults. */
    payload: () => modelFieldValuesFromInput(asked, values, true),
  }
}

/** The create-form block for a model's added fields; nothing when it has none. */
export function AddedFieldsFormSection({
  draft,
  showErrors,
}: {
  draft: ReturnType<typeof useAddedFieldDraft>
  showErrors: boolean
}) {
  if (draft.fields.length === 0) return null
  return (
    <AddedFieldInputs
      fields={draft.fields}
      values={draft.values}
      errors={draft.errors}
      showErrors={showErrors}
      onChange={draft.setValue}
    />
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
 * with their values read in one request beside the list's own query. Nothing
 * is read while no field asks to be a column.
 */
export function useAddedFieldListColumns<T extends object>(
  modelKey: string,
  /** The row property holding the object's id. */
  idField: keyof T,
  client: DataClient = notebookDataClient,
): RegistryColumn<T>[] {
  const model = builtInModel(modelKey)
  const fields = useBuiltInModelFields(modelKey, { enabled: Boolean(model) })
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
      }>(
        LIST_HOST[model!.host],
        model!.host === 'record'
          ? `?kind=eq.${encodeURIComponent(modelKey)}&select=id,custom_fields`
          : '?select=id,custom_fields',
      )
      return new Map(rows.map((row) => [row.id, row.custom_fields ?? {}]))
    },
    enabled: Boolean(model) && listed.length > 0,
    staleTime: 15_000,
  })
  const byId = values.data
  return useMemo(
    () =>
      addedFieldColumns<T>(listed, (row) => byId?.get(String(row[idField]))),
    [listed, byId, idField],
  )
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
