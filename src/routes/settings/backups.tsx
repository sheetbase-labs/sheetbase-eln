import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import {
  CheckRow,
  SettingsBody,
  SettingsHeader,
  SettingsSaveBar,
} from '#/components/v3/settings/settings-page'
import {
  fetchBackupsFn,
  runBackupNowFn,
  saveBackupSettingsFn,
} from '#/lib/workspace-backups'
import type { BackupsOverview } from '#/lib/workspace-backups'
import type { BackupRecord } from '#/lib/workspace-export/backup.server'
import { KEEP_COUNT_RANGE } from '#/lib/workspace-export/schedule'
import type { BackupFrequency } from '#/lib/workspace-export/schedule'
import { canManageSettings, canOpenSettings } from '#/lib/settings-access'
import { formatDate } from '#/lib/format-date'
import { formatFileSize } from '#/lib/format-numbers'
import { t } from '#/copy'

/**
 * Settings → Backups and export: download everything the workspace holds, and
 * set how often the server makes a copy and how many it keeps. Which roles may
 * open and change it is the workspace's choice under Members and roles.
 */
export const Route = createFileRoute('/settings/backups')({
  component: Backups,
})

const backupsKey = (workspaceId: string) => ['admin', workspaceId, 'backups']

function Backups() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const open = canOpenSettings(context.workspace, 'backups')
  const canManage = canManageSettings(context.workspace, 'backups')
  const queryClient = useQueryClient()

  const overview = useQuery({
    queryKey: backupsKey(workspaceId),
    queryFn: () => fetchBackupsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && open,
    // A run in progress finishes on its own; look again while one is going.
    refetchInterval: (query) =>
      query.state.data?.backups.some((b) => b.status === 'running')
        ? 4_000
        : false,
  })

  if (!open) {
    return (
      <>
        <SettingsHeader title={t('settings.backups.title')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('settings.backups.onlyAdmins')}
            description={
              <>
                {t('settings.backups.onlyAdminsDescription')}
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
          />
        </div>
      </>
    )
  }

  if (overview.isPending) {
    return (
      <>
        <SettingsHeader title={t('settings.backups.title')} />
        <div
          className="flex flex-col gap-3 px-6 py-5"
          aria-busy="true"
          aria-label={t('settings.backups.loadingAria')}
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-28" />
        </div>
      </>
    )
  }

  if (overview.isError) {
    return (
      <>
        <SettingsHeader title={t('settings.backups.title')} />
        <SettingsBody>
          <EmptyState
            icon="warn"
            title={t('settings.backups.couldNotLoad')}
            description={t('settings.backups.checkConnection')}
            action={
              <Button onClick={() => void overview.refetch()}>
                {t('common.actions.tryAgain')}
              </Button>
            }
          />
        </SettingsBody>
      </>
    )
  }

  return (
    <BackupsBody
      workspaceId={workspaceId}
      canManage={canManage}
      overview={overview.data}
      onChanged={() =>
        void queryClient.invalidateQueries({
          queryKey: backupsKey(workspaceId),
        })
      }
    />
  )
}

function BackupsBody({
  workspaceId,
  canManage,
  overview,
  onChanged,
}: {
  workspaceId: string
  canManage: boolean
  overview: BackupsOverview
  onChanged: () => void
}) {
  const saved = overview.settings
  const [enabled, setEnabled] = useState(saved.enabled)
  const [frequency, setFrequency] = useState<BackupFrequency>(saved.frequency)
  const [keep, setKeep] = useState(String(saved.keepCount))

  // A save elsewhere (or a refetch) becomes the new starting point.
  useEffect(() => {
    setEnabled(saved.enabled)
    setFrequency(saved.frequency)
    setKeep(String(saved.keepCount))
  }, [saved.enabled, saved.frequency, saved.keepCount])

  const keepCount = Number(keep)
  const keepValid =
    Number.isInteger(keepCount) &&
    keepCount >= KEEP_COUNT_RANGE.min &&
    keepCount <= KEEP_COUNT_RANGE.max
  const dirty =
    enabled !== saved.enabled ||
    frequency !== saved.frequency ||
    keep !== String(saved.keepCount)

  const save = useMutation({
    mutationFn: () =>
      saveBackupSettingsFn({
        data: { workspaceId, enabled, frequency, keepCount },
      }),
    onSuccess: () => {
      toast.success(t('settings.backups.savedToast'))
      onChanged()
    },
    onError: () => toast.error(t('settings.backups.couldNotSaveToast')),
  })

  const runNow = useMutation({
    mutationFn: () => runBackupNowFn({ data: { workspaceId } }),
    onSuccess: (result) => {
      if (result.ok) toast.success(t('settings.backups.backedUpToast'))
      else if (result.reason === 'already_running')
        toast.error(t('settings.backups.alreadyRunningToast'))
      else
        toast.error(t('settings.backups.failedToast'), {
          description: result.message,
        })
      onChanged()
    },
    onError: () => toast.error(t('settings.backups.failedToast')),
  })

  const running = overview.backups.some((b) => b.status === 'running')
  const { destination } = overview
  const where = t(
    destination.name === 'database'
      ? 'settings.backups.whereDatabase'
      : destination.name === 'local'
        ? 'settings.backups.whereLocal'
        : 'settings.backups.whereS3',
  )

  return (
    <>
      <SettingsHeader title={t('settings.backups.title')}>
        {t('settings.backups.intro')}
      </SettingsHeader>
      <SettingsBody>
        <Section title={t('settings.backups.exportTitle')}>
          <Muted>{t('settings.backups.exportBody')}</Muted>
          <div>
            <Button
              variant="primary"
              icon="download"
              disabled={!canManage}
              nativeButton={false}
              render={<a href="/api/export/workspace" download />}
            >
              {t('settings.backups.exportButton')}
            </Button>
          </div>
        </Section>

        <Section title={t('settings.backups.scheduleTitle')}>
          <div className="flex max-w-xl flex-col gap-3">
            <CheckRow
              title={t('settings.backups.automatic')}
              body={t('settings.backups.automaticBody')}
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canManage}
            />
            <div className="flex flex-wrap gap-4">
              <Field label={t('settings.backups.frequency')}>
                <Select
                  value={frequency}
                  disabled={!canManage || !enabled}
                  onChange={(e) =>
                    setFrequency(e.target.value as BackupFrequency)
                  }
                  className="w-44"
                >
                  <option value="daily">{t('settings.backups.daily')}</option>
                  <option value="weekly">{t('settings.backups.weekly')}</option>
                </Select>
              </Field>
              <Field
                label={t('settings.backups.keep')}
                hint={t('settings.backups.keepHint')}
                error={keepValid ? undefined : t('settings.backups.keepHint')}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={KEEP_COUNT_RANGE.min}
                  max={KEEP_COUNT_RANGE.max}
                  value={keep}
                  disabled={!canManage || !enabled}
                  onChange={(e) => setKeep(e.target.value)}
                  className="w-24"
                />
              </Field>
            </div>
            <Muted>{t('settings.backups.storedIn', { where })}</Muted>
            {!destination.separate ? (
              <Notice tone="warn">
                {t(
                  destination.name === 'local'
                    ? 'settings.backups.localNotice'
                    : 'settings.backups.sameDatabaseNotice',
                )}
              </Notice>
            ) : null}
          </div>
        </Section>

        <Section
          title={t('settings.backups.recentTitle')}
          action={
            canManage ? (
              <Button
                disabled={running || runNow.isPending}
                onClick={() => runNow.mutate()}
              >
                {running || runNow.isPending
                  ? t('settings.backups.backingUp')
                  : t('settings.backups.backUpNow')}
              </Button>
            ) : null
          }
        >
          {overview.backups.length === 0 ? (
            <EmptyState
              icon="archive"
              title={t('settings.backups.emptyTitle')}
              description={t('settings.backups.emptyDescription')}
            />
          ) : (
            <BackupsTable backups={overview.backups} canManage={canManage} />
          )}
        </Section>
      </SettingsBody>
      {canManage ? (
        <SettingsSaveBar
          dirty={dirty}
          pending={save.isPending}
          disabled={!keepValid}
          onSave={() => save.mutate()}
        />
      ) : null}
    </>
  )
}

function BackupsTable({
  backups,
  canManage,
}: {
  backups: BackupRecord[]
  canManage: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('settings.backups.when')}</TableHead>
          <TableHead>{t('settings.backups.kind')}</TableHead>
          <TableHead>{t('settings.backups.result')}</TableHead>
          <TableHead align="right">{t('settings.backups.size')}</TableHead>
          <TableHead>{t('settings.backups.contents')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('settings.backups.download')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {backups.map((b) => {
          const when = formatDate(b.startedAt, { time: true })
          return (
            <TableRow key={b.id}>
              <TableCell className="num">{when}</TableCell>
              <TableCell>
                {t(
                  b.trigger === 'scheduled'
                    ? 'settings.backups.scheduled'
                    : 'settings.backups.manual',
                )}
              </TableCell>
              <TableCell>
                <ResultStatus backup={b} />
              </TableCell>
              <TableCell align="right" className="num">
                {b.byteSize === null ? '—' : formatFileSize(b.byteSize)}
              </TableCell>
              <TableCell className="num text-fg-muted">
                {b.status === 'succeeded'
                  ? t('settings.backups.contentsLine', {
                      rows: (b.rowCount ?? 0).toLocaleString('en-GB'),
                      files: b.fileCount ?? 0,
                    })
                  : '—'}
              </TableCell>
              <TableCell align="right">
                {b.status === 'succeeded' && canManage ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="download"
                    aria-label={t('settings.backups.downloadAria', { when })}
                    nativeButton={false}
                    render={
                      <a
                        href={`/api/export/workspace-backup/${b.id}`}
                        download
                      />
                    }
                  >
                    {t('settings.backups.download')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function ResultStatus({ backup }: { backup: BackupRecord }) {
  if (backup.status === 'running') {
    return <Status tone="progress">{t('settings.backups.running')}</Status>
  }
  if (backup.status === 'failed') {
    return (
      <span title={backup.error ?? undefined}>
        <Status tone="bad">{t('settings.backups.failed')}</Status>
      </span>
    )
  }
  const missing = backup.missingFileCount ?? 0
  return missing > 0 ? (
    <span title={t('settings.backups.missingFilesHelp')}>
      <Status tone="warn">
        {t('settings.backups.succeededMissing', { count: missing })}
      </Status>
    </span>
  ) : (
    <Status tone="ok">{t('settings.backups.succeeded')}</Status>
  )
}
