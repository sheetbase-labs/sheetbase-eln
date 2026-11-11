/**
 * The lab actions agents asked for. A request that waits for a person (the
 * action is set to Ask) is approved here or from the Inbox; approving runs the
 * action as the person pressing the button, so their own access applies.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import {
  agentActionKeys,
  approveAndRunAgentAction,
  describeAgentAction,
  fetchAgentActionRequests,
  rejectAgentAction,
} from '#/lib/agent-action-policy'
import type {
  AgentActionRequestRow,
  AgentActionRequestStatus,
} from '#/lib/agent-action-policy'
import { formatDate } from '#/lib/format-date'
import { requestShellRefresh } from '#/lib/shell-refresh'
import { notebookDataClient } from '#/lib/notebook-data'

const client = notebookDataClient

const TONE: Record<AgentActionRequestStatus, Tone> = {
  pending: 'warn',
  approved: 'progress',
  rejected: 'draft',
  succeeded: 'ok',
  failed: 'bad',
  refused: 'draft',
}

const LABEL: Record<AgentActionRequestStatus, string> = {
  pending: t('agentRequests.statusPending'),
  approved: t('agentRequests.statusApproved'),
  rejected: t('agentRequests.statusRejected'),
  succeeded: t('agentRequests.statusSucceeded'),
  failed: t('agentRequests.statusFailed'),
  refused: t('agentRequests.statusRefused'),
}

function RequestsGrid({
  rows,
  nameOf,
  busy,
  runningId,
  onApprove,
  onReject,
}: {
  rows: AgentActionRequestRow[]
  nameOf: (userId: string | null) => string
  busy: boolean
  runningId: string | null
  onApprove: (row: AgentActionRequestRow) => void
  onReject: (row: AgentActionRequestRow) => void
}) {
  const columns = useMemo<RegistryColumn<AgentActionRequestRow>[]>(
    () => [
      {
        id: 'what',
        header: t('agentRequests.what'),
        accessorFn: (row) =>
          row.summary || describeAgentAction(row.action_key, row.arguments),
        enableHiding: false,
        cell: ({ row }) => {
          const text = describeAgentAction(
            row.original.action_key,
            row.original.arguments,
          )

          return (
            <Tooltip content={text}>
              <span className="block max-w-[40rem] truncate">
                <span className="font-medium text-fg">
                  {row.original.summary || text}
                </span>
              </span>
            </Tooltip>
          )
        },
      },
      {
        id: 'by',
        header: t('agentRequests.by'),
        accessorFn: (row) =>
          row.requested_by_user_id
            ? nameOf(row.requested_by_user_id)
            : t('agentRequests.withCredential'),
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.requested_by_user_id
              ? nameOf(row.original.requested_by_user_id)
              : t('agentRequests.withCredential')}
          </span>
        ),
      },
      {
        id: 'when',
        header: t('agentRequests.when'),
        accessorFn: (row) => row.created_at,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.created_at, { time: true })}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('agentRequests.status'),
        accessorFn: (row) => LABEL[row.status],
        cell: ({ row }) => (
          <Tooltip
            content={row.original.error ?? row.original.decision_reason ?? ''}
          >
            <span>
              <Status tone={TONE[row.original.status]}>
                {LABEL[row.original.status]}
              </Status>
            </span>
          </Tooltip>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">{t('agentRequests.approve')}</span>
        ),
        enableSorting: false,
        enableHiding: false,
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) =>
          row.original.status === 'pending' ? (
            <div className="flex justify-end gap-1.5">
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => onApprove(row.original)}
              >
                {runningId === row.original.id
                  ? t('agentRequests.running')
                  : t('agentRequests.approve')}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onReject(row.original)}
              >
                {t('agentRequests.reject')}
              </Button>
            </div>
          ) : null,
      },
    ],
    [nameOf, busy, runningId, onApprove, onReject],
  )

  return (
    <RegistryGrid
      label={t('agentRequests.tableLabel')}
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      selectable={false}
    />
  )
}

export function ActionRequestsBoard({
  nameOf,
}: {
  nameOf: (userId: string | null) => string
}) {
  const queryClient = useQueryClient()

  const requests = useQuery({
    queryKey: agentActionKeys.requests,
    queryFn: () => fetchAgentActionRequests(client),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: agentActionKeys.requests })
    void queryClient.invalidateQueries({ queryKey: ['work-items'] })
    requestShellRefresh()
  }

  const approve = useMutation({
    mutationFn: (request: AgentActionRequestRow) =>
      approveAndRunAgentAction(client, request),
    onSuccess: (row) => {
      refresh()

      if (row.status === 'failed') {
        toast.error(row.error ?? t('agentRequests.couldNotRun'))
      } else toast(t('agentRequests.doneToast'))
    },
    onError: (error) => {
      refresh()
      toast.error(
        error instanceof Error ? error.message : t('agentRequests.couldNotRun'),
      )
    },
  })

  const reject = useMutation({
    mutationFn: (request: AgentActionRequestRow) =>
      rejectAgentAction(client, request.id),
    onSuccess: () => {
      refresh()
      toast(t('agentRequests.rejectedToast'))
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : t('agentRequests.couldNotRun'),
      ),
  })

  const busy = approve.isPending || reject.isPending
  const rows = requests.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-body font-semibold">
          {t('agentRequests.title')}
        </h2>
        <Muted>{t('agentRequests.intro')}</Muted>
      </div>
      {requests.error ? (
        <Notice tone="bad">{t('agentRequests.loadError')}</Notice>
      ) : requests.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <Muted>{t('agentRequests.empty')}</Muted>
      ) : (
        <TableBox>
          <RequestsGrid
            rows={rows}
            nameOf={nameOf}
            busy={busy}
            runningId={approve.isPending ? approve.variables.id : null}
            onApprove={(row) => approve.mutate(row)}
            onReject={(row) => reject.mutate(row)}
          />
        </TableBox>
      )}
    </div>
  )
}
