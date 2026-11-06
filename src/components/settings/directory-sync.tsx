import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
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
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Muted, Section } from '#/components/ui/layout'
import { Secret } from '#/components/ui/secret'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { createDataClient } from '#/lib/data-client'
import {
  createScimToken,
  directorySyncKeys,
  fetchDirectorySyncStatus,
  fetchScimTokens,
  revokeScimToken,
  scimBaseUrl,
} from '#/lib/directory-sync'
import type { ScimToken } from '#/lib/directory-sync'
import { describeAdminError, formatDate } from '#/lib/workspace-admin'
import { t } from '#/copy'

const client = createDataClient()

/**
 * Members and roles → "Directory sync". The lab's identity provider adds,
 * changes and switches off people here by itself, using a token made on this
 * page. Only people who manage members see it.
 */
export function DirectorySyncSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ScimToken | null>(null)
  const tokens = useQuery({
    queryKey: directorySyncKeys.tokens(workspaceId),
    enabled: Boolean(workspaceId) && canManage,
    queryFn: () => fetchScimTokens(client, workspaceId),
  })
  const status = useQuery({
    queryKey: directorySyncKeys.status(workspaceId),
    enabled: Boolean(workspaceId) && canManage,
    queryFn: () => fetchDirectorySyncStatus(client, workspaceId),
  })
  const rows = tokens.data ?? []

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['directory-sync'] })

  const create = useMutation({
    mutationFn: () => createScimToken(client, workspaceId, label.trim()),
    onSuccess: async (value) => {
      setError(null)
      setLabel('')
      setSecret(value)
      await refresh()
    },
    onError: (failure) => setError(describeAdminError(failure)),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeScimToken(client, id),
    onSuccess: async () => {
      await refresh()
      toast.success(t('people.directorySync.revoked'))
    },
    onError: (failure) =>
      toast.error(t('people.directorySync.couldNotSave'), {
        description: describeAdminError(failure),
      }),
  })

  if (!canManage) return null

  const columns: RegistryColumn<ScimToken>[] = [
    {
      id: 'label',
      header: t('people.directorySync.labelColumn'),
      cell: ({ row }) => row.original.label,
    },
    {
      id: 'created',
      header: t('people.directorySync.createdColumn'),
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: 'lastUsed',
      header: t('people.directorySync.lastUsedColumn'),
      cell: ({ row }) =>
        row.original.lastUsedAt
          ? formatDate(row.original.lastUsedAt)
          : t('people.directorySync.neverUsed'),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="quiet"
          disabled={revoke.isPending}
          onClick={() => setRevoking(row.original)}
        >
          {t('people.directorySync.revoke')}
        </Button>
      ),
    },
  ]

  const summary = status.data
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <Section title={t('people.directorySync.title')}>
      <Muted>{t('people.directorySync.description')}</Muted>
      {summary && summary.peopleManaged > 0 ? (
        <Muted>
          {t('people.directorySync.summary', {
            count: summary.peopleManaged,
            managed: summary.peopleManaged,
            off: summary.peopleSwitchedOff,
          })}
        </Muted>
      ) : null}
      {secret ? (
        <Notice tone="warn" title={t('people.directorySync.secretTitle')}>
          <p className="mb-2">{t('people.directorySync.secretBody')}</p>
          <Secret value={secret} copyLabel={t('common.actions.copy')} />
          <Button
            className="mt-2"
            size="sm"
            variant="quiet"
            onClick={() => setSecret(null)}
          >
            {t('people.directorySync.secretDone')}
          </Button>
        </Notice>
      ) : null}
      {rows.length === 0 ? (
        <Muted>{t('people.directorySync.none')}</Muted>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('people.directorySync.title')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            selectable={false}
            sortable={false}
          />
        </TableBox>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (label.trim()) create.mutate()
        }}
      >
        <Field
          label={t('people.directorySync.nameLabel')}
          className="min-w-[200px] max-w-[320px] flex-1"
          error={error}
        >
          <Input
            value={label}
            placeholder={t('people.directorySync.namePlaceholder')}
            autoComplete="off"
            onChange={(event) => {
              setLabel(event.target.value)
              setError(null)
            }}
          />
        </Field>
        <Button type="submit" disabled={create.isPending || !label.trim()}>
          {t('people.directorySync.create')}
        </Button>
      </form>
      <Field label={t('people.directorySync.urlLabel')}>
        <Secret
          value={scimBaseUrl(origin)}
          copyLabel={t('common.actions.copy')}
        />
      </Field>
      <Muted>{t('people.directorySync.hint')}</Muted>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('people.directorySync.revokeTitle', {
                label: revoking?.label ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('people.directorySync.revokeBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              onClick={() => {
                if (revoking) revoke.mutate(revoking.id)
                setRevoking(null)
              }}
            >
              {t('people.directorySync.revoke')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}
