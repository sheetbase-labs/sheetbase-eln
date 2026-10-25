import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { Inspector, InspectorSection, Muted } from '#/components/v3/ui/layout'
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
import { hasCapability } from '#/lib/capability'
import type { DataClient } from '#/lib/data-client'
import {
  formatDate,
  formatNotebookDateTime,
  notebookDataClient,
} from '#/lib/notebook-data'
import {
  RECORD_MODEL_VERSION_KIND,
  createRecordModelVersion,
  listRecordModelVersionUsage,
  listRecordModelVersions,
  publishRecordModelVersion,
} from '#/lib/record-model-versions'
import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/v3/projects/project-data'
import { useWorkspaceRecordModel } from './models-data'
import { ModelApprovalPanel } from './model-approval-panel'
import { useModelApprovalIndex } from './model-approval-data'
import { approvalStatus, canPublishDraft } from './model-approval'
import { FieldChangeList } from './field-changes'
import { diffModelVersions } from './record-model-fields'

/** `updated_at` rides on the passthrough row; fall back to creation. */
function updatedAt(version: {
  created_at: string
  [key: string]: unknown
}): string {
  const value = version.updated_at
  return typeof value === 'string' ? value : version.created_at
}

export function RecordModelVersions({
  modelKey,
  role,
  user,
  workspaceId,
  client = notebookDataClient,
}: {
  modelKey: string
  role: string | null
  user: { id: string; name: string }
  workspaceId: string | null
  client?: DataClient
}) {
  const model = useWorkspaceRecordModel(modelKey, client)
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const modelId = model.data?.id
  const versions = useQuery({
    queryKey: ['ui-port', 'record-models', 'versions', modelId],
    queryFn: () => (modelId ? listRecordModelVersions(client, modelId) : []),
    enabled: Boolean(modelId),
  })
  const usage = useQuery({
    queryKey: ['ui-port', 'record-models', 'version-usage', modelId],
    queryFn: () =>
      modelId ? listRecordModelVersionUsage(client, modelId) : [],
    enabled: Boolean(modelId),
  })
  const rows = versions.data ?? []
  const members = useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: () => fetchWorkspaceMemberIdentities(),
  })
  const approvals = useModelApprovalIndex(
    rows.map((version) => version.id),
    client,
    RECORD_MODEL_VERSION_KIND,
  )
  const selected =
    rows.find((version) => version.id === selectedId) ?? rows.at(0)
  const draft = rows.find((version) => version.lifecycle === 'draft')
  const requests = approvals.data?.byVersion.get(selected?.id ?? '') ?? []
  const canEdit = hasCapability(role, 'schema.edit')

  function invalidate() {
    setError(null)
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'record-models'],
    })
    void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
  }
  const onError = (cause: unknown) =>
    setError(
      cause instanceof Error
        ? cause.message
        : 'The server refused this action.',
    )
  const startDraft = useMutation({
    mutationFn: () => {
      if (!modelId) throw new Error('Record Model not found.')
      return createRecordModelVersion(client, {
        modelId,
        reason: reason.trim(),
      })
    },
    onSuccess: (version) => {
      setSelectedId(version.id)
      setReason('')
      invalidate()
    },
    onError,
  })
  const publish = useMutation({
    mutationFn: (id: string) => publishRecordModelVersion(client, id),
    onSuccess: invalidate,
    onError,
  })

  if (model.isError || versions.isError)
    return (
      <div className="p-4">
        <Notice tone="bad" title="Record Model versions unavailable">
          {String((model.error ?? versions.error)?.message)}
          <Button
            onClick={() => {
              void model.refetch()
              void versions.refetch()
            }}
          >
            Retry
          </Button>
        </Notice>
      </div>
    )
  if (model.isLoading || (modelId && versions.isLoading))
    return (
      <p role="status" className="p-4 text-label">
        Loading Record Model versions…
      </p>
    )
  if (!model.data)
    return (
      <p role="status" className="p-4 text-label">
        Record Model not found in this workspace.
      </p>
    )

  const selectedUsage = usage.data?.find(
    (row) => row.version_id === selected?.id,
  )
  const publishedList = rows.filter((v) => v.lifecycle === 'published')
  const current = publishedList.at(0)
  /** The version a row is compared with: the published one before it. */
  const previousOf = (version: (typeof rows)[number]) =>
    publishedList
      .filter((v) => v.version < version.version)
      .sort((a, b) => b.version - a.version)
      .at(0) ?? null
  const changesOf = (version: (typeof rows)[number]) =>
    diffModelVersions(
      previousOf(version)?.definition ?? null,
      version.definition,
    )
  const nameOf = (userId: string | null | undefined) =>
    (userId && members.data?.find((m) => m.user_id === userId)?.name) || null
  const approvedBy = (versionId: string) => {
    const approved = (approvals.data?.byVersion.get(versionId) ?? []).find(
      (r) => r.state === 'approved',
    )
    return approved
      ? approved.approved_by_user_ids.map((id) => nameOf(id) ?? 'Someone')
      : []
  }
  const selectedChanges = selected ? changesOf(selected) : []
  const selectedPrevious = selected ? previousOf(selected) : null
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle px-4 py-3">
          <Muted>
            {current
              ? `Published v${current.version} stays in use until an approved draft is published.`
              : 'No version is published yet.'}
          </Muted>
          {!draft && canEdit ? (
            <form
              className="ml-auto flex items-end gap-2"
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
                Start draft v{(rows[0]?.version ?? 0) + 1}
              </Button>
            </form>
          ) : draft ? (
            <Button
              className="ml-auto"
              nativeButton={false}
              render={
                <Link
                  to="/models/$modelId/edit"
                  params={{ modelId: modelKey }}
                />
              }
            >
              Open draft v{draft.version}
            </Button>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="p-4 text-label text-danger-text">
            {error}
          </div>
        ) : null}
        {!rows.length ? (
          <p className="p-4 text-label text-fg-muted">
            No versions yet. Start a draft to define this Record Model.
          </p>
        ) : (
          <div className="p-4">
            <TableBox>
              <Table aria-label="Record Model versions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead align="right">Records</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((version) => {
                    const requestRows =
                      approvals.data?.byVersion.get(version.id) ?? []
                    const status = approvalStatus(requestRows, version.revision)
                    const changes = changesOf(version)
                    const names = approvedBy(version.id)
                    return (
                      <TableRow
                        key={version.id}
                        selected={selected?.id === version.id}
                      >
                        <TableCell>
                          <Button
                            variant="quiet"
                            aria-pressed={selected?.id === version.id}
                            onClick={() => setSelectedId(version.id)}
                          >
                            v{version.version}
                          </Button>
                        </TableCell>
                        <TableCell>
                          {version.lifecycle === 'published' ? (
                            <Status
                              tone={
                                version.id === current?.id
                                  ? 'progress'
                                  : 'stored'
                              }
                            >
                              {version.id === current?.id
                                ? 'Current'
                                : 'Replaced'}
                            </Status>
                          ) : (
                            <Status
                              tone={
                                status.tone === 'none' ? 'stored' : status.tone
                              }
                            >
                              {status.tone === 'none' ? 'Draft' : status.label}
                            </Status>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal text-fg-muted">
                          {version.published_at
                            ? formatDate(version.published_at)
                            : `Rev. ${version.revision} · ${formatNotebookDateTime(updatedAt(version)).slice(-5)}`}
                        </TableCell>
                        <TableCell>
                          {nameOf(version.created_by_user_id) ?? '—'}
                        </TableCell>
                        <TableCell>{names.join(', ') || '—'}</TableCell>
                        <TableCell className="min-w-[240px] whitespace-normal">
                          {previousOf(version) ? (
                            <FieldChangeList
                              changes={changes}
                              label={`Changes in v${version.version}`}
                            />
                          ) : (
                            <span className="text-fg-muted">
                              Created with {version.definition.fields.length}{' '}
                              fields
                            </span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {usage.isError
                            ? 'Unavailable'
                            : (usage.data?.find(
                                (row) => row.version_id === version.id,
                              )?.record_count ?? '…')}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
            <Muted className="mt-3 block">
              Publishing a version never changes existing records: each stays on
              the version it was made from until its owner updates it. New
              versions add or change fields; recorded values are never
              rewritten.
            </Muted>
          </div>
        )}
        {selected && !approvals.isError && !approvals.isLoading ? (
          <ModelApprovalPanel
            version={selected}
            objectKind={RECORD_MODEL_VERSION_KIND}
            publishedVersion={current?.version ?? null}
            requests={requests}
            decisions={approvals.data?.decisions ?? []}
            role={role}
            user={user}
            workspaceId={workspaceId}
            client={client}
          />
        ) : approvals.isError ? (
          <p role="alert" className="p-4 text-label text-danger-text">
            Approval history unavailable. Publication is disabled.
          </p>
        ) : null}
      </div>
      {selected ? (
        <Inspector label={`Version v${selected.version} details`} width={360}>
          <InspectorSection
            title={
              selected.lifecycle === 'draft'
                ? `Draft v${selected.version}`
                : `Version ${selected.version}`
            }
          >
            <span className="mono text-fg-muted">
              {modelKey} · v{selected.version}
            </span>
            <p className="mt-1 text-label text-fg-muted">
              {selected.lifecycle === 'published'
                ? `Published ${formatDate(selected.published_at)}${
                    approvedBy(selected.id).length
                      ? ` · approved by ${approvedBy(selected.id).join(', ')}`
                      : ''
                  }`
                : `Revision ${selected.revision} · edited by ${nameOf(selected.created_by_user_id) ?? 'someone'}, ${formatNotebookDateTime(updatedAt(selected))}`}
            </p>
            <p className="mt-1 text-label">{selected.reason}</p>
            {selected.lifecycle === 'draft' ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {hasCapability(role, 'schema.publish') &&
                approvals.isSuccess &&
                canPublishDraft(requests, true, selected.revision) ? (
                  <Button
                    variant="primary"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate(selected.id)}
                  >
                    Publish v{selected.version}
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        to="/models/$modelId/edit"
                        params={{ modelId: modelKey }}
                      />
                    }
                  >
                    Edit fields
                  </Button>
                ) : null}
              </div>
            ) : null}
          </InspectorSection>
          <InspectorSection
            title={
              selectedPrevious
                ? `Changes since v${selectedPrevious.version}`
                : 'Changes'
            }
          >
            {selectedChanges.length ? (
              <FieldChangeList
                changes={selectedChanges}
                label={`Changes in v${selected.version}`}
              />
            ) : (
              <Muted>
                {selectedPrevious
                  ? 'No field changes yet.'
                  : `Created with ${selected.definition.fields.length} fields.`}
              </Muted>
            )}
          </InspectorSection>
          {selected.lifecycle === 'published' ? (
            <InspectorSection title="What happened to records">
              {selectedUsage ? (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-label">
                  <li>
                    {selectedUsage.created_record_count} records created on v
                    {selected.version}
                  </li>
                  <li>
                    {selectedUsage.upgraded_record_count} moved up to v
                    {selected.version}
                  </li>
                  <li>No recorded value changed</li>
                </ul>
              ) : (
                <Muted>
                  Record upgrade evidence{' '}
                  {usage.isError ? 'unavailable' : 'loading'}.
                </Muted>
              )}
              <Muted className="mt-2 block">
                Signed records stay frozen: a record signed on an earlier
                version keeps it in its history and evidence.
              </Muted>
            </InspectorSection>
          ) : (
            <InspectorSection title="Records on this version">
              <Muted>
                None. Records can use it once it is approved and current.
              </Muted>
            </InspectorSection>
          )}
        </Inspector>
      ) : null}
    </div>
  )
}
