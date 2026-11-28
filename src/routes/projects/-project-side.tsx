/**
 * The project's side panel on its Overview: the fields the header does not
 * say, the fields a model adds, how review is going and what happened lately.
 */
import { useQuery } from '@tanstack/react-query'

import { AddedFields } from '#/components/models/added-fields'
import {
  fetchProjectActivity,
  fetchProjectMembers,
} from '#/components/projects/project-data'
import type { ProjectSummary } from '#/components/projects/project-data'
import { RecordProperties } from '#/components/record-page/record-side-panel'
import { InspectorSection } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { LoadingBlock } from '#/components/ui/page-skeleton'
import { describeAuditEvent } from '#/lib/audit-history'
import {
  fetchRecordsForProject,
  formatDate,
  formatRelativeTime,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { rich, t } from '#/copy'

export function ProjectSidePanel({ project }: { project: ProjectSummary }) {
  const records = useQuery({
    queryKey: notebookQueryKeys.records(project.id),
    queryFn: () => fetchRecordsForProject(notebookDataClient, project.id),
  })

  const members = useQuery({
    queryKey: ['project-members', project.id],
    queryFn: () => fetchProjectMembers(project.id),
    staleTime: 60_000,
  })

  const activity = useQuery({
    queryKey: ['project-activity', project.id],
    queryFn: () => fetchProjectActivity(project.id),
    staleTime: 30_000,
  })

  return (
    <>
      <RecordProperties
        items={[
          {
            label: t('projects.projectOverview.details.members'),
            value: memberSummary(members.data ?? []),
            wrap: true,
          },
          {
            label: t('projects.projectOverview.details.started'),
            value: project.startedOn ? formatDate(project.startedOn) : null,
          },
          {
            label: t('projects.projectOverview.details.agreement'),
            value: project.agreementReference,
            mono: true,
          },
        ]}
      />
      <AddedFields modelKey="project" objectId={project.id} labelWidth={104} />
      <OverviewReview records={records.data ?? []} />
      <OverviewActivity
        activity={activity.data ?? []}
        loading={activity.isLoading}
      />
    </>
  )
}

/** The first three members by name, then how many more. */
function memberSummary(
  members: Awaited<ReturnType<typeof fetchProjectMembers>>,
): string | null {
  if (!members.length) return null

  const names = members
    .slice(0, 3)
    .map((member) => member.name)
    .join(', ')

  return members.length > 3 ? `${names} +${members.length - 3}` : names
}

function OverviewReview({
  records,
}: {
  records: Awaited<ReturnType<typeof fetchRecordsForProject>>
}) {
  const allExperiments = records.filter(
    (record) => record.kind === 'experiment' && !record.archivedAt,
  )

  const inReview = allExperiments.filter(
    (record) => record.status === 'in_review',
  )

  const approved = allExperiments.filter(
    (record) => record.status === 'approved',
  )

  // With no experiments the overview already says so; "0 of 0 approved"
  // would only say it again.
  if (allExperiments.length === 0) return null

  return (
    <InspectorSection title={t('projects.projectOverview.review.title')}>
      <div className="flex flex-col gap-1 text-label">
        <span>
          {t('projects.projectOverview.review.approved', {
            approved: approved.length,
            count: allExperiments.length,
          })}
        </span>
        {inReview.length ? (
          <span>
            {rich('projects.projectOverview.review.awaiting', {
              waiting: inReview.length,
              links: inReview.slice(0, 3).map((record, index) => (
                <span key={record.id}>
                  {index ? ', ' : ''}
                  <ObjectLink
                    kind="experiment"
                    id={record.id}
                    identifier={record.identifier}
                  />
                </span>
              )),
            })}
          </span>
        ) : (
          <span className="text-fg-muted">
            {t('projects.projectOverview.review.nothing')}
          </span>
        )}
      </div>
    </InspectorSection>
  )
}

function OverviewActivity({
  activity,
  loading,
}: {
  activity: Awaited<ReturnType<typeof fetchProjectActivity>>
  loading: boolean
}) {
  return (
    <InspectorSection title={t('projects.projectOverview.activity.title')}>
      <div className="flex flex-col gap-2 text-label">
        {activity.map((event) => {
          const description = describeAuditEvent(event)

          return (
            <div key={event.id} className="flex gap-2 break-words">
              <time
                className="shrink-0 text-fg-muted"
                dateTime={event.createdAt}
                title={formatDate(event.createdAt)}
              >
                {formatRelativeTime(event.createdAt)}
              </time>
              <span>
                {t('projects.projectOverview.activity.line', {
                  actor:
                    event.currentActorName ??
                    t('projects.projectOverview.activity.system'),
                  action: description.action,
                  subject: event.currentRecord
                    ? `${event.currentRecord.identifier} · ${event.currentRecord.title}`
                    : description.subject,
                })}
              </span>
            </div>
          )
        })}
        {!activity.length ? (
          loading ? (
            <LoadingBlock
              label={t('projects.projectOverview.activity.loading')}
            />
          ) : (
            <span className="text-fg-muted">
              {t('projects.projectOverview.activity.empty')}
            </span>
          )
        ) : null}
      </div>
    </InspectorSection>
  )
}
