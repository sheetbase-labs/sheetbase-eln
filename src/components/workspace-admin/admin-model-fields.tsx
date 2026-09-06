import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LockKeyhole, Pencil, Plus } from 'lucide-react'

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import {
  fieldDefinitionFromModelField,
  validateFieldDefinition,
} from '#/lib/field-definition'
import { fetchModelFieldsWithUsage, fetchModelKinds } from '#/lib/model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from '#/lib/model-fields'
import { discoverObjectDependencies } from '#/lib/object-dependencies'
import {
  applyModelFieldEvolution,
  previewModelFieldEvolution,
} from '#/lib/schema-evolution'
const TYPES: Array<{ value: ModelFieldLogicalType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'decimal', label: 'Decimal number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'timestamp', label: 'Date and time' },
  { value: 'category', label: 'Category' },
  { value: 'reference', label: 'Record reference' },
]
interface AddFieldForm {
  key: string
  label: string
  type: ModelFieldLogicalType
  description: string
  required: boolean
  defaultValue: string
  unitSymbol: string
  options: string
  targetModelKey: string
}

function parseCategoryOptionKeys(input: string): string[] {
  return input
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
}

function parseDefaultValue(
  type: ModelFieldLogicalType,
  raw: string,
): unknown {
  if (raw === '') return null
  if (type === 'integer' || type === 'decimal') return Number(raw)
  if (type === 'boolean') return raw === 'true'
  return raw
}

/**
 * Project the Add-field dialog state through the same canonical adapter the
 * persisted fields use, so inline feedback is the kernel contract
 * (validateFieldDefinition) rather than a second rules engine.
 */
function draftDefinitionFromForm(form: AddFieldForm) {
  const targetModelKey = form.targetModelKey.trim()
  return fieldDefinitionFromModelField({
    id: 'draft',
    fieldName: form.key.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    logicalType: form.type,
    nullable: !form.required,
    defaultValue: parseDefaultValue(form.type, form.defaultValue),
    unit:
      (form.type === 'integer' || form.type === 'decimal') &&
      form.unitSymbol.trim()
        ? { symbol: form.unitSymbol.trim() }
        : null,
    validation: form.type === 'reference' ? { targetModelKey } : {},
    relationship:
      form.type === 'reference' && targetModelKey
        ? {
            target: { kind: 'model', modelKey: targetModelKey },
            cardinality: 'one',
          }
        : null,
    lifecycle: 'active',
    options: parseCategoryOptionKeys(form.options).map((key, index) => ({
      id: `draft-${index}`,
      key,
      label: key,
      displayOrder: index,
      lifecycle: 'active' as const,
    })),
  })
}


/**
 * Dependency list reusing the ConfigurationWorkspace impact-panel shape
 * (label · liveness · effect) for model_field discovery.
 */
function ModelFieldImpactList({
  dependencies,
}: {
  dependencies: Array<{
    kind: string
    id: string
    relation: string
    liveness: string
    effect: string
    label: string
  }>
}) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">Dependency impact</h3>
      {dependencies.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No dependants.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {dependencies.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              {item.label} · {item.liveness} · {item.effect}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UpdateEvolutionCheck({
  client,
  definitionId,
  patch,
}: {
  client: DataClient
  definitionId: string
  patch: Record<string, unknown>
}) {
  const serialized = JSON.stringify(patch)
  const previewQuery = useQuery({
    queryKey: [
      'model-fields-admin',
      'evolution',
      definitionId,
      'update',
      serialized,
    ],
    queryFn: () =>
      previewModelFieldEvolution(client, {
        definitionId,
        action: 'update',
        patch: JSON.parse(serialized) as Record<string, unknown>,
      }),
  })
  const preview = previewQuery.data
  if (previewQuery.isLoading) {
    return (
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Checking evolution impact…
      </p>
    )
  }
  if (previewQuery.isError || !preview) {
    return (
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Evolution preview unavailable — saving still runs the server gate.
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground sm:col-span-2">
      Evolution check: {String(preview.classification ?? 'unknown')}
      {typeof preview.reason === 'string' && preview.reason
        ? ` — ${preview.reason}`
        : null}
      {preview.blocked ? ' (blocked)' : null}
    </p>
  )
}

function RetireFieldDialog({
  client,
  field,
  onClose,
  onRetired,
}: {
  client: DataClient
  field: ModelFieldDefinition & { usageCount: number }
  onClose: () => void
  onRetired: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const previewQuery = useQuery({
    queryKey: ['model-fields-admin', 'evolution', field.id, 'retire'],
    queryFn: () =>
      previewModelFieldEvolution(client, {
        definitionId: field.id,
        action: 'retire',
      }),
  })
  const impactQuery = useQuery({
    queryKey: ['model-fields-admin', 'impact', field.id],
    queryFn: () => discoverObjectDependencies(client, 'model_field', field.id),
  })
  const preview = previewQuery.data
  const dependencies = impactQuery.data?.dependencies ?? []
  const blocked = preview?.blocked === true
  const apply = useMutation({
    mutationFn: () =>
      applyModelFieldEvolution(client, {
        definitionId: field.id,
        action: 'retire',
        confirm: true,
      }),
    onSuccess: () => {
      setError(null)
      onRetired()
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not retire the field.',
      ),
  })
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire {field.label}</DialogTitle>
          <DialogDescription>
            Retiring keeps stored values but locks the field for new and edited
            records. Review the impact before confirming.
          </DialogDescription>
        </DialogHeader>
        {previewQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">
            Previewing evolution impact…
          </p>
        ) : previewQuery.isError || !preview ? (
          <p className="text-xs text-muted-foreground">
            Evolution preview unavailable — confirming still runs the server
            gate.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Evolution check: {String(preview.classification ?? 'unknown')}
            {typeof preview.reason === 'string' && preview.reason
              ? ` — ${preview.reason}`
              : null}
            {blocked ? ' (blocked)' : null} · {field.usageCount}{' '}
            {field.usageCount === 1 ? 'record carries' : 'records carry'} a
            value.
          </p>
        )}
        <ModelFieldImpactList dependencies={dependencies} />
        <p className="mt-4 text-xs">
          <a
            className="text-primary underline-offset-4 hover:underline"
            href="/samples"
            aria-label={`Preview ${field.label} in Records`}
          >
            Preview in Records
          </a>
        </p>
        {blocked ? (
          <p role="alert" className="text-sm text-destructive">
            This retire is blocked by the evolution gate
            {typeof preview?.reason === 'string' && preview.reason
              ? `: ${preview.reason}`
              : '.'}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              apply.isPending || previewQuery.isLoading || blocked
            }
            onClick={() => apply.mutate()}
          >
            Confirm retire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


export function AdminModelFields({
  client,
  workspaceId,
  canManage,
  selectedModelKey,
  onSelectedModelKeyChange,
}: {
  client: DataClient
  workspaceId: string
  canManage: boolean
  selectedModelKey?: string
  onSelectedModelKeyChange?: (modelKey: string) => void
}) {
  const queryClient = useQueryClient()
  const [internalModelKey, setInternalModelKey] = useState('sample')
  const modelKey = selectedModelKey ?? internalModelKey
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<
    (ModelFieldDefinition & { usageCount: number }) | null
  >(null)
  const [retiringField, setRetiringField] = useState<
    (ModelFieldDefinition & { usageCount: number }) | null
  >(null)
  const [editForm, setEditForm] = useState({
    label: '',
    description: '',
    displayOrder: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<AddFieldForm>({
    key: '',
    label: '',
    type: 'text',
    description: '',
    required: false,
    defaultValue: '',
    unitSymbol: '',
    options: '',
    targetModelKey: 'sample',
  })
  const modelsQuery = useQuery({
    queryKey: ['model-fields-admin', 'models'],
    queryFn: () => fetchModelKinds(client),
  })
  const fieldsQuery = useQuery({
    queryKey: ['model-fields-admin', modelKey],
    queryFn: () => fetchModelFieldsWithUsage(client, modelKey),
  })
  const baseFieldsQuery = useQuery({
    queryKey: ['model-fields-admin', modelKey, 'base'],
    queryFn: () =>
      client.list<{
        field_key: string
        label: string
        presentation: { editor?: boolean }
      }>('model_base_fields', `?model_key=eq.${modelKey}&order=field_key.asc`),
  })
  const models = modelsQuery.data ?? []
  const fields = fieldsQuery.data ?? []
  const baseFields = (baseFieldsQuery.data ?? []).filter(
    (field) => field.presentation.editor === true,
  )

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.key === modelKey)) {
      const fallback = models[0].key
      setInternalModelKey(fallback)
      onSelectedModelKeyChange?.(fallback)
    }
  }, [modelKey, models, onSelectedModelKeyChange])

  function selectModel(nextModelKey: string) {
    setInternalModelKey(nextModelKey)
    onSelectedModelKeyChange?.(nextModelKey)
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['model-fields-admin'] })
    void queryClient.invalidateQueries({ queryKey: ['model-fields'] })
  }

  const draftIssues = useMemo(() => {
    const issues = validateFieldDefinition(draftDefinitionFromForm(form))
    const key = form.key.trim()
    if (key) {
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
        issues.push({
          path: 'key',
          message:
            'Stable key must match ^[a-z][a-z0-9_]{0,62}$ — the server rejects anything else.',
        })
      } else if (
        baseFields.some((field) => field.field_key === key) ||
        fields.some((field) => field.fieldName === key)
      ) {
        issues.push({
          path: 'key',
          message: `Stable key "${key}" is already in use — the server rejects protected and duplicate custom field keys.`,
        })
      }
    }
    if (
      form.type === 'category' &&
      parseCategoryOptionKeys(form.options).length === 0
    ) {
      issues.push({
        path: 'category',
        message:
          'Category needs an active option — the server rejects activation without one.',
      })
    }
    return issues
  }, [form, baseFields, fields])

  const create = useMutation({
    mutationFn: async () => {
      const validation =
        form.type === 'reference'
          ? { targetModelKey: form.targetModelKey.trim() }
          : {}
      const options =
        form.type === 'category'
          ? parseCategoryOptionKeys(form.options).map((option) => ({
              key: option,
              label: option,
            }))
          : []
      await client.rpc('create_and_activate_model_field', {
        p_workspace_id: workspaceId,
        p_model_key: modelKey,
        p_field_name: form.key.trim(),
        p_label: form.label.trim(),
        p_logical_type: form.type,
        p_nullable: !form.required,
        p_default_value: parseDefaultValue(form.type, form.defaultValue),
        p_validation: validation,
        p_options: options,
        p_unit:
          (form.type === 'integer' || form.type === 'decimal') &&
          form.unitSymbol.trim()
            ? { symbol: form.unitSymbol.trim() }
            : null,
        p_description: form.description.trim() || null,
      })
    },
    onSuccess: () => {
      setError(null)
      setDialogOpen(false)
      setForm({
        key: '',
        label: '',
        type: 'text',
        description: '',
        required: false,
        defaultValue: '',
        unitSymbol: '',
        options: '',
        targetModelKey: 'sample',
      })
      invalidate()
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not add the field.',
      ),
  })
  const update = useMutation({
    mutationFn: async () => {
      if (!editingField) throw new Error('No field selected.')
      const patch: Record<string, unknown> = {
        label: editForm.label.trim(),
        description: editForm.description.trim() || null,
        displayOrder: editForm.displayOrder,
      }
      const preview = await previewModelFieldEvolution(client, {
        definitionId: editingField.id,
        action: 'update',
        patch,
      })
      if (preview.blocked === true) {
        throw new Error(
          typeof preview.reason === 'string' && preview.reason
            ? `Change blocked: ${preview.reason}`
            : 'Change blocked by the evolution gate.',
        )
      }
      return applyModelFieldEvolution(client, {
        definitionId: editingField.id,
        action: 'update',
        patch,
        confirm: true,
      })
    },
    onSuccess: () => {
      setError(null)
      setEditingField(null)
      invalidate()
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not update the field.',
      ),
  })

  function beginEditing(field: ModelFieldDefinition & { usageCount: number }) {
    setEditingField(field)
    setEditForm({
      label: field.label,
      description: field.description ?? '',
      displayOrder: field.displayOrder,
    })
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 flex-wrap items-end gap-4">
          <Label className="w-56 text-xs font-medium text-muted-foreground">
            Model
            <Select
              className="mt-1 bg-background text-foreground"
              aria-label="Model"
              value={modelKey}
              onChange={(event) => selectModel(event.target.value)}
              disabled={modelsQuery.isLoading || models.length === 0}
            >
              {!models.some((model) => model.key === modelKey) ? (
                <option value={modelKey}>
                  {modelKey.replaceAll('_', ' ')}
                </option>
              ) : null}
              {models.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </Select>
          </Label>
          <p className="pb-1 text-sm text-muted-foreground">
            {baseFields.length} system{' '}
            {baseFields.length === 1 ? 'field' : 'fields'} · {fields.length}{' '}
            workspace {fields.length === 1 ? 'field' : 'fields'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden max-w-md text-right text-xs text-muted-foreground lg:block">
            Locked fields preserve the model contract. Workspace fields can be
            edited or retired without deleting stored values.
          </p>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={!canManage}
          >
            <Plus className="size-3.5" /> Add field
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden lg:table-cell">Required</TableHead>
              <TableHead className="hidden xl:table-cell">Usage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell
                colSpan={6}
                className="h-8 py-1 text-xs font-semibold text-muted-foreground"
              >
                System fields
              </TableCell>
            </TableRow>
            {baseFields.map((field) => (
              <TableRow
                key={`base:${field.field_key}`}
                className="bg-muted/15 hover:bg-muted/25"
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <LockKeyhole
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Locked system field"
                    />
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <p className="font-mono text-[0.65rem] text-muted-foreground">
                        {field.field_key}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  Built in
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  System governed
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">
                  Every record
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="gap-1 text-muted-foreground"
                  >
                    <LockKeyhole className="size-3" /> Locked
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-xs text-muted-foreground">
                    Read only
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {!baseFieldsQuery.isLoading && baseFields.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-destructive"
                >
                  The protected system-field registry is incomplete for this
                  model. Workspace fields cannot be governed safely until it is
                  repaired.
                </TableCell>
              </TableRow>
            ) : null}
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell
                colSpan={6}
                className="h-8 py-1 text-xs font-semibold text-muted-foreground"
              >
                Workspace fields
              </TableCell>
            </TableRow>
            {fields.map((field) => {
              const target = field.relationship?.target
              const targetModelKey =
                target?.kind === 'model' && target.modelKey.trim()
                  ? target.modelKey
                  : typeof field.validation.targetModelKey === 'string' &&
                      field.validation.targetModelKey.trim()
                    ? field.validation.targetModelKey
                    : null
              return (
              <TableRow key={field.id}>
                <TableCell>
                  <p className="font-medium">{field.label}</p>
                  <p className="font-mono text-[0.65rem] text-muted-foreground">
                    {field.fieldName}
                  </p>
                  {field.description ? (
                    <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                      {field.description}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    <a
                      className="text-primary underline-offset-4 hover:underline"
                      href="/samples"
                      aria-label={`Preview ${field.label} in Records`}
                    >
                      Preview in Records
                    </a>
                    {field.logicalType === 'reference' && targetModelKey ? (
                      <a
                        className="text-primary underline-offset-4 hover:underline"
                        href={`/configure?kind=model&model=${encodeURIComponent(targetModelKey)}`}
                        aria-label={`Open referenced model for ${field.label}`}
                      >
                        Open referenced model
                      </a>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  {
                    TYPES.find((type) => type.value === field.logicalType)
                      ?.label
                  }
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {field.nullable ? 'No' : 'Yes'}
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  {field.usageCount} records
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      field.lifecycle === 'active' ? 'success' : 'secondary'
                    }
                    className="capitalize"
                  >
                    {field.lifecycle}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${field.label}`}
                      disabled={!canManage}
                      onClick={() => beginEditing(field)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    {field.lifecycle === 'active' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canManage}
                        onClick={() => setRetiringField(field)}
                      >
                        Retire
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
              )
            })}
            {!fieldsQuery.isLoading && fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <p className="font-medium">No workspace fields yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add a field to extend this model without changing its locked
                    system structure.
                  </p>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add workspace field</DialogTitle>
            <DialogDescription>
              The key and type become immutable after activation. Required
              fields need a default when existing records do not have a value.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="text-xs text-muted-foreground">
              Label
              <Input
                className="mt-1"
                value={form.label}
                onChange={(event) =>
                  setForm({ ...form, label: event.target.value })
                }
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Stable key
              <Input
                className="mt-1 font-mono"
                value={form.key}
                onChange={(event) =>
                  setForm({
                    ...form,
                    key: event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, '_'),
                  })
                }
                placeholder="therapeutic_area"
              />
            </Label>
            <Label className="text-xs text-muted-foreground sm:col-span-2">
              Description
              <Input
                className="mt-1"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="How this property should be used"
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Type
              <Select
                className="mt-1"
                value={form.type}
                onChange={(event) =>
                  setForm({
                    ...form,
                    type: event.target.value as ModelFieldLogicalType,
                  })
                }
              >
                {TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label className="text-xs text-muted-foreground">
              Default value
              <Input
                className="mt-1"
                value={form.defaultValue}
                onChange={(event) =>
                  setForm({ ...form, defaultValue: event.target.value })
                }
              />
            </Label>
            {form.type === 'integer' || form.type === 'decimal' ? (
              <Label className="text-xs text-muted-foreground">
                Unit symbol
                <Input
                  className="mt-1"
                  value={form.unitSymbol}
                  onChange={(event) =>
                    setForm({ ...form, unitSymbol: event.target.value })
                  }
                  placeholder="mg/mL"
                />
              </Label>
            ) : null}
            {form.type === 'category' ? (
              <Label className="text-xs text-muted-foreground sm:col-span-2">
                Options, separated by commas
                <Input
                  className="mt-1"
                  value={form.options}
                  onChange={(event) =>
                    setForm({ ...form, options: event.target.value })
                  }
                />
              </Label>
            ) : null}
            {form.type === 'reference' ? (
              <Label className="text-xs text-muted-foreground sm:col-span-2">
                Referenced record model
                <Select
                  className="mt-1"
                  value={form.targetModelKey}
                  onChange={(event) =>
                    setForm({ ...form, targetModelKey: event.target.value })
                  }
                >
                  {models
                    .filter((model) => model.identityTable === 'api.records')
                    .map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.label}
                      </option>
                    ))}
                </Select>
              </Label>
            ) : null}
            <Label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={form.required}
                onCheckedChange={(checked) =>
                  setForm({ ...form, required: checked === true })
                }
              />
              Required for new and editable records
            </Label>
            {draftIssues.length > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs sm:col-span-2"
              >
                <p className="font-medium">Resolve before adding</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {draftIssues.map((issue) => (
                    <li key={`${issue.path}:${issue.message}`}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Field contract valid — the key and type lock on activation.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                create.isPending ||
                !form.label.trim() ||
                !form.key.trim() ||
                (form.type === 'category' && !form.options.trim()) ||
                draftIssues.length > 0
              }
              onClick={() => create.mutate()}
            >
              Add and activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingField !== null}
        onOpenChange={(open) => {
          if (!open) setEditingField(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit workspace field</DialogTitle>
            <DialogDescription>
              The stable key and type are locked after activation. Labels,
              descriptions and display order can be updated without changing
              stored values.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="text-xs text-muted-foreground">
              Label
              <Input
                className="mt-1"
                value={editForm.label}
                onChange={(event) =>
                  setEditForm({ ...editForm, label: event.target.value })
                }
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Display order
              <Input
                className="mt-1"
                type="number"
                value={editForm.displayOrder}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    displayOrder: Number(event.target.value),
                  })
                }
              />
            </Label>
            <Label className="text-xs text-muted-foreground sm:col-span-2">
              Description
              <Input
                className="mt-1"
                value={editForm.description}
                onChange={(event) =>
                  setEditForm({ ...editForm, description: event.target.value })
                }
              />
            </Label>
            <div className="rounded-md border bg-muted/30 p-3 text-xs sm:col-span-2">
              <p className="font-medium">Locked contract</p>
              <p className="mt-1 text-muted-foreground">
                Key: <code>{editingField?.fieldName}</code> · Type:{' '}
                {editingField
                  ? TYPES.find(
                      (type) => type.value === editingField.logicalType,
                    )?.label
                  : null}
              </p>
            </div>
            {editingField ? (
              <UpdateEvolutionCheck
                client={client}
                definitionId={editingField.id}
                patch={{
                  label: editForm.label.trim(),
                  description: editForm.description.trim() || null,
                  displayOrder: editForm.displayOrder,
                }}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingField(null)}>
              Cancel
            </Button>
            <Button
              disabled={update.isPending || !editForm.label.trim()}
              onClick={() => update.mutate()}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {retiringField ? (
        <RetireFieldDialog
          client={client}
          field={retiringField}
          onClose={() => setRetiringField(null)}
          onRetired={() => {
            setRetiringField(null)
            invalidate()
          }}
        />
      ) : null}
    </div>
  )
}
