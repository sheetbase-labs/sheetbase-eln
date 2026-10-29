import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import {
  deleteSavedQuery,
  loadSavedQueries,
  saveCurrentSearch,
  savedQueryToSearch,
} from '#/lib/search'
import type { SavedQuery, SavedSearchFacets } from '#/lib/search'
import { t } from '#/copy'

/**
 * Saved searches for the results page. A saved search is the page's URL under
 * a name, kept per workspace in this browser: it is a convenience for getting
 * back to a query, not shared state, and the copy says so.
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
  const [saved, setSaved] = useState<SavedQuery[]>(() =>
    loadSavedQueries(workspaceId),
  )
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const canSave = current.q.trim().length > 0

  const commit = () => {
    if (!name.trim()) return
    setSaved(saveCurrentSearch(workspaceId, name, current))
    setName('')
    setNaming(false)
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
              disabled={!name.trim()}
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
      {saved.length ? (
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
                onClick={() => setSaved(deleteSavedQuery(workspaceId, s.id))}
              >
                {t('common.actions.delete')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 px-1.5 text-label text-fg-muted">
          {t('projects.savedSearches.empty')}
        </p>
      )}
    </section>
  )
}
