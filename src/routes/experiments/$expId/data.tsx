import { Outlet, createFileRoute } from '@tanstack/react-router'

import { SectionTabs } from './-section-tabs'
import { t } from '#/copy'

/** The Data tab: what the experiment produced. Datasets, results, files and
 * the records it is linked to, one section each. */
export const Route = createFileRoute('/experiments/$expId/data')({
  component: DataTab,
})

function DataTab() {
  const params = Route.useParams()
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SectionTabs
        label={t('projects.experimentPage.dataSections')}
        items={[
          {
            label: t('projects.experimentPage.section.datasets'),
            link: { to: '/experiments/$expId/data/datasets', params },
          },
          {
            label: t('projects.experimentPage.section.results'),
            link: { to: '/experiments/$expId/data/results', params },
          },
          {
            label: t('projects.experimentPage.section.files'),
            link: { to: '/experiments/$expId/data/files', params },
          },
          {
            label: t('projects.experimentPage.section.links'),
            link: { to: '/experiments/$expId/data/links', params },
          },
        ]}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
