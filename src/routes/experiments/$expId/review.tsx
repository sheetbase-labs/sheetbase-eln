import {
  Outlet,
  createFileRoute,
  useParams,
  useSearch,
} from '@tanstack/react-router'

import { SectionTabs } from './-section-tabs'
import { t } from '#/copy'

/** The Review tab: everything about the experiment being checked. What was
 * submitted, who signed it, what changed and each saved version. */
export const Route = createFileRoute('/experiments/$expId/review')({
  component: ReviewTab,
})

function ReviewTab() {
  const params = Route.useParams()
  const { revisionId } = useParams({ strict: false })
  const rawView = useSearch({ strict: false }).view
  const view = rawView === 'comments' || rawView === 'checks' ? rawView : 'diff'

  // Reading one submission puts its panels in the same strip, so the tab has
  // one row of sections and not two.
  const submissionPanels = revisionId
    ? (['diff', 'comments', 'checks'] as const).map((panel) => ({
        key: panel,
        label: t(`projects.revisionPage.tabs.${panel}`),
        link: {
          to: '/experiments/$expId/review/$revisionId' as const,
          params: { ...params, revisionId },
          search: { view: panel },
        },
      }))
    : []

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SectionTabs
        label={t('projects.experimentPage.reviewSections')}
        value={revisionId ? view : undefined}
        items={[
          {
            key: 'submissions',
            label: t('projects.experimentPage.section.submissions'),
            link: { to: '/experiments/$expId/review/submissions', params },
          },
          ...submissionPanels,
          {
            key: 'signatures',
            label: t('projects.experimentPage.section.signatures'),
            link: { to: '/experiments/$expId/review/signatures', params },
          },
          {
            key: 'history',
            label: t('projects.experimentPage.section.history'),
            link: { to: '/experiments/$expId/review/history', params },
          },
          {
            key: 'versions',
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
