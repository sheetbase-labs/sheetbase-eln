import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Checkbox } from '#/components/ui/checkbox'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Select } from '#/components/ui/select'
import { TemplateSectionsBoard } from '#/components/templates/template-sections-board'
import { TemplatePartsSection } from '#/components/templates/template-parts'
import type { TemplatePart } from '#/components/templates/template-parts'
import {
  templateLifecycle,
  useTemplate,
  useTemplateVersions,
} from '#/components/templates/templates-data'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
} from '#/lib/notebook-template'
import type { Parameter } from '#/lib/parameter'
import { formatDate } from '#/lib/format-date'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { useTemplateDraft } from '../-template-draft'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): the template's Sections view reads the stored
 * configuration and edits it. A save makes a new version, because a published
 * version pins work already made. */
export const Route = createFileRoute('/templates/$templateId/')({
  component: TemplateSections,
})

/** The key format a section or parameter key has to satisfy. */
const keyPattern = /^[a-z][a-z0-9_]{0,59}$/

type ScalarValueType = (typeof FIELD_LOGICAL_TYPES)[number]

function shownVersion(
  versions: NotebookTemplateVersion[],
): NotebookTemplateVersion | undefined {
  // The newest version is the one being worked on: an open draft, else the
  // current published version.
  return [...versions].sort((a, b) => b.version - a.version).at(0)
}

function sectionKind(placement: { kind: string; blockType?: string }): string {
  if (placement.kind === 'narrative') return placement.blockType ?? 'narrative'

  if (placement.kind === 'sheet') return 'sheet'

  return 'section'
}

function placementName(placement: NotebookTemplatePlacement): string {
  if (placement.kind === 'section_placeholder') return placement.label

  if (placement.kind === 'sheet')
    return placement.title ?? t('library.templates.overview.sheet')

  return placement.blockType
}

function placementSource(placement: NotebookTemplatePlacement): string {
  if (placement.kind === 'sheet')
    return `definition version ${placement.definitionVersionId.slice(0, 8)}`

  if (placement.kind === 'section_placeholder')
    return `placeholder ${placement.key}`

  return 'narrative block'
}

function parameterTypeName(parameter: Parameter): string {
  return parameter.type.kind === 'scalar'
    ? `scalar · ${parameter.type.valueType}`
    : parameter.type.kind
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
      id: 'order',
      header: t('library.templates.overview.order'),
      meta: {
        ...rightAligned<NotebookTemplatePlacement>().meta,
        cellClassName: 'text-right num',
      },
      cell: ({ row }) => row.original.order,
    },
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
    {
      id: 'source',
      header: t('library.templates.overview.builtFrom'),
      meta: { cellClassName: 'mono text-fg-muted' },
      cell: ({ row }) => placementSource(row.original),
    },
  ]

  if (options.parts && options.parts.length > 0) {
    const parts = options.parts
    columns.splice(3, 0, {
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

/** The Parameters table's columns; the editing variant adds Required and the
 * remove control. */
function parameterColumns(options: {
  withActions?: boolean
  disabled?: boolean
  onRemove?: (id: string) => void
}): RegistryColumn<Parameter>[] {
  const columns: RegistryColumn<Parameter>[] = [
    {
      id: 'key',
      header: t('library.templates.overview.key'),
      meta: { cellClassName: 'mono' },
      cell: ({ row }) => row.original.key,
    },
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

/** The version line: its status, and either the editing controls or Edit. */
function VersionSection({
  version,
  draft,
  saving,
  onCancel,
  onSave,
  onEdit,
}: {
  version: NotebookTemplateVersion
  draft: NotebookTemplateConfiguration | null
  saving: boolean
  onCancel: () => void
  onSave: () => void
  onEdit: () => void
}) {
  const lifecycle = templateLifecycle(version.lifecycle)

  return (
    <Section
      title={t('library.templates.overview.version')}
      count={
        <Status tone={lifecycle.tone}>
          {lifecycle.label} v{version.version}
        </Status>
      }
      action={
        draft ? (
          <span className="flex gap-2">
            <Button size="sm" disabled={saving} onClick={onCancel}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={saving}
              onClick={onSave}
            >
              {saving
                ? t('common.states.saving')
                : t('library.templates.overview.saveNewVersion')}
            </Button>
          </span>
        ) : (
          <IconButton
            variant="secondary"
            icon="edit"
            label={t('common.actions.edit')}
            onClick={onEdit}
          />
        )
      }
    >
      <Muted>
        {[
          version.publishedAt
            ? t('library.templates.overview.published', {
                publishedAt: formatDate(version.publishedAt),
              })
            : t('library.templates.overview.notPublished'),
          t('library.templates.overview.notebooksAlreadyMadeKeepThe'),
          draft ? t('library.templates.overview.savingAddsANewVersion') : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </Muted>
    </Section>
  )
}

/** The sections table, with the add form and its controls while editing. */
function SectionsSection({
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
      {draft ? <AddSectionForm disabled={saving} onAdd={onAdd} /> : null}
    </Section>
  )
}

/** The declared parameters table, with the add form while editing. */
function ParametersSection({
  draft,
  parameters,
  saving,
  onRemove,
  onAdd,
}: {
  draft: boolean
  parameters: Parameter[]
  saving: boolean
  onRemove: (id: string) => void
  onAdd: (input: {
    key: string
    label: string
    required: boolean
    valueType: ScalarValueType
  }) => void
}) {
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
                  })
                : parameterColumns({})
            }
            getRowId={(parameter) => parameter.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>{t('library.templates.overview.noParametersDeclared')}</Muted>
      )}
      {draft ? <AddParameterForm disabled={saving} onAdd={onAdd} /> : null}
    </Section>
  )
}

function TemplateSections() {
  const { templateId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const { regulated } = useRegulatedLab(context.workspace?.id)
  const versions = useTemplateVersions(templateId)
  const template = useTemplate(templateId)
  const version = shownVersion(versions.data ?? [])

  const draft = useTemplateDraft(templateId, version)

  if (!version) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title={t('library.templates.overview.noVersionYet')}
          description={t('library.templates.overview.aTemplateNeedsAVersion')}
        />
      </div>
    )
  }

  if (
    !draft.draft &&
    version.configuration.placements.length > 0 &&
    !version.configuration.parts?.length
  ) {
    return (
      <TemplateSectionsBoard
        templateId={templateId}
        templateKey={template.data?.key ?? ''}
        displayId={template.data?.displayId ?? null}
        version={version}
        versions={versions.data ?? []}
        onEditSections={draft.startEditing}
      />
    )
  }

  const config = version.configuration

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-5">
        <VersionSection
          version={version}
          draft={draft.draft}
          saving={draft.saving}
          onCancel={draft.stopEditing}
          onSave={draft.saveDraft}
          onEdit={draft.startEditing}
        />

        {draft.saveError ? (
          <Notice
            tone="bad"
            title={t('library.templates.overview.couldNotSaveTheNew2')}
          >
            {draft.saveError}
          </Notice>
        ) : null}

        <SectionsSection
          draft={Boolean(draft.draft)}
          placements={draft.placements}
          editPlacements={draft.editPlacements}
          templateParts={draft.parts}
          saving={draft.saving}
          onMove={draft.movePlacement}
          onSetPart={draft.setPlacementPart}
          onRemove={draft.removePlacement}
          onAdd={draft.addSection}
        />

        <TemplatePartsSection
          parts={draft.parts}
          placements={draft.draft ? draft.draft.placements : draft.placements}
          editable={Boolean(draft.draft)}
          disabled={draft.saving}
          signOff={(draft.draft ?? config).signOffParts ?? regulated}
          onSignOffChange={draft.setSignOff}
          onChange={draft.setParts}
        />

        <ParametersSection
          draft={Boolean(draft.draft)}
          parameters={draft.draft ? draft.draft.parameters : config.parameters}
          saving={draft.saving}
          onRemove={draft.removeParameter}
          onAdd={draft.addParameter}
        />
      </div>
    </div>
  )
}

/** A section's label is what a reader sees; its key is how a notebook addresses
 * the section, so both are required and the key is checked against the format
 * the parser accepts. */
function AddSectionForm({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (key: string, label: string) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')

  const trimmedKey = key.trim()
  const trimmedLabel = label.trim()

  const keyError =
    trimmedKey.length > 0 && !keyPattern.test(trimmedKey)
      ? t('library.templates.overview.lowercaseLettersDigitsAndUnderscore')
      : null

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label={t('library.templates.overview.sectionKey')}
        required
        hint={t('library.templates.overview.eGPressureDp')}
        error={keyError}
        className="w-[200px]"
      >
        <Input
          className="mono"
          value={key}
          aria-invalid={keyError ? true : undefined}
          onChange={(event) => setKey(event.target.value)}
        />
      </Field>
      <Field
        label={t('library.templates.overview.label')}
        required
        className="w-[240px]"
      >
        <Input
          value={label}
          placeholder={t('library.templates.overview.eGPressureAndP')}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Button
        icon="plus"
        disabled={
          disabled || !keyPattern.test(trimmedKey) || trimmedLabel.length === 0
        }
        onClick={() => {
          onAdd(trimmedKey, trimmedLabel)
          setKey('')
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
  onAdd,
}: {
  disabled: boolean
  onAdd: (input: {
    key: string
    label: string
    required: boolean
    valueType: ScalarValueType
  }) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [valueType, setValueType] = useState<ScalarValueType>('text')
  const [required, setRequired] = useState(false)

  const trimmedKey = key.trim()
  const trimmedLabel = label.trim()

  const keyError =
    trimmedKey.length > 0 && !keyPattern.test(trimmedKey)
      ? t('library.templates.overview.lowercaseLettersDigitsAndUnderscore')
      : null

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label={t('library.templates.overview.parameterKey')}
        required
        hint={t('library.templates.overview.eGSampleId')}
        error={keyError}
        className="w-[200px]"
      >
        <Input
          className="mono"
          value={key}
          aria-invalid={keyError ? true : undefined}
          onChange={(event) => setKey(event.target.value)}
        />
      </Field>
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
            const picked = FIELD_LOGICAL_TYPES.find(
              (type) => type === event.target.value,
            )

            if (picked) setValueType(picked)
          }}
        >
          {FIELD_LOGICAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex h-[30px] cursor-pointer items-center gap-2 text-label">
        <Checkbox
          checked={required}
          onCheckedChange={(checked) => setRequired(checked)}
        />
        {t('common.states.required')}
      </label>
      <Button
        icon="plus"
        disabled={
          disabled || !keyPattern.test(trimmedKey) || trimmedLabel.length === 0
        }
        onClick={() => {
          onAdd({
            key: trimmedKey,
            label: trimmedLabel,
            required,
            valueType,
          })
          setKey('')
          setLabel('')
          setRequired(false)
        }}
      >
        {t('library.templates.overview.addParameter')}
      </Button>
    </div>
  )
}
