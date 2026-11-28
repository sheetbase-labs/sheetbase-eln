/**
 * The secondary editing of a template, opened from its notebook page: the
 * settings a person fills in when they use it, and which part each section
 * sits in. Both edit the same draft as the notebook.
 */
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Select } from '#/components/ui/select'
import type { TemplatePart } from '#/components/templates/template-parts'
import { placementName } from '#/components/templates/template-structure'
import type { useSheetDefinitions } from '#/components/templates/templates-data'
import { blockTypeLabel } from '#/components/notebook/block-labels'
import { PARAMETER_VALUE_TYPES } from '#/lib/parameter'
import type { ParameterValueType, Parameter } from '#/lib/parameter'
import type { NotebookTemplatePlacement } from '#/lib/notebook-template'
import { defaultAsText } from '../-template-draft'
import type { TemplateDraft, TemplateSettingTarget } from '../-template-draft'
import { t } from '#/copy'

type ScalarValueType = ParameterValueType

/** What kind of section a placement is, in words. */
function sectionKind(placement: NotebookTemplatePlacement): string {
  if (placement.kind === 'sheet') return t('library.templates.overview.sheet')

  if (placement.kind === 'section_placeholder')
    return t('library.templates.notebook.emptySection')

  return blockTypeLabel(placement.blockType)
}

const VALUE_TYPE_COPY = {
  text: 'library.templates.notebook.valueText',
  integer: 'library.templates.notebook.valueWholeNumber',
  decimal: 'library.templates.notebook.valueNumber',
  boolean: 'library.templates.notebook.valueYesNo',
  date: 'library.templates.notebook.valueDate',
  timestamp: 'library.templates.notebook.valueDateTime',
  category: 'library.templates.notebook.valueChoice',
  reference: 'library.templates.notebook.valueRecord',
} as const satisfies Record<ParameterValueType, string>

/** A setting's kind of value, in words. */
export function valueTypeLabel(valueType: ParameterValueType): string {
  return t(VALUE_TYPE_COPY[valueType])
}

function parameterTypeName(parameter: Parameter): string {
  return parameter.type.kind === 'scalar'
    ? valueTypeLabel(parameter.type.valueType)
    : t('library.templates.notebook.valueList')
}

/**
 * A key for something a person named: lower case words joined by
 * underscores, made unique among the keys already taken.
 */
export function keyFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)

  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(?=[0-9])/, 'n_')
      .slice(0, 52) || 'item'

  let key = base
  let n = 2

  while (used.has(key)) {
    key = `${base}_${n}`
    n += 1
  }

  return key
}

/** The Sections table's columns; the editing variant adds the reorder and
 * remove controls in the actions column. */
function sectionColumns(
  count: number,
  options: {
    withActions?: boolean
    disabled?: boolean
    onMove?: (index: number, delta: number) => void
    onRemove?: (id: string) => void
    /** The template's parts: adds a Part column. */
    parts?: readonly TemplatePart[]
    onSetPart?: (id: string, partId: string | null) => void
  } = {},
): RegistryColumn<NotebookTemplatePlacement>[] {
  const columns: RegistryColumn<NotebookTemplatePlacement>[] = [
    {
      id: 'section',
      header: t('library.templates.overview.section'),
      cell: ({ row }) => placementName(row.original),
    },
    {
      id: 'kind',
      header: t('library.templates.overview.kind'),
      cell: ({ row }) => sectionKind(row.original),
    },
  ]

  if (options.parts && options.parts.length > 0) {
    const parts = options.parts
    columns.splice(2, 0, {
      id: 'part',
      header: t('library.templates.parts.sectionPart'),
      cell: ({ row }) => {
        const placement = row.original

        if (placement.kind === 'section_placeholder') return '—'
        const current = placement.partId ?? ''

        if (!options.withActions) {
          return (
            parts.find((part) => part.id === current)?.title ??
            t('library.templates.parts.noPart')
          )
        }

        return (
          <Select
            size="sm"
            value={current}
            disabled={options.disabled}
            aria-label={t('library.templates.parts.sectionPartLabel', {
              section: placementName(placement),
            })}
            onChange={(event) =>
              options.onSetPart?.(placement.id, event.target.value || null)
            }
          >
            <option value="">{t('library.templates.parts.noPart')}</option>
            {parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.title}
              </option>
            ))}
          </Select>
        )
      },
    })
  }

  if (options.withActions) {
    columns.push({
      id: 'actions',
      header: t('library.templates.overview.actions'),
      meta: rightAligned<NotebookTemplatePlacement>().meta,
      cell: ({ row }) => (
        <span className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="quiet"
            disabled={row.index === 0 || options.disabled}
            aria-label={t('library.templates.overview.moveUp', {
              original: placementName(row.original),
            })}
            onClick={() => options.onMove?.(row.index, -1)}
          >
            {t('library.templates.overview.up')}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={row.index === count - 1 || options.disabled}
            aria-label={t('library.templates.overview.moveDown', {
              original: placementName(row.original),
            })}
            onClick={() => options.onMove?.(row.index, 1)}
          >
            {t('library.templates.overview.down')}
          </Button>
          {row.original.kind === 'section_placeholder' ? (
            <Button
              size="sm"
              variant="quiet"
              disabled={options.disabled}
              aria-label={t('library.templates.overview.remove', {
                label: row.original.label,
              })}
              onClick={() => options.onRemove?.(row.original.id)}
            >
              {t('common.actions.remove')}
            </Button>
          ) : null}
        </span>
      ),
    })
  }

  return columns
}

/** A scalar setting of a sheet a placement pins, which a template setting can feed. */
export interface SettingTarget {
  placementId: string
  sheetTitle: string
  parameter: Parameter
}

function targetKey(target: TemplateSettingTarget | null): string {
  return target ? `${target.placementId}|${target.definitionParameterId}` : ''
}

/** What a template setting is when nobody changes it. Typing keeps its own
 * text, so "80." survives until the number is finished. */
function DefaultInput({
  parameter,
  disabled,
  onChange,
}: {
  parameter: Parameter
  disabled?: boolean
  onChange: (text: string) => void
}) {
  const [text, setText] = useState(() => defaultAsText(parameter.defaultValue))

  return (
    <Input
      className="w-[110px]"
      value={text}
      disabled={disabled}
      aria-label={t('library.templates.overview.defaultValue')}
      onChange={(event) => {
        setText(event.target.value)
        onChange(event.target.value)
      }}
    />
  )
}

/** Which sheet setting a template setting feeds: only settings of its own type. */
function FeedsSelect({
  parameter,
  targets,
  value,
  disabled,
  onChange,
}: {
  parameter: Parameter
  targets: SettingTarget[]
  value: TemplateSettingTarget | null
  disabled?: boolean
  onChange: (target: TemplateSettingTarget | null) => void
}) {
  const options = targets.filter(
    (item) =>
      item.parameter.type.kind === 'scalar' &&
      parameter.type.kind === 'scalar' &&
      item.parameter.type.valueType === parameter.type.valueType,
  )

  return (
    <Select
      className="min-w-[240px]"
      value={targetKey(value)}
      disabled={disabled}
      aria-label={t('library.templates.overview.feeds')}
      onChange={(event) => {
        const picked = options.find(
          (item) =>
            targetKey({
              placementId: item.placementId,
              definitionParameterId: item.parameter.id,
            }) === event.target.value,
        )

        onChange(
          picked
            ? {
                placementId: picked.placementId,
                definitionParameterId: picked.parameter.id,
              }
            : null,
        )
      }}
    >
      <option value="">{t('library.templates.overview.feedsNothing')}</option>
      {options.map((item) => (
        <option
          key={`${item.placementId}|${item.parameter.id}`}
          value={`${item.placementId}|${item.parameter.id}`}
        >
          {t('library.templates.overview.feedsTarget', {
            sheet: item.sheetTitle,
            setting: item.parameter.label,
          })}
        </option>
      ))}
    </Select>
  )
}

/** The Parameters table's columns; the editing variant adds Required and the
 * remove control. */
function parameterColumns(options: {
  withActions?: boolean
  disabled?: boolean
  onRemove?: (id: string) => void
  /** The sheet settings a template setting can feed, from the sheets placed. */
  targets: SettingTarget[]
  /** What each template setting feeds now. */
  feeds: (parameterId: string) => TemplateSettingTarget | null
  onSetDefault?: (id: string, text: string) => void
  onSetFeeds?: (id: string, target: TemplateSettingTarget | null) => void
}): RegistryColumn<Parameter>[] {
  const columns: RegistryColumn<Parameter>[] = [
    {
      id: 'type',
      header: t('library.templates.overview.type'),
      cell: ({ row }) => parameterTypeName(row.original),
    },
    {
      id: 'label',
      header: t('library.templates.overview.label'),
      cell: ({ row }) => row.original.label,
    },
    {
      id: 'default',
      header: t('library.templates.overview.defaultValue'),
      cell: ({ row }) =>
        options.withActions && row.original.type.kind === 'scalar' ? (
          <DefaultInput
            parameter={row.original}
            disabled={options.disabled}
            onChange={(text) => options.onSetDefault?.(row.original.id, text)}
          />
        ) : row.original.defaultValue === undefined ? (
          '—'
        ) : (
          defaultAsText(row.original.defaultValue)
        ),
    },
    {
      id: 'feeds',
      header: t('library.templates.overview.feeds'),
      cell: ({ row }) => {
        const current = options.feeds(row.original.id)

        if (options.withActions)
          return (
            <FeedsSelect
              parameter={row.original}
              targets={options.targets}
              value={current}
              disabled={options.disabled}
              onChange={(target) =>
                options.onSetFeeds?.(row.original.id, target)
              }
            />
          )

        const target = current
          ? options.targets.find(
              (item) =>
                item.placementId === current.placementId &&
                item.parameter.id === current.definitionParameterId,
            )
          : undefined

        return target
          ? t('library.templates.overview.feedsTarget', {
              sheet: target.sheetTitle,
              setting: target.parameter.label,
            })
          : t('library.templates.overview.feedsNone')
      },
    },
  ]

  if (options.withActions) {
    columns.push(
      {
        id: 'required',
        header: t('common.states.required'),
        cell: ({ row }) =>
          row.original.required ? t('library.templates.overview.yes') : '—',
      },
      {
        id: 'actions',
        header: t('library.templates.overview.actions'),
        meta: rightAligned<Parameter>().meta,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="quiet"
            disabled={options.disabled}
            aria-label={t('library.templates.overview.remove', {
              label: row.original.label,
            })}
            onClick={() => options.onRemove?.(row.original.id)}
          >
            {t('common.actions.remove')}
          </Button>
        ),
      },
    )
  }

  return columns
}

/** The sections table, with the add form and its controls while editing. */
export function SectionsSection({
  draft,
  placements,
  editPlacements,
  templateParts,
  saving,
  onMove,
  onSetPart,
  onRemove,
  onAdd,
}: {
  draft: boolean
  placements: NotebookTemplatePlacement[]
  editPlacements: NotebookTemplatePlacement[]
  templateParts: TemplatePart[]
  saving: boolean
  onMove: (index: number, delta: number) => void
  onSetPart: (id: string, partId: string | null) => void
  onRemove: (id: string) => void
  onAdd: (key: string, label: string) => void
}) {
  const rows = draft ? editPlacements : placements

  return (
    <Section
      title={t('library.templates.overview.sections')}
      count={rows.length}
    >
      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.templates.overview.templateSections')}
            rows={rows}
            columns={
              draft
                ? sectionColumns(rows.length, {
                    withActions: true,
                    disabled: saving,
                    onMove,
                    parts: templateParts,
                    onSetPart,
                    onRemove,
                  })
                : sectionColumns(rows.length, { parts: templateParts })
            }
            getRowId={(placement) => placement.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>{t('library.templates.overview.noSectionsInThisVersion')}</Muted>
      )}
      {draft ? (
        <AddSectionForm
          disabled={saving}
          takenKeys={rows.flatMap((row) =>
            row.kind === 'section_placeholder' ? [row.key] : [],
          )}
          onAdd={onAdd}
        />
      ) : null}
    </Section>
  )
}

/** What the add form hands over for a new setting. */
export type AddedParameter = Parameters<TemplateDraft['addParameter']>[0]

/** The scalar settings of every sheet the template places, for a template
 * setting to feed. */
export function sheetSettingTargets(
  placements: NotebookTemplatePlacement[],
  versionsById: ReturnType<typeof useSheetDefinitions>['versionsById'],
): SettingTarget[] {
  return placements.flatMap((placement) => {
    if (placement.kind !== 'sheet') return []

    const definition = versionsById.get(placement.definitionVersionId)

    return (definition?.configuration.parameters ?? [])
      .filter((parameter) => parameter.type.kind === 'scalar')
      .map((parameter) => ({
        placementId: placement.id,
        sheetTitle: placement.title ?? t('library.templates.overview.sheet'),
        parameter,
      }))
  })
}

/** The declared parameters table, with the add form while editing. */
export function ParametersSection({
  draft,
  parameters,
  placements,
  targets,
  saving,
  onRemove,
  onAdd,
  onSetDefault,
  onSetFeeds,
}: {
  draft: boolean
  parameters: Parameter[]
  placements: NotebookTemplatePlacement[]
  targets: SettingTarget[]
  saving: boolean
  onRemove: (id: string) => void
  onAdd: (input: AddedParameter) => void
  onSetDefault: (id: string, text: string) => void
  onSetFeeds: (id: string, target: TemplateSettingTarget | null) => void
}) {
  const feeds = (parameterId: string): TemplateSettingTarget | null => {
    for (const placement of placements) {
      if (placement.kind !== 'sheet') continue

      const mapping = placement.parameterMappings.find(
        (item) => item.templateParameterId === parameterId,
      )

      if (mapping)
        return {
          placementId: placement.id,
          definitionParameterId: mapping.definitionParameterId,
        }
    }

    return null
  }

  return (
    <Section
      title={t('library.templates.overview.parameters')}
      count={parameters.length}
    >
      {parameters.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.templates.overview.templateParameters')}
            rows={parameters}
            columns={
              draft
                ? parameterColumns({
                    withActions: true,
                    disabled: saving,
                    onRemove,
                    targets,
                    feeds,
                    onSetDefault,
                    onSetFeeds,
                  })
                : parameterColumns({ targets, feeds })
            }
            getRowId={(parameter) => parameter.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>{t('library.templates.overview.noParametersDeclared')}</Muted>
      )}
      {draft ? (
        <AddParameterForm
          disabled={saving}
          targets={targets}
          takenKeys={parameters.map((parameter) => parameter.key)}
          onAdd={onAdd}
        />
      ) : null}
    </Section>
  )
}

/** A section a notebook fills in: a person names it, and its key follows the name. */
function AddSectionForm({
  disabled,
  takenKeys,
  onAdd,
}: {
  disabled: boolean
  takenKeys: readonly string[]
  onAdd: (key: string, label: string) => void
}) {
  const [label, setLabel] = useState('')
  const trimmedLabel = label.trim()

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label={t('library.templates.notebook.sectionName')}
        required
        className="w-[260px]"
      >
        <Input
          value={label}
          placeholder={t('library.templates.overview.eGPressureAndP')}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Button
        icon="plus"
        disabled={disabled || trimmedLabel.length === 0}
        onClick={() => {
          onAdd(keyFromLabel(trimmedLabel, takenKeys), trimmedLabel)
          setLabel('')
        }}
      >
        {t('library.templates.overview.addSection')}
      </Button>
    </div>
  )
}

/** Scalar parameters are the values a notebook asks for when it is made from
 * the template. */
function AddParameterForm({
  disabled,
  targets,
  takenKeys,
  onAdd,
}: {
  disabled: boolean
  targets: SettingTarget[]
  takenKeys: readonly string[]
  onAdd: (input: AddedParameter) => void
}) {
  const [label, setLabel] = useState('')
  const [valueType, setValueType] = useState<ScalarValueType>('text')
  const [required, setRequired] = useState(false)
  const [defaultText, setDefaultText] = useState('')
  const [feeds, setFeeds] = useState('')

  /** Choosing a sheet setting to feed fills in what the setting already says. */
  const chooseFeeds = (value: string) => {
    setFeeds(value)

    const picked = targets.find(
      (item) => `${item.placementId}|${item.parameter.id}` === value,
    )

    if (!picked || picked.parameter.type.kind !== 'scalar') return

    if (label.trim() === '') setLabel(picked.parameter.label)
    setValueType(picked.parameter.type.valueType)

    if (picked.parameter.defaultValue !== undefined && defaultText === '')
      setDefaultText(defaultAsText(picked.parameter.defaultValue))
  }

  const trimmedLabel = label.trim()

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label={t('library.templates.overview.label')}
        required
        className="w-[200px]"
      >
        <Input
          value={label}
          placeholder={t('library.templates.overview.eGSample')}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Field label={t('library.templates.overview.type')} className="w-[150px]">
        <Select
          value={valueType}
          onChange={(event) => {
            const picked = PARAMETER_VALUE_TYPES.find(
              (type) => type === event.target.value,
            )

            if (picked) setValueType(picked)
          }}
        >
          {PARAMETER_VALUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {valueTypeLabel(type)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('library.templates.overview.defaultValue')}
        hint={t('library.templates.overview.defaultValueHint')}
        className="w-[150px]"
      >
        <Input
          value={defaultText}
          onChange={(event) => setDefaultText(event.target.value)}
        />
      </Field>
      {targets.length > 0 ? (
        <Field
          label={t('library.templates.overview.feeds')}
          hint={t('library.templates.overview.feedsHint')}
          className="w-[260px]"
        >
          <Select
            value={feeds}
            onChange={(event) => chooseFeeds(event.target.value)}
          >
            <option value="">
              {t('library.templates.overview.feedsNothing')}
            </option>
            {targets.map((item) => (
              <option
                key={`${item.placementId}|${item.parameter.id}`}
                value={`${item.placementId}|${item.parameter.id}`}
              >
                {t('library.templates.overview.feedsTarget', {
                  sheet: item.sheetTitle,
                  setting: item.parameter.label,
                })}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <label className="flex h-[30px] cursor-pointer items-center gap-2 text-label">
        <Checkbox
          checked={required}
          onCheckedChange={(checked) => setRequired(checked)}
        />
        {t('common.states.required')}
      </label>
      <Button
        icon="plus"
        disabled={disabled || trimmedLabel.length === 0}
        onClick={() => {
          const target = targets.find(
            (item) => `${item.placementId}|${item.parameter.id}` === feeds,
          )

          onAdd({
            key: keyFromLabel(trimmedLabel, takenKeys),
            label: trimmedLabel,
            required,
            valueType,
            defaultText,
            feeds: target
              ? {
                  placementId: target.placementId,
                  definitionParameterId: target.parameter.id,
                }
              : null,
            // A sheet setting's limits come with it.
            constraints: target?.parameter.constraints,
          })
          setLabel('')
          setRequired(false)
          setDefaultText('')
          setFeeds('')
        }}
      >
        {t('library.templates.overview.addParameter')}
      </Button>
    </div>
  )
}
