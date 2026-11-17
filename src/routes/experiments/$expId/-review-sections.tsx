import { SectionTabs } from './-section-tabs'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'

/**
 * The strip under an experiment's Review tab. On the list pages it links the
 * sections (Submissions, Signatures, History, Versions); once a submission is
 * open it shows that submission's own panels, Diff, Comments and Checks, as a
 * plain underline strip.
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

  if (revisionId) {
    return (
      <div className="px-4 pt-3 md:px-8">
        <Tabs
          mode="url"
          label={t('projects.revisionPage.panels')}
          value={view ?? 'diff'}
          items={(['diff', 'comments', 'checks'] as const).map((panel) => ({
            key: panel,
            label: t(`projects.revisionPage.tabs.${panel}`),
            link: {
              to: '/experiments/$expId/review/$revisionId' as const,
              params: { expId, revisionId },
              search: { view: panel },
            },
          }))}
        />
      </div>
    )
  }

  return (
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
  )
}
