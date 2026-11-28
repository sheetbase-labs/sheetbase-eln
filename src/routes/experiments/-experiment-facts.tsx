/**
 * The experiment's header facts and tabs as data for the shared record page:
 * who owns and reviews it, when it started, the protocol it runs on and when
 * it is due, and its sections from Notebook to History.
 */
import type { RecordFact } from '#/components/record-page/record-page'
import type { Crumb } from '#/components/ui/breadcrumb'
import type { TabsProps } from '#/components/ui/tabs'
import { formatDate } from '#/lib/notebook-data'
import { t } from '#/copy'

import { ExperimentPerson, ExperimentProtocolLink } from './-experiment-header'
import type { ExperimentRecordRow, RecordLinkWire } from './-experiment-data'

export function experimentFacts({
  experiment: e,
  ownerName,
  reviewerName,
  protocolLink,
}: {
  experiment: ExperimentRecordRow
  ownerName: string
  reviewerName: string | null
  protocolLink: RecordLinkWire | undefined
}): RecordFact[] {
  const facts: (RecordFact | null)[] = [
    {
      label: t('projects.experimentPage.facts.owner'),
      value: (
        <ExperimentPerson name={ownerName} userId={e.created_by_user_id} />
      ),
    },
    reviewerName
      ? {
          label: t('projects.experimentPage.facts.reviewer'),
          value: (
            <ExperimentPerson name={reviewerName} userId={e.reviewer_user_id} />
          ),
        }
      : null,
    e.status === 'draft' || e.status === 'planned'
      ? null
      : {
          label: t('projects.experimentPage.facts.started'),
          value: formatDate(e.created_at),
        },
    protocolLink?.target_record_id
      ? {
          label: t('projects.experimentPage.facts.protocol'),
          value: (
            <ExperimentProtocolLink
              recordId={protocolLink.target_record_id}
              identifier={protocolLink.target_identifier}
            />
          ),
        }
      : null,
    e.planned_end
      ? {
          label: t('projects.experimentPage.facts.due'),
          value: formatDate(e.planned_end),
        }
      : null,
  ]

  return facts.filter((fact): fact is RecordFact => fact !== null)
}

/**
 * Notebook first, then Summary (or Series for a series' parent), Samples,
 * Data and Review, and History at the far end.
 */
export function experimentTabs({
  expId,
  seriesHead,
  links,
  plateRunCount,
}: {
  expId: string
  seriesHead: boolean
  links: readonly RecordLinkWire[]
  plateRunCount: number
}): TabsProps {
  const params = { expId }

  const sampleCount = links.filter((l) => l.target_kind === 'sample').length

  const dataCount =
    links.filter((l) => l.target_kind === 'dataset' || l.target_kind === 'file')
      .length + plateRunCount

  return {
    mode: 'url',
    label: t('projects.experimentPage.sections'),
    items: [
      {
        label: t('projects.experimentPage.tabs.notebook'),
        link: { to: '/experiments/$expId/notebook', params },
      },
      seriesHead
        ? {
            label: t('projects.experimentPage.tabs.series'),
            link: { to: '/experiments/$expId/series' as const, params },
          }
        : {
            label: t('projects.experimentPage.tabs.summary'),
            link: { to: '/experiments/$expId/summary' as const, params },
          },
      {
        label: t('projects.experimentPage.tabs.samples'),
        count: sampleCount,
        link: { to: '/experiments/$expId/samples', params },
      },
      {
        label: t('projects.experimentPage.tabs.data'),
        count: dataCount,
        link: { to: '/experiments/$expId/data', params },
      },
      {
        label: t('projects.experimentPage.tabs.review'),
        link: { to: '/experiments/$expId/review', params },
      },
      {
        label: t('projects.experimentPage.section.history'),
        end: true,
        link: { to: '/experiments/$expId/history', params },
      },
    ],
  }
}

/** Project (when there is one), Experiments, then the experiment's ID. */
export function experimentTrail(
  experiment: ExperimentRecordRow,
  projectTitle: string | undefined,
): Crumb[] {
  const projectCrumbs: Crumb[] = experiment.project_id
    ? [
        {
          label: projectTitle ?? t('projects.experimentPage.project'),
          link: {
            to: '/projects/$projectId',
            params: { projectId: experiment.project_id },
          },
        },
      ]
    : []

  return [
    ...projectCrumbs,
    {
      label: t('projects.experimentPage.experiments'),
      link: { to: '/experiments' },
    },
    { label: experiment.identifier, mono: true },
  ]
}

/** The reviewer as the header names them: "You" when it is the viewer. */
export function experimentReviewerName(
  reviewerId: string | null,
  viewerId: string,
  userLabel: (id: string) => string,
): string | null {
  if (!reviewerId) return null

  return reviewerId === viewerId
    ? t('projects.experimentPage.you')
    : userLabel(reviewerId)
}
