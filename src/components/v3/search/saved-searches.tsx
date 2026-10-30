import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  deleteSavedSearchOnAccount,
  fetchSavedSearches,
  moveBrowserSavedSearches,
  saveSearchOnAccount,
  savedQueryToSearch,
  savedSearchQueryKey,
} from '#/lib/search'
import type { SavedSearchFacets } from '#/lib/search'
import { t } from '#/copy'

/**
 * Saved searches for the results page. A saved search is the page's URL under
 * a name, kept on the person's account for the workspace, so it follows them to
 * another machine. Searches an earlier version kept in this browser move onto
 * the account the first time the list loads.
 */
export function SavedSearches({
  workspaceId,
  current,
  onApply,
}: {
  workspaceId: string
  /** The search the page is showing now; saving stores this. */
  current: { q: string } & SavedSearchFacets
  onApply: (search: { q: string } & SavedSearchFacets) => void
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
  const save = useMutation({
    mutationFn: (saveName: string) =>
      saveSearchOnAccount(notebookDataClient, saveName, current),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteSavedSearchOnAccount(notebookDataClient, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const canSave = current.q.trim().length > 0

  const commit = () => {
    if (!name.trim()) return
    save.mutate(name, {
      onSuccess: () => {
        setName('')
        setNaming(false)
      },
    })
  }

  return (
    <section
      aria-label={t('projects.savedSearches.title')}
      className="flex flex-col gap-1.5 border-t border-border-subtle pt-3"
    >
      <div className="flex items-center justify-between px-1.5">
        <h2 className="text-label font-medium text-fg-muted">
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
              }}
            >
              {t('common.actions.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
      {save.isError || remove.isError ? (
        <p role="alert" className="m-0 px-1.5 text-label text-danger-text">
          {t('projects.savedSearches.failed')}
        </p>
      ) : null}
      {list.isError ? (
        <p role="alert" className="m-0 px-1.5 text-label text-danger-text">
          {t('projects.savedSearches.loadFailed')}
        </p>
      ) : saved.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {saved.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onApply(savedQueryToSearch(s))}
                className="min-w-0 flex-1 cursor-pointer truncate rounded-md border-0 bg-transparent px-1.5 py-1 text-left font-[inherit] text-body text-link hover:bg-surface-hover"
                title={s.query}
              >
                {s.name}
              </button>
              <Button
                size="sm"
                variant="quiet"
                aria-label={t('projects.savedSearches.deleteLabel', {
                  name: s.name,
                })}
                onClick={() => remove.mutate(s.id)}
              >
                {t('common.actions.delete')}
              </Button>
            </li>
          ))}
        </ul>
      ) : list.isPending ? null : (
        <p className="m-0 px-1.5 text-label text-fg-muted">
          {t('projects.savedSearches.empty')}
        </p>
      )}
    </section>
  )
}
