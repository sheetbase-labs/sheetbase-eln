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

const EXPIRY_CHOICES = [
  { value: '30', label: 'In 30 days' },
  { value: '90', label: 'In 90 days' },
  { value: '365', label: 'In a year' },
  { value: '', label: 'Never' },
] as const

const STATUS_LABEL: Record<SqlLogin['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  suspended: 'Paused: role lost data access',
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
      title="SQL logins"
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
            New SQL login
          </Button>
        ) : null
      }
    >
      <Muted>
        Read your workspace data from any SQL tool. A login sees exactly what
        you see, and can only read.
      </Muted>
      {!setUp ? (
        <Notice tone="info" title="SQL access isn’t set up on this deployment">
          {ready.data === true
            ? 'Ask an administrator to set the SQL host for this deployment.'
            : 'The database hasn’t been prepared for SQL logins yet.'}
        </Notice>
      ) : null}
      {failed ? (
        <Notice tone="bad" title="That didn’t work">
          {failed instanceof Error ? failed.message : 'Please try again.'}
        </Notice>
      ) : null}
      {revealed && connection.data ? (
        <div className="flex flex-col gap-3 rounded-md bg-warning-wash p-3">
          <Notice tone="warn" className="p-0">
            Copy the password now. It won’t be shown again.
          </Notice>
          <Secret value={revealed.username} copyLabel="Copy username" />
          <Secret value={revealed.password} copyLabel="Copy password" />
          <Secret
            value={formatSqlUrl(connection.data, revealed.username).replace(
              '<password>',
              revealed.password,
            )}
            copyLabel="Copy connection string"
          />
          <div>
            <Button type="button" size="sm" onClick={() => setRevealed(null)}>
              I have stored it
            </Button>
          </div>
        </div>
      ) : null}
      {setUp && connection.data ? (
        <Muted>
          Connect to <code>{connection.data.host}</code> port{' '}
          <code>{connection.data.port}</code>, database{' '}
          <code>{connection.data.database}</code>. Your tables are in the{' '}
          <code>data</code> schema.
        </Muted>
      ) : null}
      {setUp && logins.isSuccess && rows.length === 0 ? (
        <Muted>You have no SQL logins yet.</Muted>
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
                Created {formatDate(login.createdAt)}
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
                    New password
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setConfirming({ kind: 'revoke', login })}
                >
                  Revoke
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
              title="New SQL login"
              description="Read-only access to your data. The password is shown once."
            />
            <DialogBody>
              <Field
                label="Name"
                required
                hint="So you can tell logins apart, for example the tool or laptop."
              >
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="My laptop"
                  required
                  autoFocus
                />
              </Field>
              <Field label="Expires">
                <Select
                  aria-label="Expires"
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
                Cancel
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={!name.trim() || create.isPending}
              >
                Create login
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
                ? `Revoke ${confirming.login.name}?`
                : `New password for ${confirming?.login.name ?? ''}?`}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirming?.kind === 'revoke'
                ? 'It stops working straight away and can’t be turned back on.'
                : 'The old password stops working straight away.'}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
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
                ? 'Revoke login'
                : 'Get new password'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}
