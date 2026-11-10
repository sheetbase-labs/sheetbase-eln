import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  Inspector,
  InspectorSection,
  Muted,
  PageHeader,
} from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Status } from '#/components/ui/status'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { EmptyState } from '#/components/ui/empty-state'
import { Select } from '#/components/ui/select'
import { Textarea } from '#/components/inventory/list'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import { DATASET_SCHEMA_VERSION_KIND } from '#/lib/approval-requests'
import {
  createNextDatasetSchemaVersion,
  deleteDatasetSchemaVersion,
  publishDatasetSchemaVersion,
  replaceDatasetSchemaVersionFields,
} from '#/lib/dataset-schema-definition-rpc'
import type { DatasetSchemaFieldInput } from '#/lib/dataset-schema-definition-rpc'
import {
  DATASET_FIELD_TYPES,
  computeChanges,
  detectDraftConflict,
  fieldSnapshot,
  isApprovalLock,
  isStaleRevision,
  mergeDraftRows,
  moveField,
  newDraftField,
  orderedForSave,
  toDraftField,
  validateDraft,
} from '#/lib/dataset-schema-draft'
import type { DraftConflict, DraftField } from '#/lib/dataset-schema-draft'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import {
  useModelDefinition,
  useModelFields,
  useModelVersions,
} from '#/components/models/models-data'
import { useModelApprovalIndex } from '#/components/models/model-approval-data'
import { ModelApprovalPanel } from '#/components/models/model-approval-panel'
import { DraftConflictBanner } from '#/components/models/draft-conflict-banner'
import { useInheritedColumnGroups } from '#/components/models/dataset-subtype-ui'
import {
  InheritedLabel,
  InheritedTableRows,
  TableBand,
} from '#/components/models/inherited-fields-table'
import { RecordModelEdit } from '#/components/models/record-model-edit'
import { isUuid } from '#/lib/field-value-validation'
import {
  canPublishDraft,
  pendingRequest,
} from '#/components/models/model-approval'
import { t } from '#/copy'

/**
 * UI port (roadmap-4/ui-app3): the model editor (MDL-02/MDL-03/R5-CONFIG-03).
 *
 * Edits a draft schema version while the published one stays in use; publishing
 * runs the CORE-05 RPC, so the capability and rules stay server-side.
 * `?state=denied` drives the acceptance suite.
 *
 * R5-CONFIG-03 adds the three things the design's editor carries and the ELN's
 * did not:
 *
 *  1. **Approval.** MDL-03 is in the accepted model, so this task is not
 *     reduced. The draft is submitted from here through the same reusable
 *     `api.approval_requests` RPCs the Versions tab uses, over the same draft
 *     version — submission never forks the draft. The accepted policy keeps a
 *     version locked while its request is open (SB085), so "edit after
 *     submitting" means editing the same draft again after a *return* (or
 *     withdraw), never a silent edit under review. Editing after an approval
 *     bumps the revision, which invalidates the approval, and the panel says so
 *     rather than letting a stale approval publish. Publication itself is
 *     refused by `internal.approval_publish_blocker` (SB084).
 *  2. **Conflict.** Every save sends the revision it read
 *     (`p_expected_revision`), the pattern MDL-03 established on Record Model
 *     versions. A save that lost the race is refused (SB001) and reconciled
 *     explicitly: Reload theirs, or Merge and keep editing when the two sides
 *     touched different fields, or Keep mine as an explicit overwrite when they
 *     overlap. A conflict never silently wins.
 *  3. **Field contracts.** The inspector authors canonical quantity metadata,
 *     category options, reference targets and scalar defaults. `category` is
 *     controlled vocabulary metadata, not a free-text display section.
 */
export const Route = createFileRoute('/models/$modelId/edit')({
  validateSearch: z.object({
    field: z.string().optional().catch(undefined),
    state: z.enum(['denied', 'empty']).optional().catch(undefined),
  }),
  component: ModelEditRoute,
})

/** A workspace record model (addressed by key) edits through its own draft
 * editor; a dataset-schema model (uuid) keeps this one. */
function ModelEditRoute() {
  const { modelId } = Route.useParams()
  const { context } = Route.useRouteContext()

  return isUuid(modelId) ? (
    <ModelEditor />
  ) : (
    <RecordModelEdit
      modelKey={modelId}
      role={context.workspace?.role ?? null}
      user={{ id: context.user.id, name: context.user.name }}
      workspaceId={context.workspace?.id ?? null}
    />
  )
}

function useDatasetEditorContext() {
  const { modelId } = Route.useParams()
  const { state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const definition = useModelDefinition(modelId)
  const versions = useModelVersions(modelId)

  const draft = versions.data?.find((v) => v.lifecycle === 'draft') ?? null
  // `chk_dataset_schema_versions_lifecycle` allows draft/active/retired: a
  // version that has been published is `active` (or `retired`), never
  // `published`. The in-use version is the highest non-draft one.
  const inUse = versions.data?.find((v) => v.lifecycle !== 'draft') ?? null
  const draftFields = useModelFields(draft?.id)
  const inherited = useInheritedColumnGroups(modelId)
  const inheritedKeys = inherited.keys
  const publishedFields = useModelFields(inUse?.id)

  const role = context.workspace?.role ?? null
  const user = { id: context.user.id, name: context.user.name }
  const workspaceId = context.workspace?.id ?? null
  const canEdit = hasCapability(role, 'schema.edit')
  const canPublish = hasCapability(role, 'schema.publish')
  const denied = state === 'denied' || !canEdit
  const publication = useDatasetPublication(draft, denied, canEdit)

  return {
    ...publication,
    modelId,
    definition,
    model: definition.data,
    versions,
    draft,
    inUse,
    draftFields,
    publishedFields,
    inherited,
    inheritedKeys,
    role,
    user,
    workspaceId,
    denied,
    canPublish,
  }
}

function useDatasetPublication(
  draft: DatasetDraftEditingInput['draft'],
  denied: boolean,
  canEdit: boolean,
) {
  const approval = useModelApprovalIndex(
    draft ? [draft.id] : [],
    notebookDataClient,
    DATASET_SCHEMA_VERSION_KIND,
  )

  const policy = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
  })

  const requests = draft ? (approval.data?.byVersion.get(draft.id) ?? []) : []
  const decisions = approval.data?.decisions ?? []
  const pending = pendingRequest(requests)
  const approvalRequired = policy.data?.publicationApprovalRequired ?? false
  const approvalGoverns = approvalRequired || requests.length > 0

  const publishAllowed = draft
    ? canPublishDraft(requests, approvalRequired, draft.revision)
    : false

  // The server locks a draft while a request is open (SB085), so the editor
  // must not pretend to accept edits then.
  const locked = denied || pending !== null
  const canSubmitNow = Boolean(draft) && !denied && !pending && canEdit

  return {
    requests,
    decisions,
    approvalRequired,
    approvalGoverns,
    publishAllowed,
    locked,
    canSubmitNow,
  }
}

type DatasetEditorContext = ReturnType<typeof useDatasetEditorContext>

function useModelEditor(data: DatasetEditorContext) {
  const { modelId, draft, locked, versions, draftFields, publishedFields } =
    data

  const queryClient = useQueryClient()

  const editing = useDatasetDraftEditing({
    draft,
    locked,
    versions,
    draftFields,
    publishedFields,
  })

  const [submitToken, setSubmitToken] = useState(0)
  const [publishOpen, setPublishOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  const startDraft = useMutation({
    mutationFn: () =>
      createNextDatasetSchemaVersion(notebookDataClient, modelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast(t('library.models.edit.draftStarted'))
    },
  })

  const discard = useMutation({
    mutationFn: () => deleteDatasetSchemaVersion(notebookDataClient, draft!.id),
    onSuccess: () => {
      setDiscardOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast(t('library.models.edit.draftDiscarded'))
    },
    onError: (cause) => editing.setError(errorMessage(cause)),
  })

  const publish = useMutation({
    mutationFn: () =>
      publishDatasetSchemaVersion(notebookDataClient, draft!.id),
    onSuccess: () => {
      setPublishOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast(t('library.models.edit.versionPublished'), {
        description: t('library.models.edit.datasetsKeepTheVersionThey'),
      })
    },
    onError: (cause) => editing.setError(errorMessage(cause)),
  })

  return {
    ...data,
    ...editing,
    submitToken,
    startDraft,
    discard,
    publish,
    discardOpen,
    setDiscardOpen,
    publishOpen,
    setPublishOpen,
    setSubmitToken,
  }
}

type DatasetDraftEditingInput = {
  draft: NonNullable<ReturnType<typeof useModelVersions>['data']>[number] | null
  locked: boolean
  versions: ReturnType<typeof useModelVersions>
  draftFields: ReturnType<typeof useModelFields>
  publishedFields: ReturnType<typeof useModelFields>
}

function useDatasetDraftEditing({
  draft,
  locked,
  versions,
  draftFields,
  publishedFields,
}: DatasetDraftEditingInput) {
  const queryClient = useQueryClient()

  const initialRows = useMemo(
    () => (draftFields.data ?? []).map(toDraftField),
    [draftFields.data],
  )

  const [session, setSession] = useState<{
    rows: DraftField[]
    baseRevision: number | null
    baseSnapshot: Map<string, string>
  } | null>(null)

  const rows = session?.rows ?? initialRows

  const baseRevision = session
    ? session.baseRevision
    : draftFields.data
      ? (draft?.revision ?? null)
      : null

  const baseSnapshot = session?.baseSnapshot ?? fieldSnapshot(initialRows)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState<DraftConflict | null>(null)

  // 'reconciling' while a refused stale save is being read back, 'blocked'
  // after any other refusal; both stop the autosave until the author acts.
  const [saveState, setSaveState] = useState<
    'idle' | 'blocked' | 'reconciling'
  >('idle')

  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  function setRows(next: DraftField[]) {
    setSession((current) => ({
      rows: next,
      baseRevision: current ? current.baseRevision : baseRevision,
      baseSnapshot: current?.baseSnapshot ?? baseSnapshot,
    }))
  }

  function rebase(revision: number, snapshotRows: readonly DraftField[]) {
    setSession((current) => ({
      rows: current?.rows ?? rows,
      baseRevision: revision,
      baseSnapshot: fieldSnapshot(snapshotRows),
    }))
  }

  const issues = useMemo(() => {
    const found = validateDraft(rows)

    for (const [rowKey, message] of fieldContractIssues(rows)) {
      if (!found.has(rowKey)) found.set(rowKey, message)
    }

    return found
  }, [rows])

  const changes = useMemo(
    () => computeChanges(rows, publishedFields.data ?? []),
    [rows, publishedFields.data],
  )

  const publishedKeys = useMemo(
    () => new Set((publishedFields.data ?? []).map((field) => field.key)),
    [publishedFields.data],
  )

  function applyRows(next: DraftField[]) {
    setRows(next)
    setDirty(true)
    setError(null)
    setSaveState('idle')
  }

  function patchField(rowKey: string, patch: Partial<DraftField>) {
    applyRows(
      rows.map((row) => {
        if (row.rowKey !== rowKey) return row

        if (patch.logicalType && patch.logicalType !== row.logicalType) {
          return {
            ...row,
            quantity: null,
            category:
              patch.logicalType === 'category'
                ? { kind: 'embedded', options: [] }
                : null,
            relationship: null,
            defaultValue: null,
            validation: {},
            ...patch,
          }
        }

        return { ...row, ...patch }
      }),
    )
  }

  const save = useMutation({
    mutationFn: (input: { fields: DraftField[]; expectedRevision: number }) =>
      replaceDatasetSchemaVersionFields(notebookDataClient, {
        schemaVersionId: draft!.id,
        expectedRevision: input.expectedRevision,
        fields: orderedForSave(input.fields),
      }),
    onSuccess: (version, input) => {
      setDirty(false)
      setSaveState('idle')
      rebase(version.revision, input.fields)
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
    },
    onError: async (cause: unknown, input) => {
      if (isStaleRevision(cause) && draft) {
        // Never guess: read the server's current fields and revision, then let
        // the author choose how to reconcile. `reconciling` keeps the autosave
        // from firing again while that read is in flight.
        setSaveState('reconciling')

        const [freshFields, freshVersions] = await Promise.all([
          draftFields.refetch(),
          versions.refetch(),
        ])

        const serverRows = (freshFields.data ?? []).map(toDraftField)

        const serverRevision =
          freshVersions.data?.find((v) => v.id === draft.id)?.revision ??
          input.expectedRevision

        setConflict(
          detectDraftConflict({
            base: baseSnapshot,
            mine: input.fields,
            serverRows,
            serverRevision,
          }),
        )
        setSaveState('idle')

        return
      }

      // A refusal that is not a conflict (permission, a locked draft, a bad
      // field contract) stops the autosave rather than retrying every second;
      // the next edit or the resolved conflict resumes it.
      setSaveState('blocked')
      setError(
        isApprovalLock(cause)
          ? t('library.models.edit.theDraftIsLockedWhile')
          : errorMessage(cause),
      )
    },
  })

  const { mutate: saveFields, isPending: saving } = save

  // Debounced autosave of the draft while editing. It never runs while a save
  // is in flight, while the draft is locked or conflicted, while a refusal is
  // being reconciled, or while the draft would be refused — the row messages
  // say which field to fix first.
  useEffect(() => {
    if (!dirty || locked || !draft || conflict || baseRevision === null) return

    if (issues.size > 0 || saving || saveState !== 'idle') return

    const timer = setTimeout(
      () => saveFields({ fields: rows, expectedRevision: baseRevision }),
      600,
    )

    return () => clearTimeout(timer)
  }, [
    rows,
    dirty,
    locked,
    draft,
    conflict,
    baseRevision,
    issues,
    saving,
    saveState,
    saveFields,
  ])

  /** Reload theirs: take the server's fields and revision as the new truth. */
  function reloadTheirs() {
    if (!conflict) return
    setRows(conflict.serverRows)
    rebase(conflict.serverRevision, conflict.serverRows)
    setConflict(null)
    setDirty(false)
    setError(null)
    setSaveState('idle')
  }

  /** Merge and keep editing: keep both sides when they changed different fields. */
  function mergeTheirs() {
    if (!conflict) return

    const merged = mergeDraftRows({
      base: baseSnapshot,
      mine: rows,
      theirs: conflict.theirs,
      serverRows: conflict.serverRows,
    })

    setRows(merged)
    rebase(conflict.serverRevision, conflict.serverRows)
    setConflict(null)
    setDirty(true)
    setSaveState('idle')
  }

  /** Keep mine: an explicit, deliberate overwrite of the server's version. */
  function keepMine() {
    if (!conflict) return
    rebase(conflict.serverRevision, conflict.serverRows)
    setConflict(null)
    setDirty(true)
    setSaveState('idle')
  }

  const selected = rows.find((row) => row.rowKey === selectedKey) ?? null
  const selectedIssue = selected ? issues.get(selected.rowKey) : undefined

  return {
    setError,
    rows,
    issues,
    changes,
    dirty,
    saving,
    saveState,
    baseRevision,
    error,
    conflict,
    reloadTheirs,
    mergeTheirs,
    keepMine,
    applyRows,
    patchField,
    selectedKey,
    setSelectedKey,
    selected,
    selectedIssue,
    publishedKeys,
  }
}

type ModelEditorState = ReturnType<typeof useModelEditor>

function ModelEditor() {
  const data = useDatasetEditorContext()

  // A replacement draft is a new editing session, including selection,
  // conflicts and pending local edits. Query refreshes of the same draft do
  // not discard that session.
  return (
    <ModelEditorSession
      key={`${data.modelId}:${data.draft?.id ?? 'none'}`}
      data={data}
    />
  )
}

function ModelEditorSession({ data }: { data: DatasetEditorContext }) {
  const editor = useModelEditor(data)
  const { model, definition } = editor

  if (!model) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            { label: t('library.models.edit.models'), link: { to: '/models' } },
          ]}
          title={
            definition.isLoading
              ? t('library.models.edit.loadingModel')
              : t('library.models.edit.modelNotFound')
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <EditorHeader editor={editor} model={model} />
        <EditorNotices editor={editor} modelName={model.name} />
        <EditorDraftContent editor={editor} modelName={model.name} />
      </div>
      <EditorInspector editor={editor} />
      <EditorDialogs editor={editor} />
    </div>
  )
}

function DraftSaveStatus({ editor }: { editor: ModelEditorState }) {
  const { conflict, saveState, dirty, issues, saving, baseRevision } = editor
  let message: string

  if (conflict) message = t('library.models.edit.notSavedDraftChangedOn')
  else if (saveState === 'blocked') message = t('library.models.edit.notSaved')
  else if (!dirty) {
    message =
      baseRevision === null
        ? 'Loading…'
        : t('library.models.edit.savedRevision', { baseRevision })
  } else if (issues.size > 0) {
    message = t('library.models.edit.notSavedFixFields', { count: issues.size })
  } else {
    message =
      saving || saveState === 'reconciling'
        ? 'Saving…'
        : t('library.models.edit.unsavedChanges')
  }

  return <span className="text-fg-muted">{message}</span>
}

function EditorHeader({
  editor,
  model,
}: {
  editor: ModelEditorState
  model: NonNullable<ModelEditorState['model']>
}) {
  const {
    modelId,
    draft,
    inUse,
    locked,
    saving,
    canSubmitNow,
    publishAllowed,
    changes,
    issues,
    setSubmitToken,
    canPublish,
    setPublishOpen,
    setDiscardOpen,
    denied,
    startDraft,
  } = editor

  return (
    <PageHeader
      trail={[
        { label: t('library.models.edit.models'), link: { to: '/models' } },
        {
          label: model.name,
          link: { to: '/models/$modelId', params: { modelId } },
        },
        { label: t('library.models.edit.draft') },
      ]}
      title={t('library.models.edit.edit', { name: model.name })}
      meta={
        <>
          {draft ? (
            <Status tone="draft">
              {t('library.models.edit.draftV', { version: draft.version })}
            </Status>
          ) : (
            <Status tone="none">{t('library.models.edit.noDraft')}</Status>
          )}
          {inUse ? (
            <span className="text-fg-muted">
              {t('library.models.edit.vInUse', { version: inUse.version })}
            </span>
          ) : null}
          <DraftSaveStatus editor={editor} />
        </>
      }
      actions={
        draft ? (
          <>
            <Button
              variant="quiet"
              disabled={locked || saving}
              onClick={() => setDiscardOpen(true)}
            >
              {t('library.models.edit.discardDraft')}
            </Button>
            {canSubmitNow && !publishAllowed ? (
              <Button
                variant="secondary"
                disabled={changes.total === 0 || issues.size > 0}
                onClick={() => setSubmitToken((token) => token + 1)}
              >
                {t('library.models.edit.submitForApproval')}
              </Button>
            ) : null}
            {canPublish && publishAllowed ? (
              <Button
                variant="primary"
                disabled={changes.total === 0 || issues.size > 0 || saving}
                onClick={() => setPublishOpen(true)}
              >
                {t('library.models.edit.publishV', {
                  version: draft.version,
                })}
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            variant="primary"
            disabled={denied || startDraft.isPending}
            onClick={() => startDraft.mutate()}
          >
            {t('library.models.edit.startDraft')}
          </Button>
        )
      }
    />
  )
}

function EditorNotices({
  editor,
  modelName,
}: {
  editor: ModelEditorState
  modelName: string
}) {
  const {
    denied,
    error,
    conflict,
    saving,
    reloadTheirs,
    mergeTheirs,
    keepMine,
  } = editor

  return (
    <>
      {denied ? (
        <div className="px-4 pt-4 md:px-6">
          <Notice tone="info" icon="lock">
            {t('library.models.edit.viewOnlyOnlyModelOwners', {
              name: modelName,
            })}
          </Notice>
        </div>
      ) : null}
      {error ? (
        <div className="px-4 pt-4 md:px-6">
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}

      {conflict ? (
        <div className="px-4 pt-4 md:px-6">
          <DraftConflictBanner
            conflict={conflict}
            busy={saving}
            onReload={reloadTheirs}
            onMerge={mergeTheirs}
            onKeepMine={keepMine}
          />
        </div>
      ) : null}
    </>
  )
}

function EditorDraftContent({
  editor,
  modelName,
}: {
  editor: ModelEditorState
  modelName: string
}) {
  const {
    draft,
    denied,
    startDraft,
    inUse,
    requests,
    decisions,
    role,
    user,
    workspaceId,
    submitToken,
    approvalGoverns,
    rows,
    changes,
    issues,
    locked,
    applyRows,
    setSelectedKey,
  } = editor

  return (
    <>
      {!draft ? (
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="schema"
            title={t('library.models.edit.noDraftToEdit')}
            description={t('library.models.edit.startADraftToChange')}
            action={
              <Button
                variant="primary"
                disabled={denied || startDraft.isPending}
                onClick={() => startDraft.mutate()}
              >
                {t('library.models.edit.startDraft')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-4 py-5 md:px-6">
          <ModelApprovalPanel
            version={draft}
            publishedVersion={inUse?.version ?? null}
            requests={requests}
            decisions={decisions}
            role={role}
            user={user}
            workspaceId={workspaceId}
            client={notebookDataClient}
            submitToken={submitToken}
          />

          <Notice tone="info">
            {t(
              approvalGoverns
                ? 'library.models.edit.draftStaysInUseUntilApproved'
                : 'library.models.edit.draftStaysInUseUntilPublished',
              { version: draft.version, inUseVersion: inUse?.version ?? '—' },
            )}
          </Notice>

          <div className="flex flex-wrap items-center gap-3">
            <Muted>
              {t('library.models.edit.fieldsChangesSinceV', {
                count: rows.length,
                total: changes.total,
                version: inUse?.version ?? '—',
              })}
              {issues.size > 0
                ? t('library.models.edit.fixBeforeSaving', {
                    issues: issues.size,
                  })
                : ''}
            </Muted>
            <Button
              size="sm"
              disabled={locked || issues.size > 0}
              onClick={() => {
                const next = newDraftField(rows.length + 1)
                applyRows([...rows, next])
                setSelectedKey(next.rowKey)
              }}
            >
              {t('library.models.edit.addField')}
            </Button>
          </div>

          <DraftFieldsTable editor={editor} modelName={modelName} />
          <RemovedDraftFields
            changes={changes}
            publishedVersion={inUse?.version ?? '—'}
          />
        </div>
      )}
    </>
  )
}

function DraftFieldsTable({
  editor,
  modelName,
}: {
  editor: ModelEditorState
  modelName: string
}) {
  const {
    inherited,
    inheritedKeys,
    rows,
    changes,
    issues,
    locked,
    patchField,
    selectedKey,
    setSelectedKey,
    applyRows,
  } = editor

  return (
    <section
      aria-label={t('library.models.edit.fields')}
      className="flex flex-col gap-1"
    >
      <h2 className="m-0 text-section">{t('library.models.edit.fields')}</h2>
      <div className="overflow-hidden rounded-md border border-border">
        <Table aria-label={t('library.models.edit.schemaFields')}>
          <TableHeader>
            <TableRow>
              <TableHead className="first:pl-3">
                {t('library.models.edit.name')}
              </TableHead>
              <TableHead>{t('library.models.edit.key')}</TableHead>
              <TableHead>{t('library.models.edit.type')}</TableHead>
              <TableHead>{t('common.states.required')}</TableHead>
              <TableHead>{t('library.models.edit.change')}</TableHead>
              <TableHead
                className="pr-3"
                align="right"
                aria-label={t('library.models.edit.actions')}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            <InheritedTableRows
              groups={inherited.groups}
              colSpan={6}
              bandClassName="pr-3 first:pl-3"
              cells={(row) => (
                <>
                  <TableCell className="first:pl-3">
                    <InheritedLabel row={row} />
                  </TableCell>
                  <TableCell className="mono text-label text-fg-muted">
                    {row.key}
                  </TableCell>
                  <TableCell className="text-fg-muted">{row.type}</TableCell>
                  <TableCell className="text-fg-muted">
                    {row.required}
                  </TableCell>
                  <TableCell className="text-label text-fg-muted">—</TableCell>
                  <TableCell className="pr-3" />
                </>
              )}
            />
            {inheritedKeys.size ? (
              <TableBand
                label={modelName}
                count={
                  rows.filter((field) => !inheritedKeys.has(field.key)).length
                }
                colSpan={6}
                className="pr-3 first:pl-3"
              />
            ) : null}
            {rows
              .filter((field) => !inheritedKeys.has(field.key))
              .map((field) => {
                const change = changes.byKey.get(field.key)
                const issue = issues.get(field.rowKey)

                return (
                  <TableRow key={field.rowKey}>
                    <TableCell className="first:pl-3">
                      <Input
                        aria-label={t('library.models.edit.fieldName', {
                          key: field.key || 'new field',
                        })}
                        aria-invalid={issue ? true : undefined}
                        disabled={locked}
                        value={field.label}
                        onChange={(event) =>
                          patchField(field.rowKey, {
                            label: event.target.value,
                          })
                        }
                        className="h-[26px] text-label"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={t('library.models.edit.fieldKey', {
                          key: field.key || 'new field',
                        })}
                        aria-invalid={issue ? true : undefined}
                        disabled={locked}
                        value={field.key}
                        onChange={(event) =>
                          patchField(field.rowKey, {
                            key: event.target.value,
                          })
                        }
                        className="mono h-[26px] text-label"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        aria-label={t('library.models.edit.fieldType', {
                          key: field.key || 'new field',
                        })}
                        disabled={locked}
                        value={field.logicalType}
                        onChange={(event) =>
                          patchField(field.rowKey, {
                            logicalType: event.target.value,
                          })
                        }
                        className="h-[26px]"
                      >
                        {DATASET_FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={t('library.models.edit.required', {
                          key: field.key || 'new field',
                        })}
                        disabled={locked}
                        checked={!field.nullable}
                        onChange={(event) =>
                          patchField(field.rowKey, {
                            nullable: !event.target.checked,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px] whitespace-normal">
                      {issue ? (
                        <span
                          role="alert"
                          className="text-label text-danger-text"
                        >
                          {issue}
                        </span>
                      ) : change ? (
                        <Badge variant={change === 'Added' ? 'add' : 'chg'}>
                          {change}
                        </Badge>
                      ) : (
                        <span className="text-label text-fg-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell align="right" className="pr-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-pressed={selectedKey === field.rowKey}
                          onClick={() => setSelectedKey(field.rowKey)}
                        >
                          {t('common.actions.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={locked}
                          aria-label={t('library.models.edit.remove', {
                            label: field.label || field.key || 'field',
                          })}
                          onClick={() =>
                            applyRows(
                              rows.filter((row) => row.rowKey !== field.rowKey),
                            )
                          }
                        >
                          {t('common.actions.remove')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function RemovedDraftFields({
  changes,
  publishedVersion,
}: {
  changes: ModelEditorState['changes']
  publishedVersion: number | string
}) {
  return changes.removed.length ? (
    <section aria-label={t('library.models.edit.removedFields')}>
      <h2 className="mb-1 text-section">
        {t('library.models.edit.removedSinceV', {
          version: publishedVersion,
        })}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {changes.removed.map((field) => (
          <li key={field.key} className="text-body">
            <Badge variant="del">{t('library.models.edit.removed')}</Badge>{' '}
            <span className="font-medium">{field.label}</span>{' '}
            <span className="mono text-label text-fg-muted">{field.key}</span>
          </li>
        ))}
      </ul>
    </section>
  ) : null
}

function EditorInspector({ editor }: { editor: ModelEditorState }) {
  const {
    selected,
    selectedIssue,
    locked,
    publishedKeys,
    inUse,
    patchField,
    applyRows,
    rows,
    setSelectedKey,
  } = editor

  return (
    <Inspector label={t('library.models.edit.fieldEditor')}>
      {selected ? (
        <FieldEditor
          field={selected}
          issue={selectedIssue}
          locked={locked}
          keyLocked={publishedKeys.has(selected.key)}
          publishedVersion={inUse?.version ?? null}
          onPatch={(patch) => patchField(selected.rowKey, patch)}
          onMove={(delta) => applyRows(moveField(rows, selected.rowKey, delta))}
          onRemove={() => {
            applyRows(rows.filter((row) => row.rowKey !== selected.rowKey))
            setSelectedKey(null)
          }}
        />
      ) : (
        <InspectorSection title={t('library.models.edit.fieldEditor')}>
          <Muted>{t('library.models.edit.chooseAFieldsEditAction')}</Muted>
        </InspectorSection>
      )}
    </Inspector>
  )
}

function EditorDialogs({ editor }: { editor: ModelEditorState }) {
  const {
    discardOpen,
    draft,
    setDiscardOpen,
    inUse,
    discard,
    locked,
    publishOpen,
    setPublishOpen,
    changes,
    approvalRequired,
    publish,
  } = editor

  return (
    <>
      {discardOpen && draft ? (
        <Dialog
          open
          onOpenChange={(open) => (open ? undefined : setDiscardOpen(false))}
        >
          <DialogContent className="w-[min(480px,calc(100vw-32px))]">
            <DialogHeader
              title={t('library.models.edit.discardThisDraft')}
              description={t('library.models.edit.draftVAndItsField', {
                version: draft.version,
                version2: inUse?.version ?? '—',
              })}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="danger"
                disabled={discard.isPending || locked}
                onClick={() => discard.mutate()}
              >
                {discard.isPending
                  ? t('library.models.edit.discarding')
                  : t('library.models.edit.discardDraft')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {publishOpen && draft ? (
        <Dialog
          open
          onOpenChange={(open) => (open ? undefined : setPublishOpen(false))}
        >
          <DialogContent className="w-[min(520px,calc(100vw-32px))]">
            <DialogHeader
              title={t('library.models.edit.publishV', {
                version: draft.version,
              })}
              description={t('library.models.edit.newDatasetsUseVDatasets', {
                version: draft.version,
                version2: inUse?.version ?? '—',
              })}
            />
            <DialogBody>
              <Muted>
                {t('library.models.edit.changesSinceV', {
                  total: changes.total,
                  version: inUse?.version ?? '—',
                })}
              </Muted>
              {approvalRequired ? (
                <Muted className="mt-2">
                  {t('library.models.edit.thisWorkspaceRequiresAnApproved')}
                </Muted>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                {publish.isPending
                  ? t('library.models.edit.publishing')
                  : t('library.models.edit.publish')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

/**
 * The design's field editor: identity and the type-specific
 * configuration the canonical field shapes already carry.
 */
function categoryMetadata(category: DatasetSchemaFieldInput['category']) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The canonical decoder establishes legacy string labels or typed category metadata; labels carry no options.
  return typeof category === 'string' ? {} : (category ?? {})
}

type FieldEditorProps = {
  field: DraftField
  issue: string | undefined
  locked: boolean
  keyLocked: boolean
  publishedVersion: number | null
  onPatch: (patch: Partial<DraftField>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}

type FieldConfigurationProps = Pick<
  FieldEditorProps,
  'field' | 'locked' | 'onPatch'
>

function FieldEditor({
  field,
  issue,
  locked,
  keyLocked,
  publishedVersion,
  onPatch,
  onMove,
  onRemove,
}: FieldEditorProps) {
  const numeric =
    field.logicalType === 'integer' || field.logicalType === 'decimal'

  return (
    <>
      <InspectorSection title={t('library.models.edit.fieldEditor')}>
        <p className="m-0 text-label text-fg-muted">
          {field.key || t('library.models.edit.newField')}
          {keyLocked
            ? t('library.models.edit.publishedInV', {
                publishedVersion: publishedVersion ?? '—',
              })
            : t('library.models.edit.notYetPublished')}
        </p>
        {issue ? (
          <Notice tone="bad" className="mt-2">
            {issue}
          </Notice>
        ) : null}
        <div className="mt-3 flex flex-col gap-3">
          <Field label={t('library.models.edit.name')} required>
            <Input
              aria-label={t('library.models.edit.fieldLabel')}
              disabled={locked}
              value={field.label}
              onChange={(event) => onPatch({ label: event.target.value })}
            />
          </Field>
          <Field
            label={t('library.models.edit.key')}
            hint={
              keyLocked
                ? t('library.models.edit.lockedPublishedInVSo', {
                    publishedVersion: publishedVersion ?? '—',
                  })
                : t('library.models.edit.lowerCaseLettersNumbersAnd')
            }
          >
            <Input
              aria-label={t('library.models.edit.fieldKey2')}
              className="mono"
              disabled={locked || keyLocked}
              value={field.key}
              onChange={(event) => onPatch({ key: event.target.value })}
            />
          </Field>
          <Field label={t('library.models.edit.type')}>
            <Select
              aria-label={t('library.models.edit.fieldType2')}
              disabled={locked}
              value={field.logicalType}
              onChange={(event) => onPatch({ logicalType: event.target.value })}
            >
              {DATASET_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('library.models.edit.description')}>
            <Textarea
              aria-label={t('library.models.edit.fieldDescription')}
              rows={2}
              disabled={locked}
              value={field.description ?? ''}
              onChange={(event) =>
                onPatch({ description: event.target.value || null })
              }
            />
          </Field>
        </div>
      </InspectorSection>

      {numeric ? (
        <FieldQuantityEditor field={field} locked={locked} onPatch={onPatch} />
      ) : null}
      <FieldValidationEditor field={field} locked={locked} onPatch={onPatch} />
      <FieldLifecycleEditor
        field={field}
        locked={locked}
        onPatch={onPatch}
        onMove={onMove}
        onRemove={onRemove}
      />
    </>
  )
}

function FieldQuantityEditor({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  const quantity = field.quantity

  const quantityConfig = quantity ?? {
    kind: '',
    dimension: '',
    storageUnit: '',
  }

  const unit = quantity?.storageUnit

  function setUnit(raw: string) {
    const trimmed = raw.trim()

    if (trimmed === '') {
      onPatch({ quantity: null })

      return
    }

    onPatch({ quantity: { ...quantityConfig, storageUnit: trimmed } })
  }

  return (
    <InspectorSection title={t('library.models.edit.quantity')}>
      <div className="flex flex-col gap-3">
        <Field
          label={t('library.models.edit.unit')}
          hint={t('library.models.edit.storageUnitChangingItDoes')}
        >
          <Input
            aria-label={t('library.models.edit.unit')}
            disabled={locked}
            placeholder={t('library.models.edit.eGNtu')}
            value={unit ?? ''}
            onChange={(event) => setUnit(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {(['kind', 'dimension'] as const).map((property) => (
            <Field
              key={property}
              label={
                property === 'kind'
                  ? t('library.models.edit.quantityKind')
                  : t('library.models.edit.dimension')
              }
            >
              <Input
                aria-label={
                  property === 'kind'
                    ? t('library.models.edit.quantityKind')
                    : t('library.models.edit.dimension')
                }
                disabled={locked || !unit}
                value={quantityConfig[property]}
                onChange={(event) =>
                  onPatch({
                    quantity: {
                      ...quantityConfig,
                      [property]: event.target.value,
                    },
                  })
                }
              />
            </Field>
          ))}
        </div>
      </div>
    </InspectorSection>
  )
}

function FieldValidationEditor({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  return (
    <InspectorSection title={t('library.models.edit.validationAndDefaults')}>
      <div className="flex flex-col gap-3">
        <FieldBoundsEditor field={field} locked={locked} onPatch={onPatch} />
        {field.logicalType === 'category' ? (
          <FieldCategoryEditor
            field={field}
            locked={locked}
            onPatch={onPatch}
          />
        ) : null}
        <FieldDefaultEditor field={field} locked={locked} onPatch={onPatch} />
        <FieldCardinalityEditor
          field={field}
          locked={locked}
          onPatch={onPatch}
        />
      </div>
    </InspectorSection>
  )
}

function FieldBoundsEditor({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  const numeric =
    field.logicalType === 'integer' || field.logicalType === 'decimal'

  const validation = field.validation ?? {}

  function setBound(
    bound: 'min' | 'max' | 'minLength' | 'maxLength',
    raw: string,
  ) {
    const next = { ...validation }

    if (raw.trim() === '') delete next[bound]
    else next[bound] = Number(raw)
    onPatch({ validation: next })
  }

  const boundValue = (bound: 'min' | 'max' | 'minLength' | 'maxLength') =>
    validation[bound] === undefined ? '' : String(validation[bound])

  return (
    <>
      {numeric ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('library.models.edit.minimum')}>
            <Input
              aria-label={t('library.models.edit.minimum')}
              type="number"
              step="any"
              disabled={locked}
              value={boundValue('min')}
              onChange={(event) => setBound('min', event.target.value)}
            />
          </Field>
          <Field label={t('library.models.edit.maximum')}>
            <Input
              aria-label={t('library.models.edit.maximum')}
              type="number"
              step="any"
              disabled={locked}
              value={boundValue('max')}
              onChange={(event) => setBound('max', event.target.value)}
            />
          </Field>
        </div>
      ) : null}

      {field.logicalType === 'text' ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('library.models.edit.minLength')}>
              <Input
                aria-label={t('library.models.edit.minimumLength')}
                type="number"
                min={0}
                disabled={locked}
                value={boundValue('minLength')}
                onChange={(event) => setBound('minLength', event.target.value)}
              />
            </Field>
            <Field label={t('library.models.edit.maxLength')}>
              <Input
                aria-label={t('library.models.edit.maximumLength')}
                type="number"
                min={0}
                disabled={locked}
                value={boundValue('maxLength')}
                onChange={(event) => setBound('maxLength', event.target.value)}
              />
            </Field>
          </div>
          <Field
            label={t('library.models.edit.pattern')}
            hint={t('library.models.edit.aRegularExpressionEveryValue')}
          >
            <Input
              aria-label={t('library.models.edit.pattern')}
              className="mono"
              disabled={locked}
              value={validation.pattern ?? ''}
              onChange={(event) => {
                const next = { ...validation }

                if (event.target.value === '') delete next.pattern
                else next.pattern = event.target.value
                onPatch({ validation: next })
              }}
            />
          </Field>
        </div>
      ) : null}
    </>
  )
}

function FieldCategoryEditor({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  const category = categoryMetadata(field.category)
  const options = category.options ?? []

  function setOptions(next: typeof options) {
    onPatch({ category: { ...category, kind: 'embedded', options: next } })
  }

  return (
    <div className="flex flex-col gap-2">
      <Muted>{t('library.models.edit.retireAnOptionRatherThan')}</Muted>
      {options.map((option, index) => (
        <div
          key={option.id}
          className="flex flex-col gap-2 border-b border-border pb-2"
        >
          <Field
            label={t('library.models.edit.optionKey', {
              number: index + 1,
            })}
          >
            <Input
              aria-label={t('library.models.edit.optionKey', {
                number: index + 1,
              })}
              disabled={locked}
              value={option.key}
              onChange={(event) =>
                setOptions(
                  options.map((item) =>
                    item.id === option.id
                      ? { ...item, key: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </Field>
          <Field
            label={t('library.models.edit.optionLabel', {
              number: index + 1,
            })}
          >
            <Input
              aria-label={t('library.models.edit.optionLabel', {
                number: index + 1,
              })}
              disabled={locked}
              value={option.label}
              onChange={(event) =>
                setOptions(
                  options.map((item) =>
                    item.id === option.id
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-label">
            <input
              type="checkbox"
              disabled={locked}
              checked={option.lifecycle === 'retired'}
              onChange={(event) =>
                setOptions(
                  options.map((item) =>
                    item.id === option.id
                      ? {
                          ...item,
                          lifecycle: event.target.checked
                            ? 'retired'
                            : 'active',
                        }
                      : item,
                  ),
                )
              }
            />
            {t('library.models.edit.retired')}
          </label>
        </div>
      ))}
      <Button
        size="sm"
        variant="quiet"
        disabled={locked}
        onClick={() =>
          setOptions([
            ...options,
            {
              id: crypto.randomUUID(),
              key: '',
              label: '',
              lifecycle: 'active',
              displayOrder: options.length + 1,
            },
          ])
        }
      >
        {t('library.models.edit.addCategoryOption')}
      </Button>
    </div>
  )
}

function FieldDefaultEditor({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  const options = categoryMetadata(field.category).options ?? []

  return (
    <>
      {field.logicalType === 'boolean' ? (
        <FieldBooleanDefault field={field} locked={locked} onPatch={onPatch} />
      ) : null}

      {field.logicalType !== 'boolean' ? (
        <Field
          label={t('library.models.edit.defaultValue')}
          hint={t('library.models.edit.usedForNewRowsOnly')}
        >
          {field.logicalType === 'category' ? (
            <Select
              aria-label={t('library.models.edit.defaultValue')}
              disabled={locked || field.cardinality === 'many'}
              value={
                // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The canonical default is finite JSON; category option IDs use only its string variant.
                typeof field.defaultValue === 'string' ? field.defaultValue : ''
              }
              onChange={(event) =>
                onPatch({ defaultValue: event.target.value || null })
              }
            >
              <option value="">{t('library.models.edit.noDefault')}</option>
              {options
                .filter((option) => option.lifecycle === 'active')
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label || option.key}
                  </option>
                ))}
            </Select>
          ) : (
            <FieldScalarDefault
              field={field}
              locked={locked}
              onPatch={onPatch}
            />
          )}
        </Field>
      ) : null}
      {field.defaultValue != null ? (
        <Button
          size="sm"
          variant="quiet"
          disabled={locked}
          onClick={() => onPatch({ defaultValue: null })}
        >
          {t('library.models.edit.clearDefault')}
        </Button>
      ) : null}
    </>
  )
}

function FieldScalarDefault({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  const numeric =
    field.logicalType === 'integer' || field.logicalType === 'decimal'

  return (
    <Input
      aria-label={t('library.models.edit.defaultValue')}
      disabled={locked || field.cardinality === 'many'}
      type={numeric ? 'number' : field.logicalType === 'date' ? 'date' : 'text'}
      step="any"
      value={
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Text/numeric inputs accept only the string and number variants of the validated JSON default, not boolean/object/array defaults.
        typeof field.defaultValue === 'string' ||
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This is the numeric alternative of the same validated default union.
        typeof field.defaultValue === 'number'
          ? String(field.defaultValue)
          : ''
      }
      onChange={(event) =>
        onPatch({
          defaultValue:
            event.target.value === ''
              ? null
              : numeric
                ? Number(event.target.value)
                : event.target.value,
        })
      }
    />
  )
}

function FieldBooleanDefault({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  return (
    <Field label={t('library.models.edit.defaultForNewDatasets')}>
      <Select
        aria-label={t('library.models.edit.defaultValue')}
        disabled={locked || field.cardinality === 'many'}
        value={
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A validated finite-JSON default is shown here only when it is the boolean variant; other logical types retain their separate defaults.
          typeof field.defaultValue === 'boolean'
            ? String(field.defaultValue)
            : ''
        }
        onChange={(event) =>
          onPatch({
            defaultValue:
              event.target.value === '' ? null : event.target.value === 'true',
          })
        }
      >
        <option value="">{t('library.models.edit.noDefault')}</option>
        <option value="true">{t('library.models.edit.yes')}</option>
        <option value="false">{t('library.models.edit.no')}</option>
      </Select>
    </Field>
  )
}

function FieldCardinalityEditor({
  field,
  locked,
  onPatch,
}: FieldConfigurationProps) {
  const relationship = field.relationship ?? {}
  const targetModelKey = relationship.target?.modelKey ?? ''

  return (
    <>
      {field.logicalType === 'reference' ? (
        <Field
          label={t('library.models.edit.targetModelKey')}
          hint={t('library.models.edit.theRecordModelKeyWhose')}
        >
          <Input
            aria-label={t('library.models.edit.targetModelKey')}
            disabled={locked}
            value={targetModelKey}
            onChange={(event) =>
              onPatch({
                relationship: {
                  ...relationship,
                  target: { kind: 'model', modelKey: event.target.value },
                  cardinality: field.cardinality ?? 'one',
                },
              })
            }
          />
        </Field>
      ) : null}
      <Field
        label={t('library.models.edit.cardinality')}
        hint={t('library.models.edit.oneValueOrANon')}
      >
        <Select
          aria-label={t('library.models.edit.cardinality')}
          disabled={locked}
          value={field.cardinality ?? 'one'}
          onChange={(event) => {
            const cardinality = event.target.value === 'many' ? 'many' : 'one'

            const patch: Partial<DraftField> = { cardinality }

            if (
              field.logicalType === 'reference' &&
              field.relationship != null
            ) {
              patch.relationship = { ...relationship, cardinality }
            }

            onPatch(patch)
          }}
        >
          <option value="one">{t('library.models.edit.oneValue')}</option>
          <option value="many">{t('library.models.edit.severalValues')}</option>
        </Select>
      </Field>

      <label className="flex items-center gap-2 text-label">
        <input
          type="checkbox"
          checked={!(field.nullable ?? true)}
          disabled={locked}
          onChange={(event) => onPatch({ nullable: !event.target.checked })}
        />
        {t('library.models.edit.requiredForNewDatasets')}
      </label>
    </>
  )
}

function FieldLifecycleEditor({
  field,
  locked,
  onPatch,
  onMove,
  onRemove,
}: Pick<
  FieldEditorProps,
  'field' | 'locked' | 'onPatch' | 'onMove' | 'onRemove'
>) {
  return (
    <>
      <InspectorSection title={t('library.models.edit.fieldLifecycle')}>
        <label className="flex items-start gap-2 text-label">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={field.lifecycle === 'retired'}
            disabled={locked}
            onChange={(event) =>
              onPatch({
                lifecycle: event.target.checked ? 'retired' : 'active',
              })
            }
          />
          {t('library.models.edit.retireFieldKeepItsRecorded')}
        </label>
      </InspectorSection>

      <InspectorSection title={t('library.models.edit.order')}>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="quiet"
            aria-label={t('library.models.edit.moveFieldUp')}
            disabled={locked}
            onClick={() => onMove(-1)}
          >
            {t('library.models.edit.moveUp')}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            aria-label={t('library.models.edit.moveFieldDown')}
            disabled={locked}
            onClick={() => onMove(1)}
          >
            {t('library.models.edit.moveDown')}
          </Button>
        </div>
        <Muted className="mt-2">
          {t('library.models.edit.movingAFieldChangesThe')}
        </Muted>
      </InspectorSection>

      <InspectorSection title={t('common.actions.remove')}>
        <Button size="sm" variant="danger" disabled={locked} onClick={onRemove}>
          {t('library.models.edit.removeField')}
        </Button>
        <Muted className="mt-2">
          {t('library.models.edit.removingAFieldFromThe')}
        </Muted>
      </InspectorSection>
    </>
  )
}

function errorMessage(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caught transport errors are external; Error supplies its message immediately and primitive rejections use their text form.
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('capability')) {
    return t('library.models.edit.youDontHavePermissionTo')
  }

  const inherited = /inherited columns are missing or changed: (.*)/.exec(
    message,
  )

  if (inherited)
    return t('library.models.edit.inheritedColumnsMissing', {
      columns: inherited[1],
    })

  return message
}

/** Postgres-only inline flag groups (`(?i)`, `(?m)`, …); JS RegExp has none. */
const POSTGRES_INLINE_FLAGS = /\(\?[ismxnp]+\)/g

/**
 * Whether the stored pattern would survive being compiled where it is used. The
 * database compiles `validation.pattern` as a regular expression and refuses an
 * unusable one (SB071). Postgres-only inline flags are stripped before the
 * check, because JS `RegExp` rejects syntax the database accepts.
 */
function patternCompiles(pattern: string): boolean {
  try {
    new RegExp(pattern.replace(POSTGRES_INLINE_FLAGS, ''))

    return true
  } catch {
    return false
  }
}

/**
 * The field contract the server enforces on save
 * (`internal.replace_dataset_schema_version_fields`: `^[a-z][a-z0-9_]{0,59}$`
 * keys and 1–200 character labels) and on publish
 * (`internal.assert_publishable_dataset_schema_version`: a usable pattern,
 * numeric bounds, complete quantity metadata). `validateDraft` covers identity
 * and bounds only, so the rest is named inline rather than after a round-trip.
 * Values here are only stops: the server stays authoritative.
 */
function fieldContractIssues(rows: readonly DraftField[]): Map<string, string> {
  const issues = new Map<string, string>()

  for (const row of rows) {
    const key = row.key.trim()
    const label = row.label.trim()
    const validation = row.validation ?? {}

    if (row.logicalType === 'category') {
      const options = categoryMetadata(row.category).options

      if (
        !options ||
        options.some((option) => !option.key.trim() || !option.label.trim()) ||
        new Set(options.map((option) => option.key)).size !== options.length
      ) {
        issues.set(
          row.rowKey,
          t('library.models.edit.categoryOptionsNeedUniqueKeys'),
        )
      }
    }

    if (key.length > 60) {
      issues.set(row.rowKey, t('library.models.edit.keyMustBe60Characters'))
    } else if (label.length > 200) {
      issues.set(row.rowKey, t('library.models.edit.nameMustBe200Characters'))
    }

    const pattern = validation.pattern

    if (pattern !== undefined && !patternCompiles(pattern)) {
      issues.set(row.rowKey, t('library.models.edit.patternMustBeARegular'))
    }

    for (const bound of ['min', 'max', 'minLength', 'maxLength'] as const) {
      if (bound in validation && !Number.isFinite(validation[bound])) {
        issues.set(
          row.rowKey,
          t('library.models.edit.enterAsANumber', { bound }),
        )
      }
    }

    const quantity = row.quantity

    if (quantity != null) {
      if (row.logicalType !== 'integer' && row.logicalType !== 'decimal') {
        issues.set(
          row.rowKey,
          t('library.models.edit.onlyIntegerAndDecimalFields'),
        )
      } else if (
        !quantity.kind.trim() ||
        !quantity.dimension.trim() ||
        !quantity.storageUnit.trim()
      ) {
        issues.set(row.rowKey, t('library.models.edit.aUnitNeedsItsKind'))
      }
    }
  }

  return issues
}
