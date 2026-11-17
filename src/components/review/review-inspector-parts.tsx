import {
  DescriptionList,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { Person } from '#/components/ui/person'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { t } from '#/copy'

export type ReviewStepState =
  'pending' | 'active' | 'completed' | 'rejected' | 'returned' | 'unavailable'

export interface ReviewStep {
  id: string
  title: string
  state: ReviewStepState
  /** Who acted, when known. */
  actor?: string
  /** When the step happened. */
  at?: string
}

const TONE: Record<ReviewStepState, Tone> = {
  completed: 'ok',
  active: 'review',
  rejected: 'bad',
  returned: 'warn',
  pending: 'none',
  unavailable: 'none',
}

/** Where the review stands, one line per step, in the same list style as the rest of the panel. */
export function ReviewProgress({ steps }: { steps: readonly ReviewStep[] }) {
  return (
    <InspectorSection title={t('projects.revisionPage.inspector.workflow')}>
      <DescriptionList
        labelWidth={112}
        items={steps.map((step) => [
          step.title,
          <Status key={step.id} tone={TONE[step.state]}>
            <span className="min-w-0">
              {t(`projects.approvalStepper.states.${step.state}`)}
              {step.actor ? ` · ${step.actor}` : ''}
              {step.at ? ` · ${step.at}` : ''}
            </span>
          </Status>,
        ])}
      />
    </InspectorSection>
  )
}

/** The people the review was sent to. */
export function ReviewReviewers({
  reviewers,
}: {
  reviewers: readonly { id: string; name: string; you: boolean }[]
}) {
  return (
    <InspectorSection title={t('projects.revisionPage.inspector.reviewers')}>
      {reviewers.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
          {reviewers.map((person) => (
            <li key={person.id}>
              <Person userId={person.id} name={person.name}>
                {person.you ? (
                  <span className="text-fg-muted">
                    {t('projects.revisionPage.inspector.you')}
                  </span>
                ) : null}
              </Person>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>{t('projects.revisionPage.inspector.noAssignees')}</Muted>
      )}
    </InspectorSection>
  )
}
