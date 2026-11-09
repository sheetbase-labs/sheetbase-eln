import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { toast } from '#/components/ui/sonner'
import { authClient } from '#/lib/auth-client'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

export const passkeysQueryKey = ['passkeys'] as const

interface PasskeyRow {
  id: string
  name?: string | null
  backedUp: boolean
  createdAt?: string | Date | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : t('people.passkeys.failed')
}

/** True once the browser is known to create and use passkeys (never on the server). */
export function usePasskeysSupported(): boolean {
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    setSupported('PublicKeyCredential' in window)
  }, [])

  return supported
}

/**
 * Passkeys for the signed-in person: add one from this device, give it a name
 * they will recognise, rename it, and remove the ones they no longer use.
 * Signing in with a passkey needs no emailed link.
 */
export function SettingsPasskeys() {
  const queryClient = useQueryClient()
  const supported = usePasskeysSupported()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<PasskeyRow | null>(null)
  const [newName, setNewName] = useState('')

  const list = useQuery({
    queryKey: passkeysQueryKey,
    queryFn: async () => {
      const { data, error } = await authClient.passkey.listUserPasskeys()

      if (error) throw new Error(error.message ?? t('people.passkeys.failed'))

      return data
    },
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: passkeysQueryKey })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      })

      if (error) throw new Error(error.message ?? t('people.passkeys.failed'))
    },
    onSuccess: async () => {
      setName('')
      toast.success(t('people.passkeys.added'))
      await refresh()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await authClient.passkey.deletePasskey({ id })

      if (error) throw new Error(error.message ?? t('people.passkeys.failed'))
    },
    onSuccess: async () => {
      toast.success(t('people.passkeys.removed'))
      await refresh()
    },
    onError: (failure) =>
      toast.error(t('people.passkeys.failed'), {
        description: messageOf(failure),
      }),
  })

  const rename = useMutation({
    mutationFn: async () => {
      if (!renaming) return

      const { error } = await authClient.passkey.updatePasskey({
        id: renaming.id,
        name: newName.trim(),
      })

      if (error) throw new Error(error.message ?? t('people.passkeys.failed'))
    },
    onSuccess: async () => {
      setRenaming(null)
      await refresh()
    },
  })

  const rows = list.data ?? []

  const columns: RegistryColumn<PasskeyRow>[] = [
    {
      id: 'name',
      header: t('people.passkeys.nameColumn'),
      cell: ({ row }) => row.original.name || t('people.passkeys.unnamed'),
    },
    {
      id: 'kind',
      header: t('people.passkeys.kindColumn'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) =>
        row.original.backedUp
          ? t('people.passkeys.synced')
          : t('people.passkeys.thisDevice'),
    },
    {
      id: 'added',
      header: t('people.passkeys.addedColumn'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => formatDate(row.original.createdAt ?? null),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => (
        <span className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setRenaming(row.original)
              setNewName(row.original.name ?? '')
            }}
          >
            {t('people.passkeys.rename')}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={remove.isPending}
            onClick={() => remove.mutate(row.original.id)}
          >
            {t('people.passkeys.remove')}
          </Button>
        </span>
      ),
    },
  ]

  return (
    <Section title={t('people.passkeys.title')}>
      <Muted>{t('people.passkeys.description')}</Muted>
      {list.isError ? (
        <Notice tone="bad">{messageOf(list.error)}</Notice>
      ) : rows.length === 0 ? (
        <Muted>
          {list.isLoading
            ? t('common.states.loading')
            : t('people.passkeys.none')}
        </Muted>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('people.passkeys.title')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            selectable={false}
            sortable={false}
          />
        </TableBox>
      )}
      {supported ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            add.mutate()
          }}
        >
          <Field
            label={t('people.passkeys.nameLabel')}
            className="min-w-[200px] max-w-[320px] flex-1"
          >
            <Input
              value={name}
              maxLength={80}
              placeholder={t('people.passkeys.namePlaceholder')}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending
              ? t('people.passkeys.adding')
              : t('people.passkeys.add')}
          </Button>
        </form>
      ) : (
        <Muted>{t('people.passkeys.unsupported')}</Muted>
      )}
      {add.isError ? <Notice tone="bad">{messageOf(add.error)}</Notice> : null}
      {renaming ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setRenaming(null))}>
          <DialogContent className="w-[min(420px,calc(100vw-32px))]">
            <DialogHeader title={t('people.passkeys.renameTitle')} />
            <DialogBody>
              <Field label={t('people.passkeys.nameLabel')}>
                <Input
                  value={newName}
                  maxLength={80}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={rename.isPending || !newName.trim()}
                onClick={() => rename.mutate()}
              >
                {t('common.actions.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Section>
  )
}
