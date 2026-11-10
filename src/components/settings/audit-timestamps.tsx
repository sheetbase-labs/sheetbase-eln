import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { Muted } from '#/components/ui/layout'
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
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { describeAdminError } from '#/lib/workspace-admin'
import {
  fetchSignatureTimestamps,
  fetchSigningKey,
  fetchTimestampSettings,
  requestSignatureTimestamp,
  setTimestampSettings,
  timestampKeys,
} from '#/lib/timestamps/client'
import type {
  TimestampSettings,
  TimestampStatus,
} from '#/lib/timestamps/client'
import { t } from '#/copy'

const dataClient = createDataClient()

type Choice = 'off' | 'dfn' | 'digicert' | 'custom'

const CHOICES: readonly Choice[] = ['off', 'dfn', 'digicert', 'custom']

const STATUS_TONE: Record<TimestampStatus, 'ok' | 'warn' | 'bad'> = {
  stamped: 'ok',
  pending: 'warn',
  failed: 'bad',
}

function statusLabel(status: TimestampStatus): string {
  return status === 'stamped'
    ? t('settings.timestamps.statusStamped')
    : status === 'pending'
      ? t('settings.timestamps.statusPending')
      : t('settings.timestamps.statusFailed')
}

function useTimestampSettings(workspaceId: string) {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: timestampKeys.settings(workspaceId),
    queryFn: () => fetchTimestampSettings(dataClient, workspaceId),
  })

  const current: TimestampSettings | undefined = settings.data

  const currentChoice: Choice = current?.enabled
    ? (current.authority ?? 'off')
    : 'off'

  const [choice, setChoice] = useState<Choice | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const picked = choice ?? currentChoice
  const address = url ?? current?.url ?? ''
  const customReady = picked !== 'custom' || /^https?:\/\/\S+$/.test(address)

  const dirty =
    choice !== null ||
    (picked === 'custom' && url !== null && url !== current?.url)

  const save = useMutation({
    mutationFn: () =>
      setTimestampSettings(dataClient, {
        workspaceId,
        enabled: picked !== 'off',
        authority: picked === 'off' ? null : picked,
        url: picked === 'custom' ? address : null,
      }),
    onSuccess: async () => {
      setChoice(null)
      setUrl(null)
      await queryClient.invalidateQueries({
        queryKey: timestampKeys.settings(workspaceId),
      })
      toast(t('settings.timestamps.saved'))
    },
  })

  return {
    settings,
    picked,
    address,
    customReady,
    dirty,
    save,
    setChoice,
    setUrl,
  }
}

/** Which time-stamping service signatures go to, and how each signature's stamp is doing. */
export function TimestampsDialog({
  workspaceId,
  canManage,
  onClose,
}: {
  workspaceId: string
  canManage: boolean
  onClose: () => void
}) {
  const {
    settings,
    picked,
    address,
    customReady,
    dirty,
    save,
    setChoice,
    setUrl,
  } = useTimestampSettings(workspaceId)

  const queryClient = useQueryClient()

  const stamps = useQuery({
    queryKey: timestampKeys.list(workspaceId),
    queryFn: () => fetchSignatureTimestamps(dataClient),
  })

  const key = useQuery({
    queryKey: timestampKeys.key(workspaceId),
    queryFn: () => fetchSigningKey(dataClient, workspaceId),
  })

  const again = useMutation({
    mutationFn: (signatureId: string) =>
      requestSignatureTimestamp(dataClient, signatureId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: timestampKeys.list(workspaceId),
      })
      toast(t('settings.timestamps.tryAgainQueued'))
    },
    onError: (error) => toast(describeAdminError(error)),
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogHeader
          title={t('settings.timestamps.title')}
          description={t('settings.timestamps.description')}
        />
        <DialogBody>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-label">
              {t('settings.timestamps.authority')}
              <Select
                value={picked}
                disabled={!canManage || settings.isLoading}
                onChange={(e) => {
                  const value = CHOICES.find(
                    (candidate) => candidate === e.target.value,
                  )

                  if (value) setChoice(value)
                }}
              >
                <option value="off">{t('settings.timestamps.off')}</option>
                <option value="dfn">{t('settings.timestamps.dfn')}</option>
                <option value="digicert">
                  {t('settings.timestamps.digicert')}
                </option>
                <option value="custom">
                  {t('settings.timestamps.custom')}
                </option>
              </Select>
            </label>
            {picked === 'custom' ? (
              <label
                className="flex min-w-[240px] flex-1 flex-col gap-1 text-label"
                title={t('settings.timestamps.addressHint')}
              >
                {t('settings.timestamps.address')}
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={address}
                  disabled={!canManage}
                  aria-invalid={!customReady ? true : undefined}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
            ) : null}
            {canManage ? (
              <Button
                variant="primary"
                disabled={!dirty || !customReady || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? t('common.states.saving')
                  : t('settings.timestamps.save')}
              </Button>
            ) : null}
          </div>
          <Muted>{t('settings.timestamps.privacy')}</Muted>
          {!canManage ? (
            <Muted>{t('settings.timestamps.viewOnly')}</Muted>
          ) : null}
          {save.isError ? (
            <Notice tone="bad">{describeAdminError(save.error)}</Notice>
          ) : null}

          <TimestampHistory
            rows={stamps.data ?? []}
            loaded={stamps.isSuccess}
            canManage={canManage}
            retrying={again.isPending}
            onRetry={(id) => again.mutate(id)}
          />

          <div className="flex flex-col gap-1 border-t border-border-subtle pt-3">
            <span className="text-label font-medium">
              {t('settings.timestamps.exportKey')}
            </span>
            <Muted>{t('settings.timestamps.exportKeyHint')}</Muted>
            <code className="break-all text-caption">
              {key.data?.fingerprint ?? t('settings.timestamps.exportKeyNone')}
            </code>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TimestampHistory({
  rows,
  loaded,
  canManage,
  retrying,
  onRetry,
}: {
  rows: Awaited<ReturnType<typeof fetchSignatureTimestamps>>
  loaded: boolean
  canManage: boolean
  retrying: boolean
  onRetry: (id: string) => void
}) {
  const count = (status: TimestampStatus) =>
    rows.filter((row) => row.status === status).length

  return (
    <>
      <div className="flex flex-wrap gap-4 text-label">
        <span>
          {t('settings.timestamps.stamped', { count: count('stamped') })}
        </span>
        <span>
          {t('settings.timestamps.waiting', { count: count('pending') })}
        </span>
        <span>
          {t('settings.timestamps.failed', { count: count('failed') })}
        </span>
      </div>
      {rows.length === 0 && loaded ? (
        <Muted>{t('settings.timestamps.none')}</Muted>
      ) : (
        <Table caption={t('settings.timestamps.title')}>
          <TableHeader>
            <TableRow>
              {[
                t('settings.timestamps.signature'),
                t('settings.timestamps.status'),
                t('settings.timestamps.service'),
                t('settings.timestamps.time'),
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {formatDate(row.created_at, { time: true })}
                </TableCell>
                <TableCell>
                  <span title={row.last_error ?? undefined}>
                    <Status tone={STATUS_TONE[row.status]}>
                      {statusLabel(row.status)}
                    </Status>
                  </span>
                </TableCell>
                <TableCell>{row.authority_name ?? '—'}</TableCell>
                <TableCell>
                  {row.gen_time
                    ? formatDate(row.gen_time, { time: true })
                    : '—'}
                </TableCell>
                <TableCell>
                  {canManage && row.status === 'failed' ? (
                    <Button
                      size="sm"
                      disabled={retrying}
                      onClick={() => onRetry(row.signature_id)}
                    >
                      {t('settings.timestamps.tryAgain')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
