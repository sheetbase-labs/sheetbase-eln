/**
 * The report page's header: what it is, the two things a person can do with it
 * from here, its status line and its tabs. Split from the route so the page
 * keeps the body and the inspector.
 */
import { Link } from '@tanstack/react-router'

import { ObjectLink } from '#/components/ui/object-link'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { PageHeader } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { FollowToggle } from '#/components/follow/follow-toggle'
import { reportStatus } from '#/lib/reports'
import type { ReportDetail } from '#/lib/reports'
import { t } from '#/copy'

import { REPORT_TABS } from './-report-tabs'
import type { ReportTab } from './-report-tabs'

export function ReportHeader({
  report,
  tab,
  ready,
  generating,
  onShare,
  onGenerate,
}: {
  report: ReportDetail
  tab: ReportTab
  ready: boolean
  generating: boolean
  onShare: () => void
  onGenerate: () => void
}) {
  const status = reportStatus(report.status)

  return (
    <PageHeader
      trail={[
        {
          label: t('projects.reports.builder.back'),
          link: { to: '/reports' },
        },
        { label: report.identifier, mono: true },
      ]}
      title={report.title}
      actions={
        <>
          <FavouriteToggle kind="record" objectId={report.recordId} />
          <FollowToggle kind="record" objectId={report.recordId} />
          <Button icon="share" onClick={onShare}>
            {t('projects.reports.builder.shareWithClient')}
          </Button>
          <Button
            variant="primary"
            disabled={generating || report.sections.length === 0 || !ready}
            onClick={onGenerate}
          >
            {generating
              ? t('projects.reports.builder.generating')
              : t('projects.reports.builder.generate')}
          </Button>
        </>
      }
      meta={
        <>
          <span className="text-fg">
            <Status tone={status.tone}>{status.label}</Status>
          </span>
          {report.subtitle ? <span>{report.subtitle}</span> : null}
          {report.projectTitle ? (
            <ObjectLink kind="project" id={report.projectId} mono={false}>
              {report.projectTitle}
            </ObjectLink>
          ) : null}
        </>
      }
      tabs={
        <Tabs
          mode="url"
          label={t('projects.reports.builder.tabsLabel')}
          value={tab}
          items={REPORT_TABS.map((key) => ({
            key,
            label: t(`projects.reports.builder.tabs.${key}`),
            count: key === 'build' ? report.sections.length : undefined,
            link: {
              search: { section: key === 'build' ? undefined : key },
            },
          }))}
        />
      }
    />
  )
}

/** The report when there is none yet: still loading, unreadable, or absent. */
export function ReportMissing({
  loading,
  failed,
}: {
  loading: boolean
  failed: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('projects.reports.builder.back'),
            link: { to: '/reports' },
          },
        ]}
        title={
          loading
            ? t('common.states.loading')
            : t('projects.reports.builder.notFound')
        }
      />
      {loading ? null : (
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="report"
            title={
              failed
                ? t('projects.reports.builder.loadFailed')
                : t('projects.reports.builder.notFound')
            }
            description={t('projects.reports.builder.notFoundBody')}
            action={
              <Button nativeButton={false} render={<Link to="/reports" />}>
                {t('projects.reports.builder.back')}
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}
