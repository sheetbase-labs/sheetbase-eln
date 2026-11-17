import { SectionTabs } from './-section-tabs'
import { t } from '#/copy'

/**
 * The sections of an experiment's Review tab in one strip. Reading a single
 * submission adds that submission's own panels (Diff, Comments, Checks) to the
 * same strip, so the tab never has two rows of sections.
 */
export function ReviewSections({
  expId,
  revisionId,
  view,
}: {
  expId: string
  /** The submitted version being read, when one is open. */
  revisionId?: string
  view?: 'diff' | 'comments' | 'checks'
}) {
  const params = { expId }

  const panels = revisionId
    ? (['diff', 'comments', 'checks'] as const).map((panel) => ({
        key: panel,
        label: t(`projects.revisionPage.tabs.${panel}`),
        link: {
          to: '/experiments/$expId/review/$revisionId' as const,
          params: { expId, revisionId },
          search: { view: panel },
        },
      }))
    : []

  return (
    <SectionTabs
      label={t('projects.experimentPage.reviewSections')}
      value={revisionId ? (view ?? 'diff') : undefined}
      items={[
        {
          key: 'submissions',
          label: t('projects.experimentPage.section.submissions'),
          link: { to: '/experiments/$expId/review/submissions', params },
        },
        ...panels,
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
  )
}
