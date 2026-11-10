import { useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Tabs } from '#/components/ui/tabs'
import { ListHeader } from '#/components/inventory/list'
import { SavedSearches } from '#/components/search/saved-searches'
import { SEARCH_RESULT_GROUPS, searchResultGroupLabel } from '#/lib/search'
import type { SearchResultGroup } from '#/lib/search'
import { t } from '#/copy'

import type { SearchPageSearch } from './-search-page-model'

/** The page's title, count, subtitle, saved searches and type tabs. */
export function SearchHeader({
  active,
  q,
  matchCount,
  morePending,
  shownCount,
  typeFilterCount,
  saved,
  typeTabs,
}: {
  active: boolean
  q: string
  matchCount: number
  morePending: boolean
  shownCount: number
  typeFilterCount: number
  saved: React.ReactNode
  typeTabs: React.ReactNode
}) {
  return (
    <ListHeader
      title={
        !active
          ? t('projects.searchPage.title')
          : q
            ? t('projects.searchPage.results', { query: q })
            : t('projects.searchFilter.browseTitle')
      }
      total={active && !morePending ? matchCount : undefined}
      subtitle={
        active && morePending && !typeFilterCount
          ? t('projects.searchPage.shownOfTotal', {
              shown: shownCount,
              total: matchCount,
            })
          : undefined
      }
      actions={saved}
      tabs={typeTabs}
    />
  )
}

/** Saved searches, opened from the header the way a list's views are. */
export function SavedSearchesPopover({
  workspaceId,
  userId,
  role,
  q,
  search,
}: {
  workspaceId: string
  userId: string
  role: string
  q: string
  search: SearchPageSearch
}) {
  const navigate = useNavigate()

  return (
    <Popover>
      <PopoverTrigger render={<Button />}>
        {t('projects.savedSearches.title')}
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-3">
        <SavedSearches
          workspaceId={workspaceId}
          userId={userId}
          role={role}
          current={{
            q,
            type: search.type,
            project: search.project,
            updated: search.updated === '7d' ? '7d' : undefined,
            owner: search.owner,
            from: search.from,
            to: search.to,
            archived: search.archived,
            filter: search.filter,
            sort: search.sort,
          }}
          onApply={(next) =>
            void navigate({
              to: '/search',
              search: next,
            })
          }
        />
      </PopoverContent>
    </Popover>
  )
}

/** The type tabs: one kind at a time, with how many of each the search found. */
export function SearchTypeTabs({
  search,
  facets,
  matchCount,
  activeType,
  partial,
}: {
  search: SearchPageSearch
  facets: { types: Map<SearchResultGroup, number> }
  matchCount: number
  activeType: string | undefined
  partial: (count: number) => string
}) {
  return (
    <Tabs
      mode="url"
      value={activeType ?? 'all'}
      label={t('projects.searchPage.type')}
      items={[
        {
          key: 'all',
          label: t('projects.searchPage.all'),
          count: String(matchCount),
          link: { to: '/search', search: { ...search, type: undefined } },
        },
        ...SEARCH_RESULT_GROUPS.filter(
          (g) => facets.types.get(g) || g === activeType,
        ).map((g) => ({
          key: g,
          label: searchResultGroupLabel(g),
          count: partial(facets.types.get(g) ?? 0),
          link: {
            to: '/search' as const,
            search: { ...search, type: [g] },
          },
        })),
      ]}
    />
  )
}
