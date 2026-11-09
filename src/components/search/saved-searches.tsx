import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { useSavedSearches } from '#/components/search/use-saved-searches'
import { now } from '#/lib/clock'
import { formatListDate } from '#/lib/list-date'
import { recentSavedSearches, savedQueryToSearch } from '#/lib/search'
import type { SavedSearchFacets } from '#/lib/search'
import { t } from '#/copy'

/** How many searches the popover lists; the page holds the rest. */
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
  const { list, saved, save, failureText, canShare, markUsed } =
    useSavedSearches({
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
      className="-m-3 flex flex-col"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="m-0 text-body font-semibold text-fg">
          {t('projects.savedSearches.title')}
        </h2>
        {canSave && !naming ? (
          <Button size="sm" onClick={() => setNaming(true)}>
            <Icon name="plus" size={12} />
            {t('projects.savedSearches.saveThis')}
          </Button>
        ) : null}
      </div>
      {naming ? (
        <form
          className="flex flex-col gap-2 border-b border-border-subtle bg-surface-hover/40 px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
        >
          <label className="flex flex-col gap-1 text-label font-medium text-fg-muted">
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
          <div className="flex justify-end gap-1.5">
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
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!name.trim() || save.isPending}
            >
              {t('common.actions.save')}
            </Button>
          </div>
        </form>
      ) : null}
      {failureText ? (
        <p role="alert" className="m-0 px-3 py-2 text-label text-danger-text">
          {failureText}
        </p>
      ) : null}
      {list.isError ? (
        <p role="alert" className="m-0 px-3 py-2 text-label text-danger-text">
          {t('projects.savedSearches.loadFailed')}
        </p>
      ) : list.isPending ? null : saved.length ? (
        <>
          <div className="px-3 pb-1 pt-2.5 text-label font-medium text-fg-muted">
            {t('projects.savedSearches.recent')}
          </div>
          <ul className="m-0 flex list-none flex-col p-1 pt-0">
            {recentSavedSearches(saved, RECENT).map((s) => {
              const shared = s.visibility === 'workspace'

              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      markUsed(s)
                      onApply(savedQueryToSearch(s))
                    }}
                    className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left font-[inherit] hover:bg-surface-hover"
                    title={s.query}
                  >
                    <Icon
                      name={shared ? 'share' : 'lock'}
                      size={14}
                      className="shrink-0 text-fg-muted"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-fg">
                        {s.name}
                      </span>
                      <span className="block truncate text-label text-fg-muted">
                        {shared
                          ? t('projects.savedSearches.visibilityShared')
                          : t('projects.savedSearches.visibilityPrivate')}
                      </span>
                    </span>
                    <span className="shrink-0 text-label text-fg-muted">
                      {s.lastUsed
                        ? formatListDate(
                            new Date(s.lastUsed).toISOString(),
                            now(),
                          )
                        : t('projects.savedSearches.neverUsed')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <Link
            to="/saved-searches"
            className="flex items-center justify-between border-t border-border-subtle px-3 py-2 text-body font-medium"
          >
            {t('projects.savedSearches.viewAll', { count: saved.length })}
            <Icon name="chevronRight" size={12} />
          </Link>
        </>
      ) : (
        <p className="m-0 px-3 py-3 text-label text-fg-muted">
          {t('projects.savedSearches.empty')}
        </p>
      )}
    </section>
  )
}
