import { useMemo, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { ListHeader, ListToolbar } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useSavedSearches } from '#/components/search/use-saved-searches'
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
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { now } from '#/lib/clock'
import { formatListDate } from '#/lib/list-date'
import { savedQueryToSearch } from '#/lib/search'
import type { SavedQuery } from '#/lib/search'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

export const Route = createFileRoute('/saved-searches')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: SavedSearchesPage,
})

type Who = 'all' | 'shared' | 'mine'

function SavedSearchesPage() {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate()

  const {
    list,
    saved,
    memberNames,
    remove,
    setVisibility,
    rename,
    failureText,
    canShare,
    canChange,
    markUsed,
  } = useSavedSearches({
    workspaceId: context.workspace?.id ?? '',
    userId: context.user.id,
    role: context.workspace?.role,
  })

  const [q, setQ] = useState('')
  const [who, setWho] = useState<Who>('all')
  const [renaming, setRenaming] = useState<SavedQuery | null>(null)
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<SavedQuery | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()

    return saved.filter(
      (s) =>
        (who === 'all' ||
          (who === 'shared') === (s.visibility === 'workspace')) &&
        (!needle ||
          s.name.toLowerCase().includes(needle) ||
          s.query.toLowerCase().includes(needle)),
    )
  }, [saved, q, who])

  const open = (s: SavedQuery) => {
    markUsed(s)
    void navigate({ to: '/search', search: savedQueryToSearch(s) })
  }

  const columns = useMemo<RegistryColumn<SavedQuery>[]>(
    () => [
      {
        id: 'name',
        header: t('projects.savedSearches.columns.name'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'search',
        header: t('projects.savedSearches.columns.search'),
        meta: {
          headerClassName: 'max-md:hidden',
          cellClassName: 'max-md:hidden',
        },
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {row.original.facets?.text ?? row.original.query}
          </span>
        ),
      },
      {
        id: 'visibility',
        header: t('projects.savedSearches.columns.visibility'),
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.visibility === 'workspace'
              ? t('projects.savedSearches.visibilityShared')
              : t('projects.savedSearches.visibilityPrivate')}
          </span>
        ),
      },
      {
        id: 'savedBy',
        header: t('projects.savedSearches.columns.savedBy'),
        meta: {
          headerClassName: 'max-lg:hidden',
          cellClassName: 'max-lg:hidden',
        },
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {(row.original.savedBy && memberNames[row.original.savedBy]) || '—'}
          </span>
        ),
      },
      {
        id: 'lastUsed',
        header: t('projects.savedSearches.columns.lastUsed'),
        meta: {
          headerClassName: 'max-md:hidden text-right',
          cellClassName: 'max-md:hidden text-right',
        },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.lastUsed
              ? formatListDate(
                  new Date(row.original.lastUsed).toISOString(),
                  now(),
                )
              : '—'}
          </span>
        ),
      },
      {
        id: 'updated',
        header: t('projects.savedSearches.columns.saved'),
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatListDate(new Date(row.original.ts).toISOString(), now())}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        meta: { headerClassName: 'w-10', cellClassName: 'w-10 text-right' },
        cell: ({ row }) => {
          const s = row.original

          if (!canChange(s)) return null
          const shared = s.visibility === 'workspace'

          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={t('projects.savedSearches.actionsLabel', {
                      name: s.name,
                    })}
                    onClick={(e) => e.stopPropagation()}
                  />
                }
              >
                <Icon name="more" size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setNewName(s.name)
                    setRenaming(s)
                  }}
                >
                  {t('common.actions.rename')}
                </DropdownMenuItem>
                {shared ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setVisibility.mutate({ id: s.id, visibility: 'private' })
                    }
                  >
                    {t('projects.savedSearches.stopSharing')}
                  </DropdownMenuItem>
                ) : canShare ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setVisibility.mutate({
                        id: s.id,
                        visibility: 'workspace',
                      })
                    }
                  >
                    {t('projects.savedSearches.shareWithWorkspace')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem danger onClick={() => setDeleting(s)}>
                  {t('common.actions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [memberNames, canChange, canShare, setVisibility],
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('projects.savedSearches.title')}
        total={list.isPending ? undefined : saved.length}
      />
      <ListToolbar
        q={q}
        onSearch={setQ}
        placeholder={t('projects.savedSearches.filterPlaceholder')}
        label={t('projects.savedSearches.filterLabel')}
      >
        <Select
          aria-label={t('projects.savedSearches.whoLabel')}
          value={who}
          onChange={(e) => setWho(e.target.value as Who)}
        >
          <option value="all">{t('projects.savedSearches.whoAll')}</option>
          <option value="shared">
            {t('projects.savedSearches.whoShared')}
          </option>
          <option value="mine">{t('projects.savedSearches.whoMine')}</option>
        </Select>
      </ListToolbar>
      {failureText ? (
        <p
          role="alert"
          className="m-0 px-4 pt-3 text-body text-danger-text md:px-6"
        >
          {failureText}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {list.isError ? (
          <p
            role="alert"
            className="m-0 px-4 pt-3 text-body text-danger-text md:px-6"
          >
            {t('projects.savedSearches.loadFailed')}
          </p>
        ) : !list.isPending && !saved.length ? (
          <div className="px-4 md:px-6">
            <EmptyState
              icon="search"
              title={t('projects.savedSearches.pageEmptyTitle')}
              description={t('projects.savedSearches.pageEmptyBody')}
            />
          </div>
        ) : (
          <RegistryGrid
            label={t('projects.savedSearches.title')}
            rows={rows}
            columns={columns}
            getRowId={(s) => s.id}
            selectable={false}
            onRowClick={open}
            isLoading={list.isPending}
          />
        )}
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => {
          if (!o) setRenaming(null)
        }}
      >
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader title={t('projects.savedSearches.renameTitle')} />
          <form
            onSubmit={(e) => {
              e.preventDefault()

              if (!renaming || !newName.trim()) return
              rename.mutate(
                { id: renaming.id, name: newName },
                { onSuccess: () => setRenaming(null) },
              )
            }}
          >
            <DialogBody>
              <Field label={t('projects.savedSearches.name')}>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={!newName.trim() || rename.isPending}
              >
                {t('common.actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {deleting
                ? deleting.visibility === 'workspace'
                  ? t('projects.savedSearches.deleteShared', {
                      name: deleting.name,
                    })
                  : t('projects.savedSearches.deleteOwn', {
                      name: deleting.name,
                    })
                : ''}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('projects.savedSearches.deleteBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {t('common.actions.delete')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
