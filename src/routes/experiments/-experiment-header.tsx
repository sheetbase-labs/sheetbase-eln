import { Link } from '@tanstack/react-router'

import { PublishControl } from '#/components/open-data/publish-control'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { Person } from '#/components/ui/person'
import type { NextStep } from '#/components/experiments/next-step'
import { RecordLockedLine } from '#/components/record-page/record-locked-line'
import { RecordStateLine } from '#/components/record-page/record-state-line'
import { formatDate } from '#/lib/notebook-data'
import { RecordTitleInput } from '../records/$recordId/-notebook-page'
import { ExperimentLifecycleActions } from './$expId/-lifecycle-actions'
import type { ExperimentRecordRow } from './-experiment-data'
import { t } from '#/copy'

/**
 * The experiment page's header parts for the shared record page: the inline
 * title, the lifecycle and publish actions, and the one line about a review.
 * The facts and tabs are data, in `-experiment-facts.tsx`.
 */
export function ExperimentTitle({
  experiment: e,
}: {
  experiment: ExperimentRecordRow
}) {
  if (e.locked_at || e.archived_at) return e.title

  return (
    <RecordTitleInput
      recordId={e.id}
      title={e.title}
      tags={e.tags ?? []}
      className="h-auto w-full min-w-0 border-transparent bg-transparent px-0 text-title shadow-none max-md:!h-6 max-md:overflow-hidden max-md:whitespace-nowrap max-md:text-[18px] max-md:leading-6 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]"
    />
  )
}

/** The person a fact names, with their face. */
export function ExperimentPerson({
  name,
  userId,
  you = false,
}: {
  name: string
  userId: string | null | undefined
  /** The reader themself: the face stays theirs and the name reads "You". */
  you?: boolean
}) {
  return <Person name={name} userId={userId} you={you} className="text-fg" />
}

/** The protocol the experiment runs on, by its identifier. */
export function ExperimentProtocolLink({
  recordId,
  identifier,
}: {
  recordId: string
  identifier: string
}) {
  return (
    <Link
      to="/protocols/$protocolId"
      params={{ protocolId: recordId }}
      className="mono text-link"
    >
      {identifier}
    </Link>
  )
}

/**
 * The next step (or the decision pair for a reviewer) with the lifecycle's
 * own ⋯ menu, then publishing and the assistant.
 */
export function ExperimentActions({
  experiment,
  canWrite,
  nextStep,
  reviewRevisionId,
  workspaceId,
}: {
  experiment: ExperimentRecordRow
  canWrite: boolean
  nextStep: NextStep
  reviewRevisionId: string | undefined
  workspaceId: string
}) {
  return (
    <>
      <ExperimentLifecycleActions
        experiment={experiment}
        canWrite={canWrite}
        nextStep={nextStep}
        reviewRevisionId={reviewRevisionId}
      />
      <PublishControl
        workspaceId={workspaceId}
        kind="experiment"
        objectId={experiment.id}
        defaultTitle={experiment.title}
        canPublish={canWrite}
      />
      <AskAiButton />
    </>
  )
}

/**
 * While the experiment is in review, one line says so: to the reviewer, that
 * it waits for them; to the author, who it waits for. Once approved and
 * locked, the line says that instead, with the way to amend it.
 */
export function ExperimentStateLine({
  reviewing,
  inReview,
  ownerName,
  isAuthor,
  submittedAt,
  revisionId,
  waitingNames,
  locked,
}: {
  reviewing: boolean
  inReview: boolean
  ownerName: string
  /** Whether the reader wrote it: only the author reads "You submitted". */
  isAuthor: boolean
  submittedAt?: string
  revisionId?: string
  waitingNames: readonly string[]
  /** The record's lock, when an approval locked it. */
  locked?: {
    recordId: string
    lockedAt: string
    canAmend: boolean
    onAmended: () => void
  } | null
}) {
  if (!reviewing && (!inReview || waitingNames.length === 0))
    return locked ? <RecordLockedLine {...locked} /> : null

  const date = submittedAt ? formatDate(submittedAt) : ''

  return (
    <RecordStateLine
      tone="review"
      action={
        revisionId ? (
          <Link
            to="/review/$revisionId"
            params={{ revisionId }}
            className="text-link"
          >
            {t('projects.experimentPage.reviewBand.open')}
          </Link>
        ) : null
      }
    >
      <strong className="font-medium">
        {reviewing
          ? t('projects.experimentPage.reviewBand.title')
          : t('projects.experimentPage.reviewBand.authorTitle', {
              reviewers: waitingNames.join(', '),
            })}
      </strong>{' '}
      <span className="text-fg-muted max-md:hidden">
        {reviewing
          ? t('projects.experimentPage.reviewBand.body', {
              name: ownerName,
              date,
            })
          : isAuthor
            ? t('projects.experimentPage.reviewBand.authorBody', { date })
            : t('projects.experimentPage.reviewBand.othersBody', {
                name: ownerName,
                date,
              })}
      </span>
    </RecordStateLine>
  )
}
