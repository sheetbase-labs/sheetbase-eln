import { Outlet, createFileRoute } from '@tanstack/react-router'

import { SectionTabs } from './-section-tabs'
import { t } from '#/copy'

/** The Review tab: everything about the experiment being checked. What was
 * submitted, who signed it, what changed and each saved version. */
export const Route = createFileRoute('/experiments/$expId/review')({
  component: ReviewTab,
})

function ReviewTab() {
  const params = Route.useParams()

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SectionTabs
        label={t('projects.experimentPage.reviewSections')}
        items={[
          {
            label: t('projects.experimentPage.section.submissions'),
            link: { to: '/experiments/$expId/review/submissions', params },
          },
          {
            label: t('projects.experimentPage.section.signatures'),
            link: { to: '/experiments/$expId/review/signatures', params },
          },
          {
            label: t('projects.experimentPage.section.history'),
            link: { to: '/experiments/$expId/review/history', params },
          },
          {
            label: t('projects.experimentPage.section.revisions'),
            link: { to: '/experiments/$expId/review/revisions', params },
          },
        ]}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
