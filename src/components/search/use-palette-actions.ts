import { useNavigate } from '@tanstack/react-router'
import { requestOpenBeside } from '#/components/workspace/workspace-navigation'
import { encodeFilter } from '#/lib/search-filter'
import { searchActionHref, searchResultNewTabUrl } from '#/lib/search'
import type {
  DidYouMeanSuggestion,
  SavedSearchFacets,
  SearchContextAction,
  SearchResult,
} from '#/lib/search'
import type { PaletteCommand } from './palette-commands'
import type { usePaletteSearch } from './use-palette-search'

/** Palette destinations share the router, new-tab and linked-pane handoffs. */
export function usePaletteActions({
  q,
  typed,
  archived,
  close,
}: Pick<ReturnType<typeof usePaletteSearch>, 'q' | 'typed' | 'archived'> & {
  close: () => void
}) {
  const navigate = useNavigate()

  const runCommand = (command: PaletteCommand, newTab = false) => {
    if (newTab) {
      window.open(
        searchResultNewTabUrl(
          searchActionHref({
            id: command.id,
            label: command.label,
            to: command.to,
            search: command.search,
          }),
          window.location.origin,
        ),
        '_blank',
        'noopener,noreferrer',
      )

      return
    }

    close()
    void navigate({ to: command.to, search: command.search })
  }

  const go = (
    result: SearchResult,
    newTab = false,
    beside = false,
    below = false,
  ) => {
    if (beside) {
      close()
      requestOpenBeside(result.deepLink, result.title, below)

      return
    }

    if (newTab) {
      window.open(
        searchResultNewTabUrl(result.deepLink, window.location.origin),
        '_blank',
        'noopener,noreferrer',
      )

      return
    }

    close()

    // Attached-file hits must preserve the block search/hash in their href.
    if (result.matchedBlockId) void navigate({ href: result.deepLink })
    else void navigate({ to: result.deepLink })
  }

  const runAction = (action: SearchContextAction, newTab = false) => {
    if (newTab) {
      window.open(
        searchResultNewTabUrl(searchActionHref(action), window.location.origin),
        '_blank',
        'noopener,noreferrer',
      )

      return
    }

    close()
    void navigate({ to: action.to, search: action.search })
  }

  const seeAll = (opts?: { builder?: boolean }) => {
    close()
    const words = typed ? typed.q : q.trim()

    const search: Pick<SavedSearchFacets, 'filter' | 'archived'> & {
      q?: string
      builder?: boolean
    } = {}

    if (words) search.q = words

    if (typed?.filter) search.filter = encodeFilter(typed.filter)

    if (archived) search.archived = true

    if (opts?.builder) search.builder = true

    void navigate({ to: '/search', search })
  }

  const acceptSuggestion = (suggestion: DidYouMeanSuggestion) => {
    close()
    void navigate({
      to: '/records/$recordId',
      params: { recordId: suggestion.identifier },
    })
  }

  return { runCommand, go, runAction, seeAll, acceptSuggestion }
}
