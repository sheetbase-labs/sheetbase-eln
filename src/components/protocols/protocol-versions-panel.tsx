import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'

import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Section } from '#/components/ui/layout'

import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import { useModelApprovalIndex } from '#/components/models/model-approval-data'
import {
  isWorkspaceWriter,
  latestRequest,
  pendingRequest,
  roleLabel,
} from '#/components/models/model-approval'
import {
  PROTOCOL_REVISION_KIND,
  fetchProtocolVersions,
} from '#/lib/controlled-protocols'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'
import { useProtocolVersionActions } from './protocol-versions-actions'
import { VersionDialogs } from './protocol-versions-dialogs'
import { protocolVersionsKey } from './protocol-versions'
import type { ApprovalFor, RowDialog } from './protocol-versions'
import { versionsColumns } from './protocol-versions-columns'

export { protocolVersionsKey } from './protocol-versions'

/**
 * The protocol's one list of versions: each is a frozen copy of the text with
 * its own approval chain. Submitting freezes the current text, the chain
 * (technical review, then QA) approves it, and the last approval makes it the
 * effective version, which the next experiment starts from.
 */
/** The banner that names the version experiments start from. */
function EffectiveBanner({ effective }: { effective: ProtocolVersion }) {
  return (
    <Banner
      tone="info"
      icon="check"
      title={t(
        'library.protocols.protocolVersionsPanel.vIsTheEffectiveVersion',
        {
          version: effective.version,
        },
      )}
    >
      {effective.effective_at
        ? t('library.protocols.protocolVersionsPanel.inEffectSince', {
            effectiveAt: formatNotebookDateTime(effective.effective_at),
          })
        : t(
            'library.protocols.protocolVersionsPanel.newExperimentsStartFromIt2',
          )}
    </Banner>
  )
}

/** The table, or what stands in for it while the list loads, fails or is empty. */
function VersionsList({
  versions,
  rows,
  columns,
  canSubmit,
  onSubmit,
}: {
  versions: UseQueryResult<ProtocolVersion[]>
  rows: ProtocolVersion[]
  columns: RegistryColumn<ProtocolVersion>[]
  canSubmit: boolean
  onSubmit: () => void
}) {
  if (versions.isPending) {
    return (
      <p role="status">
        {t('library.protocols.protocolVersionsPanel.loadingVersions')}
      </p>
    )
  }

  if (versions.isError) {
    return (
      <p role="alert">
        {t(
          'library.protocols.protocolVersionsPanel.theProtocolVersionsCouldNot',
        )}
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="protocol"
        title={t('library.protocols.protocolVersionsPanel.noVersionYet')}
        description={t(
          'library.protocols.protocolVersionsPanel.writingTheProtocolDoesNot',
        )}
        action={
          canSubmit ? (
            <Button variant="primary" onClick={onSubmit}>
              {t(
                'library.protocols.protocolVersionsPanel.submitTheCurrentTextAs2',
              )}
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <TableBox>
      <RegistryGrid
        label={t('library.protocols.protocolVersionsPanel.protocolVersions')}
        rows={rows}
        columns={columns}
        getRowId={(v) => v.id}
        selectable={false}
      />
    </TableBox>
  )
}

export function ProtocolVersionsPanel({
  protocolRecordId,
  workspaceId,
  role,
  user,
}: {
  protocolRecordId: string
  workspaceId: string | null | undefined
  role: string | null | undefined
  user: { id: string; name: string } | null
}) {
  const client = notebookDataClient
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<RowDialog | null>(null)

  const versions = useQuery({
    queryKey: protocolVersionsKey(protocolRecordId),
    queryFn: () => fetchProtocolVersions(client, protocolRecordId),
  })

  const rows = versions.data ?? []

  const approvals = useModelApprovalIndex(
    rows.map((v) => v.id),
    client,
    PROTOCOL_REVISION_KIND,
  )

  const names = useUserNames(
    rows.map((v) => v.created_by_user_id),
    user ?? undefined,
  )

  const writer = isWorkspaceWriter(role)
  const effective = rows.find((v) => v.status === 'effective')

  const inFlight = rows.find(
    (v) => v.status === 'draft' || v.status === 'in_review',
  )

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-versions'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'models', 'approval-index'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-acknowledgements'],
    })
  }

  const { submit, approve, returnBack, withdraw, release, busy } =
    useProtocolVersionActions({
      client,
      protocolRecordId,
      workspaceId,
      onCloseDialog: () => {
        setDialog(null)
        refresh()
      },
    })

  function approvalFor(version: ProtocolVersion): ApprovalFor {
    const requests = approvals.data?.byVersion.get(version.id) ?? []

    const decisions = requests.flatMap(
      (r) => approvals.data?.byRequest.get(r.id) ?? [],
    )

    const pending = pendingRequest(requests)
    const latest = latestRequest(requests)

    return { requests, decisions, pending, latest }
  }

  const columns = versionsColumns({
    approvalFor,
    names,
    userId: user?.id,
    role,
    writer,
    busy,
    protocolRecordId,
    onDialog: setDialog,
    onRelease: (version) => release.mutate(version),
  })

  const dialogVersion =
    dialog && dialog.kind !== 'submit' ? dialog.version : null

  const dialogRequest = dialogVersion
    ? approvalFor(dialogVersion).pending
    : null

  return (
    <Section
      title={t('library.protocols.protocolVersionsPanel.versions')}
      count={rows.length}
      action={
        writer && !inFlight ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => setDialog({ kind: 'submit' })}
          >
            {t(
              'library.protocols.protocolVersionsPanel.submitTheCurrentTextAs',
            )}
          </Button>
        ) : undefined
      }
    >
      {effective ? <EffectiveBanner effective={effective} /> : null}
      <VersionsList
        versions={versions}
        rows={rows}
        columns={columns}
        canSubmit={writer}
        onSubmit={() => setDialog({ kind: 'submit' })}
      />

      <VersionDialogs
        dialog={dialog}
        busy={busy}
        pendingRequestId={dialogRequest?.id ?? null}
        onClose={() => setDialog(null)}
        onSubmit={(summary, resume) => submit.mutate({ summary, resume })}
        onApprove={(reason) => {
          if (!dialogVersion || !dialogRequest) return

          approve.mutate({
            version: dialogVersion,
            requestId: dialogRequest.id,
            reason,
          })
        }}
        onReturn={(reason) => {
          if (dialogRequest)
            returnBack.mutate({ requestId: dialogRequest.id, reason })
        }}
        onWithdraw={(reason) => {
          if (dialogRequest)
            withdraw.mutate({ requestId: dialogRequest.id, reason })
        }}
      />
      <p className="mt-2 text-caption text-fg-muted">
        {t('library.protocols.protocolVersionsPanel.approvers', {
          first: ['scientist', 'steward'].map(roleLabel).join(' or '),
          // oxlint-disable-next-line unicorn/no-thenable -- `then` is the catalogue's placeholder name for the second approver, not a promise hook: the object goes straight to t() and is never awaited.
          then: ['reviewer', 'admin', 'owner'].map(roleLabel).join(', '),
        })}
      </p>
    </Section>
  )
}
