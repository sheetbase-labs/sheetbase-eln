import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { CodeBlock } from '#/components/ui/code-block'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Secret } from '#/components/ui/secret'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { CheckRow } from '#/components/settings/settings-page'
import { toast } from '#/components/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { describeAdminError } from '#/lib/workspace-admin'
import { getSqlConnectionFn, sqlConnectionQueryKey } from '#/lib/sql-access'
import {
  createLakeLogin,
  fetchLakeLogins,
  fetchLakeSettings,
  fetchLakeTables,
  lakeSnippets,
  openDataKeys,
  requestLakeRefresh,
  revokeLakeLogin,
  setLakeSettings,
} from '#/lib/open-data/client'
import type { LakeLogin, LakeLoginSecret, LakeTable } from '#/lib/open-data/client'
import { t } from '#/copy'

const dataClient = createDataClient()

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const TABLE_TONE = { ready: 'ok', pending: 'warn', failed: 'bad', retired: 'draft' } as const
const tableStatus = (s: LakeTable['status']) =>
  s === 'ready'
    ? t('openData.tables.statusReady')
    : s === 'failed'
      ? t('openData.tables.statusFailed')
      : t('openData.tables.statusPending')

/**
 * Settings → Open data: the workspace's data as open table files. Anyone with
 * settings access sees the status; people with data access can switch it on,
 * and get logins and connection snippets.
 */
export function OpenTablesSection({
  workspaceId,
  canManage,
  dataAccess,
}: {
  workspaceId: string
  canManage: boolean
  dataAccess: boolean
}) {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: openDataKeys.lake(workspaceId),
    queryFn: () => fetchLakeSettings(dataClient, workspaceId),
    refetchInterval: (q) => (q.state.data?.enabled ? 15_000 : false),
  })
  const tables = useQuery({
    queryKey: openDataKeys.lakeTables(workspaceId),
    queryFn: () => fetchLakeTables(dataClient),
    enabled: settings.data?.enabled === true,
    refetchInterval: 15_000,
  })
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: openDataKeys.lake(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: openDataKeys.lakeTables(workspaceId) })
  }
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setLakeSettings(dataClient, workspaceId, enabled),
    onSuccess: () => {
      toast(t('openData.tables.saved'))
      refreshAll()
    },
    onError: (e) => toast(`${t('openData.tables.failed')}: ${describeAdminError(e)}`),
  })
  const refresh = useMutation({
    mutationFn: () => requestLakeRefresh(dataClient, workspaceId),
    onSuccess: () => {
      toast(t('openData.tables.refreshQueued'))
      refreshAll()
    },
    onError: (e) => toast(`${t('openData.tables.failed')}: ${describeAdminError(e)}`),
  })

  const enabled = settings.data?.enabled === true
  const rows = tables.data ?? []
  const editable = canManage && dataAccess

  return (
    <Section
      title={t('openData.tables.title')}
      count={enabled ? rows.length : undefined}
      action={
        enabled && editable ? (
          <Button size="sm" icon="refresh" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {t('openData.tables.refresh')}
          </Button>
        ) : null
      }
    >
      <Muted>{t('openData.tables.explain')}</Muted>
      <CheckRow
        title={t('openData.tables.enable')}
        body={t('openData.tables.enableHint')}
        checked={enabled}
        disabled={!editable || settings.isPending || toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(v)}
      />
      {!editable ? <Muted>{t('openData.tables.needsDataAccess')}</Muted> : null}
      {enabled && settings.data?.lastError ? (
        <Notice tone="bad">{settings.data.lastError}</Notice>
      ) : null}
      {enabled ? (
        <>
          <Muted>
            {t('openData.tables.lastRun')}:{' '}
            {settings.data?.lastRunAt
              ? formatDate(settings.data.lastRunAt)
              : t('openData.tables.never')}
          </Muted>
          <TableBox>
            <Table caption={t('openData.tables.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('openData.tables.columns.table')}</TableHead>
                  <TableHead>{t('openData.tables.columns.from')}</TableHead>
                  <TableHead className="text-right">{t('openData.tables.columns.rows')}</TableHead>
                  <TableHead className="text-right">{t('openData.tables.columns.size')}</TableHead>
                  <TableHead>{t('openData.tables.columns.updated')}</TableHead>
                  <TableHead>{t('openData.tables.columns.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody loading={tables.isPending} empty={t('openData.tables.empty')} colSpan={6}>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {dataAccess ? <code>{row.table_name}</code> : row.source_label}
                    </TableCell>
                    <TableCell title={row.source_label}>
                      {row.source_kind === 'dataset'
                        ? t('openData.tables.kindDataset')
                        : t('openData.tables.kindModel')}
                                      {' · '}
                      {row.source_label}
                    </TableCell>
                    <TableCell className="text-right">{row.row_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatBytes(row.byte_size)}</TableCell>
                    <TableCell>{row.last_snapshot_at ? formatDate(row.last_snapshot_at) : '—'}</TableCell>
                    <TableCell title={row.last_error ?? undefined}>
                      <Status tone={TABLE_TONE[row.status]}>{tableStatus(row.status)}</Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          {dataAccess ? (
            <LakeLogins
              workspaceId={workspaceId}
              canIssue={settings.data?.canIssueLogins === true && rows.some((r) => r.status === 'ready')}
              hasTables={rows.some((r) => r.status === 'ready')}
              firstTable={rows.find((r) => r.status === 'ready')?.table_name ?? null}
            />
          ) : null}
        </>
      ) : (
        <Muted>{t('openData.tables.off')}</Muted>
      )}
    </Section>
  )
}

const EXPIRY = [
  { value: '30', label: t('openData.logins.n30') },
  { value: '90', label: t('openData.logins.n90') },
  { value: '365', label: t('openData.logins.year') },
  { value: '', label: t('openData.logins.never') },
] as const

const LOGIN_LABEL: Record<LakeLogin['status'], string> = {
  active: t('openData.logins.active'),
  expired: t('openData.logins.expired'),
  suspended: t('openData.logins.suspended'),
  revoked: t('openData.logins.revoked'),
}

function LakeLogins({
  workspaceId,
  canIssue,
  hasTables,
  firstTable,
}: {
  workspaceId: string
  canIssue: boolean
  hasTables: boolean
  firstTable: string | null
}) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('90')
  const [revealed, setRevealed] = useState<(LakeLoginSecret & { name: string }) | null>(null)
  const [revoking, setRevoking] = useState<LakeLogin | null>(null)
  const [engine, setEngine] = useState<'duckdb' | 'polars' | 'spark'>('duckdb')

  const connection = useQuery({
    queryKey: sqlConnectionQueryKey,
    queryFn: () => getSqlConnectionFn(),
  })
  const logins = useQuery({
    queryKey: openDataKeys.lakeLogins(workspaceId),
    queryFn: () => fetchLakeLogins(dataClient, workspaceId),
    enabled: hasTables,
  })
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: openDataKeys.lakeLogins(workspaceId) })

  const create = useMutation({
    mutationFn: () =>
      createLakeLogin(dataClient, workspaceId, {
        name: name.trim(),
        expiresAt: expiry ? new Date(Date.now() + Number(expiry) * 86_400_000).toISOString() : null,
      }),
    onSuccess: (secret) => {
      setRevealed({ ...secret, name: name.trim() })
      setCreateOpen(false)
      setName('')
      void invalidate()
    },
  })
  const revoke = useMutation({
    mutationFn: (login: LakeLogin) => revokeLakeLogin(dataClient, workspaceId, login.id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast(describeAdminError(e)),
  })

  const rows = (logins.data ?? []).filter((l) => l.status !== 'revoked')
  const setUp = canIssue && connection.data != null

  const snippets =
    setUp && connection.data
      ? lakeSnippets({
          workspaceId,
          appUrl: window.location.origin,
          host: connection.data.host,
          port: connection.data.port,
          database: connection.data.database,
          username: revealed?.username ?? '<login username>',
          secret: revealed?.secret ?? '<login password>',
        })
      : null

  return (
    <Section
      title={t('openData.logins.title')}
      count={rows.length}
      action={
        setUp ? (
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={() => {
              create.reset()
              setCreateOpen(true)
            }}
          >
            {t('openData.logins.create')}
          </Button>
        ) : null
      }
    >
      <Muted>{t('openData.logins.explain')}</Muted>
      {!setUp && connection.isSuccess ? (
        <Notice tone="info">{t('openData.logins.notReady')}</Notice>
      ) : null}
      {revealed ? (
        <div className="flex flex-col gap-3 rounded-md bg-warning-wash p-3">
          <Notice tone="warn" className="p-0">
            {t('openData.logins.copyNow')}
          </Notice>
          <Secret value={revealed.username} copyLabel={t('openData.logins.copyUser')} />
          <Secret value={revealed.secret} copyLabel={t('openData.logins.copyPassword')} />
          <div>
            <Button size="sm" onClick={() => setRevealed(null)}>
              {t('openData.logins.stored')}
            </Button>
          </div>
        </div>
      ) : null}
      {snippets ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium">{t('openData.logins.connect')}</h3>
          <Tabs
            mode="state"
            variant="segment"
            label={t('openData.logins.connect')}
            value={engine}
            onValueChange={(v) => setEngine(v as typeof engine)}
            items={[
              { key: 'duckdb', label: 'DuckDB' },
              { key: 'polars', label: 'Polars' },
              { key: 'spark', label: 'Spark' },
            ]}
          />
          <CodeBlock
            label={t('openData.logins.connect')}
            language={engine === 'duckdb' ? 'sql' : 'python'}
            code={snippets[engine].replaceAll('<table>', firstTable ?? '<table>')}
            maxHeight="lg"
          />
        </div>
      ) : null}
      {create.error ? <Notice tone="bad">{describeAdminError(create.error)}</Notice> : null}
      {rows.length === 0 && logins.isSuccess ? <Muted>{t('openData.logins.none')}</Muted> : null}
      {rows.length ? (
        <TableBox>
          <Table caption={t('openData.logins.title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('openData.logins.name')}</TableHead>
                <TableHead>{t('openData.logins.created')}</TableHead>
                <TableHead>{t('openData.logins.expires')}</TableHead>
                <TableHead>{t('openData.logins.lastUsed')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((login) => (
                <TableRow key={login.id}>
                  <TableCell title={login.username}>
                    {login.name} <Status tone={login.status === 'active' ? 'ok' : 'warn'}>{LOGIN_LABEL[login.status]}</Status>
                  </TableCell>
                  <TableCell>{formatDate(login.created_at)}</TableCell>
                  <TableCell>{login.expires_at ? formatDate(login.expires_at) : t('openData.logins.never')}</TableCell>
                  <TableCell>{login.last_used_at ? formatDate(login.last_used_at) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="quiet" onClick={() => setRevoking(login)}>
                      {t('openData.logins.revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim()) create.mutate()
            }}
          >
            <DialogHeader title={t('openData.logins.create')} />
            <DialogBody>
              <Field label={t('openData.logins.name')} required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('openData.logins.namePlaceholder')}
                  required
                  autoFocus
                />
              </Field>
              <Field label={t('openData.logins.expires')}>
                <Select
                  aria-label={t('openData.logins.expires')}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                >
                  {EXPIRY.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>{t('common.actions.cancel')}</DialogClose>
              <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
                {t('openData.logins.createLogin')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={revoking !== null} onOpenChange={(o) => (o ? null : setRevoking(null))}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t('openData.logins.revokeTitle')}</ConfirmDialogTitle>
            <ConfirmDialogDescription>{t('openData.logins.revokeBody')}</ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>{t('common.actions.cancel')}</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              onClick={() => {
                if (revoking) revoke.mutate(revoking)
                setRevoking(null)
              }}
            >
              {t('openData.logins.revoke')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}
