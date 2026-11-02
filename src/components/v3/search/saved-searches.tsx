import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Input } from '#/components/v3/ui/input'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  deleteSavedSearchOnAccount,
  fetchSavedSearches,
  moveBrowserSavedSearches,
  renameSavedSearch,
  saveSearchOnAccount,
  savedQueryToSearch,
  savedSearchQueryKey,
  setSavedSearchVisibility,
} from '#/lib/search'
import type { SavedQuery, SavedSearchFacets } from '#/lib/search'
import { t } from '#/copy'

/**
 * Saved searches for the results page. A saved search is the page's URL under
 * a name. It is private to the person who saved it unless they share it with
 * the workspace, and either way it follows them to another machine. Searches an
 * earlier version kept in this browser move onto the account the first time the
 * list loads.
 */
export function SavedSearches({
  workspaceId,
  current,
  onApply,
  userId,
  role,
  memberNames,
}: {
  workspaceId: string
  /** The search the page is showing now; saving stores this. */
  current: { q: string } & SavedSearchFacets
  onApply: (search: { q: string } & SavedSearchFacets) => void
  /** The signed-in person: their searches are theirs to change. */
  userId?: string
  /** Their role in the workspace, which decides who can share and tidy up. */
  role?: string | null
  /** Names of the people in the workspace, by user id. */
  memberNames?: Record<string, string>
}) {
  const queryClient = useQueryClient()
  const key = savedSearchQueryKey(workspaceId)
  const list = useQuery({
    queryKey: key,
    queryFn: async () => {
      await moveBrowserSavedSearches(notebookDataClient, workspaceId).catch(
        () => 0,
      )
      return fetchSavedSearches(notebookDataClient)
    },
  })
  const saved = list.data ?? []
  const shared = saved.filter((s) => s.visibility === 'workspace')
  const mine = saved.filter((s) => s.visibility !== 'workspace')
  // Anyone who can add records can share; viewers keep searches to themselves.
  const canShare = hasCapability(role, 'record.create')
  const isManager = hasCapability(role, 'schema.edit')
  const canChange = (s: SavedQuery) =>
    s.visibility !== 'workspace' || s.savedBy === userId || isManager

  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const [shareNew, setShareNew] = useState(false)
  const save = useMutation({
    mutationFn: (saveName: string) =>
      saveSearchOnAccount(
        notebookDataClient,
        saveName,
        current,
        shareNew ? 'workspace' : 'private',
      ),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteSavedSearchOnAccount(notebookDataClient, id),
    onSuccess: refresh,
  })
  const setVisibility = useMutation({
    mutationFn: (v: { id: string; visibility: 'private' | 'workspace' }) =>
      setSavedSearchVisibility(notebookDataClient, v.id, v.visibility),
    onSuccess: refresh,
  })
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      renameSavedSearch(notebookDataClient, v.id, v.name),
    onSuccess: refresh,
  })
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [deleting, setDeleting] = useState<string | null>(null)
  const canSave = current.q.trim().length > 0 || Boolean(current.filter)

  const failure = [save, remove, setVisibility, rename]
    .map((m) => (m.isError ? m.error : null))
    .find(Boolean)
  const failureText = failure
    ? /already exists/i.test(String(failure.message))
      ? t('projects.savedSearches.nameTaken')
      : t('projects.savedSearches.failed')
    : null

  const commit = () => {
    if (!name.trim()) return
    save.mutate(name, {
      onSuccess: () => {
        setName('')
        setShareNew(false)
        setNaming(false)
      },
    })
  }

  const row = (s: SavedQuery) => {
    const sharedRow = s.visibility === 'workspace'
    const author = s.savedBy ? memberNames?.[s.savedBy] : undefined
    if (renaming?.id === s.id) {
      return (
        <li key={s.id}>
          <form
            className="flex items-center gap-1 px-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (!renaming.name.trim()) return
              rename.mutate(renaming, {
                onSuccess: () => setRenaming(null),
              })
            }}
          >
            <Input
              aria-label={t('projects.savedSearches.name')}
              value={renaming.name}
              onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
              autoFocus
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!renaming.name.trim() || rename.isPending}
            >
              {t('common.actions.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => setRenaming(null)}
            >
              {t('common.actions.cancel')}
            </Button>
          </form>
        </li>
      )
    }
    if (deleting === s.id) {
      return (
        <li
          key={s.id}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-body"
        >
          <span className="min-w-0 flex-1 truncate">
            {sharedRow
              ? t('projects.savedSearches.deleteShared', { name: s.name })
              : t('projects.savedSearches.deleteOwn', { name: s.name })}
          </span>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              remove.mutate(s.id, { onSettled: () => setDeleting(null) })
            }
          >
            {t('common.actions.delete')}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setDeleting(null)}>
            {t('common.actions.cancel')}
          </Button>
        </li>
      )
    }
    return (
      <li key={s.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onApply(savedQueryToSearch(s))}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left font-[inherit] text-body hover:bg-surface-hover"
          title={s.query}
        >
          <span className="min-w-0 truncate text-link">{s.name}</span>
          {sharedRow && author ? (
            <span className="shrink-0 text-label text-fg-muted">{author}</span>
          ) : null}
        </button>
        {canChange(s) ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={t('projects.savedSearches.actionsLabel', {
                    name: s.name,
                  })}
                />
              }
            >
              <Icon name="more" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setRenaming({ id: s.id, name: s.name })}
              >
                {t('common.actions.rename')}
              </DropdownMenuItem>
              {sharedRow ? (
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
                    setVisibility.mutate({ id: s.id, visibility: 'workspace' })
                  }
                >
                  {t('projects.savedSearches.shareWithWorkspace')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem danger onClick={() => setDeleting(s.id)}>
                {t('common.actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>
    )
  }

  const group = (title: string, items: SavedQuery[], empty?: string) => (
    <div className="flex flex-col gap-0.5">
      <h3 className="m-0 px-1.5 text-label font-medium text-fg-muted">
        {title}
      </h3>
      {items.length ? (
        <ul className="m-0 flex max-h-[220px] list-none flex-col gap-0.5 overflow-y-auto p-0">
          {items.map(row)}
        </ul>
      ) : empty ? (
        <p className="m-0 px-1.5 text-label text-fg-muted">{empty}</p>
      ) : null}
    </div>
  )

  return (
    <section
      aria-label={t('projects.savedSearches.title')}
      className="flex flex-col gap-2.5"
    >
      <div className="flex items-center justify-between px-1.5">
        <h2 className="m-0 text-label font-medium text-fg-muted">
          {t('projects.savedSearches.title')}
        </h2>
        {canSave && !naming ? (
          <Button size="sm" variant="quiet" onClick={() => setNaming(true)}>
            {t('projects.savedSearches.saveThis')}
          </Button>
        ) : null}
      </div>
      {naming ? (
        <form
          className="flex flex-col gap-1.5 px-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
        >
          <label className="flex flex-col gap-0.5 text-label">
            {t('projects.savedSearches.name')}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('projects.savedSearches.example', {
                query: current.q.trim().slice(0, 24),
              })}
              autoFocus
            />
          </label>
          {canShare ? (
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={shareNew}
                onCheckedChange={(v) => setShareNew(Boolean(v))}
              />
              {t('projects.savedSearches.shareNew')}
            </label>
          ) : null}
          <div className="flex gap-1.5">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!name.trim() || save.isPending}
            >
              {t('common.actions.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => {
                setNaming(false)
                setName('')
                setShareNew(false)
              }}
            >
              {t('common.actions.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
      {failureText ? (
        <p role="alert" className="m-0 px-1.5 text-label text-danger-text">
          {failureText}
        </p>
      ) : null}
      {list.isError ? (
        <p role="alert" className="m-0 px-1.5 text-label text-danger-text">
          {t('projects.savedSearches.loadFailed')}
        </p>
      ) : list.isPending ? null : saved.length ? (
        <>
          {shared.length
            ? group(t('projects.savedSearches.sharedTitle'), shared)
            : null}
          {group(
            t('projects.savedSearches.yoursTitle'),
            mine,
            t('projects.savedSearches.noneOfYours'),
          )}
        </>
      ) : (
        <p className="m-0 px-1.5 text-label text-fg-muted">
          {t('projects.savedSearches.empty')}
        </p>
      )}
    </section>
  )
}
