import { Button } from '#/components/ui/button'
import { copyText } from '#/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Icon } from '#/components/icons'
import { ListToolbar } from '#/components/inventory/list'
import { GroupMenu, SortMenu } from '#/components/inventory/list-arrange'
import type { ListFilter } from '#/components/inventory/list-filter'
import { t } from '#/copy'

import { projectColumnKeys, sortLabel, sorts } from './projects-page-model'
import type {
  ArchivedMode,
  ProjectsSearch,
  ProjectsSort,
} from './projects-page-model'

const groups = ['stage', 'lead'] as const

/**
 * The list's controls: sort, filter, group, the search box, which columns are
 * shown, and the overflow menu, laid out by the shared `ListToolbar` so the
 * search box matches every other list. Everything writes straight to the URL's
 * search state.
 */
export function ProjectsToolbar({
  sort,
  group,
  hidden,
  filter,
  archived,
  search,
  setSearch,
}: {
  sort: ProjectsSort
  group: 'none' | 'stage' | 'lead'
  hidden: ReadonlySet<string>
  filter: ListFilter
  archived: ArchivedMode
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
}) {
  return (
    <ListToolbar
      q={search.q}
      label={t('projects.projectsPage.search')}
      placeholder={t('projects.projectsPage.search')}
      filter={filter}
      onSearch={(q) => setSearch({ q: q.trim() || undefined })}
      right={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="quiet" className="max-lg:hidden" />}
            >
              {t('projects.projectsPage.fields')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {t('projects.projectsPage.showColumns')}
                </DropdownMenuLabel>
                {projectColumnKeys.map((k) => (
                  <DropdownMenuItem
                    key={k}
                    closeOnClick={false}
                    icon={hidden.has(k) ? undefined : 'check'}
                    className={hidden.has(k) ? 'pl-[30px]' : ''}
                    onClick={() => {
                      const next = new Set(hidden)

                      if (next.has(k)) next.delete(k)
                      else next.add(k)
                      setSearch({
                        fields: [...next].sort().join(',') || undefined,
                      })
                    }}
                  >
                    {t(`projects.projectsPage.columns.${k}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  className="max-md:hidden"
                  aria-label={t('projects.projectsPage.moreOptions')}
                />
              }
            >
              <Icon name="more" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuItem
                closeOnClick={false}
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
              <DropdownMenuItem
                icon="copy"
                onClick={() =>
                  void copyText(window.location.href, {
                    copiedMessage: t('projects.projectsPage.linkCopied'),
                    failedMessage: t('projects.projectsPage.linkCopyFailed'),
                  })
                }
              >
                {t('projects.projectsPage.copyLink')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <SortMenu
        options={sorts.map((k) => ({ value: k, label: sortLabel(k) }))}
        value={sort}
        onChange={(next) =>
          setSearch({ sort: sorts.find((k) => k === next) ?? 'updated' })
        }
      />
      <GroupMenu
        options={groups.map((g) => ({
          value: g,
          label: t(`projects.projectsPage.group.${g}`),
        }))}
        value={group === 'none' ? undefined : group}
        onChange={(next) =>
          setSearch({ group: groups.find((g) => g === next) ?? 'none' })
        }
      />
    </ListToolbar>
  )
}
