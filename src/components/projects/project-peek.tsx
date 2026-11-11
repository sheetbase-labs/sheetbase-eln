/**
 * The projects list's side panel: the selected project's details, its latest
 * experiments and what changed lately, without leaving the list. Reads only.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import { DescriptionList } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { experimentStatus } from '#/components/experiments/experiments-data'
import { t } from '#/copy'
import { describeAuditEvent } from '#/lib/audit-history'
import { formatDate, formatRelativeTime } from '#/lib/notebook-data'

import {
  fetchProjectActivity,
  fetchProjectMembers,
  useProjectMilestones,
} from './project-data'
import { useProjectExperimentsPage } from './project-lists'
import type { ProjectRow } from './types'

const SHOWN_EXPERIMENTS = 4
const SHOWN_MEMBERS = 3

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="m-0 text-label font-medium text-fg-muted">{children}</h3>
  )
}

/** The first few member names, then how many more there are. */
function membersText(names: readonly string[], fallback: string): string {
  if (!names.length) return fallback
  const more = names.length - SHOWN_MEMBERS

  return (
    names.slice(0, SHOWN_MEMBERS).join(', ') + (more > 0 ? ` +${more}` : '')
  )
}

function PeekHeader({
  project,
  onClose,
}: {
  project: ProjectRow
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle px-4 py-3">
      <div className="flex items-center">
        <ObjectLink
          kind="project"
          id={project.uuid}
          identifier={project.id}
          className="text-label"
        />
        <Button
          className="ml-auto"
          variant="quiet"
          icon="x"
          aria-label={t('projects.projectsPage.peek.close')}
          onClick={onClose}
        />
      </div>
      <h2 className="m-0 text-[15px] leading-5 font-semibold">
        {project.name}
      </h2>
      <div className="flex items-center">
        <Status tone={project.status.tone}>{project.status.label}</Status>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.uuid }}
          className="ml-auto text-label text-link"
        >
          {t('projects.projectsPage.peek.open')}
        </Link>
      </div>
    </div>
  )
}

function PeekDetails({ project }: { project: ProjectRow }) {
  const milestones = useProjectMilestones(project.uuid)

  const members = useQuery({
    queryKey: ['project-members', project.uuid],
    queryFn: () => fetchProjectMembers(project.uuid),
    staleTime: 60_000,
  })

  const next = milestones.data?.find(
    (m) => m.kind === 'milestone' && m.status !== 'done',
  )

  const milestone = next
    ? `${next.name}${next.dueAt ? ` · ${formatDate(next.dueAt)}` : ''}`
    : '—'

  return (
    <section className="flex flex-col gap-2">
      <Heading>{t('projects.projectsPage.peek.details')}</Heading>
      <DescriptionList
        labelWidth={84}
        items={[
          [t('projects.projectOverview.details.client'), project.client],
          [t('projects.projectOverview.details.modality'), project.modality],
          [t('projects.projectOverview.details.stage'), project.stage],
          [t('projects.projectOverview.details.lead'), project.lead],
          [
            t('projects.projectOverview.details.members'),
            membersText(
              (members.data ?? []).map((m) => m.name),
              project.memberSummary ?? '—',
            ),
          ],
          [
            t('projects.projectOverview.details.started'),
            project.started ? formatDate(project.started) : '—',
          ],
          [t('projects.projectsPage.peek.milestone'), milestone],
        ]}
      />
    </section>
  )
}

function PeekExperiments({ project }: { project: ProjectRow }) {
  const experiments = useProjectExperimentsPage(project.uuid, 0)
  const rows = experiments.data?.rows.slice(0, SHOWN_EXPERIMENTS) ?? []

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <Heading>{t('projects.projectsPage.peek.experiments')}</Heading>
        <span className="num text-label text-fg-muted">
          {experiments.data?.total ?? project.experiments}
        </span>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.uuid }}
          className="ml-auto text-label text-link"
        >
          {t('projects.projectsPage.peek.all')}
        </Link>
      </div>
      <div className="flex flex-col gap-1.5 text-label">
        {rows.map((e) => {
          const status = experimentStatus(e.status)

          return (
            <div key={e.id} className="flex items-baseline gap-2">
              <ObjectLink
                kind="experiment"
                id={e.id}
                identifier={e.identifier}
              />
              <span className="min-w-0 flex-1">{e.title}</span>
              <Status tone={status.tone}>{status.label}</Status>
            </div>
          )
        })}
        {!rows.length && !experiments.isPending ? (
          <span className="text-fg-muted">
            {t('projects.projectsPage.peek.noExperiments')}
          </span>
        ) : null}
      </div>
    </section>
  )
}

function PeekActivity({ project }: { project: ProjectRow }) {
  const activity = useQuery({
    queryKey: ['project-activity', project.uuid],
    queryFn: () => fetchProjectActivity(project.uuid),
    staleTime: 30_000,
  })

  return (
    <section className="flex flex-col gap-2">
      <Heading>{t('projects.projectOverview.activity.title')}</Heading>
      <div className="flex flex-col gap-2 text-label">
        {(activity.data ?? []).map((event) => {
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
        {!activity.data?.length ? (
          <span className="text-fg-muted">
            {activity.isPending
              ? t('projects.projectOverview.activity.loading')
              : t('projects.projectOverview.activity.empty')}
          </span>
        ) : null}
      </div>
    </section>
  )
}

export function ProjectPeek({
  project,
  onClose,
}: {
  project: ProjectRow
  onClose: () => void
}) {
  return (
    <aside
      aria-label={t('projects.projectsPage.peek.label')}
      className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface md:flex"
    >
      <PeekHeader project={project} onClose={onClose} />
      <div className="flex flex-col gap-5 px-4 py-3.5">
        <PeekDetails project={project} />
        <PeekExperiments project={project} />
        <PeekActivity project={project} />
      </div>
    </aside>
  )
}
