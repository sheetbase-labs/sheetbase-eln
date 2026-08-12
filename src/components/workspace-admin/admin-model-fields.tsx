import { useEffect, useState } from 'react'
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
import { fetchModelFieldsWithUsage, fetchModelKinds } from '#/lib/model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from '#/lib/model-fields'

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
  const [editForm, setEditForm] = useState({
    label: '',
    description: '',
    displayOrder: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    key: '',
    label: '',
    type: 'text' as ModelFieldLogicalType,
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

  const create = useMutation({
    mutationFn: async () => {
      const validation =
        form.type === 'reference' ? { targetModelKey: form.targetModelKey } : {}
      const parsedDefault =
        form.defaultValue === ''
          ? null
          : form.type === 'integer' || form.type === 'decimal'
            ? Number(form.defaultValue)
            : form.type === 'boolean'
              ? form.defaultValue === 'true'
              : form.defaultValue
      const options =
        form.type === 'category'
          ? form.options
              .split(',')
              .map((option) => option.trim())
              .filter(Boolean)
              .map((option) => ({ key: option, label: option }))
          : []
      await client.rpc('create_and_activate_model_field', {
        p_workspace_id: workspaceId,
        p_model_key: modelKey,
        p_field_name: form.key,
        p_label: form.label,
        p_logical_type: form.type,
        p_nullable: !form.required,
        p_default_value: parsedDefault,
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
  const retire = useMutation({
    mutationFn: (id: string) =>
      client.rpc('retire_model_field', { p_definition_id: id }),
    onSuccess: invalidate,
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not retire the field.',
      ),
  })
  const update = useMutation({
    mutationFn: () => {
      if (!editingField) throw new Error('No field selected.')
      return client.rpc('update_model_field', {
        p_definition_id: editingField.id,
        p_patch: {
          label: editForm.label.trim(),
          description: editForm.description.trim() || null,
          displayOrder: editForm.displayOrder,
        },
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
            {fields.map((field) => (
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
                        disabled={!canManage || retire.isPending}
                        onClick={() => retire.mutate(field.id)}
                      >
                        Retire
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
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
                (form.type === 'category' && !form.options.trim())
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
    </div>
  )
}
