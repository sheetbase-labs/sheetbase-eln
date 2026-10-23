import { useMemo, useState } from 'react'
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
import { discoverModelImpact } from '#/lib/model-impact'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import {
  RECORD_MODEL_VERSION_KIND,
  createRecordModelVersion,
  listRecordModelVersionUsage,
  listRecordModelVersions,
  publishRecordModelVersion,
  replaceRecordModelVersionDefinition,
} from '#/lib/record-model-versions'
import type {
  ModelChangeScope,
  RecordModelVersionDefinition,
} from '#/lib/record-model-versions'
import { useWorkspaceRecordModel } from './models-data'
import { ModelApprovalPanel } from './model-approval-panel'
import { useModelApprovalIndex } from './model-approval-data'
import {
  approvalStatus,
  canPublishDraft,
  pendingRequest,
} from './model-approval'
import { buildModelFieldImpact } from './model-field-impact'
import { RecordModelVersionEditor } from './record-model-version-editor'

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
  const dependencies = useQuery({
    queryKey: ['ui-port', 'record-models', 'impact', modelKey] as const,
    queryFn: () => discoverModelImpact(client, modelKey),
  })
  const rows = versions.data ?? []
  const fieldImpact = useMemo(
    () =>
      buildModelFieldImpact(
        rows,
        usage.data ?? [],
        dependencies.data?.dependencies ?? [],
      ),
    [rows, usage.data, dependencies.data],
  )
  const approvals = useModelApprovalIndex(
    rows.map((version) => version.id),
    client,
    RECORD_MODEL_VERSION_KIND,
  )
  const selected =
    rows.find((version) => version.id === selectedId) ?? rows.at(0)
  const draft = rows.find((version) => version.lifecycle === 'draft')
  const published = rows.find((version) => version.lifecycle === 'published')
  const requests = approvals.data?.byVersion.get(selected?.id ?? '') ?? []
  const pending = pendingRequest(requests)
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
  const save = useMutation({
    mutationFn: async (input: {
      definition: RecordModelVersionDefinition
      reason: string
      scope: ModelChangeScope
    }) => {
      if (!selected) throw new Error('Version not found.')
      const version = await replaceRecordModelVersionDefinition(client, {
        versionId: selected.id,
        expectedRevision: selected.revision,
        definition: input.definition,
        reason: input.reason,
        migrationScope: input.scope,
      })
      return version
    },
    onSuccess: invalidate,
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
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle px-4 py-3">
          <Muted>
            {published
              ? `Published v${published.version} stays in use until an approved draft is published.`
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
                    <TableHead>Reason for change</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead align="right">Records</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((version) => {
                    const requestRows =
                      approvals.data?.byVersion.get(version.id) ?? []
                    const status = approvalStatus(requestRows, version.revision)
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
                          <Status
                            tone={
                              version.lifecycle === 'published'
                                ? 'ok'
                                : status.tone
                            }
                          >
                            {version.lifecycle === 'published'
                              ? 'Published'
                              : status.label}
                          </Status>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {version.reason}
                        </TableCell>
                        <TableCell>
                          {version.published_at
                            ? formatNotebookDateTime(version.published_at)
                            : 'Not published'}
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
          </div>
        )}
        {selected && !approvals.isError && !approvals.isLoading ? (
          <ModelApprovalPanel
            version={selected}
            objectKind={RECORD_MODEL_VERSION_KIND}
            publishedVersion={published?.version ?? null}
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
          <InspectorSection title={`Version v${selected.version}`}>
            <p className="text-label">{selected.reason}</p>
            <p className="mt-1 text-label text-fg-muted">
              {selected.definition.fields.length}{' '}
              {selected.definition.fields.length === 1 ? 'field' : 'fields'}.
              Revision {selected.revision}.
            </p>
            <details className="mt-3 border-t border-border-subtle pt-2">
              <summary className="cursor-pointer text-label text-fg-muted">
                Usage and frozen evidence
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {selectedUsage ? (
                  <p className="text-label">
                    {selectedUsage.created_record_count} records created under
                    this version. {selectedUsage.upgraded_record_count}{' '}
                    explicitly upgraded to it. No recorded values were changed
                    by publication or pin upgrades.
                  </p>
                ) : (
                  <Muted>
                    Record upgrade evidence{' '}
                    {usage.isError ? 'unavailable' : 'loading'}.
                  </Muted>
                )}
                <Muted>
                  Earlier signed evidence remains frozen. A new version does not
                  automatically migrate records.
                </Muted>
              </div>
            </details>
          </InspectorSection>
          {selected.lifecycle === 'draft' &&
          canEdit &&
          !pending &&
          approvals.isSuccess ? (
            <InspectorSection title="Draft fields">
              <RecordModelVersionEditor
                key={`${selected.id}:${selected.revision}`}
                version={selected}
                impact={fieldImpact}
                publishedFieldNames={
                  published?.definition.fields.map((f) => f.field_name) ?? []
                }
                publishedVersion={published?.version ?? null}
                busy={save.isPending}
                onSave={(definition, changeReason, scope) =>
                  save.mutate({ definition, reason: changeReason, scope })
                }
              />
            </InspectorSection>
          ) : (
            <InspectorSection title="Fields">
              <ul className="m-0 list-none p-0">
                {selected.definition.fields.map((field) => (
                  <li
                    key={field.id}
                    className="border-b border-border-subtle py-2 text-label"
                  >
                    {field.label}
                    <div className="mono text-fg-muted">
                      {field.field_name} · {field.logical_type}
                      {field.nullable ? '' : ' · required'}
                      {field.lifecycle === 'retired' ? ' · retired' : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </InspectorSection>
          )}
          {selected.lifecycle === 'draft' &&
          hasCapability(role, 'schema.publish') &&
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
        </Inspector>
      ) : null}
    </div>
  )
}
