import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { functionalUpdate } from '@tanstack/react-table'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { TableBox } from '#/components/ui/table'
import { toast } from '#/components/ui/sonner'
import { Textarea } from '#/components/inventory/list'
import {
  RegistryGrid,
  bandRow,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/inventory/registry-grid'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { fieldKeyFromLabel } from '#/lib/built-in-models'
import type { BuiltInModel } from '#/lib/built-in-models'
import { parseModelFieldInput } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
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
import { t } from '#/copy'
import {
  AUTHORED_TYPES,
  TYPE_LABELS,
  fieldTypeName,
  fieldShowsOn,
  withArticle,
  parseChoices,
  builtInFieldErrors,
} from './built-in-field-presentation'
import type { AuthoredType } from './built-in-field-presentation'
import { BuiltInFieldInspector } from './built-in-field-inspector'

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
function useBuiltInFieldsState(model: BuiltInModel) {
  const fields = useBuiltInModelFields(model.key, { includeRetired: true })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<ModelFieldDefinition | null>(null)
  const [retiring, setRetiring] = useState<ModelFieldDefinition | null>(null)
  const queryClient = useQueryClient()
  const added = fields.data ?? []
  const active = added.filter((field) => field.lifecycle !== 'retired')
  const retired = added.filter((field) => field.lifecycle === 'retired')

  const sections = [
    ...new Set(
      active.flatMap((field) => (field.section ? [field.section] : [])),
    ),
  ]

  const toRow = (field: ModelFieldDefinition): FieldRow => ({
    id: field.id,
    label: field.label,
    standard: false,
    field,
  })

  const rows: RegistryRow<FieldRow>[] = [
    bandRow(
      t('library.models.builtInModelFields.addedByYourWorkspace'),
      active.length,
    ),
    ...active.map(toRow),
    ...(retired.length
      ? [
          bandRow(
            t('library.models.builtInModelFields.noLongerUsed'),
            retired.length,
          ),
          ...retired.map(toRow),
        ]
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
      toast(
        t('library.models.builtInModelFields.isNoLongerUsed', {
          label: field.label,
        }),
        {
          description: t(
            'library.models.builtInModelFields.valuesAlreadyRecordedStayOn',
          ),
        },
      )
    },
  })

  return {
    fields,
    active,
    rows,
    sel,
    rowSelection,
    onRowSelectionChange,
    invalidate,
    retire,
    retiring,
    setRetiring,
    editing,
    setEditing,
    setSelected,
    sections,
  }
}

function useBuiltInFieldColumns(model: BuiltInModel) {
  const dataAccess = useDataAccess()
  const names = useReportingNames()

  const columns: RegistryColumn<FieldRow>[] = [
    {
      id: 'field',
      header: t('library.models.builtInModelFields.field'),
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
            header: t('library.models.builtInModelFields.key'),
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
      header: t('library.models.builtInModelFields.type'),
      cell: ({ row }) =>
        row.original.field ? (
          fieldTypeName(row.original.field)
        ) : (
          <span className="text-fg-muted">
            {t('library.models.builtInModelFields.builtIn')}
          </span>
        ),
    },
    {
      id: 'required',
      header: t('common.states.required'),
      cell: ({ row }) =>
        row.original.field ? (
          row.original.field.nullable ? (
            t('common.states.optional')
          ) : (
            t('common.states.required')
          )
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      id: 'shows',
      header: t('library.models.builtInModelFields.showsOn'),
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
      header: t('library.models.builtInModelFields.heading'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.field?.section ?? '—'}
        </span>
      ),
    },
  ]

  return columns
}

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
  const {
    fields,
    active,
    rows,
    sel,
    rowSelection,
    onRowSelectionChange,
    invalidate,
    retire,
    retiring,
    setRetiring,
    editing,
    setEditing,
    setSelected,
    sections,
  } = useBuiltInFieldsState(model)

  const columns = useBuiltInFieldColumns(model)

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4 md:px-6">
        {!fields.isLoading && active.length === 0 ? (
          <Muted>
            {t('library.models.builtInModelFields.everyHasTheStandardFields', {
              name: model.name.toLowerCase(),
              name2: model.name.toLowerCase(),
            })}
          </Muted>
        ) : null}
        {fields.isError ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {t('library.models.builtInModelFields.theFieldsCouldNotBe')}
          </p>
        ) : null}
        <TableBox>
          <RegistryGrid
            label={t('library.models.shared.nameFields', { name: model.name })}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            rowSelection={rowSelection}
            onRowSelectionChange={(updater) => {
              const next = functionalUpdate(updater, rowSelection)

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
        <BuiltInFieldInspector
          sel={sel}
          model={model}
          canEdit={canEdit}
          onEdit={setEditing}
          onRetire={setRetiring}
        />
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
              {t('library.models.builtInModelFields.stopUsing2', {
                label: retiring?.label ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('library.models.builtInModelFields.itDisappearsFromFormsAnd', {
                plural: model.plural,
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          {retire.isError ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {describeFieldAuthoringError(retire.error)}
            </p>
          ) : null}
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={retire.isPending}
              onClick={() => {
                if (retiring) retire.mutate(retiring)
              }}
            >
              {t('library.models.builtInModelFields.stopUsing')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

/**
 * Add a field to a built-in model, or edit one already in use. Editing keeps
 * to what can change on a live field: its name, help text and placement.
 */
function useBuiltInFieldDraft({
  model,
  workspaceId,
  field,
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
    label: t('library.models.builtInModelFields.startingValue'),
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

  const { labelError, choicesError, startError, blocking } = builtInFieldErrors(
    {
      label,
      editing,
      type,
      optionCount: options.length,
      required,
      startValue,
      plural: model.plural,
    },
  )

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

      if (!workspaceId)
        throw new Error(
          t('library.models.builtInModelFields.noActiveWorkspace'),
        )
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
        editing
          ? t('library.models.builtInModelFields.saved', {
              label: label.trim(),
            })
          : t('library.models.builtInModelFields.added', {
              label: label.trim(),
            }),
        editing
          ? undefined
          : {
              description: t(
                'library.models.builtInModelFields.itNowShowsOnEvery',
                { name: model.name.toLowerCase() },
              ),
            },
      )
      onSaved(id)
    },
  })

  return {
    editing,
    taken,
    label,
    setLabel,
    description,
    setDescription,
    type,
    setType,
    unit,
    setUnit,
    choices,
    setChoices,
    required,
    setRequired,
    startValue,
    setStartValue,
    section,
    setSection,
    askOnCreate,
    setAskOnCreate,
    showInList,
    setShowInList,
    submitted,
    setSubmitted,
    draft,
    labelError,
    choicesError,
    startError,
    blocking,
    save,
  }
}

function BuiltInFieldDialog(props: Parameters<typeof useBuiltInFieldDraft>[0]) {
  const { model, field, sections, onClose } = props

  const {
    editing,
    taken,
    label,
    setLabel,
    description,
    setDescription,
    type,
    setType,
    unit,
    setUnit,
    choices,
    setChoices,
    required,
    setRequired,
    startValue,
    setStartValue,
    section,
    setSection,
    askOnCreate,
    setAskOnCreate,
    showInList,
    setShowInList,
    submitted,
    setSubmitted,
    draft,
    labelError,
    choicesError,
    startError,
    blocking,
    save,
  } = useBuiltInFieldDraft(props)

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
            editing
              ? t('library.models.builtInModelFields.edit', {
                  label: field?.label ?? '',
                })
              : t('library.models.builtInModelFields.addAFieldTo', {
                  name: model.name,
                })
          }
          description={
            editing
              ? t('library.models.builtInModelFields.renameItChangeItsHelp')
              : t(
                  'library.models.builtInModelFields.everyGetsThisFieldExisting',
                  { name: model.name.toLowerCase(), plural: model.plural },
                )
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
              label={t('library.models.builtInModelFields.name')}
              required
              error={submitted ? labelError : undefined}
            >
              <Input
                autoFocus
                value={label}
                placeholder={t(
                  'library.models.builtInModelFields.eGCellPassage',
                )}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            {!editing ? (
              <BuiltInFieldType
                type={type}
                unit={unit}
                setUnit={setUnit}
                onTypeChange={(next) => {
                  setType(next)
                  setStartValue('')
                }}
              />
            ) : null}
            {!editing && type === 'category' ? (
              <Field
                label={t('library.models.builtInModelFields.choices')}
                required
                hint={t('library.models.builtInModelFields.onePerLine')}
                error={submitted ? choicesError : undefined}
              >
                <Textarea
                  rows={4}
                  value={choices}
                  placeholder={t(
                    'library.models.builtInModelFields.passFailRepeat',
                  )}
                  onChange={(event) => setChoices(event.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label={t('library.models.builtInModelFields.helpText')}
              hint={t(
                'library.models.builtInModelFields.optionalShownUnderTheField',
              )}
            >
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {!editing ? (
              <BuiltInStartingValue
                draft={draft}
                startValue={startValue}
                setStartValue={setStartValue}
                required={required}
                setRequired={setRequired}
                submitted={submitted}
                startError={startError}
                plural={model.plural}
              />
            ) : null}
            <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-border-subtle p-0 pt-3">
              <legend className="mb-1 text-label font-medium">
                {t('library.models.builtInModelFields.whereItShows')}
              </legend>
              <Field
                label={t('library.models.builtInModelFields.headingOnThePage')}
                hint={t(
                  'library.models.builtInModelFields.fieldsWithTheSameHeading',
                  { name: model.name },
                )}
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
                {t('library.models.builtInModelFields.askForItWhenSomeone', {
                  name: withArticle(model.name.toLowerCase()),
                })}
              </label>
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  checked={showInList}
                  onCheckedChange={(checked) => setShowInList(checked === true)}
                />
                {t('library.models.builtInModelFields.showItAsAColumn', {
                  label: model.surface.label,
                })}
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
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="built-in-field-form"
            disabled={save.isPending}
          >
            {save.isPending
              ? t('common.states.saving')
              : editing
                ? t('library.models.builtInModelFields.saveField')
                : t('library.models.builtInModelFields.addField')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BuiltInFieldType({
  type,
  unit,
  setUnit,
  onTypeChange,
}: {
  type: AuthoredType
  unit: string
  setUnit: (value: string) => void
  onTypeChange: (value: AuthoredType) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={t('library.models.builtInModelFields.type')}>
        <Select
          value={type}
          onChange={(event) => {
            const selectedType = AUTHORED_TYPES.find(
              (value) => value === event.target.value,
            )

            if (selectedType) onTypeChange(selectedType)
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
        <Field
          label={t('library.models.builtInModelFields.unit')}
          hint={t('library.models.builtInModelFields.optionalEGMgMl')}
        >
          <Input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  )
}

function BuiltInStartingValue({
  draft,
  startValue,
  setStartValue,
  required,
  setRequired,
  submitted,
  startError,
  plural,
}: {
  draft: ModelFieldDefinition
  startValue: string | boolean
  setStartValue: (value: string | boolean) => void
  required: boolean
  setRequired: (value: boolean) => void
  submitted: boolean
  startError: string | undefined
  plural: string
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-label">
        <Checkbox
          checked={required}
          onCheckedChange={(checked) => setRequired(checked === true)}
        />
        {t('common.states.required')}
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
              ? t('library.models.builtInModelFields.filledInOnExistingAnd', {
                  plural,
                })
              : t(
                  'library.models.builtInModelFields.optionalNewRecordsStartWith',
                )}
          </span>
        )}
      </div>
    </>
  )
}
