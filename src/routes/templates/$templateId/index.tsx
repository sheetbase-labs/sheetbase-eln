import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Select } from '#/components/v3/ui/select'
import { TemplateSectionsBoard } from '#/components/v3/templates/template-sections-board'
import {
  templateDataQueryKeys,
  templateLifecycle,
  useTemplate,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import { createNotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { notebookTemplateConfigurationSchema } from '#/lib/notebook-template'
import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
} from '#/lib/notebook-template'
import type { Parameter } from '#/lib/parameter'
import { formatDate } from '#/lib/format-date'
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

/** Orders are unique positive integers, so every add, remove and move rewrites
 * them as 1..n. */
function withOrders(
  placements: NotebookTemplatePlacement[],
): NotebookTemplatePlacement[] {
  return placements.map((placement, index) => ({
    ...placement,
    order: index + 1,
  }))
}

function TemplateSections() {
  const { templateId } = Route.useParams()
  const queryClient = useQueryClient()
  const versions = useTemplateVersions(templateId)
  const template = useTemplate(templateId)
  const version = shownVersion(versions.data ?? [])

  const [draft, setDraft] = useState<NotebookTemplateConfiguration | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const revision = template.data?.revision

  const save = useMutation({
    mutationFn: (configuration: NotebookTemplateConfiguration) => {
      if (revision === undefined)
        throw new Error(
          t('library.templates.overview.theTemplateIsStillLoading'),
        )
      return createNotebookTemplateVersion(templateId, revision, configuration)
    },
    onSuccess: (saved) => {
      // The header and the tab counts read this list, so show the saved version
      // now rather than after the invalidation's refetch lands. The refetch
      // still runs, so anything the server returns later wins.
      queryClient.setQueryData<NotebookTemplateVersion[]>(
        templateDataQueryKeys.versions(templateId),
        (current) =>
          [...(current ?? []).filter((v) => v.id !== saved.id), saved].sort(
            (a, b) => a.version - b.version,
          ),
      )
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.versions(templateId),
      })
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.template(templateId),
      })
      setDraft(null)
      setSaveError(null)
      toast(
        t('library.templates.overview.savedAsV', { version: saved.version }),
        {
          description: t('library.templates.overview.itStaysADraftUntil'),
        },
      )
    },
    onError: (error: unknown) => {
      setSaveError(
        error instanceof Error
          ? error.message
          : t('library.templates.overview.couldNotSaveTheNew'),
      )
    },
  })

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

  if (!draft && version.configuration.placements.length > 0) {
    return (
      <TemplateSectionsBoard
        templateId={templateId}
        templateKey={template.data?.key ?? ''}
        displayId={template.data?.displayId ?? null}
        version={version}
        versions={versions.data ?? []}
        onEditSections={() => {
          setSaveError(null)
          setDraft(structuredClone(version.configuration))
        }}
      />
    )
  }

  const config = version.configuration
  const placements = [...config.placements].sort((a, b) => a.order - b.order)

  const startEditing = () => {
    setSaveError(null)
    setDraft(structuredClone(config))
  }

  const stopEditing = () => {
    setDraft(null)
    setSaveError(null)
  }

  const editPlacements = draft
    ? [...draft.placements].sort((a, b) => a.order - b.order)
    : []

  const applyPlacements = (next: NotebookTemplatePlacement[]) => {
    if (!draft) return
    setDraft({ ...draft, placements: withOrders(next) })
  }

  const movePlacement = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= editPlacements.length) return
    const next = [...editPlacements]
    const moved = next[index]
    next[index] = next[target]
    next[target] = moved
    applyPlacements(next)
  }

  const addSection = (key: string, label: string) => {
    if (!draft) return
    const placement: NotebookTemplatePlacement = {
      id: crypto.randomUUID(),
      kind: 'section_placeholder',
      order: editPlacements.length + 1,
      key,
      label,
    }
    setDraft({
      ...draft,
      placements: withOrders([...editPlacements, placement]),
    })
  }

  const addParameter = (input: {
    key: string
    label: string
    required: boolean
    valueType: ScalarValueType
  }) => {
    if (!draft) return
    const parameter: Parameter = {
      id: crypto.randomUUID(),
      key: input.key,
      label: input.label,
      required: input.required,
      type: { kind: 'scalar', valueType: input.valueType },
      constraints: {},
    }
    setDraft({ ...draft, parameters: [...draft.parameters, parameter] })
  }

  const removeParameter = (id: string) => {
    if (!draft) return
    setDraft({
      ...draft,
      parameters: draft.parameters.filter((parameter) => parameter.id !== id),
    })
  }

  /** The RPC and the parser hold the same invariants, so the payload is checked
   * here first — the save error names the field that is wrong. */
  const saveDraft = () => {
    if (!draft) return
    const parsed = notebookTemplateConfigurationSchema.safeParse(draft)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setSaveError(
        `${issue.path.join('.') || t('library.templates.overview.configuration')}: ${issue.message}`,
      )
      return
    }
    setSaveError(null)
    save.mutate(parsed.data)
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-5">
        <Section
          title={t('library.templates.overview.version')}
          count={
            <Status tone={templateLifecycle(version.lifecycle).tone}>
              {templateLifecycle(version.lifecycle).label} v{version.version}
            </Status>
          }
          action={
            draft ? (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  disabled={save.isPending}
                  onClick={stopEditing}
                >
                  {t('common.actions.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={save.isPending}
                  onClick={saveDraft}
                >
                  {save.isPending
                    ? t('common.states.saving')
                    : t('library.templates.overview.saveNewVersion')}
                </Button>
              </span>
            ) : (
              <Button size="sm" icon="edit" onClick={startEditing}>
                {t('common.actions.edit')}
              </Button>
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
              draft
                ? t('library.templates.overview.savingAddsANewVersion')
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </Muted>
        </Section>

        {saveError ? (
          <Notice
            tone="bad"
            title={t('library.templates.overview.couldNotSaveTheNew2')}
          >
            {saveError}
          </Notice>
        ) : null}

        <Section
          title={t('library.templates.overview.sections')}
          count={draft ? draft.placements.length : placements.length}
        >
          {draft ? (
            <>
              {editPlacements.length ? (
                <TableBox>
                  <RegistryGrid
                    label={t('library.templates.overview.templateSections')}
                    rows={editPlacements}
                    columns={sectionColumns(editPlacements.length, {
                      withActions: true,
                      disabled: save.isPending,
                      onMove: movePlacement,
                      onRemove: (id) =>
                        applyPlacements(
                          editPlacements.filter((row) => row.id !== id),
                        ),
                    })}
                    getRowId={(placement) => placement.id}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>
                  {t('library.templates.overview.noSectionsInThisVersion')}
                </Muted>
              )}
              <AddSectionForm disabled={save.isPending} onAdd={addSection} />
            </>
          ) : placements.length ? (
            <TableBox>
              <RegistryGrid
                label={t('library.templates.overview.templateSections')}
                rows={placements}
                columns={sectionColumns(placements.length)}
                getRowId={(placement) => placement.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <Muted>
              {t('library.templates.overview.noSectionsInThisVersion')}
            </Muted>
          )}
        </Section>

        <Section
          title={t('library.templates.overview.parameters')}
          count={draft ? draft.parameters.length : config.parameters.length}
        >
          {draft ? (
            <>
              {draft.parameters.length ? (
                <TableBox>
                  <RegistryGrid
                    label={t('library.templates.overview.templateParameters')}
                    rows={draft.parameters}
                    columns={parameterColumns({
                      withActions: true,
                      disabled: save.isPending,
                      onRemove: removeParameter,
                    })}
                    getRowId={(parameter) => parameter.id}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>
                  {t('library.templates.overview.noParametersDeclared')}
                </Muted>
              )}
              <AddParameterForm
                disabled={save.isPending}
                onAdd={addParameter}
              />
            </>
          ) : config.parameters.length ? (
            <TableBox>
              <RegistryGrid
                label={t('library.templates.overview.templateParameters')}
                rows={config.parameters}
                columns={parameterColumns({})}
                getRowId={(parameter) => parameter.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <Muted>
              {t('library.templates.overview.noParametersDeclared')}
            </Muted>
          )}
        </Section>
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
