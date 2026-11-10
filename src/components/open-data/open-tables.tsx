import { useEffect, useState } from 'react'
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
  describeOpenDataError,
} from '#/lib/open-data/client'
import type {
  LakeLogin,
  LakeLoginSecret,
  LakeTable,
} from '#/lib/open-data/client'
import { t } from '#/copy'

const dataClient = createDataClient()

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`

  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`

  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`

  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const TABLE_TONE = {
  ready: 'ok',
  pending: 'warn',
  failed: 'bad',
  retired: 'draft',
} as const

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
    void queryClient.invalidateQueries({
      queryKey: openDataKeys.lake(workspaceId),
    })
    void queryClient.invalidateQueries({
      queryKey: openDataKeys.lakeTables(workspaceId),
    })
  }

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setLakeSettings(dataClient, workspaceId, enabled),
    onSuccess: () => {
      toast(t('openData.tables.saved'))
      refreshAll()
    },
    onError: (e) =>
      toast(`${t('openData.tables.failed')}: ${describeOpenDataError(e)}`),
  })

  const refresh = useMutation({
    mutationFn: () => requestLakeRefresh(dataClient, workspaceId),
    onSuccess: () => {
      toast(t('openData.tables.refreshQueued'))
      refreshAll()
    },
    onError: (e) =>
      toast(`${t('openData.tables.failed')}: ${describeOpenDataError(e)}`),
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
          <Button
            size="sm"
            icon="refresh"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
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
        <LakeTables
          workspaceId={workspaceId}
          lastRunAt={settings.data?.lastRunAt ?? null}
          canIssueLogins={settings.data?.canIssueLogins === true}
          rows={rows}
          dataAccess={dataAccess}
          isPending={tables.isPending}
        />
      ) : (
        <Muted>{t('openData.tables.off')}</Muted>
      )}
    </Section>
  )
}

/** What the lake holds once it is switched on, and who may connect to it. */
function LakeTables({
  workspaceId,
  lastRunAt,
  canIssueLogins,
  rows,
  dataAccess,
  isPending,
}: {
  workspaceId: string
  lastRunAt: string | null
  canIssueLogins: boolean
  rows: readonly LakeTable[]
  dataAccess: boolean
  isPending: boolean
}) {
  const ready = rows.some((row) => row.status === 'ready')

  return (
    <>
      <Muted>
        {t('openData.tables.lastRun')}:{' '}
        {lastRunAt ? formatDate(lastRunAt) : t('openData.tables.never')}
      </Muted>
      <LakeTableGrid
        rows={rows}
        dataAccess={dataAccess}
        isPending={isPending}
      />
      {dataAccess ? (
        <LakeLogins
          workspaceId={workspaceId}
          canIssue={canIssueLogins && ready}
          hasTables={ready}
          firstTable={
            rows.find((row) => row.status === 'ready')?.table_name ?? null
          }
        />
      ) : null}
    </>
  )
}

/** The lake's own tables: what a query from outside can read today. */
function LakeTableGrid({
  rows,
  dataAccess,
  isPending,
}: {
  rows: readonly LakeTable[]
  dataAccess: boolean
  isPending: boolean
}) {
  return (
    <TableBox>
      <Table caption={t('openData.tables.title')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('openData.tables.columns.table')}</TableHead>
            <TableHead>{t('openData.tables.columns.from')}</TableHead>
            <TableHead className="text-right">
              {t('openData.tables.columns.rows')}
            </TableHead>
            <TableHead className="text-right">
              {t('openData.tables.columns.size')}
            </TableHead>
            <TableHead>{t('openData.tables.columns.updated')}</TableHead>
            <TableHead>{t('openData.tables.columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody
          loading={isPending}
          empty={t('openData.tables.empty')}
          colSpan={6}
        >
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
              <TableCell className="text-right">
                {row.row_count.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {formatBytes(row.byte_size)}
              </TableCell>
              <TableCell>
                {row.last_snapshot_at ? formatDate(row.last_snapshot_at) : '—'}
              </TableCell>
              <TableCell title={row.last_error ?? undefined}>
                <Status tone={TABLE_TONE[row.status]}>
                  {tableStatus(row.status)}
                </Status>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}

/** The logins that still work, oldest first, each with its own revoke. */
function LakeLoginTable({
  rows,
  onRevoke,
}: {
  rows: readonly LakeLogin[]
  onRevoke: (login: LakeLogin) => void
}) {
  if (rows.length === 0) return null

  return (
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
                {login.name}{' '}
                <Status tone={login.status === 'active' ? 'ok' : 'warn'}>
                  {LOGIN_LABEL[login.status]}
                </Status>
              </TableCell>
              <TableCell>{formatDate(login.created_at)}</TableCell>
              <TableCell>
                {login.expires_at
                  ? formatDate(login.expires_at)
                  : t('openData.logins.never')}
              </TableCell>
              <TableCell>
                {login.last_used_at ? formatDate(login.last_used_at) : '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => onRevoke(login)}
                >
                  {t('openData.logins.revoke')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}

/** The create-login dialog: what the login is called and how long it lasts. */
function CreateLoginDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onCreated: (secret: LakeLoginSecret & { name: string }) => void
}) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('90')

  const create = useMutation({
    mutationFn: () =>
      createLakeLogin(dataClient, workspaceId, {
        name: name.trim(),
        expiresAt: expiry
          ? new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
          : null,
      }),
    onSuccess: (secret) => {
      onCreated({ ...secret, name: name.trim() })
      setName('')
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()

            if (name.trim()) create.mutate()
          }}
        >
          <DialogHeader title={t('openData.logins.create')} />
          {create.error ? (
            <Notice tone="bad">{describeOpenDataError(create.error)}</Notice>
          ) : null}
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
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || create.isPending}
            >
              {t('openData.logins.createLogin')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const EXPIRY = [
  { value: '30', label: t('openData.logins.n30') },
  { value: '90', label: t('openData.logins.n90') },
  { value: '365', label: t('openData.logins.year') },
  { value: '', label: t('openData.logins.never') },
] as const

/** The engines the connect snippets are written for, in picker order. */
const SNIPPET_ENGINES = ['duckdb', 'polars', 'spark'] as const

type SnippetEngine = (typeof SNIPPET_ENGINES)[number]

function isSnippetEngine(value: string): value is SnippetEngine {
  return SNIPPET_ENGINES.some((engine) => engine === value)
}

/** How to connect from each engine, once a login exists to connect with. */
function ConnectSnippets({
  snippets,
  engine,
  onEngine,
  firstTable,
}: {
  snippets: Record<SnippetEngine, string> | null
  engine: SnippetEngine
  onEngine: (engine: SnippetEngine) => void
  firstTable: string | null
}) {
  if (!snippets) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label font-medium">{t('openData.logins.connect')}</h3>
      <Tabs
        mode="state"
        variant="segment"
        label={t('openData.logins.connect')}
        value={engine}
        onValueChange={(value) => {
          if (isSnippetEngine(value)) onEngine(value)
        }}
        items={[
          // copy-ignore-next-line
          { key: 'duckdb', label: 'DuckDB' },
          // copy-ignore-next-line
          { key: 'polars', label: 'Polars' },
          // copy-ignore-next-line
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
  )
}

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

  const [revealed, setRevealed] = useState<
    (LakeLoginSecret & { name: string }) | null
  >(null)

  const [revoking, setRevoking] = useState<LakeLogin | null>(null)
  const [engine, setEngine] = useState<SnippetEngine>('duckdb')

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
    queryClient.invalidateQueries({
      queryKey: openDataKeys.lakeLogins(workspaceId),
    })

  const revoke = useMutation({
    mutationFn: (login: LakeLogin) =>
      revokeLakeLogin(dataClient, workspaceId, login.id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast(describeOpenDataError(e)),
  })

  // The snippets name the app's own origin, which only the browser knows.
  const [appUrl, setAppUrl] = useState('')

  useEffect(() => setAppUrl(window.location.origin), [])

  const rows = (logins.data ?? []).filter((l) => l.status !== 'revoked')
  const setUp = canIssue && connection.data != null

  const snippets =
    setUp && connection.data && appUrl
      ? lakeSnippets({
          workspaceId,
          appUrl,
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
            onClick={() => setCreateOpen(true)}
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
          <Secret
            value={revealed.username}
            copyLabel={t('openData.logins.copyUser')}
          />
          <Secret
            value={revealed.secret}
            copyLabel={t('openData.logins.copyPassword')}
          />
          <div>
            <Button size="sm" onClick={() => setRevealed(null)}>
              {t('openData.logins.stored')}
            </Button>
          </div>
        </div>
      ) : null}
      <ConnectSnippets
        snippets={snippets}
        engine={engine}
        onEngine={setEngine}
        firstTable={firstTable}
      />
      {rows.length === 0 && logins.isSuccess ? (
        <Muted>{t('openData.logins.none')}</Muted>
      ) : null}
      <LakeLoginTable rows={rows} onRevoke={setRevoking} />

      <CreateLoginDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        onCreated={(secret) => {
          setRevealed(secret)
          void invalidate()
        }}
      />

      {/* react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- The shared shell is the design system's ConfirmDialog; each open-data panel confirms its own act in its own words, and its twin is being changed separately. */}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => (o ? null : setRevoking(null))}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('openData.logins.revokeTitle')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('openData.logins.revokeBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
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
