import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { cn } from '#/lib/utils'
import { rich, t } from '#/copy'

/** The miss state: why nothing matched, did-you-mean, and how to widen the search. */
export function NoResults({
  q,
  archived,
  filtered,
  suggestions,
  onArchivedChange,
  onClear,
}: {
  q: string
  archived: boolean
  filtered: boolean
  suggestions: { kind: string; identifier: string; title: string }[]
  onArchivedChange: (on: boolean) => void
  onClear: () => void
}) {
  return (
    <div role="status" className="mt-6 flex max-w-[560px] flex-col gap-2.5">
      <div className="flex items-center gap-2 font-semibold">
        <Icon name="search" size={14} className="text-fg-muted" />
        {t('projects.searchPage.noMatch', { query: q })}
      </div>
      <p className="m-0 text-body leading-[19px] text-fg-muted">
        {filtered
          ? t('projects.searchPage.noMatchFiltered')
          : t('projects.searchPage.noMatchBody')}
      </p>
      {suggestions.length ? (
        <p className="m-0 text-body">
          {rich('projects.searchPage.didYouMean', {
            list: suggestions.map((s, i) => (
              <span key={s.identifier}>
                {i > 0 ? ', ' : ''}
                <Link
                  to="/search"
                  search={{ q: s.identifier }}
                  className={cn('font-medium')}
                >
                  {s.identifier}
                </Link>
                <span className="text-fg-muted"> {s.title}</span>
              </span>
            )),
          })}
        </p>
      ) : null}
      {filtered ? (
        <div>
          <Button onClick={onClear}>
            {t('projects.searchPage.clearFilters')}
          </Button>
        </div>
      ) : null}
      <p className="m-0 text-label text-fg-muted">
        {archived ? (
          <>
            {t('projects.searchPage.archivedSearched', { query: q })}{' '}
            <button
              type="button"
              onClick={() => onArchivedChange(false)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              {t('projects.searchPalette.activeOnly')}
            </button>
          </>
        ) : (
          <>
            {t('projects.searchPage.archivedNotSearched')}{' '}
            <button
              type="button"
              onClick={() => onArchivedChange(true)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              {t('projects.searchPalette.includeArchived')}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
