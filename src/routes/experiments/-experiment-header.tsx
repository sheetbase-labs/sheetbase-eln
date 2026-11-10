import { Link } from '@tanstack/react-router'

import { PublishControl } from '#/components/open-data/publish-control'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { PageHeader } from '#/components/ui/layout'
import { Tabs } from '#/components/ui/tabs'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import type { NextStep } from '#/components/experiments/next-step'
import { SeriesBar } from '#/components/experiments/series-bar'
import { formatDate } from '#/lib/notebook-data'
import { RecordTitleInput } from '../records/$recordId/-notebook-page'
import { ExperimentLifecycleActions } from './$expId/-lifecycle-actions'
import type { ExperimentRecordRow, RecordLinkWire } from './-experiment-data'
import { rich, t } from '#/copy'

/**
 * The experiment page's header: the project and identifier trail, the inline
 * title, the experiment's status and dates, the lifecycle and publish actions,
 * and the Notebook, Series, Summary, Samples, Data and Review tabs.
 */
export function ExperimentHeader({
  experiment,
  status,
  ownerName,
  reviewerName,
  projectTitle,
  protocolLink,
  runningDay,
  canWrite,
  nextStep,
  reviewRevisionId,
  seriesHead,
  sampleCount,
  dataCount,
  workspaceId,
}: {
  experiment: ExperimentRecordRow
  status: { tone: Tone; label: string }
  ownerName: string
  /** The reviewer's name, or "you" when the reader is the reviewer. */
  reviewerName: string | null
  projectTitle: string | undefined
  protocolLink: RecordLinkWire | undefined
  runningDay: string | null
  canWrite: boolean
  nextStep: NextStep
  reviewRevisionId: string | undefined
  seriesHead: boolean
  sampleCount: number
  dataCount: number
  workspaceId: string
}) {
  const e = experiment
  const params = { expId: e.id }

  return (
    <PageHeader
      compact
      trail={[
        ...(e.project_id
          ? [
              {
                label: projectTitle ?? t('projects.experimentPage.project'),
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
            {t('projects.experimentPage.owner', { name: ownerName })}
          </span>
          {reviewerName ? (
            <span className="max-md:hidden">
              {t('projects.experimentPage.reviewer', { name: reviewerName })}
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
                    params={{ protocolId: protocolLink.target_record_id ?? '' }}
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
            workspaceId={workspaceId}
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
              ...(seriesHead
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
              ...(seriesHead
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
                count: <span className="max-md:hidden">{sampleCount}</span>,
                link: { to: '/experiments/$expId/samples', params },
              },
              {
                label: t('projects.experimentPage.tabs.data'),
                count: <span className="max-md:hidden">{dataCount}</span>,
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
  )
}
