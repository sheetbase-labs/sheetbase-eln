import { useState } from 'react'

import { usePageAi } from '#/lib/use-page-ai'
import { parseSearchAnswer, searchInstruction } from '#/lib/ai-search-filters'
import { countConditions, encodeFilter } from '#/lib/search-filter'
import type { useSearchFields } from '#/components/search/use-search-fields'
import { t } from '#/copy'

import type { SearchPageSearch } from './-search-page-model'

/** What the assistant's last filter run has to say. */
export type SearchAiState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; count: number; skipped: string[] }
  | { phase: 'failed'; message: string }

/**
 * Plain English in, editable filters out: the assistant proposes a filter tree
 * for the words typed and the builder opens on what it understood.
 */
export function useSearchAi({
  draft,
  setDraft,
  filterFields,
  setSearch,
  onOpenBuilder,
}: {
  draft: string
  setDraft: (value: string) => void
  filterFields: ReturnType<typeof useSearchFields>
  setSearch: (patch: Partial<SearchPageSearch>) => void
  onOpenBuilder: () => void
}) {
  const ai = usePageAi()
  const [state, setState] = useState<SearchAiState>({ phase: 'idle' })

  const ask = async () => {
    setState({ phase: 'running' })

    const result = await ai.run({
      task: 'search_filters',
      instruction: searchInstruction(
        draft,
        filterFields,
        new Date().toISOString().slice(0, 10),
      ),
    })

    const proposal =
      result.status === 'ok'
        ? await parseSearchAnswer(result.text, filterFields)
        : null

    if (!proposal || (!proposal.filter && !proposal.q)) {
      setState({
        phase: 'failed',
        message:
          result.status === 'ok'
            ? t('projects.searchAi.noFilters')
            : result.message,
      })

      return
    }

    setDraft(proposal.q)
    setSearch({
      q: proposal.q || undefined,
      filter: proposal.filter ? encodeFilter(proposal.filter) : undefined,
    })

    if (proposal.filter) onOpenBuilder()
    setState({
      phase: 'done',
      count: proposal.filter ? countConditions(proposal.filter) : 0,
      skipped: proposal.skipped,
    })
  }

  return { ai, state, ask }
}
