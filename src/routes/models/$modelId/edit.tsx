import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  Inspector,
  InspectorSection,
  Muted,
  PageHeader,
} from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Badge } from '#/components/v3/ui/badge'
import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Select } from '#/components/v3/ui/select'
import { Textarea } from '#/components/v3/inventory/list'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import { DATASET_SCHEMA_VERSION_KIND } from '#/lib/approval-requests'
import {
  createNextDatasetSchemaVersion,
  deleteDatasetSchemaVersion,
  publishDatasetSchemaVersion,
  replaceDatasetSchemaVersionFields,
} from '#/lib/dataset-schema-definition-rpc'
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
} from '#/components/v3/models/models-data'
import { useModelApprovalIndex } from '#/components/v3/models/model-approval-data'
import { ModelApprovalPanel } from '#/components/v3/models/model-approval-panel'
import { DraftConflictBanner } from '#/components/v3/models/draft-conflict-banner'
import { RecordModelEdit } from '#/components/v3/models/record-model-edit'
import { isUuid } from '#/lib/field-value-validation'
import {
  canPublishDraft,
  pendingRequest,
} from '#/components/v3/models/model-approval'

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
  validateSearch: (
    search: Record<string, unknown>,
  ): { field?: string; state?: 'denied' | 'empty' } => ({
    field: typeof search.field === 'string' ? search.field : undefined,
    state:
      search.state === 'denied' || search.state === 'empty'
        ? search.state
        : undefined,
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

function ModelEditor() {
  const { modelId } = Route.useParams()
  const { state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const definition = useModelDefinition(modelId)
  const versions = useModelVersions(modelId)

  const draft = versions.data?.find((v) => v.lifecycle === 'draft') ?? null
  // `chk_dataset_schema_versions_lifecycle` allows draft/active/retired: a
  // version that has been published is `active` (or `retired`), never
  // `published`. The in-use version is the highest non-draft one.
  const inUse = versions.data?.find((v) => v.lifecycle !== 'draft') ?? null
  const draftFields = useModelFields(draft?.id)
  const publishedFields = useModelFields(inUse?.id)
  const approval = useModelApprovalIndex(
    draft ? [draft.id] : [],
    notebookDataClient,
    DATASET_SCHEMA_VERSION_KIND,
  )
  const policy = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
  })

  const role = context.workspace?.role ?? null
  const user = { id: context.user.id, name: context.user.name }
  const workspaceId = context.workspace?.id ?? null
  const canEdit = hasCapability(role, 'schema.edit')
  const canPublish = hasCapability(role, 'schema.publish')
  const denied = state === 'denied' || !canEdit

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

  const [rows, setRows] = useState<DraftField[]>([])
  const [dirty, setDirty] = useState(false)
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [conflict, setConflict] = useState<DraftConflict | null>(null)
  // 'reconciling' while a refused stale save is being read back, 'blocked'
  // after any other refusal; both stop the autosave until the author acts.
  const [saveState, setSaveState] = useState<
    'idle' | 'blocked' | 'reconciling'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [submitToken, setSubmitToken] = useState(0)
  const [publishOpen, setPublishOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const loadedRef = useRef<string | null>(null)
  const baseSnapshot = useRef<Map<string, string>>(new Map())

  function rebase(revision: number, snapshotRows: readonly DraftField[]) {
    baseSnapshot.current = fieldSnapshot(snapshotRows)
    setBaseRevision(revision)
  }

  useEffect(() => {
    if (!draft || !draftFields.data) return
    if (loadedRef.current === draft.id) return
    const loaded = draftFields.data.map(toDraftField)
    setRows(loaded)
    rebase(draft.revision, loaded)
    loadedRef.current = draft.id
    setDirty(false)
    setConflict(null)
    setSaveState('idle')
  }, [draft, draftFields.data])

  // A draft that is replaced by another model version (discard, publish) starts
  // fresh; drop the inspector selection with it.
  useEffect(() => {
    setSelectedKey(null)
  }, [draft?.id])

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
            base: baseSnapshot.current,
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
          ? 'The draft is locked while it is awaiting approval. Withdraw the submission to keep editing.'
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

  const startDraft = useMutation({
    mutationFn: () =>
      createNextDatasetSchemaVersion(notebookDataClient, modelId),
    onSuccess: () => {
      loadedRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Draft started')
    },
  })

  const discard = useMutation({
    mutationFn: () => deleteDatasetSchemaVersion(notebookDataClient, draft!.id),
    onSuccess: () => {
      setDiscardOpen(false)
      loadedRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Draft discarded')
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const publish = useMutation({
    mutationFn: () =>
      publishDatasetSchemaVersion(notebookDataClient, draft!.id),
    onSuccess: () => {
      setPublishOpen(false)
      loadedRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Version published', {
        description: 'Datasets keep the version they are on.',
      })
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

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
      base: baseSnapshot.current,
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

  const model = definition.data
  const selected = rows.find((row) => row.rowKey === selectedKey) ?? null
  const selectedIssue = selected ? issues.get(selected.rowKey) : undefined
  const savedState = conflict
    ? 'Not saved: draft changed on the server'
    : saveState === 'blocked'
      ? 'Not saved'
      : dirty
        ? issues.size > 0
          ? `Not saved: fix ${issues.size} ${issues.size === 1 ? 'field' : 'fields'}`
          : saving || saveState === 'reconciling'
            ? 'Saving…'
            : 'Unsaved changes'
        : baseRevision === null
          ? 'Loading…'
          : `Saved · revision ${baseRevision}`

  if (!model) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Models', link: { to: '/models' } }]}
          title={definition.isLoading ? 'Loading model…' : 'Model not found'}
        />
      </div>
    )
  }

  const canSubmitNow = Boolean(draft) && !denied && !pending && canEdit

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[
            { label: 'Models', link: { to: '/models' } },
            {
              label: model.name,
              link: { to: '/models/$modelId', params: { modelId } },
            },
            { label: 'Draft' },
          ]}
          title={`Edit ${model.name}`}
          meta={
            <>
              {draft ? (
                <Status tone="draft">Draft v{draft.version}</Status>
              ) : (
                <Status tone="none">No draft</Status>
              )}
              {inUse ? (
                <span className="text-fg-muted">v{inUse.version} in use</span>
              ) : null}
              <span className="text-fg-muted">{savedState}</span>
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
                  Discard draft
                </Button>
                {canSubmitNow && !publishAllowed ? (
                  <Button
                    variant="secondary"
                    disabled={changes.total === 0 || issues.size > 0}
                    onClick={() => setSubmitToken((token) => token + 1)}
                  >
                    Submit for approval
                  </Button>
                ) : null}
                {canPublish && publishAllowed ? (
                  <Button
                    variant="primary"
                    disabled={changes.total === 0 || issues.size > 0 || saving}
                    onClick={() => setPublishOpen(true)}
                  >
                    Publish v{draft.version}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                variant="primary"
                disabled={denied || startDraft.isPending}
                onClick={() => startDraft.mutate()}
              >
                Start draft
              </Button>
            )
          }
        />

        {denied ? (
          <div className="px-4 pt-4 md:px-6">
            <Notice tone="info" icon="lock">
              View only. Only model owners and admins can change {model.name}.
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

        {!draft ? (
          <div className="px-4 py-5 md:px-6">
            <EmptyState
              icon="schema"
              title="No draft to edit"
              description="Start a draft to change this model’s fields. The published version stays in use until the draft is published."
              action={
                <Button
                  variant="primary"
                  disabled={denied || startDraft.isPending}
                  onClick={() => startDraft.mutate()}
                >
                  Start draft
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
              Draft v{draft.version} · v{inUse?.version ?? '—'} stays in use
              until this is{' '}
              {approvalGoverns ? 'approved and published' : 'published'}. Values
              already recorded never change.
            </Notice>

            <div className="flex flex-wrap items-center gap-3">
              <Muted>
                {rows.length} {rows.length === 1 ? 'field' : 'fields'} ·{' '}
                {changes.total} changes since v{inUse?.version ?? '—'}
                {issues.size > 0 ? ` · fix ${issues.size} before saving` : ''}
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
                Add field
              </Button>
            </div>

            <section aria-label="Fields" className="flex flex-col gap-1">
              <h2 className="m-0 text-section">Fields</h2>
              <div className="overflow-hidden rounded-md border border-border">
                <Table aria-label="Schema fields">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="first:pl-3">Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead
                        className="pr-3"
                        align="right"
                        aria-label="Actions"
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((field) => {
                      const change = changes.byKey.get(field.key)
                      const issue = issues.get(field.rowKey)
                      return (
                        <TableRow key={field.rowKey}>
                          <TableCell className="first:pl-3">
                            <Input
                              aria-label={`Field name ${field.key || 'new field'}`}
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
                              aria-label={`Field key ${field.key || 'new field'}`}
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
                              aria-label={`Field type ${field.key || 'new field'}`}
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
                              aria-label={`Required ${field.key || 'new field'}`}
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
                              <Badge
                                variant={change === 'Added' ? 'add' : 'chg'}
                              >
                                {change}
                              </Badge>
                            ) : (
                              <span className="text-label text-fg-muted">
                                —
                              </span>
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
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="quiet"
                                disabled={locked}
                                aria-label={`Remove ${field.label || field.key || 'field'}`}
                                onClick={() =>
                                  applyRows(
                                    rows.filter(
                                      (row) => row.rowKey !== field.rowKey,
                                    ),
                                  )
                                }
                              >
                                Remove
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

            {changes.removed.length ? (
              <section aria-label="Removed fields">
                <h2 className="mb-1 text-section">
                  Removed since v{inUse?.version}
                </h2>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {changes.removed.map((field) => (
                    <li key={field.key} className="text-body">
                      <Badge variant="del">Removed</Badge>{' '}
                      <span className="font-medium">{field.label}</span>{' '}
                      <span className="mono text-label text-fg-muted">
                        {field.key}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>

      <Inspector label="Field editor">
        {selected ? (
          <FieldEditor
            field={selected}
            issue={selectedIssue}
            locked={locked}
            keyLocked={publishedKeys.has(selected.key)}
            publishedVersion={inUse?.version ?? null}
            onPatch={(patch) => patchField(selected.rowKey, patch)}
            onMove={(delta) =>
              applyRows(moveField(rows, selected.rowKey, delta))
            }
            onRemove={() => {
              applyRows(rows.filter((row) => row.rowKey !== selected.rowKey))
              setSelectedKey(null)
            }}
          />
        ) : (
          <InspectorSection title="Field editor">
            <Muted>
              Choose a field’s Edit action to configure its type, unit,
              validation, defaults and reference target.
            </Muted>
          </InspectorSection>
        )}
      </Inspector>

      {discardOpen && draft ? (
        <Dialog
          open
          onOpenChange={(open) => (open ? undefined : setDiscardOpen(false))}
        >
          <DialogContent className="w-[min(480px,calc(100vw-32px))]">
            <DialogHeader
              title="Discard this draft?"
              description={`Draft v${draft.version} and its field changes are deleted. v${inUse?.version ?? '—'} stays in use.`}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                Cancel
              </DialogClose>
              <Button
                variant="danger"
                disabled={discard.isPending || locked}
                onClick={() => discard.mutate()}
              >
                {discard.isPending ? 'Discarding…' : 'Discard draft'}
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
              title={`Publish v${draft.version}`}
              description={`New datasets use v${draft.version}. Datasets already on v${inUse?.version ?? '—'} keep it.`}
            />
            <DialogBody>
              <Muted>
                {changes.total} changes since v{inUse?.version}.
              </Muted>
              {approvalRequired ? (
                <Muted className="mt-2">
                  This workspace requires an approved request for the current
                  revision before publishing.
                </Muted>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                Cancel
              </DialogClose>
              <Button
                variant="primary"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

/**
 * The design's field editor: identity and the type-specific
 * configuration the canonical field shapes already carry.
 */
const categoryOptionsSchema = z.array(
  z
    .object({
      id: z.string(),
      key: z.string(),
      label: z.string(),
      lifecycle: z.enum(['active', 'retired']),
      displayOrder: z.number().optional(),
    })
    .passthrough(),
)

function FieldEditor({
  field,
  issue,
  locked,
  keyLocked,
  publishedVersion,
  onPatch,
  onMove,
  onRemove,
}: {
  field: DraftField
  issue: string | undefined
  locked: boolean
  keyLocked: boolean
  publishedVersion: number | null
  onPatch: (patch: Partial<DraftField>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const validation = field.validation ?? {}
  const numeric =
    field.logicalType === 'integer' || field.logicalType === 'decimal'
  const quantity = field.quantity
  const parsedQuantity = z.record(z.string(), z.unknown()).safeParse(quantity)
  const quantityConfig: Record<string, unknown> = parsedQuantity.success
    ? parsedQuantity.data
    : {}
  const category =
    field.category &&
    typeof field.category === 'object' &&
    !Array.isArray(field.category)
      ? field.category
      : {}
  const parsedOptions = categoryOptionsSchema.safeParse(
    'options' in category ? category.options : [],
  )
  const options = parsedOptions.success ? parsedOptions.data : []
  const relationship =
    field.relationship &&
    typeof field.relationship === 'object' &&
    !Array.isArray(field.relationship)
      ? field.relationship
      : {}
  const target =
    'target' in relationship &&
    relationship.target &&
    typeof relationship.target === 'object'
      ? relationship.target
      : {}
  const targetModelKey =
    'modelKey' in target && typeof target.modelKey === 'string'
      ? target.modelKey
      : ''
  function setOptions(next: typeof options) {
    onPatch({ category: { ...category, kind: 'embedded', options: next } })
  }
  const unit =
    quantity && typeof quantity === 'object' && 'storageUnit' in quantity
      ? quantity.storageUnit
      : undefined

  function setBound(bound: 'min' | 'max', raw: string) {
    const next = { ...validation }
    if (raw.trim() === '') delete next[bound]
    else next[bound] = Number(raw)
    onPatch({ validation: next })
  }

  function setLengthBound(bound: 'minLength' | 'maxLength', raw: string) {
    const next = { ...validation }
    if (raw.trim() === '') delete next[bound]
    else next[bound] = Number(raw)
    onPatch({ validation: next })
  }

  function setUnit(raw: string) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      onPatch({ quantity: null })
      return
    }
    const existing =
      quantity && typeof quantity === 'object' && !Array.isArray(quantity)
        ? quantity
        : {}
    onPatch({
      quantity: {
        ...existing,
        kind: 'kind' in existing ? existing.kind : '',
        dimension: 'dimension' in existing ? existing.dimension : '',
        storageUnit: trimmed,
      },
    })
  }

  const boundValue = (bound: 'min' | 'max' | 'minLength' | 'maxLength') =>
    typeof validation[bound] === 'number' ? String(validation[bound]) : ''

  return (
    <>
      <InspectorSection title="Field editor">
        <p className="m-0 text-label text-fg-muted">
          {field.key || 'New field'}
          {keyLocked
            ? ` · published in v${publishedVersion ?? '—'}`
            : ' · not yet published'}
        </p>
        {issue ? (
          <Notice tone="bad" className="mt-2">
            {issue}
          </Notice>
        ) : null}
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Name" required>
            <Input
              aria-label="Field label"
              disabled={locked}
              value={field.label}
              onChange={(event) => onPatch({ label: event.target.value })}
            />
          </Field>
          <Field
            label="Key"
            hint={
              keyLocked
                ? `Locked: published in v${publishedVersion ?? '—'}, so it identifies this field on every saved record.`
                : 'Lower-case letters, numbers and _, starting with a letter.'
            }
          >
            <Input
              aria-label="Field key"
              className="mono"
              disabled={locked || keyLocked}
              value={field.key}
              onChange={(event) => onPatch({ key: event.target.value })}
            />
          </Field>
          <Field label="Type">
            <Select
              aria-label="Field type"
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
          <Field label="Description">
            <Textarea
              aria-label="Field description"
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
        <InspectorSection title="Quantity">
          <div className="flex flex-col gap-3">
            <Field
              label="Unit"
              hint="Canonical storage unit. Changing it does not convert existing values."
            >
              <Input
                aria-label="Unit"
                disabled={locked}
                placeholder="e.g. NTU"
                value={typeof unit === 'string' ? unit : ''}
                onChange={(event) => setUnit(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {(['kind', 'dimension'] as const).map((property) => (
                <Field
                  key={property}
                  label={property === 'kind' ? 'Quantity kind' : 'Dimension'}
                >
                  <Input
                    aria-label={
                      property === 'kind' ? 'Quantity kind' : 'Dimension'
                    }
                    disabled={locked || !unit}
                    value={
                      property in quantityConfig &&
                      typeof quantityConfig[property] === 'string'
                        ? quantityConfig[property]
                        : ''
                    }
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
      ) : null}

      <InspectorSection title="Validation and defaults">
        <div className="flex flex-col gap-3">
          {numeric ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Minimum">
                <Input
                  aria-label="Minimum"
                  type="number"
                  step="any"
                  disabled={locked}
                  value={boundValue('min')}
                  onChange={(event) => setBound('min', event.target.value)}
                />
              </Field>
              <Field label="Maximum">
                <Input
                  aria-label="Maximum"
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
                <Field label="Min length">
                  <Input
                    aria-label="Minimum length"
                    type="number"
                    min={0}
                    disabled={locked}
                    value={boundValue('minLength')}
                    onChange={(event) =>
                      setLengthBound('minLength', event.target.value)
                    }
                  />
                </Field>
                <Field label="Max length">
                  <Input
                    aria-label="Maximum length"
                    type="number"
                    min={0}
                    disabled={locked}
                    value={boundValue('maxLength')}
                    onChange={(event) =>
                      setLengthBound('maxLength', event.target.value)
                    }
                  />
                </Field>
              </div>
              <Field
                label="Pattern"
                hint="A regular expression every value must match."
              >
                <Input
                  aria-label="Pattern"
                  className="mono"
                  disabled={locked}
                  value={
                    typeof validation.pattern === 'string'
                      ? validation.pattern
                      : ''
                  }
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

          {field.logicalType === 'category' ? (
            <div className="flex flex-col gap-2">
              <Muted>
                Retire an option rather than deleting it, so recorded values
                keep their meaning.
              </Muted>
              {options.map((option, index) => (
                <div
                  key={option.id}
                  className="flex flex-col gap-2 border-b border-border pb-2"
                >
                  <Field label={`Option ${index + 1} key`}>
                    <Input
                      aria-label={`Option ${index + 1} key`}
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
                  <Field label={`Option ${index + 1} label`}>
                    <Input
                      aria-label={`Option ${index + 1} label`}
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
                    Retired
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
                Add category option
              </Button>
            </div>
          ) : null}

          {field.logicalType === 'boolean' ? (
            <Field label="Default for new datasets">
              <Select
                aria-label="Default value"
                disabled={locked || field.cardinality === 'many'}
                value={
                  typeof field.defaultValue === 'boolean'
                    ? String(field.defaultValue)
                    : ''
                }
                onChange={(event) =>
                  onPatch({
                    defaultValue:
                      event.target.value === ''
                        ? null
                        : event.target.value === 'true',
                  })
                }
              >
                <option value="">No default</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
          ) : null}

          {field.logicalType !== 'boolean' ? (
            <Field
              label="Default value"
              hint="Used for new rows only. Leave blank for no default. Many-valued fields cannot have defaults."
            >
              {field.logicalType === 'category' ? (
                <Select
                  aria-label="Default value"
                  disabled={locked || field.cardinality === 'many'}
                  value={
                    typeof field.defaultValue === 'string'
                      ? field.defaultValue
                      : ''
                  }
                  onChange={(event) =>
                    onPatch({ defaultValue: event.target.value || null })
                  }
                >
                  <option value="">No default</option>
                  {options
                    .filter((option) => option.lifecycle === 'active')
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label || option.key}
                      </option>
                    ))}
                </Select>
              ) : (
                <Input
                  aria-label="Default value"
                  disabled={locked || field.cardinality === 'many'}
                  type={
                    numeric
                      ? 'number'
                      : field.logicalType === 'date'
                        ? 'date'
                        : 'text'
                  }
                  step="any"
                  value={
                    typeof field.defaultValue === 'string' ||
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
              Clear default
            </Button>
          ) : null}

          {field.logicalType === 'reference' ? (
            <Field
              label="Target model key"
              hint="The Record Model key whose records this field can reference."
            >
              <Input
                aria-label="Target model key"
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
            label="Cardinality"
            hint="One value or a non-empty list of values when supplied."
          >
            <Select
              aria-label="Cardinality"
              disabled={locked}
              value={field.cardinality ?? 'one'}
              onChange={(event) =>
                onPatch({
                  cardinality: event.target.value === 'many' ? 'many' : 'one',
                  ...(field.logicalType === 'reference' &&
                  field.relationship != null
                    ? {
                        relationship: {
                          ...relationship,
                          cardinality: event.target.value,
                        },
                      }
                    : {}),
                })
              }
            >
              <option value="one">One value</option>
              <option value="many">Several values</option>
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-label">
            <input
              type="checkbox"
              checked={!(field.nullable ?? true)}
              disabled={locked}
              onChange={(event) => onPatch({ nullable: !event.target.checked })}
            />
            Required for new datasets
          </label>
        </div>
      </InspectorSection>

      <InspectorSection title="Field lifecycle">
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
          Retire field, keep its identity and recorded values
        </label>
      </InspectorSection>

      <InspectorSection title="Order">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="quiet"
            aria-label="Move field up"
            disabled={locked}
            onClick={() => onMove(-1)}
          >
            Move up
          </Button>
          <Button
            size="sm"
            variant="quiet"
            aria-label="Move field down"
            disabled={locked}
            onClick={() => onMove(1)}
          >
            Move down
          </Button>
        </div>
        <Muted className="mt-2">
          Moving a field changes the order only, not its values.
        </Muted>
      </InspectorSection>

      <InspectorSection title="Remove">
        <Button size="sm" variant="danger" disabled={locked} onClick={onRemove}>
          Remove field
        </Button>
        <Muted className="mt-2">
          Removing a field from the draft retires it on publish; recorded values
          stay as they were recorded.
        </Muted>
      </InspectorSection>
    </>
  )
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('capability')) {
    return 'You don’t have permission to change this model.'
  }
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
      const category = row.category
      const parsed = categoryOptionsSchema.safeParse(
        category && typeof category === 'object' && 'options' in category
          ? category.options
          : null,
      )
      if (
        !parsed.success ||
        parsed.data.some(
          (option) => !option.key.trim() || !option.label.trim(),
        ) ||
        new Set(parsed.data.map((option) => option.key)).size !==
          parsed.data.length
      ) {
        issues.set(
          row.rowKey,
          'Category options need unique keys and non-empty labels.',
        )
      }
    }
    if (key.length > 60) {
      issues.set(row.rowKey, 'Key must be 60 characters or fewer.')
    } else if (label.length > 200) {
      issues.set(row.rowKey, 'Name must be 200 characters or fewer.')
    }
    const pattern = validation.pattern
    if (
      pattern !== undefined &&
      (typeof pattern !== 'string' || !patternCompiles(pattern))
    ) {
      issues.set(
        row.rowKey,
        'Pattern must be a regular expression the database can compile.',
      )
    }
    for (const bound of ['min', 'max', 'minLength', 'maxLength'] as const) {
      if (bound in validation && !Number.isFinite(validation[bound])) {
        issues.set(row.rowKey, `Enter ${bound} as a number.`)
      }
    }
    const quantity = row.quantity
    if (quantity != null) {
      const config =
        typeof quantity === 'object' && !Array.isArray(quantity)
          ? (quantity as Record<string, unknown>)
          : null
      const blank = (name: string) =>
        typeof config?.[name] !== 'string' || config[name].trim() === ''
      if (row.logicalType !== 'integer' && row.logicalType !== 'decimal') {
        issues.set(row.rowKey, 'Only integer and decimal fields carry a unit.')
      } else if (
        config === null ||
        blank('kind') ||
        blank('dimension') ||
        blank('storageUnit')
      ) {
        issues.set(
          row.rowKey,
          'A unit needs its kind, dimension and storage unit.',
        )
      }
    }
  }
  return issues
}
