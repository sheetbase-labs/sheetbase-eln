import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Secret } from '#/components/v3/ui/secret'
import { Select } from '#/components/v3/ui/select'
import { Badge } from '#/components/v3/ui/badge'
import {
  createSqlLogin,
  dataAccessKeys,
  fetchSqlAccessReady,
  fetchSqlLogins,
  revokeSqlLogin,
  rotateSqlLogin,
} from '#/lib/data-access'
import type { SqlLogin, SqlLoginSecret } from '#/lib/data-access'
import {
  formatSqlUrl,
  getSqlConnectionFn,
  sqlConnectionQueryKey,
} from '#/lib/sql-access'
import { formatDate } from '#/lib/workspace-admin'
import { rich, t } from '#/copy'

const EXPIRY_CHOICES = [
  { value: '30', label: t('settings.sqlLogins.n30Days') },
  { value: '90', label: t('settings.sqlLogins.n90Days') },
  { value: '365', label: t('settings.sqlLogins.year') },
  { value: '', label: t('settings.sqlLogins.never') },
] as const

const STATUS_LABEL: Record<SqlLogin['status'], string> = {
  active: t('settings.sqlLogins.statusActive'),
  expired: t('settings.sqlLogins.statusExpired'),
  revoked: t('settings.sqlLogins.statusRevoked'),
  suspended: t('settings.sqlLogins.pausedRoleLost'),
}

/**
 * Settings → API: the member's personal read-only SQL logins. A login sees the
 * same data its member sees and can only read the reporting views. The password
 * is shown once, when the login is created or rotated.
 */
export function SqlLogins({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('90')
  const [revealed, setRevealed] = useState<
    (SqlLoginSecret & { name: string }) | null
  >(null)
  const [confirming, setConfirming] = useState<{
    kind: 'revoke' | 'rotate'
    login: SqlLogin
  } | null>(null)

  const ready = useQuery({
    queryKey: dataAccessKeys.ready(workspaceId),
    queryFn: () => fetchSqlAccessReady(),
  })
  const connection = useQuery({
    queryKey: sqlConnectionQueryKey,
    queryFn: () => getSqlConnectionFn(),
  })
  const logins = useQuery({
    queryKey: dataAccessKeys.logins(workspaceId),
    queryFn: () => fetchSqlLogins(workspaceId),
    enabled: ready.data === true,
  })
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: dataAccessKeys.logins(workspaceId),
    })

  const create = useMutation({
    mutationFn: () =>
      createSqlLogin(workspaceId, {
        name: name.trim(),
        expiresAt: expiry
          ? new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
          : null,
      }),
    onSuccess: (secret) => {
      setRevealed({ ...secret, name: name.trim() })
      setCreateOpen(false)
      setName('')
      void refresh()
    },
  })
  const rotate = useMutation({
    mutationFn: (login: SqlLogin) => rotateSqlLogin(workspaceId, login.id),
    onSuccess: (secret, login) => {
      setRevealed({ ...secret, name: login.name })
      void refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (login: SqlLogin) => revokeSqlLogin(workspaceId, login.id),
    onSuccess: () => void refresh(),
  })
  const failed = create.error ?? rotate.error ?? revoke.error

  if (ready.isPending || connection.isPending) return null

  const setUp = ready.data === true && connection.data != null
  const rows = (logins.data ?? []).filter((l) => l.status !== 'revoked')

  return (
    <Section
      title={t('settings.sqlLogins.sqlLogins')}
      action={
        setUp ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              create.reset()
              setCreateOpen(true)
            }}
          >
            {t('settings.sqlLogins.newSqlLogin')}
          </Button>
        ) : null
      }
    >
      <Muted>{t('settings.sqlLogins.readWorkspaceData')}</Muted>
      {!setUp ? (
        <Notice tone="info" title={t('settings.sqlLogins.sqlAccessIsn')}>
          {ready.data === true
            ? t('settings.sqlLogins.askAdministratorSet')
            : t('settings.sqlLogins.databaseHasnPrepared')}
        </Notice>
      ) : null}
      {failed ? (
        <Notice tone="bad" title={t('settings.sqlLogins.didnWork')}>
          {failed instanceof Error
            ? failed.message
            : t('settings.sqlLogins.pleaseTryAgain')}
        </Notice>
      ) : null}
      {revealed && connection.data ? (
        <div className="flex flex-col gap-3 rounded-md bg-warning-wash p-3">
          <Notice tone="warn" className="p-0">
            {t('settings.sqlLogins.copyPasswordNow')}
          </Notice>
          <Secret
            value={revealed.username}
            copyLabel={t('settings.sqlLogins.copyUsername')}
          />
          <Secret
            value={revealed.password}
            copyLabel={t('settings.sqlLogins.copyPassword')}
          />
          <Secret
            value={formatSqlUrl(connection.data, revealed.username).replace(
              '<password>',
              revealed.password,
            )}
            copyLabel={t('settings.sqlLogins.copyConnectionString')}
          />
          <div>
            <Button type="button" size="sm" onClick={() => setRevealed(null)}>
              {t('settings.sqlLogins.iStored')}
            </Button>
          </div>
        </div>
      ) : null}
      {setUp && connection.data ? (
        <Muted>
          {rich('settings.sqlLogins.connectTo', {
            host: <code>{connection.data.host}</code>,
            port: <code>{connection.data.port}</code>,
            database: <code>{connection.data.database}</code>,
            schema: <code>{t('settings.sqlLogins.dataSchemaName')}</code>,
          })}
        </Muted>
      ) : null}
      {setUp && logins.isSuccess && rows.length === 0 ? (
        <Muted>{t('settings.sqlLogins.sqlLoginsYet')}</Muted>
      ) : null}
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle p-0">
          {rows.map((login) => (
            <li
              key={login.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
            >
              <span className="min-w-40 font-medium">{login.name}</span>
              <code className="text-label">{login.username}</code>
              <Badge>{STATUS_LABEL[login.status]}</Badge>
              <span className="text-label text-fg-muted">
                {t('settings.sqlLogins.created')}
                {formatDate(login.createdAt)}
                {login.expiresAt
                  ? ` · expires ${formatDate(login.expiresAt)}`
                  : ''}
              </span>
              <span className="ml-auto flex gap-2">
                {login.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming({ kind: 'rotate', login })}
                  >
                    {t('settings.sqlLogins.newPassword')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setConfirming({ kind: 'revoke', login })}
                >
                  {t('settings.sqlLogins.revoke')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim()) create.mutate()
            }}
          >
            <DialogHeader
              title={t('settings.sqlLogins.newSqlLogin')}
              description={t('settings.sqlLogins.readOnlyAccessDescription')}
            />
            <DialogBody>
              <Field
                label={t('settings.sqlLogins.name')}
                required
                hint={t('settings.sqlLogins.tellLoginsApartHint')}
              >
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('settings.sqlLogins.myLaptopPlaceholder')}
                  required
                  autoFocus
                />
              </Field>
              <Field label={t('settings.sqlLogins.expires')}>
                <Select
                  aria-label={t('settings.sqlLogins.expires')}
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                >
                  {EXPIRY_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
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
                {t('settings.sqlLogins.createLogin')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {confirming?.kind === 'revoke'
                ? t('settings.sqlLogins.revoke2', {
                    name: confirming.login.name,
                  })
                : t('settings.sqlLogins.newPasswordFor', {
                    name: confirming?.login.name ?? '',
                  })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirming?.kind === 'revoke'
                ? t('settings.sqlLogins.stopsWorkingStraight')
                : t('settings.sqlLogins.oldPasswordStops')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant={
                confirming?.kind === 'revoke' ? 'danger-fill' : 'primary'
              }
              onClick={() => {
                if (!confirming) return
                if (confirming.kind === 'rotate')
                  rotate.mutate(confirming.login)
                else revoke.mutate(confirming.login)
                setConfirming(null)
              }}
            >
              {confirming?.kind === 'revoke'
                ? t('settings.sqlLogins.revokeLogin')
                : t('settings.sqlLogins.getNewPassword')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}
