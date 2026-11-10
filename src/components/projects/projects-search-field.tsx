import { Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import { t } from '#/copy'

import { useSearchDraft } from './use-project-search-draft'

/**
 * The projects search box. Enter applies the term; clearing the box clears the
 * search at once rather than leaving a stale term filtering the list. The draft
 * follows the applied query, so Back returns the box to the term it names.
 */
export function ProjectsSearchField({
  appliedQ,
  onSearch,
}: {
  appliedQ: string | undefined
  onSearch: (q: string | undefined) => void
}) {
  const [draft, setDraft] = useSearchDraft(appliedQ)

  return (
    <form
      role="search"
      className="relative order-first min-w-0 flex-1 lg:order-none lg:ml-3 lg:w-[280px] lg:flex-none"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(draft.trim() || undefined)
      }}
    >
      <label htmlFor="project-search" className="sr-only">
        {t('projects.projectsPage.search')}
      </label>
      <Icon
        name="search"
        size={14}
        className="pointer-events-none absolute left-[9px] top-[8px] text-fg-muted"
      />
      <Input
        id="project-search"
        type="search"
        placeholder={t('projects.projectsPage.search')}
        value={draft}
        className="h-7 pl-7 max-lg:h-9"
        onChange={(e) => {
          setDraft(e.target.value)

          if (!e.target.value) onSearch(undefined)
        }}
      />
    </form>
  )
}
