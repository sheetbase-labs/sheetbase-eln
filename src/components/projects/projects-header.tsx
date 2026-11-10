import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Tabs } from '#/components/ui/tabs'
import { Icon } from '#/components/icons'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

import { tabLabel, tabs } from './projects-page-model'
import type { ProjectsSearch, ProjectsTab } from './projects-page-model'

/**
 * The screen's title row and its view strip. The count is stated only when the
 * read has resolved — a number here would be asserted as fact while the page
 * does not know it — and the New project button says why it cannot be used
 * rather than being disabled with no reason (QA2-projects-1).
 *
 * The wide strip carries every tab. Narrow screens get three tabs and a More
 * menu, because all the tabs plus that menu are wider than the column at 400 %
 * zoom, and a row with no way to scroll put More past the viewport
 * (QA4-zoom-projects).
 */
export function ProjectsHeader({
  hasProjects,
  count,
  loading,
  error,
  canCreate,
  createDisabledReason,
  onNew,
  onTab,
  tab,
  counts,
  search,
}: {
  hasProjects: boolean
  count: number
  loading: boolean
  error: string | null
  canCreate: boolean
  createDisabledReason: string | null
  onNew: () => void
  onTab: (tab: ProjectsTab) => void
  tab: ProjectsTab
  counts: Map<ProjectsTab, number>
  search: ProjectsSearch
}) {
  const linkFor = (tabKey: ProjectsTab) => ({
    to: '/projects' as const,
    search: { ...search, tab: tabKey === 'all' ? undefined : tabKey },
  })

  return (
    <header
      className={cn(
        'flex flex-col gap-1 border-b border-border bg-surface px-4 pt-4 md:px-6',
        !hasProjects && 'pb-3',
      )}
    >
      <div className="flex max-md:flex-wrap items-center gap-2">
        <h1 className="text-title">{t('projects.projectsPage.title')}</h1>
        {/* A number here would be asserted as fact. While the read is
            unresolved — stalled or failed — the page does not know it. */}
        {loading || error ? null : (
          <span className="num text-body text-fg-muted">{count}</span>
        )}
        <span className="flex-1" />
        <Button
          variant="primary"
          disabled={!canCreate || loading}
          title={createDisabledReason ?? undefined}
          onClick={onNew}
        >
          {t('projects.projectsPage.newProject')}
        </Button>
      </div>
      {hasProjects ? (
        <>
          <Tabs
            mode="url"
            value={tab}
            className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 max-lg:hidden"
            label={t('projects.projectsPage.views')}
            items={tabs.map((tabKey) => ({
              key: tabKey,
              label: tabLabel(tabKey),
              count: counts.get(tabKey) ?? 0,
              link: linkFor(tabKey),
            }))}
          />
          {/* Three tabs plus the "More" menu are wider than the column at
              400 % zoom, and the row had no way to scroll, so "More" sat
              past the viewport (QA4-zoom-projects). */}
          <div className="flex flex-wrap items-center gap-5 lg:hidden">
            <Tabs
              mode="url"
              value={tab}
              label={t('projects.projectsPage.views')}
              items={tabs.slice(0, 3).map((tabKey) => ({
                key: tabKey,
                label: tabLabel(tabKey),
                count: counts.get(tabKey) ?? 0,
                link: linkFor(tabKey),
              }))}
            />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="quiet" />}>
                {t('common.actions.more')} <Icon name="chevronDown" size={12} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {tabs.slice(3).map((tabKey) => (
                  <DropdownMenuItem key={tabKey} onClick={() => onTab(tabKey)}>
                    {tabLabel(tabKey)} {counts.get(tabKey) ?? 0}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ) : null}
    </header>
  )
}
