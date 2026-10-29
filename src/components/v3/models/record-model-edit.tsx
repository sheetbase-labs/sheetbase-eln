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
import { useInheritedFieldGroups } from './model-subtype-ui'
import { InheritedLabel, InheritedTableRows } from './inherited-fields-table'
import { t } from '#/copy'

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/

/** What an author picks; `decimal_places` decides integer or decimal. */
type FieldKind =
  'text' | 'number' | 'choice' | 'date' | 'timestamp' | 'boolean' | 'link'

const KIND_OPTIONS: { value: FieldKind; label: string }[] = [
  { value: 'text', label: t('library.models.recordModelEdit.text') },
  { value: 'number', label: t('library.models.recordModelEdit.number') },
  { value: 'choice', label: t('library.models.recordModelEdit.choice') },
  { value: 'date', label: t('library.models.recordModelEdit.date') },
  {
    value: 'timestamp',
    label: t('library.models.recordModelEdit.dateAndTime'),
  },
  { value: 'boolean', label: t('library.models.recordModelEdit.yesOrNo') },
  { value: 'link', label: t('library.models.recordModelEdit.link') },
]

const SOURCES = [
  t('library.models.recordModelEdit.byHand'),
  t('library.models.recordModelEdit.qcLims'),
  t('library.models.recordModelEdit.calculated'),
  t('library.models.recordModelEdit.workflow'),
] as const

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
      issues.set(
        field.id,
        t('library.models.recordModelEdit.everyFieldNeedsAName'),
      )
      continue
    }
    if (!KEY_PATTERN.test(field.field_name)) {
      issues.set(
        field.id,
        t('library.models.recordModelEdit.keyIsNotValidUse', {
          fieldName: field.field_name || '(empty)',
        }),
      )
      continue
    }
    const other = fields.find(
      (f) => f.id !== field.id && f.field_name === field.field_name,
    )
    if (other)
      issues.set(
        field.id,
        t('library.models.recordModelEdit.keyIsAlreadyUsedBy', {
          fieldName: field.field_name,
          label: other.label,
        }),
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
      if (!model.data)
        throw new Error(t('library.models.recordModelEdit.modelNotFound'))
      return createRecordModelVersion(notebookDataClient, {
        modelId: model.data.id,
        reason: reason.trim(),
      })
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['ui-port', 'record-models'] }),
    onError: (cause) =>
      toast(t('library.models.recordModelEdit.couldNotStartADraft'), {
        description: cause instanceof Error ? cause.message : undefined,
      }),
  })

  if (!model.data) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.models.recordModelEdit.models'),
              link: { to: '/models' },
            },
          ]}
          title={
            model.isLoading
              ? t('library.models.recordModelEdit.loadingModel')
              : t('library.models.recordModelEdit.modelNotFound2')
          }
        />
      </div>
    )
  }
  if (versions.isLoading)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.models.recordModelEdit.models'),
              link: { to: '/models' },
            },
          ]}
          title={t('library.models.recordModelEdit.edit', {
            name: model.data.name,
          })}
        />
      </div>
    )
  if (!draft)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.models.recordModelEdit.models'),
              link: { to: '/models' },
            },
            {
              label: model.data.name,
              link: { to: '/models/$modelId', params: { modelId: modelKey } },
            },
          ]}
          title={t('library.models.recordModelEdit.edit', {
            name: model.data.name,
          })}
        />
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="schema"
            title={t('library.models.recordModelEdit.noDraftToEdit')}
            description={
              published
                ? t(
                    'library.models.recordModelEdit.startADraftToChangePublished',
                    { version: published.version },
                  )
                : t('library.models.recordModelEdit.startADraftToChange')
            }
            action={
              canEdit ? (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    startDraft.mutate()
                  }}
                >
                  <Field
                    label={t('library.models.recordModelEdit.reasonForDraft')}
                    required
                  >
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
                    {t('library.models.recordModelEdit.startDraftV', {
                      version: (versions.data?.[0]?.version ?? 0) + 1,
                    })}
                  </Button>
                </form>
              ) : (
                <Muted>
                  {t('library.models.recordModelEdit.onlyModelOwnersAndAdmins')}
                </Muted>
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
  const inherited = useInheritedFieldGroups(modelKey)
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
    const byLabel = new Map<string, string>()
    for (const c of changes)
      if (c.kind !== 'Removed' && !c.subject.endsWith(' option'))
        byLabel.set(
          c.subject,
          c.kind === 'Added'
            ? t('library.models.recordModelEdit.added')
            : t('library.models.recordModelEdit.changed'),
        )
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
        toast(t('library.models.recordModelEdit.couldNotSaveTheDraft'), {
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
      toast(t('library.models.recordModelEdit.draftDiscarded'), {
        description: published
          ? t('library.models.recordModelEdit.vStaysInUse', {
              version: published.version,
            })
          : undefined,
      })
      void navigate({
        to: '/models/$modelId/versions',
        params: { modelId: modelKey },
      })
    },
    onError: (cause) =>
      toast(t('library.models.recordModelEdit.couldNotDiscardTheDraft'), {
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
    const label = t('library.models.recordModelEdit.newField')
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
      source: t('library.models.recordModelEdit.byHand'),
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
    ? t('library.models.recordModelEdit.notSavedThisDraftChanged')
    : issues.size > 0
      ? t('library.models.recordModelEdit.notSavedFixFields', {
          count: issues.size,
        })
      : save.isPending
        ? 'Saving…'
        : dirty
          ? t('library.models.recordModelEdit.unsavedChanges')
          : savedAt
            ? t('library.models.recordModelEdit.savedRevision', {
                savedAt: formatNotebookDateTime(savedAt).slice(-5),
                revision,
              })
            : t('library.models.recordModelEdit.revision', { revision })

  const startedBy = nameOf(draft.created_by_user_id)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[
            {
              label: t('library.models.recordModelEdit.models'),
              link: { to: '/models' },
            },
            {
              label: modelName,
              link: { to: '/models/$modelId', params: { modelId: modelKey } },
            },
            {
              label: t('library.models.recordModelEdit.draftV', {
                version: draft.version,
              }),
            },
          ]}
          title={t('library.models.recordModelEdit.edit2', { modelName })}
          meta={
            <>
              <span className="text-fg">
                <Status tone="stored">
                  {t('library.models.recordModelEdit.draftV', {
                    version: draft.version,
                  })}
                </Status>
              </span>
              <span>{savedLabel}</span>
              <span className="max-lg:hidden">
                {t('library.models.recordModelEdit.startedBy', {
                  startedBy,
                  createdAt: formatNotebookDateTime(draft.created_at),
                })}
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
                {t('library.models.recordModelEdit.discardDraft')}
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
                onClick={() => setSubmitToken((item) => item + 1)}
              >
                {t('library.models.recordModelEdit.submitForApproval')}
              </Button>
            </>
          }
        />
        {!canEdit ? (
          <div className="px-4 pt-4 md:px-6">
            <Notice tone="info" icon="lock">
              {t('library.models.recordModelEdit.viewOnlyOnlyModelOwners', {
                modelName,
              })}
            </Notice>
          </div>
        ) : null}
        {conflict ? (
          <div className="px-4 pt-4 md:px-6">
            <Notice
              tone="warn"
              title={t('library.models.recordModelEdit.thisDraftChangedOnThe')}
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
                  {t('library.models.recordModelEdit.reloadTheirs')}
                </Button>
              }
            >
              {t('library.models.recordModelEdit.nothingOfYoursWasWritten')}
            </Notice>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-4 py-2 text-label md:px-6">
          <Icon name="edit" size={14} className="text-fg-muted" />
          <span>
            <span className="font-medium">
              {t('library.models.recordModelEdit.draftV', {
                version: draft.version,
              })}
            </span>
            {published
              ? t('library.models.recordModelEdit.vStaysInUseUntil', {
                  version: published.version,
                })
              : ' · '}
            {t('library.models.recordModelEdit.editsSaveToTheDraft')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 pt-4 md:px-6">
          <Muted className="min-w-0 flex-1">
            {t('library.models.recordModelEdit.fieldsInSections', {
              fields: t('library.models.counts.fields', {
                count: live.length,
              }),
              sections: t('library.models.counts.sections', {
                count: sections.length,
              }),
            })}
            {published ? (
              <>
                {' · '}
                <span className="text-link">
                  {t('library.models.recordModelEdit.changesSinceV', {
                    count: changes.length,
                    version: published.version,
                  })}
                </span>
              </>
            ) : null}
            {issues.size > 0 ? (
              <span className="text-danger-text">
                {' '}
                {t('library.models.recordModelEdit.fixToSubmit', {
                  issues: issues.size,
                })}
              </span>
            ) : null}{' '}
            {t('library.models.recordModelEdit.dragTheHandleOrUse')}
          </Muted>
          <Button
            size="sm"
            disabled={locked}
            onClick={() =>
              addField(
                selected
                  ? fieldSection(selected)
                  : (sections.at(-1) ??
                      t('library.models.recordModelEdit.fields')),
              )
            }
          >
            <Icon name="plus" size={14} />{' '}
            {t('library.models.recordModelEdit.addField')}
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
                aria-label={t('library.models.recordModelEdit.sectionName')}
                placeholder={t('library.models.recordModelEdit.sectionName')}
                className="h-[26px] w-40"
                value={sectionName}
                onChange={(event) => setSectionName(event.target.value)}
              />
              <Button size="sm" type="submit" disabled={!sectionName.trim()}>
                {t('common.actions.add')}
              </Button>
            </form>
          ) : (
            <Button
              size="sm"
              disabled={locked}
              onClick={() => setAddingSection(true)}
            >
              {t('library.models.recordModelEdit.addSection')}
            </Button>
          )}
        </div>

        <div className="px-4 py-3 md:px-6">
          <div className="overflow-hidden rounded-md border border-border">
            <Table aria-label={t('library.models.recordModelEdit.draftFields')}>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="w-6"
                    aria-label={t('library.models.recordModelEdit.reorder')}
                  />
                  <TableHead>
                    {t('library.models.recordModelEdit.name')}
                  </TableHead>
                  <TableHead>
                    {t('library.models.recordModelEdit.key')}
                  </TableHead>
                  <TableHead>
                    {t('library.models.recordModelEdit.type')}
                  </TableHead>
                  <TableHead>
                    {t('library.models.recordModelEdit.unit')}
                  </TableHead>
                  <TableHead>{t('common.states.required')}</TableHead>
                  <TableHead>
                    {t('library.models.recordModelEdit.rule')}
                  </TableHead>
                  <TableHead>
                    {t('library.models.recordModelEdit.source')}
                  </TableHead>
                  <TableHead
                    aria-label={t('library.models.recordModelEdit.change')}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                <InheritedTableRows
                  groups={inherited.groups}
                  colSpan={9}
                  cells={(row) => (
                    <>
                      <TableCell className="w-6 pr-0" />
                      <TableCell className="whitespace-normal">
                        <InheritedLabel row={row} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'text-fg-muted',
                            row.key ? 'mono' : undefined,
                          )}
                        >
                          {row.key ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal text-fg-muted">
                        {row.type}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {row.unit ?? '—'}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {row.required}
                      </TableCell>
                      <TableCell className="text-fg-muted">—</TableCell>
                      <TableCell className="text-fg-muted">—</TableCell>
                      <TableCell />
                    </>
                  )}
                />
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
                        ? t('library.models.recordModelEdit.added')
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
                              aria-label={t(
                                'library.models.recordModelEdit.reorder2',
                                { label: field.label },
                              )}
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
                                aria-label={t(
                                  'library.models.recordModelEdit.key',
                                )}
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
          aria-label={t(
            'library.models.recordModelEdit.changesSinceThePublishedVersion',
          )}
          className="px-4 pb-4 md:px-6"
        >
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="m-0 text-section">
              {t('library.models.recordModelEdit.changes', {
                count: changes.length,
              })}
              {published
                ? t('library.models.recordModelEdit.sinceV', {
                    version: published.version,
                  })
                : ''}
            </h2>
            {issues.size > 0 ? (
              <span className="ml-auto text-label text-danger-text">
                {t('library.models.recordModelEdit.toFixBeforeSubmitting', {
                  issues: issues.size,
                })}
              </span>
            ) : null}
          </div>
          {changes.length ? (
            <FieldChangeList
              changes={changes}
              label={t('library.models.recordModelEdit.draftChanges')}
            />
          ) : (
            <Muted>{t('library.models.recordModelEdit.noChangesYet')}</Muted>
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

      <Inspector
        label={t('library.models.recordModelEdit.fieldEditor')}
        width={340}
      >
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
            onChoices={(item) => setChoices(selected, item)}
            onBound={(bound, raw) => patchValidation(selected, bound, raw)}
            onRemove={() => removeField(selected)}
          />
        ) : (
          <InspectorSection title={t('library.models.recordModelEdit.field')}>
            <Muted>
              {t('library.models.recordModelEdit.chooseAFieldToEdit', {
                version: draft.version,
              })}
            </Muted>
          </InspectorSection>
        )}
        <InspectorSection title={t('library.models.recordModelEdit.approval')}>
          <Muted>
            {t('library.models.recordModelEdit.submittingSendsVToA', {
              version: draft.version,
              publishedVersion: published?.version ?? '—',
            })}
          </Muted>
        </InspectorSection>
      </Inspector>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.models.recordModelEdit.discardDraftV', {
              version: draft.version,
            })}
            description={
              published
                ? t(
                    'library.models.recordModelEdit.theChangesInThisDraftPublished',
                    { count: changes.length, version: published.version },
                  )
                : t('library.models.recordModelEdit.theChangesInThisDraft', {
                    count: changes.length,
                  })
            }
          />
          <DialogBody>
            <Muted>
              {t('library.models.recordModelEdit.recordsAreNotAffectedNone')}
            </Muted>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('library.models.recordModelEdit.keepEditing')}
            </DialogClose>
            <Button
              variant="danger"
              disabled={discard.isPending}
              onClick={() => discard.mutate()}
            >
              {t('library.models.recordModelEdit.discardDraft')}
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
          {t('library.models.recordModelEdit.field')}
          {added ? t('library.models.recordModelEdit.newInDraft') : ''}
        </span>
        <div className="font-heading text-doc font-semibold">{field.label}</div>
        <span className="mono text-label text-fg-muted">
          {field.field_name}
        </span>
      </div>
      <Field label={t('library.models.recordModelEdit.name')} required>
        <Input
          value={field.label}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </Field>
      <Field
        label={t('library.models.recordModelEdit.key')}
        required
        error={issue}
        hint={
          keyLocked
            ? t('library.models.recordModelEdit.lockedPublishedInVRecords', {
                publishedVersion: publishedVersion ?? '—',
              })
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
        <Field label={t('library.models.recordModelEdit.type')}>
          <Select
            aria-label={t('library.models.recordModelEdit.type')}
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
        <Field label={t('library.models.recordModelEdit.section')}>
          <Select
            aria-label={t('library.models.recordModelEdit.section')}
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
            <Field label={t('library.models.recordModelEdit.decimalPlaces')}>
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
            <Field label={t('library.models.recordModelEdit.unit')}>
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
            <Field label={t('library.models.recordModelEdit.minimum')}>
              <Input
                type="number"
                value={bound('min')}
                onChange={(event) => onBound('min', event.target.value)}
              />
            </Field>
            <Field label={t('library.models.recordModelEdit.maximum')}>
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
        <Field
          label={t('library.models.recordModelEdit.choices')}
          hint={t('library.models.recordModelEdit.oneChoicePerLine')}
        >
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
        <Field
          label={t('library.models.recordModelEdit.linksTo')}
          hint={t('library.models.recordModelEdit.aRecordModelKeyE')}
        >
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
        <Field label={t('common.states.required')}>
          <Select
            aria-label={t('common.states.required')}
            value={
              fieldRequiredFor(field)
                ? 'release'
                : field.nullable
                  ? 'no'
                  : 'yes'
            }
            onChange={(event) => onRequired(event.target.value)}
          >
            <option value="yes">
              {t('library.models.recordModelEdit.yes')}
            </option>
            <option value="no">{t('library.models.recordModelEdit.no')}</option>
            <option value="release">
              {t('library.models.recordModelEdit.toRelease')}
            </option>
          </Select>
        </Field>
        <Field label={t('library.models.recordModelEdit.source')}>
          <Select
            aria-label={t('library.models.recordModelEdit.source')}
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
        <h3 className="m-0 text-label font-semibold">
          {t('library.models.recordModelEdit.inRecords')}
        </h3>
        <Muted>
          {added
            ? t('library.models.recordModelEdit.newInVItStarts', {
                draftVersion,
                recordCount,
              })
            : t('library.models.recordModelEdit.alreadyOnVValuesRecorded', {
                publishedVersion: publishedVersion ?? '—',
              })}
        </Muted>
      </div>
      <div>
        <Button variant="danger" onClick={onRemove}>
          <Icon name="x" size={14} />{' '}
          {added
            ? t('library.models.recordModelEdit.removeField')
            : t('library.models.recordModelEdit.retireField')}
        </Button>
      </div>
    </fieldset>
  )
}
