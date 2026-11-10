import { createFileRoute, redirect } from '@tanstack/react-router'

import { useState } from 'react'

import { PluginWidgets } from '#/components/extensions/plugin-widgets'
import { LabSetupDialog } from '#/components/setup/lab-setup-dialog'
import { HomeQuiet } from '#/components/home/home-quiet'
import { signInRedirect } from '#/lib/sign-in-redirect'

import { useHomeModel, useLabSetupPrompt } from './-home-model'
import {
  HomeBriefButton,
  HomeBusySections,
  HomeFirstRunSections,
  HomeHeader,
  HomeInspectorFirstRun,
  HomeInspectorToday,
  HomeLoading,
  HomeUnavailable,
} from './-home-parts'

/** UI port (roadmap-4/ui-app3): Home, matching the reference — a status chip
 * row, Awaiting your review, Continue working, and an inspector with Today,
 * Needs attention and Recent activity — all on real data. When the user has no
 * personal recents yet, Home shows the first-run setup state instead. */
/** What Home reads from the URL: whether the first-run setup asked to open. */
interface HomeSearch {
  setup?: true
}

export const Route = createFileRoute('/')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; the two accepted spellings are compared directly and nothing else is read.
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    setup: search.setup === true || search.setup === '1' ? true : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    // A client viewer has no Home: the portal is their whole product, so they
    // land there instead of on a workspace page they cannot use.
    if (context.workspace?.role === 'client_viewer') {
      throw redirect({ to: '/client-portal' })
    }

    return { context }
  },
  component: Home,
})

export function Home() {
  const { context, shellCounts } = Route.useRouteContext()
  const { setup: forceSetup } = Route.useSearch()
  const [briefOpen, setBriefOpen] = useState(false)

  const model = useHomeModel({ context, shellCounts, briefOpen })

  const setup = useLabSetupPrompt({
    workspaceId: model.workspaceId,
    role: context.workspace?.role,
    forceSetup,
    workspaceQuery: model.workspaceQuery,
    skippedQuery: model.skippedQuery,
  })

  if (model.pageFailed) return <HomeUnavailable onRetry={model.retryAll} />

  if (model.homeQueries.some((query) => query.isPending)) return <HomeLoading />

  const header = (
    <HomeHeader
      showFirstRun={model.showFirstRun}
      today={model.today}
      workspaceName={model.headerWorkspaceName}
      joinedToday={model.joinedToday}
      openNotebookId={model.openNotebookId}
      briefButton={
        <HomeBriefButton
          open={briefOpen}
          onOpenChange={setBriefOpen}
          ready={model.briefReady}
          input={model.briefInput}
        />
      }
      unavailable={model.unavailable}
      onRetryUnavailable={model.retryUnavailable}
    />
  )

  if (model.calm) {
    return (
      <HomeQuiet
        header={header}
        pace={model.pace === 'quiet' ? 'quiet' : 'near-quiet'}
        waiting={model.readWork.waiting}
        comingUp={model.comingUp}
        pickUp={model.readWork.pickUp}
        continueWorking={model.readWork.continueWorking}
        projects={model.approvals}
        todayBookings={model.readWork.todayBookings}
        freeInstruments={model.instrumentsFree}
        activity={model.readWork.activity}
        userId={model.userId}
        timeZone={model.timeZone}
      />
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {setup.open ? (
        <LabSetupDialog
          workspaceId={model.workspaceId!}
          workspaceName={context.workspace?.name ?? ''}
          currentTimeZone={model.workspaceQuery.data?.timezone}
          ownEmail={context.user.email}
          onClose={setup.close}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto max-md:pb-20">
        {header}
        {model.showFirstRun ? (
          <HomeFirstRunSections
            workspaceId={model.workspaceId}
            workspaceName={model.headerWorkspaceName}
            userId={model.userId}
            email={context.user.email}
            role={model.onboarding?.workspace_role}
            setupSteps={model.setupSteps}
            progress={model.progress}
          />
        ) : (
          <HomeBusySections
            todayBookings={model.readWork.todayBookings}
            timeZone={model.timeZone}
            bookingsFailed={model.sectionFailed(model.bookingsQuery)}
            onRetryBookings={model.retrySection(model.bookingsQuery)}
            counts={model.counts}
            inboxCount={model.inboxCount}
            reviewsSettledEmpty={model.readWork.reviewsSettledEmpty}
            reviews={model.readWork.reviews}
            reviewsFailed={model.sectionFailed(
              model.reviewsQuery,
              model.seenQuery,
            )}
            onRetryReviews={model.retrySection(
              model.reviewsQuery,
              model.seenQuery,
            )}
            recents={model.recents}
          />
        )}
        <PluginWidgets />
      </div>

      {model.showFirstRun ? (
        <HomeInspectorFirstRun
          projects={model.projects}
          role={model.onboarding?.workspace_role}
          people={model.peopleQuery.data ?? []}
        />
      ) : (
        <HomeInspectorToday
          todayBookings={model.readWork.todayBookings}
          timeZone={model.timeZone}
          bookingsFailed={model.sectionFailed(model.bookingsQuery)}
          onRetryBookings={model.retrySection(model.bookingsQuery)}
          datasetIssues={model.readWork.datasetIssues}
          materials={model.readWork.materials}
          attentionFailed={model.sectionFailed(
            model.datasetIssuesQuery,
            model.materialsQuery,
            model.seenQuery,
          )}
          onRetryAttention={model.retrySection(
            model.datasetIssuesQuery,
            model.materialsQuery,
            model.seenQuery,
          )}
          activity={model.readWork.activity}
          activityFailed={model.sectionFailed(model.activityQuery)}
          onRetryActivity={model.retrySection(model.activityQuery)}
          userId={model.userId}
        />
      )}
    </div>
  )
}
