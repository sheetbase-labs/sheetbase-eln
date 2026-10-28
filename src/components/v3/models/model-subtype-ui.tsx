import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
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
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Muted } from '#/components/v3/ui/layout'
import { Textarea } from '#/components/v3/inventory/list'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { displayModelFieldValue } from '#/lib/model-fields'
import { toast } from '#/components/v3/ui/sonner'
import { BUILT_IN_MODELS, builtInModel } from '#/lib/built-in-models'
import { notebookDataClient } from '#/lib/notebook-data'
import { createRecordModelVersion } from '#/lib/record-model-versions'
import {
  fetchTypedObjects,
  typeAncestors,
  typeDescendants,
  typeHost,
  typeRoot,
} from '#/lib/model-subtypes'
import type { ModelType, TypedObject } from '#/lib/model-subtypes'
import { useRecordModelFields } from './models-data'
import { fieldTypeName } from './built-in-model-fields'
import type { InheritedGroup } from './inherited-fields-table'
import {
  createModelSubtype,
  describeTypeError,
  modelTypeQueryKeys,
  reparentRecordModel,
  useModelTypes,
  useTypeFields,
} from './model-subtype-data'

/** A model's name from its key: a built-in model or a workspace type. */
export function modelName(types: readonly ModelType[], key: string): string {
  return (
    builtInModel(key)?.name ??
    types.find((type) => type.key === key)?.name ??
    key
  )
}

/** A key the database accepts, from the name the scientist typed. */
export function subtypeKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const key = /^[a-z]/.test(slug) ? slug : `type_${slug}`
  return key.slice(0, 60).replace(/_+$/, '') || 'type'
}

const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,7}$/

/** "Subtype of Cell culture, a subtype of Experiment", linked. */
export function SubtypeOf({ modelKey }: { modelKey: string }) {
  const types = useModelTypes().data ?? []
  const own = types.find((type) => type.key === modelKey)
  if (!own?.parentKey) return null
  const parentKey = own.parentKey
  return (
    <span>
      Subtype of{' '}
      <Link
        to="/models/$modelId"
        params={{ modelId: parentKey }}
        className="text-link hover:underline"
      >
        {modelName(types, parentKey)}
      </Link>
    </span>
  )
}

/** The direct subtypes of a model, linked, for its page header. */
export function SubtypesList({ modelKey }: { modelKey: string }) {
  const types = useModelTypes().data ?? []
  const direct = types.filter((type) => type.parentKey === modelKey)
  if (!direct.length) return null
  return (
    <span>
      Subtypes{' '}
      {direct.map((type, index) => (
        <span key={type.key}>
          {index ? ', ' : ''}
          <Link
            to="/models/$modelId"
            params={{ modelId: type.key }}
            className="text-link hover:underline"
          >
            {type.name}
          </Link>
        </span>
      ))}
    </span>
  )
}

/**
 * The fields a subtype carries from the models above it, from the top of the
 * chain down, for its fields table to list read-only above its own.
 */
export function useInheritedFieldGroups(modelKey: string): {
  groups: InheritedGroup[]
  isLoading: boolean
} {
  const types = useModelTypes()
  const own = types.data?.find((type) => type.key === modelKey)
  const parentKey = own?.parentKey ?? null
  const root = types.data && parentKey ? typeRoot(types.data, parentKey) : ''
  const inherited = useTypeFields(types.data, root, parentKey, null, {
    enabled: Boolean(parentKey),
  })
  if (!parentKey) return { groups: [], isLoading: false }
  const builtIn = builtInModel(root)
  const groups = (inherited.data ?? []).map((group) => ({
    modelId: group.modelKey,
    modelName: group.modelName,
    rows: [
      ...(group.modelKey === builtIn?.key
        ? builtIn.standardFields.map((label) => ({
            id: `${group.modelKey}:standard:${label}`,
            label,
            key: null,
            type: 'Standard',
            unit: null,
            required: '—',
          }))
        : []),
      ...group.fields.map((field) => ({
        id: `${group.modelKey}:${field.fieldName}`,
        label: field.label,
        key: field.fieldName,
        type: fieldTypeName(field).split(' · ')[0],
        unit:
          typeof field.unit?.symbol === 'string' && field.unit.symbol
            ? field.unit.symbol
            : null,
        required: field.nullable ? 'No' : 'Yes',
      })),
    ],
  }))
  return { groups, isLoading: inherited.isLoading }
}

/**
 * Make a subtype of any model. It starts with a draft v1 and opens it, so the
 * next step is adding the fields the subtype has on top of its parent's.
 */
export function NewSubtypeDialog({
  open,
  onOpenChange,
  workspaceId,
  parentKey,
  parentName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
  parentKey: string
  parentName: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const nameError = name.trim() ? undefined : 'Name is required.'
  const prefixError = PREFIX_PATTERN.test(prefix.trim())
    ? undefined
    : 'Use 1–8 upper-case letters or digits, starting with a letter.'

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('No active workspace.')
      const created = await createModelSubtype(notebookDataClient, {
        workspaceId,
        parentKey,
        key: subtypeKey(name),
        name: name.trim(),
        prefix: prefix.trim(),
        description: description.trim() || null,
      })
      await createRecordModelVersion(notebookDataClient, {
        modelId: created.id,
        reason: 'Define fields',
      })
      return created
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries()
      reset()
      onOpenChange(false)
      toast(`${name.trim()} created`, {
        description: `Add its own fields, then publish it to use it on new ${
          builtInModel(parentKey)?.plural ?? 'records'
        }.`,
      })
      void navigate({
        to: '/models/$modelId/edit',
        params: { modelId: created.key },
      })
    },
  })

  function reset() {
    setName('')
    setPrefix('')
    setDescription('')
    setSubmitted(false)
    create.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={`New subtype of ${parentName}`}
          description={`A kind of ${parentName.toLowerCase()} with fields of its own. It keeps everything ${parentName} has, and its own ID prefix.`}
        />
        <DialogBody>
          <form
            id="new-subtype-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSubmitted(true)
              if (nameError || prefixError) return
              create.mutate()
            }}
          >
            <Field
              label="Name"
              required
              error={submitted ? nameError : undefined}
            >
              <Input
                autoFocus
                value={name}
                placeholder={`e.g. Cell culture ${parentName.toLowerCase()}`}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="ID prefix"
              required
              hint="Unique in this workspace, e.g. CCX."
              error={submitted || prefix ? prefixError : undefined}
            >
              <Input
                value={prefix}
                maxLength={8}
                placeholder="CCX"
                onChange={(event) =>
                  setPrefix(event.target.value.toUpperCase())
                }
              />
            </Field>
            <Field label="Description" hint="Optional">
              <Textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {create.error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {describeTypeError(create.error)}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="new-subtype-form"
            disabled={create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create subtype'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The models a type can sit under: every built-in and every other type,
 * except itself and its own subtypes. */
export function parentChoices(
  types: readonly ModelType[],
  key: string,
): { key: string; name: string }[] {
  const below = new Set(
    typeDescendants(types, key).map((option) => option.type.key),
  )
  return [
    ...BUILT_IN_MODELS.map((model) => ({ key: model.key, name: model.name })),
    ...types
      .filter((type) => type.key !== key && !below.has(type.key))
      .map((type) => ({
        key: type.key,
        name: [...typeAncestors(types, type.key)]
          .reverse()
          .map((parent) => parent.name)
          .concat(type.name)
          .join(' › '),
      })),
  ]
}

/**
 * Move a type under another model, or out to stand on its own. Its records
 * move with it and are checked against the new parent's fields; signed
 * records keep their type, so a move that would change one is refused.
 */
export function BasedOnDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: { id: string; key: string; name: string }
}) {
  const queryClient = useQueryClient()
  const types = useModelTypes().data ?? []
  const current =
    types.find((type) => type.key === model.key)?.parentKey ?? null
  const [choice, setChoice] = useState<string>(current ?? '')
  const save = useMutation({
    mutationFn: () =>
      reparentRecordModel(notebookDataClient, model.id, choice || null),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onOpenChange(false)
      toast(
        choice
          ? `${model.name} is now a subtype of ${modelName(types, choice)}`
          : `${model.name} now stands on its own`,
      )
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setChoice(current ?? '')
          save.reset()
        }
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={`Change what ${model.name} is based on`}
          description="Its records move with it and take on the new parent’s fields. Values already recorded are kept."
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label="Based on">
              <Select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">Nothing, its own model</option>
                {parentChoices(types, model.key).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            {save.error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {describeTypeError(save.error)}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || choice === (current ?? '')}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A subtype's Records tab: its objects with its own fields as columns. They
 * open on their own pages (an experiment on the experiment page), and new
 * ones are made where the model at the top of the chain makes them.
 */
/** The objects given one type, for its Records tab and count. */
export function useTypedObjects(modelKey: string) {
  const types = useModelTypes()
  const type = types.data?.find((t) => t.key === modelKey) ?? null
  const objects = useQuery({
    queryKey: [...modelTypeQueryKeys.all, 'objects', modelKey],
    queryFn: () =>
      type && types.data
        ? fetchTypedObjects(notebookDataClient, types.data, type)
        : [],
    enabled: Boolean(type?.parentKey),
    staleTime: 15_000,
  })
  return { types, type, objects }
}

export function SubtypeObjects({ modelKey }: { modelKey: string }) {
  const { types, type, objects } = useTypedObjects(modelKey)
  const fields = useRecordModelFields(modelKey)
  const host = type && types.data ? typeHost(types.data, type.key) : null
  const surface = host?.builtIn?.surface ?? null
  const rows = objects.data ?? []
  const own = fields.data ?? []
  const columns: RegistryColumn<TypedObject>[] = [
    {
      id: 'identifier',
      header: 'ID',
      cell: ({ row }) => (
        <Link to={row.original.href} className="mono text-link">
          {row.original.identifier}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => row.original.name,
    },
    ...own.map<RegistryColumn<TypedObject>>((field) => ({
      id: `field:${field.fieldName}`,
      header: field.label,
      cell: ({ row }) =>
        displayModelFieldValue(
          field,
          row.original.customFields[field.fieldName],
        ) || '—',
    })),
  ]
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4 md:px-6">
      {surface ? (
        <div className="flex items-center gap-2">
          <Muted className="flex-1">
            Make a new {type?.name ?? 'one'} from {surface.label} and pick it as
            the type.
          </Muted>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to={surface.to} />}
          >
            Open {surface.label}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            nativeButton={false}
            render={
              <Link
                to="/models/$modelId/records/new"
                params={{ modelId: modelKey }}
              />
            }
          >
            New {type?.name ?? 'record'}
          </Button>
        </div>
      )}
      {rows.length || objects.isLoading ? (
        <TableBox>
          <RegistryGrid
            label={`${type?.name ?? 'Subtype'} records`}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          icon="table"
          title={`No ${type?.name ?? 'records'} yet`}
          description={`Records given this type show here, with its own fields.`}
        />
      )}
    </div>
  )
}
