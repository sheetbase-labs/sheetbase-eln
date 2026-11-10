import { useMemo } from 'react'
import { formatDate } from '#/lib/format-date'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { EmptyState } from '#/components/ui/empty-state'
import { Muted } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { toast } from '#/components/ui/sonner'
import { publishDatasetSchemaVersion } from '#/lib/dataset-schema-definition-rpc'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import { notebookDataClient } from '#/lib/notebook-data'
import { hasCapability } from '#/lib/capability'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import {
  modelStatus,
  useModelDatasets,
  useModelVersionFields,
  useModelVersions,
} from '#/components/models/models-data'
import { ContractImpactNotice } from '#/components/contracts/contract-impact-notice'
import { storageUnitOf } from '#/components/contracts/field-storage-unit'
import { buildVersionImpacts } from '#/components/models/model-version-impact'
import {
  approvalStatus,
  canPublishDraft,
} from '#/components/models/model-approval'
import { useModelApprovalIndex } from '#/components/models/model-approval-data'
import { ModelApprovalPanel } from '#/components/models/model-approval-panel'
import { RecordModelVersions } from '#/components/models/record-model-versions'
import { isUuid } from '#/lib/field-value-validation'
import type {
  FieldChange,
  RecordOutcome,
  VersionFieldDiff,
} from '#/components/models/model-version-impact'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): the Versions tab. Publishing runs the publish
 * RPC, so the database holds the rules. Each row also records the field changes
 * since the previous version and what publishing did to records (MDL-02.4). */
export const Route = createFileRoute('/models/$modelId/versions')({
  component: ModelVersions,
})

const MAX_CHANGES_SHOWN = 6

const CHANGE_BADGE: Record<FieldChange['kind'], 'add' | 'chg' | 'del'> = {
  added: 'add',
  changed: 'chg',
  removed: 'del',
}

const OUTCOME: Record<
  RecordOutcome,
  { tone: Tone; label: string; detail: string }
> = {
  draft: {
    tone: 'draft',
    label: t('library.models.versions.notPublished'),
    detail: t('library.models.versions.draftNotYetInUse'),
  },
  'new-records-only': {
    tone: 'progress',
    label: t('library.models.versions.newRecordsOnly'),
    detail: t('library.models.versions.newDatasetsUseThisVersion'),
  },
  unchanged: {
    tone: 'stored',
    label: t('library.models.versions.unchanged'),
    detail: t('library.models.versions.recordsStayPinnedNotMigrated'),
  },
}

function ModelVersions() {
  const { modelId } = Route.useParams()
  const { context } = Route.useRouteContext()

  return isUuid(modelId) ? (
    <DatasetModelVersions />
  ) : (
    <RecordModelVersions
      modelKey={modelId}
      role={context.workspace?.role ?? null}
      user={{ id: context.user.id, name: context.user.name }}
      workspaceId={context.workspace?.id ?? null}
    />
  )
}

function useDatasetVersionHistory() {
  const { modelId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const versions = useModelVersions(modelId)
  const rows = useMemo(() => versions.data ?? [], [versions.data])
  const versionIds = useMemo(() => rows.map((v) => v.id), [rows])
  const versionFields = useModelVersionFields(versionIds)
  const datasets = useModelDatasets(versionIds)
  const approval = useModelApprovalIndex(versionIds)

  const policy = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
  })

  const loading = versionFields.isLoading || datasets.isLoading

  const requestsFor = (versionId: string) =>
    approval.data?.byVersion.get(versionId) ?? []

  const draft = rows.find((v) => v.lifecycle === 'draft') ?? null
  const latestPublished = rows.find((v) => v.lifecycle !== 'draft') ?? null
  const panelVersion = draft ?? rows.at(0) ?? null
  const role = context.workspace?.role ?? null
  const user = { id: context.user.id, name: context.user.name }
  const workspaceId = context.workspace?.id ?? null

  const fieldsByVersion = useMemo(() => {
    const map = new Map<string, CanonicalDatasetSchemaField[]>()

    for (const field of versionFields.data ?? []) {
      const list = map.get(field.schema_version_id) ?? []
      list.push(field)
      map.set(field.schema_version_id, list)
    }

    return map
  }, [versionFields.data])

  const impacts = useMemo(
    () => buildVersionImpacts(rows, fieldsByVersion, datasets.data ?? []),
    [rows, fieldsByVersion, datasets.data],
  )

  const publish = useMutation({
    mutationFn: (versionId: string) =>
      publishDatasetSchemaVersion(notebookDataClient, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast(t('library.models.versions.versionPublished'), {
        description: t('library.models.versions.newAndExistingDatasetsCan'),
      })
    },
    onError: (error) => {
      toast(t('library.models.versions.couldNotPublish'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.models.versions.theDatabaseRefusedIt'),
      })
    },
  })

  return {
    modelId,
    rows,
    impacts,
    loading,
    approval,
    policy,
    draft,
    panelVersion,
    fieldsByVersion,
    latestPublished,
    role,
    user,
    workspaceId,
    requestsFor,
    publish,
  }
}

type DatasetVersionHistory = ReturnType<typeof useDatasetVersionHistory>

type DatasetVersion = DatasetVersionHistory['rows'][number]

function DatasetModelVersions() {
  const history = useDatasetVersionHistory()

  const {
    modelId,
    rows,
    impacts,
    loading,
    approval,
    policy,
    draft,
    panelVersion,
    fieldsByVersion,
    latestPublished,
    role,
    user,
    workspaceId,
    requestsFor,
  } = history

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title={t('library.models.versions.noVersionsYet')}
          description={t('library.models.versions.openEditModelChooseStart')}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/models/$modelId/edit" params={{ modelId }} />}
            >
              {t('library.models.versions.editModel')}
            </Button>
          }
        />
      </div>
    )
  }

  const columns: RegistryColumn<(typeof impacts)[number]>[] = [
    {
      id: 'version',
      header: t('library.models.versions.version'),
      cell: ({ row }) => (
        <span className="font-medium">v{row.original.version.version}</span>
      ),
      meta: { cellClassName: 'align-top!' },
    },
    {
      id: 'status',
      header: t('library.models.versions.status'),
      cell: ({ row }) => {
        const status = modelStatus(row.original.version.lifecycle)

        return <Status tone={status.tone}>{status.label}</Status>
      },
      meta: { cellClassName: 'align-top!' },
    },
    {
      id: 'approval',
      header: t('library.models.versions.approval'),
      cell: ({ row }) => {
        if (approval.isLoading) return <span className="text-fg-muted">…</span>

        const status = approvalStatus(
          requestsFor(row.original.version.id),
          row.original.version.revision,
        )

        return <Status tone={status.tone}>{status.label}</Status>
      },
      meta: { cellClassName: 'align-top!' },
    },
    {
      id: 'published',
      header: t('library.models.versions.published'),
      cell: ({ row }) => formatDate(row.original.version.published_at),
      meta: { cellClassName: 'align-top! text-fg-muted' },
    },
    {
      id: 'changes',
      header: t('library.models.versions.changesSincePrevious'),
      cell: ({ row }) => (
        <VersionChanges
          diff={row.original.diff}
          loading={loading}
          isFirstVersion={
            impacts[impacts.length - 1]?.version.id === row.original.version.id
          }
        />
      ),
      meta: {
        cellClassName:
          'min-w-[260px] max-w-[420px] whitespace-normal align-top!',
      },
    },
    {
      id: 'records',
      header: t('library.models.versions.records'),
      cell: ({ row }) => (loading ? '…' : row.original.recordCount),
      meta: {
        ...rightAligned<(typeof impacts)[number]>().meta,
        cellClassName: 'align-top! tabular-nums text-right',
      },
    },
    {
      id: 'impact',
      header: t('library.models.versions.recordImpact'),
      cell: ({ row }) => {
        const outcome = OUTCOME[row.original.outcome]

        return (
          <div className="flex flex-col gap-0.5">
            <Status tone={outcome.tone}>{outcome.label}</Status>
            <span className="text-label text-fg-muted">
              {row.original.outcome === 'new-records-only'
                ? t('library.models.versions.olderRecordsUnchanged', {
                    count: row.original.olderRecordCount,
                  })
                : outcome.detail}
            </span>
          </div>
        )
      },
      meta: { cellClassName: 'whitespace-normal align-top!' },
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">{t('library.models.versions.actions')}</span>
      ),
      cell: ({ row }) => {
        return (
          <VersionPublishAction
            version={row.original.version}
            history={history}
          />
        )
      },
      meta: {
        ...rightAligned<(typeof impacts)[number]>().meta,
        cellClassName: 'align-top! text-right',
      },
    },
  ]

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      {policy.isError ? (
        <Notice
          tone="bad"
          title={t('library.models.versions.publishingPolicyUnavailable')}
          className="mb-4"
          action={
            <Button size="sm" onClick={() => void policy.refetch()}>
              {t('library.models.versions.retry')}
            </Button>
          }
        >
          {t('library.models.versions.theWorkspacesPublicationPolicyCould')}
        </Notice>
      ) : null}
      {draft ? (
        <ContractImpactNotice
          target={{ kind: 'dataset_schema', id: modelId }}
          modelId={modelId}
          nextFields={(fieldsByVersion.get(draft.id) ?? [])
            .filter((field) => field.lifecycle === 'active')
            .map((field) => ({
              key: field.key,
              logicalType: field.logical_type,
              unit: storageUnitOf(field.quantity),
            }))}
        />
      ) : null}
      {panelVersion ? (
        <ModelApprovalPanel
          className="mb-4"
          version={panelVersion}
          publishedVersion={latestPublished?.version ?? null}
          requests={requestsFor(panelVersion.id)}
          decisions={approval.data?.decisions ?? []}
          role={role}
          user={user}
          workspaceId={workspaceId}
        />
      ) : null}
      <TableBox>
        <RegistryGrid
          label={t('library.models.versions.modelVersions')}
          rows={impacts}
          columns={columns}
          getRowId={(row) => row.version.id}
          selectable={false}
        />
      </TableBox>
      <Muted className="mt-3">
        {t('library.models.versions.publishingCreatesANewVersion')}
      </Muted>
    </div>
  )
}

function VersionPublishAction({
  version,
  history,
}: {
  version: DatasetVersion
  history: DatasetVersionHistory
}) {
  const { role, policy, approval, requestsFor, publish } = history

  return version.lifecycle === 'draft' &&
    hasCapability(role, 'schema.publish') &&
    policy.isSuccess &&
    !approval.isLoading &&
    !approval.isError &&
    canPublishDraft(
      requestsFor(version.id),
      policy.data?.publicationApprovalRequired ?? false,
      version.revision,
    ) ? (
    <Button
      size="sm"
      variant="primary"
      disabled={publish.isPending}
      onClick={() => publish.mutate(version.id)}
    >
      {t('library.models.versions.publish')}
    </Button>
  ) : null
}

function VersionChanges({
  diff,
  loading,
  isFirstVersion,
}: {
  diff: VersionFieldDiff
  loading: boolean
  isFirstVersion: boolean
}) {
  if (loading) return <span className="text-fg-muted">…</span>

  if (isFirstVersion && diff.total === 0)
    return (
      <span className="text-fg-muted">
        {t('library.models.versions.initialVersion')}
      </span>
    )

  if (diff.total === 0)
    return (
      <span className="text-fg-muted">
        {t('library.models.versions.noFieldChanges')}
      </span>
    )

  const changes = [...diff.added, ...diff.changed, ...diff.removed]
  const shown = changes.slice(0, MAX_CHANGES_SHOWN)
  const hidden = changes.length - shown.length

  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {shown.map((change) => (
        <li key={`${change.kind}-${change.key}`} className="text-body">
          <Badge variant={CHANGE_BADGE[change.kind]}>
            {change.kind === 'added'
              ? t('library.models.versions.added')
              : change.kind === 'removed'
                ? t('library.models.versions.removed')
                : t('library.models.versions.changed')}
          </Badge>{' '}
          <span className="font-medium">{change.label}</span>{' '}
          <span className="mono text-label text-fg-muted">{change.key}</span>
          {change.detail ? (
            <span className="text-label text-fg-muted"> · {change.detail}</span>
          ) : null}
        </li>
      ))}
      {hidden > 0 ? (
        <li className="text-label text-fg-muted">
          {t('library.models.versions.more', { hidden })}
        </li>
      ) : null}
    </ul>
  )
}
