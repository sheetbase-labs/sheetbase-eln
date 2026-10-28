import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { Textarea } from '#/components/v3/inventory/list'
import {
  RegistryGrid,
  bandRow,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/v3/inventory/registry-grid'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { fieldKeyFromLabel } from '#/lib/built-in-models'
import type { BuiltInModel } from '#/lib/built-in-models'
import {
  displayModelFieldValue,
  parseModelFieldInput,
} from '#/lib/model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from '#/lib/model-fields'
import { notebookDataClient } from '#/lib/notebook-data'
import { useDataAccess } from '#/lib/data-access'
import { useReportingNames } from '#/lib/data-access-names'
import { reportingColumnName } from '#/lib/data-access-handles'
import {
  builtInModelQueryKeys,
  createBuiltInModelField,
  describeFieldAuthoringError,
  retireBuiltInModelField,
  updateBuiltInModelField,
  useBuiltInModelFields,
  useTakenFieldKeys,
} from './built-in-model-data'
import { modelsQueryKeys } from './models-data'

type AuthoredType = Exclude<ModelFieldLogicalType, 'reference'>

const TYPE_LABELS: Record<ModelFieldLogicalType, string> = {
  text: 'Text',
  decimal: 'Number',
  integer: 'Whole number',
  boolean: 'Yes / no',
  date: 'Date',
  timestamp: 'Date and time',
  category: 'Choice',
  reference: 'Link to a record',
}

const AUTHORED_TYPES: AuthoredType[] = [
  'text',
  'decimal',
  'integer',
  'boolean',
  'date',
  'timestamp',
  'category',
]

export function fieldTypeName(field: ModelFieldDefinition): string {
  const unit =
    typeof field.unit?.symbol === 'string' && field.unit.symbol
      ? ` · ${field.unit.symbol}`
      : ''
  return `${TYPE_LABELS[field.logicalType]}${unit}`
}

/** Where an added field appears, in the words the inspector uses. */
export function fieldShowsOn(field: ModelFieldDefinition): string {
  return [
    'Record page',
    ...(field.askOnCreate !== false ? ['create form'] : []),
    ...(field.showInList ? ['list column'] : []),
  ].join(', ')
}

/** "an experiment", "a sample". */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

interface FieldRow {
  id: string
  label: string
  standard: boolean
  field?: ModelFieldDefinition
}

/**
 * Fields tab for a built-in model (Experiment, Sample…): the standard fields
 * every record has, which stay fixed, and the fields this workspace added,
 * which an owner, admin or steward can add, rename, place and retire.
 */
export function BuiltInModelFields({
  model,
  workspaceId,
  canEdit,
  addOpen,
  onAddOpenChange,
}: {
  model: BuiltInModel
  workspaceId: string | null
  canEdit: boolean
  addOpen: boolean
  onAddOpenChange: (open: boolean) => void
}) {
  const fields = useBuiltInModelFields(model.key, { includeRetired: true })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<ModelFieldDefinition | null>(null)
  const [retiring, setRetiring] = useState<ModelFieldDefinition | null>(null)
  const queryClient = useQueryClient()
  const added = fields.data ?? []
  const active = added.filter((field) => field.lifecycle !== 'retired')
  const retired = added.filter((field) => field.lifecycle === 'retired')
  const sections = [
    ...new Set(active.map((field) => field.section).filter(Boolean)),
  ] as string[]

  const toRow = (field: ModelFieldDefinition): FieldRow => ({
    id: field.id,
    label: field.label,
    standard: false,
    field,
  })
  const rows: RegistryRow<FieldRow>[] = [
    bandRow('Added by your workspace', active.length),
    ...active.map(toRow),
    ...(retired.length
      ? [bandRow('No longer used', retired.length), ...retired.map(toRow)]
      : []),
    bandRow('Standard', model.standardFields.length),
    ...model.standardFields.map((label) => ({
      id: `standard:${label}`,
      label,
      standard: true,
    })),
  ]
  const sel =
    added.find((field) => field.id === selected) ??
    (selected === null ? active.at(0) : undefined)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    setSelected,
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: builtInModelQueryKeys.all,
    })
    void queryClient.invalidateQueries({ queryKey: modelsQueryKeys.list })
  }

  const retire = useMutation({
    mutationFn: (field: ModelFieldDefinition) =>
      retireBuiltInModelField(notebookDataClient, field.id),
    onSuccess: (_, field) => {
      invalidate()
      setRetiring(null)
      toast(`“${field.label}” is no longer used`, {
        description: 'Values already recorded stay on their records.',
      })
    },
  })

  const dataAccess = useDataAccess()
  const names = useReportingNames()
  const columns: RegistryColumn<FieldRow>[] = [
    {
      id: 'field',
      header: 'Field',
      cell: ({ row }) =>
        row.original.standard ? (
          <span className="text-fg-muted">{row.original.label}</span>
        ) : (
          <span className="font-medium">{row.original.label}</span>
        ),
    },
    ...(dataAccess
      ? [
          {
            id: 'key',
            header: 'Key',
            cell: ({ row }) =>
              row.original.field ? (
                <span className="mono text-fg-muted">
                  {row.original.field.fieldName}
                  <span className="text-fg-faint">
                    {' · '}
                    {reportingColumnName(
                      model.key,
                      row.original.field.fieldName,
                      names,
                    )}
                  </span>
                </span>
              ) : (
                <span className="text-fg-muted">—</span>
              ),
          } satisfies RegistryColumn<FieldRow>,
        ]
      : []),
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) =>
        row.original.field ? (
          fieldTypeName(row.original.field)
        ) : (
          <span className="text-fg-muted">Built in</span>
        ),
    },
    {
      id: 'required',
      header: 'Required',
      cell: ({ row }) =>
        row.original.field ? (
          row.original.field.nullable ? (
            'Optional'
          ) : (
            'Required'
          )
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      id: 'shows',
      header: 'Shows on',
      cell: ({ row }) =>
        row.original.field && row.original.field.lifecycle !== 'retired' ? (
          <span className="text-fg-muted">
            {fieldShowsOn(row.original.field)}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      id: 'section',
      header: 'Heading',
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.field?.section ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4 md:px-6">
        {!fields.isLoading && active.length === 0 ? (
          <Muted>
            Every {model.name.toLowerCase()} has the standard fields below. Add
            your own to record anything else your lab tracks; they appear on
            each {model.name.toLowerCase()}’s page and, if you choose, on the
            create form and as a list column.
          </Muted>
        ) : null}
        {fields.isError ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            The fields could not be loaded. Check the connection and try again.
          </p>
        ) : null}
        <TableBox>
          <RegistryGrid
            label={`${model.name} fields`}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            rowSelection={rowSelection}
            onRowSelectionChange={(updater) => {
              const next =
                typeof updater === 'function' ? updater(rowSelection) : updater
              // Standard fields have nothing to inspect.
              if (Object.keys(next).some((key) => key.startsWith('standard:')))
                return
              onRowSelectionChange(updater)
            }}
            isLoading={fields.isLoading}
          />
        </TableBox>
      </div>

      {sel ? (
        <Inspector aria-label="Field details" className="w-[320px]">
          <InspectorSection title={sel.label}>
            {sel.description ? <Muted>{sel.description}</Muted> : null}
          </InspectorSection>
          <InspectorSection title="Definition">
            <DescriptionList
              labelWidth={100}
              items={[
                ['Type', fieldTypeName(sel)],
                ...(sel.logicalType === 'category'
                  ? [
                      [
                        'Choices',
                        sel.options
                          .filter((option) => option.lifecycle !== 'retired')
                          .map((option) => option.label)
                          .join(', ') || '—',
                      ] as [string, string],
                    ]
                  : []),
                ['Required', sel.nullable ? 'Optional' : 'Required'],
                [
                  'Starting value',
                  sel.defaultValue == null
                    ? 'None'
                    : displayModelFieldValue(sel, sel.defaultValue),
                ],
                [
                  'Status',
                  <Status
                    key="status"
                    tone={sel.lifecycle === 'retired' ? 'stored' : 'ok'}
                  >
                    {sel.lifecycle === 'retired' ? 'No longer used' : 'In use'}
                  </Status>,
                ],
              ]}
            />
          </InspectorSection>
          {sel.lifecycle !== 'retired' ? (
            <InspectorSection title="Where it shows">
              <DescriptionList
                labelWidth={100}
                items={[
                  ['Heading', sel.section ?? `${model.name} details`],
                  ['Shows on', fieldShowsOn(sel)],
                ]}
              />
            </InspectorSection>
          ) : null}
          {canEdit && sel.lifecycle !== 'retired' ? (
            <div className="flex gap-2">
              <Button icon="edit" onClick={() => setEditing(sel)}>
                Edit
              </Button>
              <Button variant="quiet" onClick={() => setRetiring(sel)}>
                Stop using
              </Button>
            </div>
          ) : null}
          {sel.lifecycle !== 'retired' ? (
            <Muted>
              The type and whether it is required can’t change once a field is
              in use. To change them, stop using this field and add a new one.
            </Muted>
          ) : null}
        </Inspector>
      ) : null}

      {addOpen ? (
        <BuiltInFieldDialog
          model={model}
          workspaceId={workspaceId}
          sections={sections}
          onClose={() => onAddOpenChange(false)}
          onSaved={(id) => {
            invalidate()
            setSelected(id)
            onAddOpenChange(false)
          }}
        />
      ) : null}
      {editing ? (
        <BuiltInFieldDialog
          model={model}
          workspaceId={workspaceId}
          sections={sections}
          field={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate()
            setEditing(null)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(retiring)}
        onOpenChange={(open) => {
          if (!open) setRetiring(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              Stop using “{retiring?.label}”?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              It disappears from forms and lists. Values already recorded stay
              on their {model.plural} and in their history. This can’t be
              undone, but you can add a new field with the same name.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          {retire.isError ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {describeFieldAuthoringError(retire.error)}
            </p>
          ) : null}
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={retire.isPending}
              onClick={() => {
                if (retiring) retire.mutate(retiring)
              }}
            >
              Stop using
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

/** Choice labels from the textarea, one per line, without repeats. */
export function parseChoices(
  text: string,
): Array<{ key: string; label: string }> {
  const taken = new Set<string>()
  const choices: Array<{ key: string; label: string }> = []
  for (const line of text.split('\n')) {
    const label = line.trim()
    if (!label || choices.some((choice) => choice.label === label)) continue
    const key = fieldKeyFromLabel(label, taken)
    taken.add(key)
    choices.push({ key, label })
  }
  return choices
}

/**
 * Add a field to a built-in model, or edit one already in use. Editing keeps
 * to what can change on a live field: its name, help text and placement.
 */
function BuiltInFieldDialog({
  model,
  workspaceId,
  sections,
  field,
  onClose,
  onSaved,
}: {
  model: BuiltInModel
  workspaceId: string | null
  sections: string[]
  field?: ModelFieldDefinition
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = Boolean(field)
  const taken = useTakenFieldKeys(model.key)
  const [label, setLabel] = useState(field?.label ?? '')
  const [description, setDescription] = useState(field?.description ?? '')
  const [type, setType] = useState<AuthoredType>('text')
  const [unit, setUnit] = useState('')
  const [choices, setChoices] = useState('')
  const [required, setRequired] = useState(false)
  const [startValue, setStartValue] = useState<string | boolean>('')
  const [section, setSection] = useState(field?.section ?? '')
  const [askOnCreate, setAskOnCreate] = useState(field?.askOnCreate ?? true)
  const [showInList, setShowInList] = useState(field?.showInList ?? false)
  const [submitted, setSubmitted] = useState(false)

  const options = useMemo(() => parseChoices(choices), [choices])
  // A stand-in definition so the starting value uses the same input the
  // record pages will.
  const draft: ModelFieldDefinition = {
    id: 'draft',
    modelKey: model.key,
    fieldName: 'draft',
    label: 'Starting value',
    description: null,
    displayOrder: 0,
    logicalType: type,
    nullable: true,
    defaultValue: null,
    unit: unit ? { symbol: unit } : null,
    validation: {},
    lifecycle: 'draft',
    options: options.map((option, index) => ({
      id: option.key,
      key: option.key,
      label: option.label,
      displayOrder: index + 1,
      lifecycle: 'active',
    })),
  }

  const labelError = !label.trim()
    ? 'Give the field a name.'
    : label.trim().length > 200
      ? 'Keep the name under 200 characters.'
      : undefined
  const choicesError =
    !editing && type === 'category' && options.length === 0
      ? 'Add at least one choice, one per line.'
      : undefined
  const startError =
    !editing && required && type !== 'boolean' && startValue === ''
      ? `A required field needs a starting value for the ${model.plural} that already exist.`
      : undefined
  const blocking = labelError ?? choicesError ?? startError

  const save = useMutation({
    mutationFn: async () => {
      const placement = {
        section: section.trim() || null,
        askOnCreate,
        showInList,
      }
      if (field) {
        await updateBuiltInModelField(notebookDataClient, field.id, {
          label: label.trim(),
          description: description.trim() || null,
          ...placement,
        })
        return field.id
      }
      if (!workspaceId) throw new Error('No active workspace.')
      const keys = taken.data ?? new Set<string>()
      return createBuiltInModelField(notebookDataClient, {
        workspaceId,
        modelKey: model.key,
        fieldName: fieldKeyFromLabel(label.trim(), keys),
        label: label.trim(),
        description: description.trim() || null,
        logicalType: type,
        required,
        // An unticked optional yes/no field starts empty, not as "No".
        defaultValue:
          type === 'boolean'
            ? startValue === true || (required ? false : null)
            : startValue === ''
              ? null
              : parseModelFieldInput(draft, startValue),
        validation: {},
        unit:
          (type === 'decimal' || type === 'integer') && unit.trim()
            ? unit.trim()
            : null,
        options: type === 'category' ? options : [],
        ...placement,
      })
    },
    onSuccess: (id) => {
      toast(
        editing ? `“${label.trim()}” saved` : `“${label.trim()}” added`,
        editing
          ? undefined
          : {
              description: `It now shows on every ${model.name.toLowerCase()}’s page.`,
            },
      )
      onSaved(id)
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
          title={
            editing ? `Edit “${field?.label}”` : `Add a field to ${model.name}`
          }
          description={
            editing
              ? 'Rename it, change its help text or where it shows. Values already recorded don’t change.'
              : `Every ${model.name.toLowerCase()} gets this field. Existing ${model.plural} show it empty until someone fills it in.`
          }
        />
        <DialogBody>
          <form
            id="built-in-field-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSubmitted(true)
              if (!blocking && !taken.isLoading) save.mutate()
            }}
          >
            <Field
              label="Name"
              required
              error={submitted ? labelError : undefined}
            >
              <Input
                autoFocus
                value={label}
                placeholder="e.g. Cell passage"
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            {!editing ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Type">
                  <Select
                    value={type}
                    onChange={(event) => {
                      setType(event.target.value as AuthoredType)
                      setStartValue('')
                    }}
                  >
                    {AUTHORED_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {TYPE_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {type === 'decimal' || type === 'integer' ? (
                  <Field label="Unit" hint="Optional, e.g. mg/mL or °C">
                    <Input
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {!editing && type === 'category' ? (
              <Field
                label="Choices"
                required
                hint="One per line."
                error={submitted ? choicesError : undefined}
              >
                <Textarea
                  rows={4}
                  value={choices}
                  placeholder={'Pass\nFail\nRepeat'}
                  onChange={(event) => setChoices(event.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label="Help text"
              hint="Optional. Shown under the field when someone fills it in."
            >
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {!editing ? (
              <>
                <label className="flex items-center gap-2 text-label">
                  <Checkbox
                    checked={required}
                    onCheckedChange={(checked) => setRequired(checked === true)}
                  />
                  Required
                </label>
                <div className="flex flex-col gap-1 text-label">
                  <ModelFieldInput
                    definition={draft}
                    value={startValue}
                    onChange={setStartValue}
                  />
                  {submitted && startError ? (
                    <span className="text-danger-text">{startError}</span>
                  ) : (
                    <span className="text-fg-muted">
                      {required
                        ? `Filled in on existing ${model.plural} and new ones until someone changes it.`
                        : 'Optional. New records start with it.'}
                    </span>
                  )}
                </div>
              </>
            ) : null}
            <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-border-subtle p-0 pt-3">
              <legend className="mb-1 text-label font-medium">
                Where it shows
              </legend>
              <Field
                label="Heading on the page"
                hint={`Fields with the same heading are grouped. Leave empty for “${model.name} details”.`}
              >
                <Input
                  value={section}
                  list="built-in-field-sections"
                  onChange={(event) => setSection(event.target.value)}
                />
                <datalist id="built-in-field-sections">
                  {sections.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  checked={askOnCreate}
                  onCheckedChange={(checked) =>
                    setAskOnCreate(checked === true)
                  }
                />
                Ask for it when someone creates{' '}
                {withArticle(model.name.toLowerCase())}
              </label>
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  checked={showInList}
                  onCheckedChange={(checked) => setShowInList(checked === true)}
                />
                Show it as a column in the {model.surface.label} list
              </label>
            </fieldset>
            {save.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {describeFieldAuthoringError(save.error)}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="built-in-field-form"
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save field' : 'Add field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
