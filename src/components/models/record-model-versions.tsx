import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { ContractImpactNotice } from '#/components/contracts/contract-impact-notice'
import { storageUnitOf } from '#/components/contracts/field-storage-unit'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Inspector, InspectorSection, Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
} from '#/components/projects/project-data'
import { useWorkspaceRecordModel } from './models-data'
import { ModelApprovalPanel } from './model-approval-panel'
import { useModelApprovalIndex } from './model-approval-data'
import { approvalStatus, canPublishDraft } from './model-approval'
import { FieldChangeList } from './field-changes'
import { diffModelVersions } from './record-model-fields'
import { t } from '#/copy'
import type { RecordModelVersion } from '#/lib/record-model-versions'

/** `updated_at` rides on the passthrough row; fall back to creation. */
function updatedAt(
  version: Pick<RecordModelVersion, 'created_at' | 'updated_at'>,
): string {
  return version.updated_at ?? version.created_at
}

type VersionsProps = {
  modelKey: string
  role: string | null
  user: { id: string; name: string }
  workspaceId: string | null
  client?: DataClient
}

function useVersions({
  modelKey,
  role,
  user,
  workspaceId,
  client = notebookDataClient,
}: VersionsProps) {
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
        : t('library.models.recordModelVersions.theServerRefusedThisAction'),
    )

  const startDraft = useMutation({
    mutationFn: () => {
      if (!modelId)
        throw new Error(
          t('library.models.recordModelVersions.recordModelNotFound'),
        )

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

  return {
    modelKey,
    role,
    user,
    workspaceId,
    client,
    model,
    modelId,
    versions,
    usage,
    rows,
    members,
    approvals,
    selected,
    draft,
    requests,
    canEdit,
    reason,
    setReason,
    error,
    startDraft,
    publish,
    setSelectedId,
  }
}

type Versions = ReturnType<typeof useVersions>

export function RecordModelVersions(props: VersionsProps) {
  const state = useVersions(props)
  const { model, versions, modelId } = state

  if (model.isError || versions.isError)
    return (
      <div className="p-4">
        <Notice
          tone="bad"
          title={t(
            'library.models.recordModelVersions.recordModelVersionsUnavailable',
          )}
        >
          {String((model.error ?? versions.error)?.message)}
          <Button
            onClick={() => {
              void model.refetch()
              void versions.refetch()
            }}
          >
            {t('library.models.recordModelVersions.retry')}
          </Button>
        </Notice>
      </div>
    )

  if (model.isLoading || (modelId && versions.isLoading))
    return (
      <p role="status" className="p-4 text-label">
        {t('library.models.recordModelVersions.loadingRecordModelVersions')}
      </p>
    )

  if (!model.data)
    return (
      <p role="status" className="p-4 text-label">
        {t('library.models.recordModelVersions.recordModelNotFoundIn')}
      </p>
    )

  return <VersionsContent state={state} />
}

function versionComparisons(state: Versions) {
  const { usage, selected, rows, members, approvals } = state

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
      ? approved.approved_by_user_ids.map(
          (id) => nameOf(id) ?? t('library.models.recordModelVersions.someone'),
        )
      : []
  }

  const selectedChanges = selected ? changesOf(selected) : []
  const selectedPrevious = selected ? previousOf(selected) : null

  return {
    selectedUsage,
    current,
    previousOf,
    changesOf,
    nameOf,
    approvedBy,
    selectedChanges,
    selectedPrevious,
  }
}

type Comparisons = ReturnType<typeof versionComparisons>

function VersionsContent({ state }: { state: Versions }) {
  const comparisons = versionComparisons(state)

  const {
    selected,
    approvals,
    requests,
    role,
    user,
    workspaceId,
    client,
    error,
  } = state

  const { current } = comparisons

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <VersionsToolbar state={state} current={current} />
        {error ? (
          <div role="alert" className="p-4 text-label text-danger-text">
            {error}
          </div>
        ) : null}
        <VersionsTable state={state} comparisons={comparisons} />
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
            {t(
              'library.models.recordModelVersions.approvalHistoryUnavailablePublicationIs',
            )}
          </p>
        ) : null}
      </div>
      {selected ? (
        <VersionInspector
          state={state}
          comparisons={comparisons}
          selected={selected}
        />
      ) : null}
    </div>
  )
}

function VersionsToolbar({
  state,
  current,
}: {
  state: Versions
  current: RecordModelVersion | undefined
}) {
  const { draft, canEdit, reason, setReason, startDraft, rows, modelKey } =
    state

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle px-4 py-3">
      <Muted>
        {current
          ? t('library.models.recordModelVersions.publishedVStaysInUse', {
              version: current.version,
            })
          : t('library.models.recordModelVersions.noVersionIsPublishedYet')}
      </Muted>
      {!draft && canEdit ? (
        <form
          className="ml-auto flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            startDraft.mutate()
          }}
        >
          <Field
            label={t('library.models.recordModelVersions.reasonForDraft')}
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
            {t('library.models.recordModelVersions.startDraftV', {
              version: (rows[0]?.version ?? 0) + 1,
            })}
          </Button>
        </form>
      ) : draft ? (
        <Button
          className="ml-auto"
          nativeButton={false}
          render={
            <Link to="/models/$modelId/edit" params={{ modelId: modelKey }} />
          }
        >
          {t('library.models.recordModelVersions.openDraftV', {
            version: draft.version,
          })}
        </Button>
      ) : null}
    </div>
  )
}

function VersionsTable({
  state,
  comparisons,
}: {
  state: Versions
  comparisons: Comparisons
}) {
  const { rows, approvals, selected, setSelectedId, usage } = state
  const { changesOf, approvedBy, current, nameOf, previousOf } = comparisons
  const focus = useRowFocus(selected?.id ?? null, setSelectedId)

  const columns = useMemo<RegistryColumn<RecordModelVersion>[]>(
    () => [
      {
        id: 'version',
        header: t('library.models.recordModelVersions.version'),
        accessorFn: (version) => version.version,
        cell: ({ row }) => (
          <Button
            variant="quiet"
            aria-pressed={selected?.id === row.original.id}
            onClick={() => setSelectedId(row.original.id)}
          >
            v{row.original.version}
          </Button>
        ),
      },
      {
        id: 'published',
        header: t('library.models.recordModelVersions.published'),
        accessorFn: (version) => version.published_at ?? updatedAt(version),
        cell: ({ row }) => {
          const version = row.original

          return version.published_at
            ? formatDate(version.published_at)
            : t('library.models.recordModelVersions.rev', {
                revision: version.revision,
                version: formatNotebookDateTime(updatedAt(version)).slice(-5),
              })
        },
        meta: { cellClassName: 'text-fg-muted' },
      },
      {
        id: 'by',
        header: t('library.models.recordModelVersions.by'),
        accessorFn: (version) => nameOf(version.created_by_user_id) ?? '—',
      },
      {
        id: 'change',
        header: t('library.models.recordModelVersions.change'),
        enableSorting: false,
        meta: {
          cellClassName: 'min-w-[220px] max-w-[300px] whitespace-normal',
        },
        cell: ({ row }) => {
          const version = row.original

          return previousOf(version) ? (
            <FieldChangeList
              changes={changesOf(version)}
              label={t('library.models.recordModelVersions.changesInV', {
                version: version.version,
              })}
            />
          ) : (
            <span className="text-fg-muted">
              {t('library.models.recordModelVersions.createdWithFields', {
                fields: version.definition.fields.length,
              })}
            </span>
          )
        },
      },
      {
        id: 'approvedBy',
        header: t('library.models.recordModelVersions.approvedBy'),
        accessorFn: (version) => approvedBy(version.id).join(', ') || '—',
      },
      {
        id: 'records',
        header: t('library.models.recordModelVersions.records'),
        accessorFn: (version) =>
          usage.data?.find((row) => row.version_id === version.id)
            ?.record_count ?? 0,
        cell: ({ row }) =>
          usage.isError
            ? t('library.models.recordModelVersions.unavailable')
            : (usage.data?.find((entry) => entry.version_id === row.original.id)
                ?.record_count ?? '…'),
        ...rightAligned<RecordModelVersion>(),
      },
      {
        id: 'status',
        header: t('library.models.recordModelVersions.state'),
        meta: { cellClassName: 'min-w-[110px]' },
        accessorFn: (version) => version.lifecycle,
        cell: ({ row }) => {
          const version = row.original

          if (version.lifecycle === 'published') {
            return (
              <Status tone={version.id === current?.id ? 'progress' : 'stored'}>
                {version.id === current?.id
                  ? t('library.models.recordModelVersions.current')
                  : t('library.models.recordModelVersions.replaced')}
              </Status>
            )
          }

          const status = approvalStatus(
            approvals.data?.byVersion.get(version.id) ?? [],
            version.revision,
          )

          return (
            <Status tone={status.tone === 'none' ? 'stored' : status.tone}>
              {status.tone === 'none'
                ? t('library.models.recordModelVersions.draft')
                : status.label}
            </Status>
          )
        },
      },
    ],
    [
      selected?.id,
      setSelectedId,
      current?.id,
      approvals.data,
      nameOf,
      approvedBy,
      previousOf,
      changesOf,
      usage.data,
      usage.isError,
    ],
  )

  return !rows.length ? (
    <p className="p-4 text-label text-fg-muted">
      {t('library.models.recordModelVersions.noVersionsYetStartA')}
    </p>
  ) : (
    <div className="p-4">
      <TableBox>
        <RegistryGrid
          label={t('library.models.recordModelVersions.recordModelVersions')}
          rows={rows}
          columns={columns}
          getRowId={(version) => version.id}
          rowSelection={focus.rowSelection}
          onRowSelectionChange={focus.onRowSelectionChange}
          rowLabel={(version) => `v${version.version}`}
        />
      </TableBox>
      <Muted className="mt-3 block">
        {t('library.models.recordModelVersions.publishingAVersionNeverChanges')}
      </Muted>
    </div>
  )
}

function VersionInspector({
  state,
  comparisons,
  selected,
}: {
  state: Versions
  comparisons: Comparisons
  selected: RecordModelVersion
}) {
  const { modelKey, role, approvals, requests, publish, canEdit } = state
  const { selectedPrevious, selectedChanges } = comparisons

  return (
    <Inspector
      label={t('library.models.recordModelVersions.versionVDetails', {
        version: selected.version,
      })}
      width={360}
    >
      <InspectorSection
        title={
          selected.lifecycle === 'draft'
            ? t('library.models.recordModelVersions.draftV', {
                version: selected.version,
              })
            : t('library.models.recordModelVersions.version2', {
                version: selected.version,
              })
        }
      >
        <span className="mono text-fg-muted">
          {modelKey} · v{selected.version}
        </span>
        <VersionAuthorship selected={selected} comparisons={comparisons} />
        <p className="mt-1 text-label">{selected.reason}</p>
        {selected.lifecycle === 'draft' ? (
          <ContractImpactNotice
            target={{ kind: 'record_model', key: modelKey }}
            modelId={modelKey}
            nextFields={selected.definition.fields
              .filter((field) => field.lifecycle === 'active')
              .map((field) => ({
                key: field.field_name,
                logicalType: field.logical_type,
                unit: storageUnitOf(field.quantity),
              }))}
          />
        ) : null}
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
                {t('library.models.recordModelVersions.publishV', {
                  version: selected.version,
                })}
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
                {t('library.models.recordModelVersions.editFields')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </InspectorSection>
      <InspectorSection
        title={
          selectedPrevious
            ? t('library.models.recordModelVersions.changesSinceV', {
                version: selectedPrevious.version,
              })
            : t('library.models.recordModelVersions.changes')
        }
      >
        {selectedChanges.length ? (
          <FieldChangeList
            changes={selectedChanges}
            label={t('library.models.recordModelVersions.changesInV', {
              version: selected.version,
            })}
          />
        ) : (
          <Muted>
            {selectedPrevious
              ? t('library.models.recordModelVersions.noFieldChangesYet')
              : t('library.models.recordModelVersions.createdWithFields2', {
                  fields: selected.definition.fields.length,
                })}
          </Muted>
        )}
      </InspectorSection>
      <VersionRecordUsage
        selected={selected}
        usage={state.usage}
        selectedUsage={comparisons.selectedUsage}
      />
    </Inspector>
  )
}

function VersionRecordUsage({
  selected,
  usage,
  selectedUsage,
}: {
  selected: RecordModelVersion
  usage: Versions['usage']
  selectedUsage: Comparisons['selectedUsage']
}) {
  return selected.lifecycle === 'published' ? (
    <InspectorSection
      title={t('library.models.recordModelVersions.whatHappenedToRecords')}
    >
      {selectedUsage ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-label">
          <li>
            {t('library.models.recordModelVersions.recordsCreatedOnV', {
              createdRecordCount: selectedUsage.created_record_count,
              version: selected.version,
            })}
          </li>
          <li>
            {t('library.models.recordModelVersions.movedUpToV', {
              upgradedRecordCount: selectedUsage.upgraded_record_count,
              version: selected.version,
            })}
          </li>
          <li>
            {t('library.models.recordModelVersions.noRecordedValueChanged')}
          </li>
        </ul>
      ) : (
        <Muted>
          {t('library.models.recordModelVersions.recordUpgradeEvidence')}{' '}
          {usage.isError ? 'unavailable' : 'loading'}.
        </Muted>
      )}
      <Muted className="mt-2 block">
        {t('library.models.recordModelVersions.signedRecordsStayFrozenA')}
      </Muted>
    </InspectorSection>
  ) : (
    <InspectorSection
      title={t('library.models.recordModelVersions.recordsOnThisVersion')}
    >
      <Muted>
        {t('library.models.recordModelVersions.noneRecordsCanUseIt')}
      </Muted>
    </InspectorSection>
  )
}

function VersionAuthorship({
  selected,
  comparisons,
}: {
  selected: RecordModelVersion
  comparisons: Comparisons
}) {
  const { approvedBy, nameOf } = comparisons

  return (
    <p className="mt-1 text-label text-fg-muted">
      {selected.lifecycle === 'published'
        ? approvedBy(selected.id).length
          ? t('library.models.recordModelVersions.publishedApprovedBy', {
              publishedAt: formatDate(selected.published_at),
              approvers: approvedBy(selected.id).join(', '),
            })
          : t('library.models.recordModelVersions.published2', {
              publishedAt: formatDate(selected.published_at),
            })
        : t('library.models.recordModelVersions.revisionEditedBy', {
            revision: selected.revision,
            name: nameOf(selected.created_by_user_id) ?? 'someone',
            when: formatNotebookDateTime(updatedAt(selected)),
          })}
    </p>
  )
}
