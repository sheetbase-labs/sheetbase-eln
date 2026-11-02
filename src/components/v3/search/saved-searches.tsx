import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { useSavedSearches } from '#/components/v3/search/use-saved-searches'
import { savedQueryToSearch } from '#/lib/search'
import type { SavedSearchFacets } from '#/lib/search'
import { t } from '#/copy'

/** How many of the newest searches the popover lists; the page holds the rest. */
const RECENT = 5

/**
 * The results page's quick access to saved searches: save what the page shows,
 * jump back to one of the latest, or open the full list. A saved search is the
 * page's URL under a name, private to the person who saved it unless they share
 * it with the workspace. Managing them (rename, share, delete) happens on the
 * saved searches page, which stays readable at any number of searches.
 */
export function SavedSearches({
  workspaceId,
  current,
  onApply,
  userId,
  role,
}: {
  workspaceId: string
  /** The search the page is showing now; saving stores this. */
  current: { q: string } & SavedSearchFacets
  onApply: (search: { q: string } & SavedSearchFacets) => void
  userId?: string
  role?: string | null
}) {
  const { list, saved, save, failureText, canShare } = useSavedSearches({
    workspaceId,
    userId,
    role,
  })
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [shareNew, setShareNew] = useState(false)
  const canSave = current.q.trim().length > 0 || Boolean(current.filter)

  const commit = () => {
    if (!name.trim()) return
    save.mutate(
      { name, search: current, shared: shareNew },
      {
        onSuccess: () => {
          setName('')
          setShareNew(false)
          setNaming(false)
        },
      },
    )
  }

  return (
    <section
      aria-label={t('projects.savedSearches.title')}
      className="flex flex-col gap-2"
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
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {saved.slice(0, RECENT).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onApply(savedQueryToSearch(s))}
                  className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left font-[inherit] text-body hover:bg-surface-hover"
                  title={s.query}
                >
                  <span className="min-w-0 truncate text-link">{s.name}</span>
                  {s.visibility === 'workspace' ? (
                    <span className="shrink-0 text-label text-fg-muted">
                      {t('projects.savedSearches.sharedTag')}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <Link to="/saved-searches" className="px-1.5 text-body font-medium">
            {t('projects.savedSearches.viewAll', { count: saved.length })}
          </Link>
        </>
      ) : (
        <p className="m-0 px-1.5 text-label text-fg-muted">
          {t('projects.savedSearches.empty')}
        </p>
      )}
    </section>
  )
}
