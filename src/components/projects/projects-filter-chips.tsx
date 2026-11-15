import { Chip } from '#/components/ui/chip'
import { rich, t } from '#/copy'

import type { ProjectsSearch } from './projects-page-model'

/**
 * The filters the person has set, each as a chip that removes itself, naming the
 * value the toolbar's count cannot.
 */
export function ProjectsFilterChips({
  search,
  setSearch,
}: {
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 md:px-6">
      {search.stage ? (
        <Chip
          variant="remove"
          removeLabel={t('projects.projectsPage.filters.removeStage', {
            value: search.stage,
          })}
          onRemove={() => setSearch({ stage: undefined })}
        >
          {rich('projects.projectsPage.filters.chipStage', {
            value: search.stage,
            b: (text) => <b className="font-medium">{text}</b>,
          })}
        </Chip>
      ) : null}
      {(['client', 'modality'] as const).map((field) =>
        search[field] ? (
          <Chip
            variant="remove"
            key={field}
            removeLabel={t(`projects.projectsPage.filters.remove.${field}`, {
              value: search[field],
            })}
            onRemove={() => setSearch({ [field]: undefined })}
          >
            {rich(`projects.projectsPage.filters.chip.${field}`, {
              value: search[field],
              b: (text) => <b className="font-medium">{text}</b>,
            })}
          </Chip>
        ) : null,
      )}
    </div>
  )
}
