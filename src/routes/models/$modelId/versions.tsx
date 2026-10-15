import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { publishDatasetSchemaVersion } from '#/lib/dataset-schema-definition-rpc'
import type {
  CanonicalDatasetSchemaField,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'
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
} from '#/components/v3/models/models-data'
import { buildVersionImpacts } from '#/components/v3/models/model-version-impact'
import {
  approvalStatus,
  canPublishDraft,
} from '#/components/v3/models/model-approval'
import { useModelApprovalIndex } from '#/components/v3/models/model-approval-data'
import { ModelApprovalPanel } from '#/components/v3/models/model-approval-panel'
import { RecordModelVersions } from '#/components/v3/models/record-model-versions'
import { isUuid } from '#/lib/field-value-validation'
import type {
  FieldChange,
  RecordOutcome,
  VersionFieldDiff,
} from '#/components/v3/models/model-version-impact'

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
    label: 'Not published',
    detail: 'Draft, not yet in use',
  },
  'new-records-only': {
    tone: 'progress',
    label: 'New records only',
    detail: 'New datasets use this version',
  },
  unchanged: {
    tone: 'stored',
    label: 'Unchanged',
    detail: 'Records stay pinned, not migrated',
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

function DatasetModelVersions() {
  const { modelId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const versions = useModelVersions(modelId)
  const rows = versions.data ?? []
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
      toast('Version published', {
        description: 'New and existing datasets can now use it.',
      })
    },
    onError: (error: unknown) => {
      toast('Could not publish', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    },
  })

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title="No versions yet"
          body="Start a version from the header, add fields, then publish it."
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      {policy.isError ? (
        <Notice
          tone="bad"
          title="Publishing policy unavailable."
          className="mb-4"
          action={
            <Button size="sm" onClick={() => void policy.refetch()}>
              Retry
            </Button>
          }
        >
          The workspace’s publication policy could not be read, so Publish is
          withheld from every draft until it loads. The policy is what decides
          whether a draft needs approval before it may publish.
        </Notice>
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
        <Table aria-label="Model versions">
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Approval</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Changes since previous</TableHead>
              <TableHead align="right">Records</TableHead>
              <TableHead>Record impact</TableHead>
              <TableHead align="right" aria-label="Actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {impacts.map((row) => {
              const v: CanonicalDatasetSchemaVersion = row.version
              const outcome = OUTCOME[row.outcome]
              return (
                <TableRow key={v.id}>
                  <TableCell className="font-medium align-top">
                    v{v.version}
                  </TableCell>
                  <TableCell className="align-top">
                    <Status tone={modelStatus(v.lifecycle).tone}>
                      {modelStatus(v.lifecycle).label}
                    </Status>
                  </TableCell>
                  <TableCell className="align-top">
                    {approval.isLoading ? (
                      <span className="text-fg-muted">…</span>
                    ) : (
                      <Status
                        tone={
                          approvalStatus(requestsFor(v.id), v.revision).tone
                        }
                      >
                        {approvalStatus(requestsFor(v.id), v.revision).label}
                      </Status>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-fg-muted">
                    {v.published_at ? v.published_at.slice(0, 10) : '—'}
                  </TableCell>
                  <TableCell className="min-w-[260px] max-w-[420px] whitespace-normal align-top">
                    <VersionChanges
                      diff={row.diff}
                      loading={loading}
                      isFirstVersion={
                        impacts[impacts.length - 1]?.version.id === v.id
                      }
                    />
                  </TableCell>
                  <TableCell align="right" className="align-top tabular-nums">
                    {loading ? '…' : row.recordCount}
                  </TableCell>
                  <TableCell className="whitespace-normal align-top">
                    <div className="flex flex-col gap-0.5">
                      <Status tone={outcome.tone}>{outcome.label}</Status>
                      <span className="text-label text-fg-muted">
                        {row.outcome === 'new-records-only'
                          ? `${row.olderRecordCount} older ${
                              row.olderRecordCount === 1 ? 'record' : 'records'
                            } unchanged`
                          : outcome.detail}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell align="right" className="align-top">
                    {v.lifecycle === 'draft' &&
                    hasCapability(role, 'schema.publish') &&
                    policy.isSuccess &&
                    !approval.isLoading &&
                    !approval.isError &&
                    canPublishDraft(
                      requestsFor(v.id),
                      policy.data?.publicationApprovalRequired ?? false,
                      v.revision,
                    ) ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(v.id)}
                      >
                        Publish
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableBox>
      <Muted className="mt-3">
        Publishing forks a new version; existing datasets stay on the version
        they were created on, so no version migrated records. The registry
        stores no reason-for-change, so changes show the field-contract
        difference only.
      </Muted>
    </div>
  )
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
    return <span className="text-fg-muted">Initial version</span>
  if (diff.total === 0)
    return <span className="text-fg-muted">No field changes</span>

  const changes = [...diff.added, ...diff.changed, ...diff.removed]
  const shown = changes.slice(0, MAX_CHANGES_SHOWN)
  const hidden = changes.length - shown.length
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {shown.map((change) => (
        <li key={`${change.kind}-${change.key}`} className="text-body">
          <Badge variant={CHANGE_BADGE[change.kind]}>
            {change.kind === 'added'
              ? 'Added'
              : change.kind === 'removed'
                ? 'Removed'
                : 'Changed'}
          </Badge>{' '}
          <span className="font-medium">{change.label}</span>{' '}
          <span className="mono text-label text-fg-muted">{change.key}</span>
          {change.detail ? (
            <span className="text-label text-fg-muted"> · {change.detail}</span>
          ) : null}
        </li>
      ))}
      {hidden > 0 ? (
        <li className="text-label text-fg-muted">+{hidden} more</li>
      ) : null}
    </ul>
  )
}
