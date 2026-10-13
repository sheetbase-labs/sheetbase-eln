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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Select } from '#/components/v3/inventory/list'
import {
  publishedTemplateVersion,
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
  const published = publishedTemplateVersion(versions)
  return published ?? [...versions].sort((a, b) => b.version - a.version).at(0)
}

function sectionKind(placement: { kind: string; blockType?: string }): string {
  if (placement.kind === 'narrative') return placement.blockType ?? 'narrative'
  if (placement.kind === 'sheet') return 'sheet'
  return 'section'
}

function placementName(placement: NotebookTemplatePlacement): string {
  if (placement.kind === 'section_placeholder') return placement.label
  if (placement.kind === 'sheet') return placement.title ?? 'Sheet'
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
        throw new Error('The template is still loading. Try again.')
      return createNotebookTemplateVersion(templateId, revision, configuration)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.versions(templateId),
      })
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.template(templateId),
      })
      setDraft(null)
      setSaveError(null)
      toast(`Saved as v${saved.version}`, {
        description: 'It stays a draft until it is published.',
      })
    },
    onError: (error: unknown) => {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Could not save the new version.',
      )
    },
  })

  if (!version) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title="No version yet"
          body="A template needs a version with sections and parameters before a notebook can be made from it."
        />
      </div>
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
        `${issue.path.join('.') || 'Configuration'}: ${issue.message}`,
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
          title="Version"
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
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={save.isPending}
                  onClick={saveDraft}
                >
                  {save.isPending ? 'Saving…' : 'Save new version'}
                </Button>
              </span>
            ) : (
              <Button size="sm" icon="edit" onClick={startEditing}>
                Edit
              </Button>
            )
          }
        >
          <Muted>
            {version.publishedAt
              ? `Published ${version.publishedAt.slice(0, 10)}. `
              : 'Not published. '}
            Notebooks already made keep the version they started on.
            {draft
              ? ' Saving adds a new version and leaves this one as it is.'
              : ''}
          </Muted>
        </Section>

        {saveError ? (
          <Notice tone="bad" title="Could not save the new version">
            {saveError}
          </Notice>
        ) : null}

        <Section
          title="Sections"
          count={draft ? draft.placements.length : placements.length}
        >
          {draft ? (
            <>
              {editPlacements.length ? (
                <TableBox>
                  <Table aria-label="Template sections">
                    <TableHeader>
                      <TableRow>
                        <TableHead align="right">Order</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Built from</TableHead>
                        <TableHead align="right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editPlacements.map((placement, index) => (
                        <TableRow key={placement.id}>
                          <TableCell align="right" className="num">
                            {placement.order}
                          </TableCell>
                          <TableCell>{placementName(placement)}</TableCell>
                          <TableCell>{sectionKind(placement)}</TableCell>
                          <TableCell className="mono text-fg-muted">
                            {placementSource(placement)}
                          </TableCell>
                          <TableCell align="right">
                            <span className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="quiet"
                                disabled={index === 0 || save.isPending}
                                aria-label={`Move ${placementName(placement)} up`}
                                onClick={() => movePlacement(index, -1)}
                              >
                                Up
                              </Button>
                              <Button
                                size="sm"
                                variant="quiet"
                                disabled={
                                  index === editPlacements.length - 1 ||
                                  save.isPending
                                }
                                aria-label={`Move ${placementName(placement)} down`}
                                onClick={() => movePlacement(index, 1)}
                              >
                                Down
                              </Button>
                              {placement.kind === 'section_placeholder' ? (
                                <Button
                                  size="sm"
                                  variant="quiet"
                                  disabled={save.isPending}
                                  aria-label={`Remove ${placement.label}`}
                                  onClick={() =>
                                    applyPlacements(
                                      editPlacements.filter(
                                        (row) => row.id !== placement.id,
                                      ),
                                    )
                                  }
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <Muted>No sections in this version.</Muted>
              )}
              <AddSectionForm disabled={save.isPending} onAdd={addSection} />
            </>
          ) : placements.length ? (
            <TableBox>
              <Table aria-label="Template sections">
                <TableHeader>
                  <TableRow>
                    <TableHead align="right">Order</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Built from</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {placements.map((placement) => (
                    <TableRow key={placement.id}>
                      <TableCell align="right" className="num">
                        {placement.order}
                      </TableCell>
                      <TableCell>{placementName(placement)}</TableCell>
                      <TableCell>{sectionKind(placement)}</TableCell>
                      <TableCell className="mono text-fg-muted">
                        {placementSource(placement)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No sections in this version.</Muted>
          )}
        </Section>

        <Section
          title="Parameters"
          count={draft ? draft.parameters.length : config.parameters.length}
        >
          {draft ? (
            <>
              {draft.parameters.length ? (
                <TableBox>
                  <Table aria-label="Template parameters">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Key</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead align="right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draft.parameters.map((parameter) => (
                        <TableRow key={parameter.id}>
                          <TableCell className="mono">
                            {parameter.key}
                          </TableCell>
                          <TableCell>{parameterTypeName(parameter)}</TableCell>
                          <TableCell>{parameter.label}</TableCell>
                          <TableCell>
                            {parameter.required ? 'Yes' : '—'}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="sm"
                              variant="quiet"
                              disabled={save.isPending}
                              aria-label={`Remove ${parameter.label}`}
                              onClick={() => removeParameter(parameter.id)}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <Muted>No parameters declared.</Muted>
              )}
              <AddParameterForm
                disabled={save.isPending}
                onAdd={addParameter}
              />
            </>
          ) : config.parameters.length ? (
            <TableBox>
              <Table aria-label="Template parameters">
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Label</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.parameters.map((parameter) => (
                    <TableRow key={parameter.id}>
                      <TableCell className="mono">{parameter.key}</TableCell>
                      <TableCell>{parameter.type.kind}</TableCell>
                      <TableCell>{parameter.label}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No parameters declared.</Muted>
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
      ? 'Lowercase letters, digits and underscore, starting with a letter.'
      : null

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label="Section key"
        required
        hint="e.g. pressure_dp"
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
      <Field label="Label" required className="w-[240px]">
        <Input
          value={label}
          placeholder="e.g. Pressure and ΔP"
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
        Add section
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
      ? 'Lowercase letters, digits and underscore, starting with a letter.'
      : null

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label="Parameter key"
        required
        hint="e.g. sample_id"
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
      <Field label="Label" required className="w-[200px]">
        <Input
          value={label}
          placeholder="e.g. Sample"
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Field label="Type" className="w-[150px]">
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
        Required
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
        Add parameter
      </Button>
    </div>
  )
}
