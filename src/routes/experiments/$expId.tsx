import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { TitleSkeleton } from '#/components/ui/page-skeleton'
import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '#/components/ui/layout'
import { experimentNextStep } from '#/components/experiments/next-step'
import { SeriesBar } from '#/components/experiments/series-bar'
import { RecordPage } from '#/components/record-page/record-page'
import { useIsSeriesHead } from '#/lib/experiment-series'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { useRecordParts } from '#/components/notebook/use-record-parts'
import {
  fetchNotebookReviewContext,
  notebookReviewRevisionId,
} from '#/lib/notebook-experience'
import {
  fetchProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { useReportFrozen } from '#/components/workspace/workspace-navigation'
import { hasCapability } from '#/lib/capability'
import { RecordActionsProvider } from '#/components/notebook/record-actions'

import {
  experimentFrozenReason,
  experimentRunningDay,
  experimentStatusFor,
  useExperimentLinks,
  useExperimentPlateRunCount,
  useExperimentRecord,
} from './-experiment-data'
import {
  ExperimentActions,
  ExperimentStateLine,
  ExperimentTitle,
} from './-experiment-header'
import {
  experimentFacts,
  experimentTabs,
  experimentTrail,
} from './-experiment-facts'

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

/**
 * Re-exported from `-experiment-data.ts`, which owns the experiment row's reads
 * and query keys, so the experiment tabs that import them from this route keep
 * working.
 */
export type { RecordLinkWire } from './-experiment-data'

export {
  experimentQueryKeys,
  experimentStatusFor,
  useExperimentLinks,
  useExperimentRecord,
} from './-experiment-data'

function ExperimentLayout() {
  const { expId } = Route.useParams()
  const { context } = Route.useRouteContext()
  // A viewer reads the record; the buttons that change it are not theirs.
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const record = useExperimentRecord(expId)
  const links = useExperimentLinks(expId)
  const seriesHead = useIsSeriesHead(expId)
  const partsQuery = useRecordParts(expId)

  const plateRunCount = useExperimentPlateRunCount(expId)

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
    experimentFrozenReason({
      reviewing: nextStep.reviewing,
      status: e?.status,
      lockedAt: e?.locked_at,
    }),
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
            record.isLoading ? (
              <TitleSkeleton label={t('projects.experimentPage.loading')} />
            ) : (
              t('projects.experimentPage.notFound')
            )
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

  const protocolLink = rows.find(
    (l) => l.link_type === 'protocol' && l.target_record_id,
  )

  const reviewerName = e.reviewer_user_id ? userLabel(e.reviewer_user_id) : null

  const waitingNames = (
    review.data?.submission?.assigned_reviewer_user_ids ?? []
  )
    .filter((id) => id !== userId)
    .map((id) => userLabel(id))

  const runningDay = experimentRunningDay({
    status: e.status,
    startedAt: e.created_at,
    parts: partsQuery.data ?? [],
  })

  return (
    <RecordActionsProvider
      reviewing={nextStep.reviewing}
      submitVariant={nextStep.primary === 'submit' ? 'primary' : 'secondary'}
    >
      <RecordPage
        recordId={e.id}
        compact
        fill
        trail={experimentTrail(e, project.data?.title)}
        title={<ExperimentTitle experiment={e} />}
        paneTitle={e.title}
        identifier={e.identifier}
        status={experimentStatusFor(e.status)}
        facts={experimentFacts({
          experiment: e,
          ownerName: userLabel(e.created_by_user_id),
          reviewerName,
          viewerId: userId,
          protocolLink,
        })}
        marks={runningDay ? <span>{runningDay}</span> : null}
        actionsOwnMenu
        actions={
          <ExperimentActions
            experiment={e}
            canWrite={canWrite}
            nextStep={nextStep}
            reviewRevisionId={reviewRevisionId}
            workspaceId={context.workspace?.id ?? ''}
          />
        }
        stateLine={
          <ExperimentStateLine
            reviewing={nextStep.reviewing}
            inReview={e.status === 'in_review'}
            ownerName={userLabel(e.created_by_user_id)}
            submittedAt={review.data?.submission?.submitted_at}
            revisionId={reviewRevisionId}
            waitingNames={waitingNames}
          />
        }
        aboveTabs={<SeriesBar recordId={e.id} placement="header" />}
        tabs={experimentTabs({
          expId: e.id,
          seriesHead: Boolean(seriesHead.data),
          links: rows,
          plateRunCount,
        })}
      >
        <Outlet />
      </RecordPage>
    </RecordActionsProvider>
  )
}
