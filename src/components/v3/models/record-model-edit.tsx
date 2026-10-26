import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/v3/icons'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Inspector,
  InspectorSection,
  Muted,
  PageHeader,
} from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import { hasCapability } from '#/lib/capability'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient, formatNotebookDateTime } from '#/lib/notebook-data'
import {
  RECORD_MODEL_VERSION_KIND,
  createRecordModelVersion,
  discardRecordModelVersion,
  replaceRecordModelVersionDefinition,
} from '#/lib/record-model-versions'
import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/v3/projects/project-data'
import { FieldChangeList } from './field-changes'
import { useWorkspaceRecordModel } from './models-data'
import { useModelApprovalIndex } from './model-approval-data'
import { ModelApprovalPanel } from './model-approval-panel'
import { pendingRequest } from './model-approval'
import {
  diffModelVersions,
  fieldRequiredFor,
  fieldRequiredLabel,
  fieldRule,
  fieldSection,
  fieldSource,
  fieldTypeLabel,
  fieldUnit,
  groupFieldsBySection,
} from './record-model-fields'
import type { ModelVersionField } from './record-model-fields'
import {
  useRecordModelVersionList,
  useRecordModelVersionUsage,
} from './record-model-data'
import { cn } from '#/lib/utils'

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/

/** What an author picks; `decimal_places` decides integer or decimal. */
type FieldKind =
  'text' | 'number' | 'choice' | 'date' | 'timestamp' | 'boolean' | 'link'

const KIND_OPTIONS: { value: FieldKind; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'choice', label: 'Choice' },
  { value: 'date', label: 'Date' },
  { value: 'timestamp', label: 'Date and time' },
  { value: 'boolean', label: 'Yes or no' },
  { value: 'link', label: 'Link' },
]

const SOURCES = ['By hand', 'QC LIMS', 'Calculated', 'Workflow'] as const

function kindOf(field: ModelVersionField): FieldKind {
  switch (field.logical_type) {
    case 'integer':
    case 'decimal':
      return 'number'
    case 'category':
      return 'choice'
    case 'reference':
      return 'link'
    case 'text':
    case 'date':
    case 'timestamp':
    case 'boolean':
      return field.logical_type
    default:
      return 'text'
  }
}

function decimalPlaces(field: ModelVersionField): number {
  const stored = (field as { decimal_places?: unknown }).decimal_places
  if (typeof stored === 'number') return stored
  return field.logical_type === 'decimal' ? 1 : 0
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, 60)
}

function newId(): string {
  return crypto.randomUUID()
}

/** One message per field that cannot be saved, keyed by field id. */
export function fieldIssues(fields: ModelVersionField[]): Map<string, string> {
  const issues = new Map<string, string>()
  const live = fields.filter((f) => f.lifecycle !== 'retired')
  for (const field of live) {
    if (!field.label.trim()) {
      issues.set(field.id, 'Every field needs a name.')
      continue
    }
    if (!KEY_PATTERN.test(field.field_name)) {
      issues.set(
        field.id,
        `Key ${field.field_name || '(empty)'} is not valid. Use lowercase letters, numbers and underscores, starting with a letter.`,
      )
      continue
    }
    const other = fields.find(
      (f) => f.id !== field.id && f.field_name === field.field_name,
    )
    if (other)
      issues.set(
        field.id,
        `Key ${field.field_name} is already used by ${other.label}. Keys must be unique: records store values by key.`,
      )
  }
  return issues
}

function reorder(
  fields: ModelVersionField[],
  id: string,
  targetId: string | null,
  section: string,
): ModelVersionField[] {
  const ordered = [...fields].sort((a, b) => a.display_order - b.display_order)
  const moving = ordered.find((f) => f.id === id)
  if (!moving) return fields
  const rest = ordered.filter((f) => f.id !== id)
  const at = targetId ? rest.findIndex((f) => f.id === targetId) : -1
  const placed = { ...moving, section }
  rest.splice(at < 0 ? rest.length : at, 0, placed)
  return rest.map((f, i) => ({ ...f, display_order: i + 1 }))
}

/** Move a field one place within its section, or into the next one. */
function nudge(
  fields: ModelVersionField[],
  id: string,
  delta: -1 | 1,
): ModelVersionField[] {
  const live = groupFieldsBySection(
    fields.filter((f) => f.lifecycle !== 'retired'),
  ).flatMap((g) => g.fields)
  const index = live.findIndex((f) => f.id === id)
  const neighbour = live.find((_, i) => i === index + delta)
  if (!neighbour) return fields
  return delta < 0
    ? reorder(fields, id, neighbour.id, fieldSection(neighbour))
    : reorder(fields, id, live[index + 2]?.id ?? null, fieldSection(neighbour))
}

/**
 * The ModelEdit board: a record model's open draft as one grid grouped into
 * sections, with the selected field's definition beside it. Edits save to the
 * draft as they are made (when every field is valid); the published version
 * stays in use until the draft is approved. Fields that are already
 * published keep their key and cannot be deleted, only retired.
 */
export function RecordModelEdit({
  modelKey,
  role,
  user,
  workspaceId,
}: {
  modelKey: string
  role: string | null
  user: { id: string; name: string }
  workspaceId: string | null
}) {
  const model = useWorkspaceRecordModel(modelKey)
  const versions = useRecordModelVersionList(model.data?.id)
  const canEdit = hasCapability(role, 'schema.edit')
  const draft = versions.data?.find((v) => v.lifecycle === 'draft') ?? null
  const published = versions.data?.find((v) => v.lifecycle === 'published')
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const startDraft = useMutation({
    mutationFn: () => {
      if (!model.data) throw new Error('Model not found.')
      return createRecordModelVersion(notebookDataClient, {
        modelId: model.data.id,
        reason: reason.trim(),
      })
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['ui-port', 'record-models'] }),
    onError: (cause) =>
      toast('Could not start a draft', {
        description: cause instanceof Error ? cause.message : undefined,
      }),
  })

  if (!model.data) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Models', link: { to: '/models' } }]}
          title={model.isLoading ? 'Loading model…' : 'Model not found'}
        />
      </div>
    )
  }
  if (versions.isLoading)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Models', link: { to: '/models' } }]}
          title={`Edit ${model.data.name}`}
        />
      </div>
    )
  if (!draft)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            { label: 'Models', link: { to: '/models' } },
            {
              label: model.data.name,
              link: { to: '/models/$modelId', params: { modelId: modelKey } },
            },
          ]}
          title={`Edit ${model.data.name}`}
        />
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="schema"
            title="No draft to edit"
            description={`Start a draft to change this model's fields. ${published ? `Published v${published.version} stays in use until the draft is approved.` : ''}`}
            action={
              canEdit ? (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    startDraft.mutate()
                  }}
                >
                  <Field label="Reason for draft" required>
                    <Input
                      required
                      maxLength={500}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!reason.trim() || startDraft.isPending}
                  >
                    Start draft v{(versions.data?.[0]?.version ?? 0) + 1}
                  </Button>
                </form>
              ) : (
                <Muted>Only model owners and admins can start a draft.</Muted>
              )
            }
          />
        </div>
      </div>
    )

  return (
    <DraftEditor
      key={draft.id}
      modelKey={modelKey}
      modelName={model.data.name}
      draft={draft}
      published={published ?? null}
      canEdit={canEdit}
      role={role}
      user={user}
      workspaceId={workspaceId}
    />
  )
}

type Version = NonNullable<
  ReturnType<typeof useRecordModelVersionList>['data']
>[number]

function DraftEditor({
  modelKey,
  modelName,
  draft,
  published,
  canEdit,
  role,
  user,
  workspaceId,
}: {
  modelKey: string
  modelName: string
  draft: Version
  published: Version | null
  canEdit: boolean
  role: string | null
  user: { id: string; name: string }
  workspaceId: string | null
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [fields, setFields] = useState<ModelVersionField[]>(
    draft.definition.fields,
  )
  const [extraSections, setExtraSections] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const publishedIds = new Set(
      (published?.definition.fields ?? []).map((f) => f.id),
    )
    const live = draft.definition.fields.filter(
      (f) => f.lifecycle !== 'retired',
    )
    return (live.find((f) => !publishedIds.has(f.id)) ?? live.at(0))?.id ?? null
  })
  const [revision, setRevision] = useState(draft.revision)
  const [savedAt, setSavedAt] = useState<string | null>(
    typeof draft.updated_at === 'string' ? draft.updated_at : null,
  )
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionName, setSectionName] = useState('')
  const [submitToken, setSubmitToken] = useState(0)
  const dragging = useRef<string | null>(null)
  const revisionRef = useRef(revision)
  revisionRef.current = revision

  const members = useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: () => fetchWorkspaceMemberIdentities(),
  })
  const usage = useRecordModelVersionUsage(draft.model_id)
  const approvals = useModelApprovalIndex(
    [draft.id],
    notebookDataClient,
    RECORD_MODEL_VERSION_KIND,
  )
  const requests = approvals.data?.byVersion.get(draft.id) ?? []
  const pending = pendingRequest(requests)
  const locked = !canEdit || Boolean(pending) || conflict
  const nameOf = (id: string | null | undefined) =>
    (id && members.data?.find((m) => m.user_id === id)?.name) || 'someone'

  const issues = useMemo(() => fieldIssues(fields), [fields])
  const publishedIds = useMemo(
    () => new Set((published?.definition.fields ?? []).map((f) => f.id)),
    [published],
  )
  const changes = useMemo(
    () =>
      diffModelVersions(published?.definition ?? null, {
        ...draft.definition,
        fields,
      }),
    [published, draft.definition, fields],
  )
  const changeKindByLabel = useMemo(() => {
    const byLabel = new Map<string, 'Added' | 'Changed'>()
    for (const c of changes)
      if (c.kind !== 'Removed' && !c.subject.endsWith(' option'))
        byLabel.set(c.subject, c.kind === 'Added' ? 'Added' : 'Changed')
    return byLabel
  }, [changes])

  const live = fields.filter((f) => f.lifecycle !== 'retired')
  const groups = groupFieldsBySection(live)
  const sections = [
    ...groups.map((g) => g.name),
    ...extraSections.filter((s) => !groups.some((g) => g.name === s)),
  ]
  const selected = live.find((f) => f.id === selectedId) ?? null

  const save = useMutation({
    mutationFn: (next: ModelVersionField[]) =>
      replaceRecordModelVersionDefinition(notebookDataClient, {
        versionId: draft.id,
        expectedRevision: revisionRef.current,
        definition: { ...draft.definition, fields: next },
        reason: draft.reason,
      }),
    onSuccess: (version) => {
      setRevision(version.revision)
      setSavedAt(
        typeof version.updated_at === 'string'
          ? version.updated_at
          : new Date().toISOString(),
      )
      setDirty(false)
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (cause) => {
      if (cause instanceof DataClientError && cause.code === 'SB001')
        setConflict(true)
      else
        toast('Could not save the draft', {
          description: cause instanceof Error ? cause.message : undefined,
        })
    },
  })

  // Autosave once typing pauses, but never a draft with a field that cannot be
  // stored: the author fixes it first.
  useEffect(() => {
    if (!dirty || locked || issues.size > 0 || save.isPending) return
    const timer = setTimeout(() => save.mutate(fields), 700)
    return () => clearTimeout(timer)
  }, [dirty, locked, issues.size, fields, save.isPending])

  const discard = useMutation({
    mutationFn: () => discardRecordModelVersion(notebookDataClient, draft.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
      toast('Draft discarded', {
        description: published
          ? `v${published.version} stays in use.`
          : undefined,
      })
      void navigate({
        to: '/models/$modelId/versions',
        params: { modelId: modelKey },
      })
    },
    onError: (cause) =>
      toast('Could not discard the draft', {
        description: cause instanceof Error ? cause.message : undefined,
      }),
  })

  function change(next: ModelVersionField[]) {
    setFields(next)
    setDirty(true)
  }
  function patch(id: string, patchFields: Partial<ModelVersionField>) {
    change(fields.map((f) => (f.id === id ? { ...f, ...patchFields } : f)))
  }
  function patchValidation(
    field: ModelVersionField,
    bound: 'min' | 'max',
    raw: string,
  ) {
    const validation = { ...field.validation }
    if (raw === '') delete validation[bound]
    else validation[bound] = Number(raw)
    patch(field.id, { validation })
  }
  function setKind(field: ModelVersionField, kind: FieldKind) {
    const base: Partial<ModelVersionField> = {}
    if (kind === 'number')
      base.logical_type = decimalPlaces(field) > 0 ? 'decimal' : 'integer'
    else if (kind === 'choice') base.logical_type = 'category'
    else if (kind === 'link') base.logical_type = 'reference'
    else base.logical_type = kind
    patch(field.id, base)
  }
  function setDecimalPlaces(field: ModelVersionField, places: number) {
    patch(field.id, {
      decimal_places: places,
      logical_type: places > 0 ? 'decimal' : 'integer',
    })
  }
  function setRequired(field: ModelVersionField, value: string) {
    const next = { ...field } as Record<string, unknown>
    delete next.required_for
    next.nullable = value !== 'yes'
    if (value === 'release') next.required_for = 'release'
    change(
      fields.map((f) => (f.id === field.id ? (next as ModelVersionField) : f)),
    )
  }
  function setChoices(field: ModelVersionField, text: string) {
    const labels = [
      ...new Set(
        text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    ]
    const existing = field.options ?? []
    patch(field.id, {
      options: labels.map((label, i) => {
        const key = slug(label) || `choice_${i + 1}`
        const match =
          existing.find((o) => o.label === label) ??
          existing.find((o) => o.key === key)
        return {
          id: match?.id ?? newId(),
          key: match?.key ?? key,
          label,
          displayOrder: i + 1,
          lifecycle: 'active' as const,
        }
      }),
    })
  }
  function addField(section: string) {
    const label = 'New field'
    let key = 'new_field'
    for (let n = 2; fields.some((f) => f.field_name === key); n += 1)
      key = `new_field_${n}`
    const field = {
      id: newId(),
      field_name: key,
      label,
      logical_type: 'text',
      nullable: true,
      display_order: fields.length + 1,
      lifecycle: 'active',
      default_value: null,
      validation: {},
      cardinality: 'one',
      options: [],
      section,
      source: 'By hand',
    } as ModelVersionField
    change([...fields, field])
    setSelectedId(field.id)
  }
  function removeField(field: ModelVersionField) {
    if (publishedIds.has(field.id)) patch(field.id, { lifecycle: 'retired' })
    else change(fields.filter((f) => f.id !== field.id))
    setSelectedId(null)
  }

  const savedLabel = conflict
    ? 'Not saved: this draft changed on the server'
    : issues.size > 0
      ? `Not saved: fix ${issues.size} ${issues.size === 1 ? 'field' : 'fields'}`
      : save.isPending
        ? 'Saving…'
        : dirty
          ? 'Unsaved changes'
          : savedAt
            ? `Saved ${formatNotebookDateTime(savedAt).slice(-5)} · revision ${revision}`
            : `Revision ${revision}`

  const startedBy = nameOf(draft.created_by_user_id)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[
            { label: 'Models', link: { to: '/models' } },
            {
              label: modelName,
              link: { to: '/models/$modelId', params: { modelId: modelKey } },
            },
            { label: `Draft v${draft.version}` },
          ]}
          title={`Edit ${modelName}`}
          meta={
            <>
              <span className="text-fg">
                <Status tone="stored">Draft v{draft.version}</Status>
              </span>
              <span>{savedLabel}</span>
              <span className="max-lg:hidden">
                Started by {startedBy},{' '}
                {formatNotebookDateTime(draft.created_at)}
              </span>
            </>
          }
          actions={
            <>
              <Button
                variant="danger"
                disabled={locked || discard.isPending}
                onClick={() => setDiscardOpen(true)}
              >
                Discard draft
              </Button>
              <Button
                variant="primary"
                disabled={
                  locked ||
                  issues.size > 0 ||
                  changes.length === 0 ||
                  dirty ||
                  save.isPending
                }
                onClick={() => setSubmitToken((t) => t + 1)}
              >
                Submit for approval
              </Button>
            </>
          }
        />
        {!canEdit ? (
          <div className="px-4 pt-4 md:px-6">
            <Notice tone="info" icon="lock">
              View only. Only model owners and admins can change {modelName}.
            </Notice>
          </div>
        ) : null}
        {conflict ? (
          <div className="px-4 pt-4 md:px-6">
            <Notice
              tone="warn"
              title="This draft changed on the server."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    void queryClient
                      .invalidateQueries({
                        queryKey: ['ui-port', 'record-models'],
                      })
                      .then(() => window.location.reload())
                  }}
                >
                  Reload theirs
                </Button>
              }
            >
              Nothing of yours was written over theirs. Reload to see their
              version, then make your change again.
            </Notice>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-4 py-2 text-label md:px-6">
          <Icon name="edit" size={14} className="text-fg-muted" />
          <span>
            <span className="font-medium">Draft v{draft.version}</span>
            {published
              ? ` · v${published.version} stays in use until this is approved. `
              : ' · '}
            Edits save to the draft as you go. Values already recorded never
            change.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 pt-4 md:px-6">
          <Muted className="min-w-0 flex-1">
            {live.length} field{live.length === 1 ? '' : 's'} in{' '}
            {sections.length} section{sections.length === 1 ? '' : 's'}
            {published ? (
              <>
                {' · '}
                <span className="text-link">
                  {changes.length} change{changes.length === 1 ? '' : 's'} since
                  v{published.version}
                </span>
              </>
            ) : null}
            {issues.size > 0 ? (
              <span className="text-danger-text">
                {' · '}fix {issues.size} to submit
              </span>
            ) : null}
            {' · '}drag the handle or use ↑ ↓ on it to reorder
          </Muted>
          <Button
            size="sm"
            disabled={locked}
            onClick={() =>
              addField(
                selected
                  ? fieldSection(selected)
                  : (sections.at(-1) ?? 'Fields'),
              )
            }
          >
            <Icon name="plus" size={14} /> Add field
          </Button>
          {addingSection ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                const name = sectionName.trim()
                if (name && !sections.includes(name)) {
                  setExtraSections([...extraSections, name])
                  addField(name)
                }
                setSectionName('')
                setAddingSection(false)
              }}
            >
              <Input
                autoFocus
                aria-label="Section name"
                placeholder="Section name"
                className="h-[26px] w-40"
                value={sectionName}
                onChange={(event) => setSectionName(event.target.value)}
              />
              <Button size="sm" type="submit" disabled={!sectionName.trim()}>
                Add
              </Button>
            </form>
          ) : (
            <Button
              size="sm"
              disabled={locked}
              onClick={() => setAddingSection(true)}
            >
              Add section
            </Button>
          )}
        </div>

        <div className="px-4 py-3 md:px-6">
          <div className="overflow-hidden rounded-md border border-border">
            <Table aria-label="Draft fields">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" aria-label="Reorder" />
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead aria-label="Change" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.flatMap((section) => {
                  const group = groups.find((g) => g.name === section)
                  const rows = group?.fields ?? []
                  return [
                    <TableRow
                      key={`band-${section}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragging.current && !locked)
                          change(
                            reorder(fields, dragging.current, null, section),
                          )
                        dragging.current = null
                      }}
                    >
                      <TableCell
                        colSpan={9}
                        className="bg-surface-muted text-label font-semibold"
                      >
                        {section}{' '}
                        <span className="font-normal text-fg-muted">
                          {rows.length}
                        </span>
                      </TableCell>
                    </TableRow>,
                    ...rows.flatMap((field) => {
                      const issue = issues.get(field.id)
                      const added = !publishedIds.has(field.id)
                      const chip = added
                        ? 'Added'
                        : changeKindByLabel.get(field.label)
                      const isSelected = selectedId === field.id
                      return [
                        <TableRow
                          key={field.id}
                          selected={isSelected}
                          onClick={() => setSelectedId(field.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (dragging.current && !locked)
                              change(
                                reorder(
                                  fields,
                                  dragging.current,
                                  field.id,
                                  fieldSection(field),
                                ),
                              )
                            dragging.current = null
                          }}
                        >
                          <TableCell className="w-6 pr-0">
                            <button
                              type="button"
                              draggable={!locked}
                              disabled={locked}
                              aria-label={`Reorder ${field.label}`}
                              className="cursor-grab border-0 bg-transparent p-0 text-fg-faint"
                              onDragStart={() => {
                                dragging.current = field.id
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key !== 'ArrowUp' &&
                                  event.key !== 'ArrowDown'
                                )
                                  return
                                event.preventDefault()
                                change(
                                  nudge(
                                    fields,
                                    field.id,
                                    event.key === 'ArrowUp' ? -1 : 1,
                                  ),
                                )
                              }}
                            >
                              ⠿
                            </button>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {field.label}
                          </TableCell>
                          <TableCell>
                            {isSelected && added && !locked ? (
                              <Input
                                aria-label="Key"
                                aria-invalid={issue ? true : undefined}
                                className="mono h-[24px] w-[110px] text-label"
                                value={field.field_name}
                                onChange={(event) =>
                                  patch(field.id, {
                                    field_name: event.target.value,
                                  })
                                }
                              />
                            ) : (
                              <span className="mono text-fg-muted">
                                {field.field_name}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {fieldTypeLabel(field)}
                          </TableCell>
                          <TableCell className="text-fg-muted">
                            {fieldUnit(field) ?? '—'}
                          </TableCell>
                          <TableCell>{fieldRequiredLabel(field)}</TableCell>
                          <TableCell className="whitespace-normal text-fg-muted">
                            {fieldRule(field) ?? '—'}
                          </TableCell>
                          <TableCell>{fieldSource(field)}</TableCell>
                          <TableCell>
                            {chip ? (
                              <span
                                className={cn(
                                  'rounded-[3px] px-1.5 text-caption font-medium',
                                  chip === 'Added'
                                    ? 'bg-success-wash text-success-text'
                                    : 'bg-warning-wash text-warning-text',
                                )}
                              >
                                {chip}
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>,
                        ...(issue
                          ? [
                              <TableRow key={`${field.id}-issue`}>
                                <TableCell
                                  colSpan={9}
                                  className="bg-danger-wash"
                                >
                                  <span
                                    role="alert"
                                    className="flex items-center gap-1.5 text-label text-danger-text"
                                  >
                                    <Icon name="warn" size={14} /> {issue}
                                  </span>
                                </TableCell>
                              </TableRow>,
                            ]
                          : []),
                      ]
                    }),
                  ]
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <section
          aria-label="Changes since the published version"
          className="px-4 pb-4 md:px-6"
        >
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="m-0 text-section">
              {changes.length} change{changes.length === 1 ? '' : 's'}
              {published ? ` since v${published.version}` : ''}
            </h2>
            {issues.size > 0 ? (
              <span className="ml-auto text-label text-danger-text">
                {issues.size} to fix before submitting
              </span>
            ) : null}
          </div>
          {changes.length ? (
            <FieldChangeList changes={changes} label="Draft changes" />
          ) : (
            <Muted>No changes yet.</Muted>
          )}
        </section>

        <ModelApprovalPanel
          version={{ ...draft, lifecycle: 'draft', revision }}
          objectKind={RECORD_MODEL_VERSION_KIND}
          publishedVersion={published?.version ?? null}
          requests={requests}
          decisions={approvals.data?.decisions ?? []}
          role={role}
          user={user}
          workspaceId={workspaceId}
          submitToken={submitToken}
        />
      </div>

      <Inspector label="Field editor" width={340}>
        {selected ? (
          <FieldInspector
            field={selected}
            issue={issues.get(selected.id)}
            sections={sections}
            locked={locked}
            added={!publishedIds.has(selected.id)}
            keyLocked={publishedIds.has(selected.id)}
            publishedVersion={published?.version ?? null}
            recordCount={
              usage.data?.reduce((sum, row) => sum + row.record_count, 0) ?? 0
            }
            draftVersion={draft.version}
            onPatch={(p) => patch(selected.id, p)}
            onKind={(k) => setKind(selected, k)}
            onDecimals={(n) => setDecimalPlaces(selected, n)}
            onRequired={(v) => setRequired(selected, v)}
            onChoices={(t) => setChoices(selected, t)}
            onBound={(bound, raw) => patchValidation(selected, bound, raw)}
            onRemove={() => removeField(selected)}
          />
        ) : (
          <InspectorSection title="Field">
            <Muted>
              Choose a field to edit its name, type, unit, rule and who fills it
              in. Changes save to draft v{draft.version}.
            </Muted>
          </InspectorSection>
        )}
        <InspectorSection title="Approval">
          <Muted>
            Submitting sends v{draft.version} to a reviewer. The approver signs
            with their password; v{published?.version ?? '—'} is replaced for
            new records then, and existing records keep their version until
            their owner updates them.
          </Muted>
        </InspectorSection>
      </Inspector>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogHeader
            title={`Discard draft v${draft.version}?`}
            description={`The ${changes.length} change${changes.length === 1 ? '' : 's'} in this draft are lost. ${published ? `v${published.version} stays in use.` : ''}`}
          />
          <DialogBody>
            <Muted>Records are not affected: none were made on a draft.</Muted>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              Keep editing
            </DialogClose>
            <Button
              variant="danger"
              disabled={discard.isPending}
              onClick={() => discard.mutate()}
            >
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FieldInspector({
  field,
  issue,
  sections,
  locked,
  added,
  keyLocked,
  publishedVersion,
  recordCount,
  draftVersion,
  onPatch,
  onKind,
  onDecimals,
  onRequired,
  onChoices,
  onBound,
  onRemove,
}: {
  field: ModelVersionField
  issue: string | undefined
  sections: string[]
  locked: boolean
  added: boolean
  keyLocked: boolean
  publishedVersion: number | null
  recordCount: number
  draftVersion: number
  onPatch: (patch: Partial<ModelVersionField>) => void
  onKind: (kind: FieldKind) => void
  onDecimals: (places: number) => void
  onRequired: (value: string) => void
  onChoices: (text: string) => void
  onBound: (bound: 'min' | 'max', raw: string) => void
  onRemove: () => void
}) {
  const kind = kindOf(field)
  const bound = (b: 'min' | 'max') => {
    const v = field.validation[b]
    return typeof v === 'number' ? String(v) : ''
  }
  return (
    <fieldset
      disabled={locked}
      className="m-0 flex flex-col gap-4 border-0 p-0"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-label text-fg-muted">
          Field{added ? ` · new in draft` : ''}
        </span>
        <div className="font-heading text-doc font-semibold">{field.label}</div>
        <span className="mono text-label text-fg-muted">
          {field.field_name}
        </span>
      </div>
      <Field label="Name" required>
        <Input
          value={field.label}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </Field>
      <Field
        label="Key"
        required
        error={issue}
        hint={
          keyLocked
            ? `Locked: published in v${publishedVersion}. Records store values by key.`
            : undefined
        }
      >
        <Input
          className="mono"
          aria-invalid={issue ? true : undefined}
          disabled={keyLocked}
          value={field.field_name}
          onChange={(event) => onPatch({ field_name: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select
            aria-label="Type"
            value={kind}
            onChange={(event) =>
              onKind(
                KIND_OPTIONS.find((o) => o.value === event.target.value)
                  ?.value ?? 'text',
              )
            }
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Section">
          <Select
            aria-label="Section"
            value={fieldSection(field)}
            onChange={(event) => onPatch({ section: event.target.value })}
          >
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {kind === 'number' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Decimal places">
              <Input
                type="number"
                min={0}
                max={6}
                value={decimalPlaces(field)}
                onChange={(event) =>
                  onDecimals(Math.max(0, Number(event.target.value) || 0))
                }
              />
            </Field>
            <Field label="Unit">
              <Input
                value={fieldUnit(field) ?? ''}
                onChange={(event) =>
                  onPatch({
                    unit: event.target.value || null,
                  })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum">
              <Input
                type="number"
                value={bound('min')}
                onChange={(event) => onBound('min', event.target.value)}
              />
            </Field>
            <Field label="Maximum">
              <Input
                type="number"
                value={bound('max')}
                onChange={(event) => onBound('max', event.target.value)}
              />
            </Field>
          </div>
        </>
      ) : null}
      {kind === 'choice' ? (
        <Field label="Choices" hint="One choice per line.">
          <Textarea
            rows={5}
            value={(field.options ?? [])
              .filter((o) => o.lifecycle !== 'retired')
              .map((o) => o.label)
              .join('\n')}
            onChange={(event) => onChoices(event.target.value)}
          />
        </Field>
      ) : null}
      {kind === 'link' ? (
        <Field label="Links to" hint="A record model key, e.g. cell_bank.">
          <Input
            value={
              typeof field.validation.targetModelKey === 'string'
                ? field.validation.targetModelKey
                : ''
            }
            onChange={(event) =>
              onPatch({
                validation: {
                  ...field.validation,
                  targetModelKey: event.target.value,
                },
                relationship: {
                  target: { kind: 'model', modelKey: event.target.value },
                  cardinality: 'one',
                },
              })
            }
          />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Required">
          <Select
            aria-label="Required"
            value={
              fieldRequiredFor(field)
                ? 'release'
                : field.nullable
                  ? 'no'
                  : 'yes'
            }
            onChange={(event) => onRequired(event.target.value)}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="release">To release</option>
          </Select>
        </Field>
        <Field label="Source">
          <Select
            aria-label="Source"
            value={fieldSource(field)}
            onChange={(event) =>
              onPatch({
                source: event.target.value,
              })
            }
          >
            {[...new Set([...SOURCES, fieldSource(field)])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-label font-semibold">In records</h3>
        <Muted>
          {added
            ? `New in v${draftVersion}. It starts empty on all ${recordCount} records.`
            : `Already on v${publishedVersion}. Values recorded so far never change.`}
        </Muted>
      </div>
      <div>
        <Button variant="danger" onClick={onRemove}>
          <Icon name="x" size={14} /> {added ? 'Remove field' : 'Retire field'}
        </Button>
      </div>
    </fieldset>
  )
}
