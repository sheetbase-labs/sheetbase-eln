/**
 * The report's readiness inspector: whether it can be generated, what needs
 * attention, who owns it, and the status moves it offers. Split from the route
 * so the screen's own component stays about the page around it.
 */
import { ObjectLink } from '#/components/ui/object-link'
import { Button } from '#/components/ui/button'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { formatDate } from '#/lib/format-date'
import { reportStatus } from '#/lib/reports'
import type { ReportDetail, ReportStatus } from '#/lib/reports'
import { t } from '#/copy'

/** How the report's sections stand: ready, stale, or with no source left. */
export interface ReadinessCounts {
  valid: number
  stale: number
  missing: number
}

/** The next steps a report offers, as the status they lead to. */
function nextStatuses(status: ReportStatus): ReportStatus[] {
  switch (status) {
    case 'draft':
      return ['in_review']
    case 'in_review':
      return ['approved', 'draft']
    case 'approved':
    case 'published':
      return ['draft']
    default:
      return ['draft']
  }
}

const statusAction: Record<ReportStatus, string> = {
  draft: t('projects.reports.builder.reopen'),
  in_review: t('projects.reports.builder.sendForReview'),
  approved: t('projects.reports.builder.approve'),
  published: t('projects.reports.builder.approve'),
  archived: t('projects.reports.builder.archive'),
}

export function ReportReadinessPanel({
  report,
  readiness,
  ready,
  userLabel,
  checking,
  changing,
  onCheck,
  onChangeStatus,
}: {
  report: ReportDetail
  readiness: ReadinessCounts
  ready: boolean
  userLabel: (id: string) => string
  checking: boolean
  changing: boolean
  onCheck: () => void
  onChangeStatus: (status: ReportStatus) => void
}) {
  const status = reportStatus(report.status)
  const attention = readiness.stale + readiness.missing
  const locked = report.lockedAt !== null

  return (
    <Inspector
      aria-label={t('projects.reports.builder.readiness')}
      className="w-[320px] gap-0 p-0 max-lg:hidden"
    >
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <InspectorSection title={t('projects.reports.builder.readiness')}>
          <Status tone={ready ? 'ok' : 'warn'}>
            {ready
              ? t('projects.reports.builder.readyTitle')
              : t('projects.reports.builder.notReadyTitle')}
          </Status>
          <p className="text-label text-fg-muted">
            {t('projects.reports.builder.readyCount', {
              valid: report.sections.length - attention,
              sections: report.sections.length,
            })}
          </p>
          {readiness.stale > 0 ? (
            <p className="text-label">
              {t('projects.reports.builder.staleCount', {
                n: readiness.stale,
              })}
            </p>
          ) : null}
          {readiness.missing > 0 ? (
            <p className="text-label">
              {t('projects.reports.builder.missingCount', {
                n: readiness.missing,
              })}
            </p>
          ) : null}
          <Button
            disabled={checking || report.sections.length === 0}
            onClick={onCheck}
          >
            {checking
              ? t('projects.reports.builder.checking')
              : t('projects.reports.builder.check')}
          </Button>
        </InspectorSection>
        <InspectorSection title={t('projects.reports.builder.details')}>
          <DescriptionList
            labelWidth={90}
            items={[
              [t('projects.reports.builder.status'), status.label],
              [
                t('projects.reports.builder.project'),
                report.projectTitle ? (
                  <ObjectLink kind="project" id={report.projectId} mono={false}>
                    {report.projectTitle}
                  </ObjectLink>
                ) : (
                  '—'
                ),
              ],
              [
                t('projects.reports.builder.owner'),
                userLabel(report.createdByUserId),
              ],
              [
                t('projects.reports.builder.created'),
                formatDate(report.createdAt),
              ],
              [
                t('projects.reports.builder.updated'),
                formatDate(report.updatedAt),
              ],
              [t('projects.reports.builder.version'), report.version],
            ]}
          />
        </InspectorSection>
        {!locked ? (
          <InspectorSection title={t('projects.reports.builder.status')}>
            <div className="flex flex-wrap gap-2">
              {nextStatuses(report.status).map((next) => (
                <Button
                  key={next}
                  disabled={changing}
                  onClick={() => onChangeStatus(next)}
                >
                  {statusAction[next]}
                </Button>
              ))}
            </div>
          </InspectorSection>
        ) : null}
      </div>
    </Inspector>
  )
}
