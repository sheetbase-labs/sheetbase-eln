import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { useQuery } from '@tanstack/react-query'

import { PublishControl } from '#/components/open-data/publish-control'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { PageHeader } from '#/components/ui/layout'
import { Tabs } from '#/components/ui/tabs'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { experimentStatus } from '#/components/experiments/experiments-data'
import { experimentNextStep } from '#/components/experiments/next-step'
import { ReviewerBand } from '#/components/experiments/reviewer-band'
import { SeriesBar } from '#/components/experiments/series-bar'
import { useIsSeriesHead } from '#/lib/experiment-series'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { useRecordParts } from '#/components/notebook/use-record-parts'
import { daysSinceStart, lastDayOffset } from '#/lib/experiment-parts'
import {
  fetchNotebookReviewContext,
  notebookReviewRevisionId,
} from '#/lib/notebook-experience'
import {
  fetchProject,
  formatDate,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { rich, t } from '#/copy'
import { useReportFrozen } from '#/components/workspace/workspace-navigation'
import { hasCapability } from '#/lib/capability'
import { RecordTitleInput } from '../records/$recordId/-notebook-page'
import { ExperimentLifecycleActions } from './$expId/-lifecycle-actions'
import { RecordActionsProvider } from '#/components/notebook/record-actions'

/** The experiment page: one frame, one URL. Notebook is the default tab and the
 * working surface; Summary, Samples, Data and Review sit beside it. `/records/$recordId/notebook` redirects here for experiments. */
export const Route = createFileRoute('/experiments/$expId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    await resolveIdentifierParam({
      entity: 'experiment',
      ref: params.expId,
      href: location.href,
    })

    return { context }
  },
  component: ExperimentLayout,
})

export interface RecordLinkWire {
  id: string
  target_kind: string
  target_identifier: string
  target_record_id: string | null
  link_type: string
  /** The part of the experiment it was made in; none for an experiment without parts. */
  part_id?: string | null
  created_at: string
}

export const experimentQueryKeys = {
  record: (recordId: string) => ['ui-port', 'experiment', recordId] as const,
  links: (recordId: string) =>
    ['ui-port', 'experiment-links', recordId] as const,
  revisions: (recordId: string) =>
    ['ui-port', 'experiment-revisions', recordId] as const,
}

export function useExperimentRecord(recordId: string) {
  return useQuery({
    queryKey: experimentQueryKeys.record(recordId),
    queryFn: () =>
      notebookDataClient
        .list<{
          id: string
          workspace_id: string
          identifier: string
          title: string
          status: string
          project_id: string | null
          tags: string[] | null
          locked_at: string | null
          archived_at: string | null
          created_by_user_id: string
          reviewer_user_id: string | null
          planned_end: string | null
          created_at: string
          updated_at: string
        }>(
          'records',
          `?id=eq.${recordId}&kind=eq.experiment&limit=1&select=id,workspace_id,identifier,title,status,project_id,tags,locked_at,archived_at,created_by_user_id,reviewer_user_id,planned_end,created_at,updated_at`,
        )
        .then((rows) => rows[0] ?? null),
  })
}

export function useExperimentLinks(recordId: string) {
  return useQuery({
    queryKey: experimentQueryKeys.links(recordId),
    queryFn: () =>
      notebookDataClient.list<RecordLinkWire>(
        'record_links',
        `?source_record_id=eq.${recordId}&select=id,target_kind,target_identifier,target_record_id,link_type,part_id,created_at&order=created_at.desc`,
      ),
  })
}

export function experimentStatusFor(status: string): {
  tone: Tone
  label: string
} {
  return experimentStatus(status)
}

function ExperimentLayout() {
  const { expId } = Route.useParams()
  const { context } = Route.useRouteContext()
  // A viewer reads the record; the buttons that change it are not theirs.
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const record = useExperimentRecord(expId)
  const links = useExperimentLinks(expId)
  const seriesHead = useIsSeriesHead(expId)
  const partsQuery = useRecordParts(expId)
  const e = record.data

  const { userLabel } = useUserNames(
    [e?.created_by_user_id, e?.reviewer_user_id].filter((id): id is string =>
      Boolean(id),
    ),
  )

  const { regulated } = useRegulatedLab(e?.workspace_id)

  // The same read the notebook makes, so it is one request: the submitted
  // version a reviewer decides on, and who it was sent to.
  const review = useQuery({
    queryKey: notebookQueryKeys.review(expId),
    queryFn: () => fetchNotebookReviewContext(notebookDataClient, expId),
    enabled: e?.status === 'in_review',
  })

  const userId = context.user.id

  const assigned =
    e?.reviewer_user_id === userId ||
    Boolean(
      review.data?.submission?.assigned_reviewer_user_ids.includes(userId),
    )

  const nextStep = experimentNextStep({
    status: e?.status ?? '',
    locked: Boolean(e?.locked_at),
    archived: Boolean(e?.archived_at),
    canWrite,
    regulated,
    isReviewer: assigned && e?.created_by_user_id !== userId,
  })

  const reviewRevisionId = notebookReviewRevisionId({
    lockedByRevisionId: null,
    review: review.data,
  })

  // The pane header says why the notebook is read-only: the reviewer reads
  // the submitted version, and an approved record is locked.
  useReportFrozen(
    nextStep.reviewing
      ? 'review'
      : e?.locked_at
        ? e.status === 'approved'
          ? 'approved'
          : true
        : false,
  )

  const project = useQuery({
    queryKey: ['ui-port', 'experiment-project', e?.project_id ?? ''],
    queryFn: () =>
      e?.project_id
        ? fetchProject(notebookDataClient, e.project_id)
        : Promise.resolve(null),
    enabled: Boolean(e?.project_id),
  })

  if (!e) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('projects.experimentPage.experiments'),
              link: { to: '/experiments' },
            },
          ]}
          title={
            record.isLoading
              ? t('projects.experimentPage.loading')
              : t('projects.experimentPage.notFound')
          }
        />
        <RecordUnavailable
          query={record}
          what={t('settings.uiKit.recordUnavailable.experiment')}
          back={{
            to: '/experiments',
            label: t('settings.uiKit.recordUnavailable.backToExperiments'),
          }}
        />
      </div>
    )
  }

  const rows = links.data ?? []
  const params = { expId: e.id }

  const protocolLink = rows.find(
    (l) => l.link_type === 'protocol' && l.target_record_id,
  )

  const kindCount = (kind: string) =>
    rows.filter((l) => l.target_kind === kind).length

  const status = experimentStatusFor(e.status)
  // "Day 3 of 10" while an experiment with parts is running: how far along the
  // calendar it is, out of the day of its last part.
  const lastDay = lastDayOffset(partsQuery.data ?? [])

  const runningDay =
    lastDay != null &&
    lastDay > 0 &&
    (e.status === 'in_progress' || e.status === 'returned')
      ? t('notebook.parts.dayOfTotal', {
          day: String(Math.min(daysSinceStart(e.created_at), lastDay)),
          total: String(lastDay),
        })
      : null

  return (
    <RecordActionsProvider
      reviewing={nextStep.reviewing}
      submitVariant={nextStep.primary === 'submit' ? 'primary' : 'secondary'}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          compact
          trail={[
            ...(e.project_id
              ? [
                  {
                    label:
                      project.data?.title ??
                      t('projects.experimentPage.project'),
                    link: {
                      to: '/projects/$projectId' as const,
                      params: { projectId: e.project_id },
                    },
                  },
                ]
              : []),
            {
              label: t('projects.experimentPage.experiments'),
              link: { to: '/experiments' },
            },
            { label: e.identifier, mono: true },
          ]}
          title={
            e.locked_at || e.archived_at ? (
              e.title
            ) : (
              <RecordTitleInput
                recordId={e.id}
                title={e.title}
                tags={e.tags ?? []}
                className="h-auto w-full min-w-0 border-transparent bg-transparent px-0 text-title shadow-none max-md:!h-6 max-md:overflow-hidden max-md:whitespace-nowrap max-md:text-[18px] max-md:leading-6 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]"
              />
            )
          }
          meta={
            <>
              <span className="text-fg">
                <Status tone={status.tone}>{status.label}</Status>
              </span>
              <span className="max-md:hidden">
                {t('projects.experimentPage.owner', {
                  name: userLabel(e.created_by_user_id),
                })}
              </span>
              {e.reviewer_user_id ? (
                <span className="max-md:hidden">
                  {t('projects.experimentPage.reviewer', {
                    name:
                      e.reviewer_user_id === userId
                        ? t('projects.experimentPage.you')
                        : userLabel(e.reviewer_user_id),
                  })}
                </span>
              ) : null}
              <span className="max-lg:hidden">
                {e.status === 'draft' || e.status === 'planned'
                  ? t('projects.experimentPage.notStarted')
                  : t('projects.experimentPage.started', {
                      date: formatDate(e.created_at),
                    })}
              </span>
              {protocolLink ? (
                <span className="max-lg:hidden">
                  {rich('projects.experimentPage.protocol', {
                    link: (
                      <Link
                        to="/protocols/$protocolId"
                        params={{
                          protocolId: protocolLink.target_record_id ?? '',
                        }}
                        className="mono text-link"
                      >
                        {protocolLink.target_identifier}
                      </Link>
                    ),
                  })}
                </span>
              ) : null}
              {runningDay ? <span>{runningDay}</span> : null}
              {e.planned_end ? (
                <span>
                  {t('projects.experimentPage.due', {
                    date: formatDate(e.planned_end),
                  })}
                </span>
              ) : null}
            </>
          }
          actions={
            <>
              <ExperimentLifecycleActions
                experiment={e}
                canWrite={canWrite}
                nextStep={nextStep}
                reviewRevisionId={reviewRevisionId}
              />
              <PublishControl
                workspaceId={context.workspace?.id ?? ''}
                kind="experiment"
                objectId={e.id}
                defaultTitle={e.title}
                canPublish={canWrite}
              />
              <AskAiButton />
            </>
          }
          tabs={
            <div className="flex flex-col gap-1.5">
              <SeriesBar recordId={e.id} placement="header" />
              <Tabs
                mode="url"
                label={t('projects.experimentPage.sections')}
                items={[
                  {
                    label: t('projects.experimentPage.tabs.notebook'),
                    link: { to: '/experiments/$expId/notebook', params },
                  },
                  ...(seriesHead.data
                    ? [
                        {
                          label: t('projects.experimentPage.tabs.series'),
                          link: {
                            to: '/experiments/$expId/series' as const,
                            params,
                          },
                        },
                      ]
                    : []),
                  // A series parent shows its Series tab where Summary would
                  // be, so the row keeps five tabs and fits a phone.
                  ...(seriesHead.data
                    ? []
                    : [
                        {
                          label: t('projects.experimentPage.tabs.summary'),
                          link: {
                            to: '/experiments/$expId/summary' as const,
                            params,
                          },
                        },
                      ]),
                  {
                    label: t('projects.experimentPage.tabs.samples'),
                    count: (
                      <span className="max-md:hidden">
                        {kindCount('sample')}
                      </span>
                    ),
                    link: { to: '/experiments/$expId/samples', params },
                  },
                  {
                    label: t('projects.experimentPage.tabs.data'),
                    count: (
                      <span className="max-md:hidden">
                        {kindCount('dataset') + kindCount('file')}
                      </span>
                    ),
                    link: { to: '/experiments/$expId/data', params },
                  },
                  {
                    label: t('projects.experimentPage.tabs.review'),
                    link: { to: '/experiments/$expId/review', params },
                  },
                ]}
              />
            </div>
          }
        />
        {nextStep.reviewing ? (
          <ReviewerBand
            ownerName={userLabel(e.created_by_user_id)}
            submittedAt={review.data?.submission?.submitted_at}
            revisionId={reviewRevisionId}
          />
        ) : null}
        <div className="flex min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
    </RecordActionsProvider>
  )
}
