import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { auditEventsRpcArgs } from '#/lib/audit-history'
import type { AuditEventsPageWire } from '#/lib/audit-history'
import {
  adminQueryKeys,
  describeAdminError,
  fetchWorkspaceSettings,
  updateWorkspaceSettings,
} from '#/lib/workspace-admin'

const dataClient = createDataClient()

const DAYS_PER_YEAR = 365

/** Whole years a retention of `days` covers, never below one. */
export function retentionYears(days: number): number {
  return Math.max(1, Math.round(days / DAYS_PER_YEAR))
}

export function formatRetention(days: number): string {
  const years = retentionYears(days)
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

/** The audit log's integrity line: when the nightly check last passed, that
 * entries can't be changed, and how long they are kept. */
export function AuditIntegrityLine({ workspaceId }: { workspaceId: string }) {
  const settings = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  // The nightly check writes a System entry carrying its result.
  const check = useQuery({
    queryKey: ['audit-integrity', workspaceId],
    queryFn: async () =>
      (await dataClient.rpc(
        'audit_events',
        auditEventsRpcArgs({ entityType: 'system', limit: 1 }),
      )),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
  const last = check.data?.events.at(0)
  const payload = last?.payload as { ok?: boolean } | undefined
  const parts = [
    last
      ? payload?.ok === false
        ? `Integrity check failed ${formatDate(last.createdAt, { time: true })}`
        : `Integrity verified ${formatDate(last.createdAt, { time: true })}`
      : null,
    'Entries can’t be edited or deleted',
    settings.data
      ? `Kept ${formatRetention(settings.data.auditRetentionDays)}`
      : null,
  ].filter(Boolean)
  return <>{parts.join(' · ')}</>
}

/** The retention policy: how long audit entries are kept. */
export function RetentionDialog({
  workspaceId,
  canManage,
  onClose,
}: {
  workspaceId: string
  canManage: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId),
  })
  const [years, setYears] = useState<string | null>(null)
  const current = settings.data
    ? String(retentionYears(settings.data.auditRetentionDays))
    : ''
  const value = years ?? current
  const parsed = Number(value)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 100
  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceSettings(dataClient, {
        workspaceId,
        auditRetentionDays: parsed * DAYS_PER_YEAR,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.settings(workspaceId),
      })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title="Retention policy"
          description="How long audit entries are kept before they can be archived."
        />
        <DialogBody>
          <label className="flex flex-col gap-1 text-label">
            Keep entries for (years)
            <Input
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              className="w-[120px]"
              value={value}
              disabled={!canManage || settings.isLoading}
              aria-invalid={!valid && value !== '' ? true : undefined}
              onChange={(e) => setYears(e.target.value)}
            />
          </label>
          <p className="m-0 text-label text-fg-muted">
            Signed records are never removed while they are in use.
          </p>
          {save.isError ? (
            <Notice tone="bad">{describeAdminError(save.error)}</Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          {canManage ? (
            <Button
              variant="primary"
              disabled={!valid || save.isPending || years === null}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save policy'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
