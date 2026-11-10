import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { t } from '#/copy'

import { stages } from './options'
import type { ArchivedMode, ProjectsSearch } from './projects-page-model'
import type { ProjectRow } from './types'

/**
 * The filter menu: whether archived projects are listed, and the stage, client
 * and modality to narrow to. The button says how many filters are on, so a
 * hidden row is never unexplained.
 */
export function ProjectsFilterMenu({
  archived,
  filterCount,
  projects,
  search,
  setSearch,
}: {
  archived: ArchivedMode
  filterCount: number
  projects: readonly ProjectRow[]
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            className={filterCount ? 'text-link hover:text-link' : ''}
          />
        }
      >
        {filterCount
          ? t('projects.projectsPage.filterCount', { count: filterCount })
          : t('common.actions.filter')}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[260px]">
        <DropdownMenuItem
          icon={archived === 'exclude' ? 'check' : undefined}
          className={archived === 'exclude' ? '' : 'pl-[30px]'}
          onClick={() =>
            setSearch({
              archived: archived === 'exclude' ? 'include' : 'exclude',
            })
          }
        >
          {t('projects.projectsPage.filters.statusNotArchived')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('projects.projectsPage.filters.stageIs')}
          </DropdownMenuLabel>
          {stages.map((s) => (
            <DropdownMenuItem
              key={s}
              icon={search.stage === s ? 'check' : undefined}
              className={search.stage === s ? '' : 'pl-[30px]'}
              onClick={() =>
                setSearch({ stage: search.stage === s ? undefined : s })
              }
            >
              {s}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {(['client', 'modality'] as const).map((field) => (
          <DropdownMenuGroup key={field}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {field === 'client'
                ? t('projects.projectsPage.filters.clientIs')
                : t('projects.projectsPage.filters.modalityIs')}
            </DropdownMenuLabel>
            {[...new Set(projects.map((project) => project[field]))]
              .sort()
              .map((value) => (
                <DropdownMenuItem
                  key={value}
                  icon={search[field] === value ? 'check' : undefined}
                  onClick={() =>
                    setSearch({
                      [field]: search[field] === value ? undefined : value,
                    })
                  }
                >
                  {value}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
