import { Link } from '@tanstack/react-router'

import { InspectorSection, Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { ApprovalTrailEntry } from '#/components/models/model-approval'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { formatInstant } from '#/lib/display-time-zone'
import { t } from '#/copy'

import type { TrainingRow, UsedByRow } from './protocol-inspector-data'

/**
 * The three lists the protocol inspector shows below its change summary: who
 * approved this version, who is trained on it, and which experiments run on it.
 * Each is a section of its own with its own empty state, so a quiet protocol
 * says why it is quiet rather than rendering an empty box.
 */

const TECHNICAL = new Set(['scientist', 'steward'])

function shortDate(iso: string): string {
  return formatInstant(iso, { day: 'numeric', month: 'short' })
}

/** Who approved this version, in the order they acted. */
export function ProtocolApprovalTrail({
  trail,
  version,
  userLabel,
}: {
  trail: readonly ApprovalTrailEntry[]
  version: ProtocolVersion | undefined
  userLabel: (userId: string) => string
}) {
  return (
    <InspectorSection
      title={
        version
          ? t('library.protocols.protocolInspector.approvalsVersion', {
              version: version.version,
            })
          : t('library.protocols.protocolInspector.approvals')
      }
    >
      {trail.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
          {trail.map((entry) => (
            <li key={entry.id} className="flex justify-between gap-2">
              <span>
                {entry.actorUserId ? userLabel(entry.actorUserId) : '—'} ·{' '}
                <span className="text-fg-muted">
                  {entry.kind === 'submitted'
                    ? t('library.protocols.protocolInspector.authored')
                    : entry.role && TECHNICAL.has(entry.role)
                      ? t('library.protocols.protocolInspector.technicalReview')
                      : t('library.protocols.protocolInspector.qaApproved')}
                </span>
              </span>
              <span className="text-fg-muted">{shortDate(entry.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>
          {t('library.protocols.protocolInspector.noApprovalRecordedForThis')}
        </Muted>
      )}
    </InspectorSection>
  )
}

/** Who is trained on this protocol, and which of them trained on an older version. */
export function ProtocolTraining({
  training,
  trained,
  waiting,
  version,
  userLabel,
}: {
  training: readonly TrainingRow[]
  trained: readonly TrainingRow[]
  waiting: readonly TrainingRow[]
  version: ProtocolVersion | undefined
  userLabel: (userId: string) => string
}) {
  return (
    <InspectorSection title={t('library.protocols.protocolInspector.training')}>
      {training.length ? (
        <Muted>
          {t('library.protocols.protocolInspector.ofUsersTrained', {
            trained: trained.length,
            data: training.length,
          })}
          {waiting.length && version
            ? t('library.protocols.protocolInspector.mustReadAndAcknowledgeV', {
                names: waiting
                  .map((item) => userLabel(item.user_id))
                  .join(', '),
                version: version.version,
              })
            : ''}
        </Muted>
      ) : (
        <Muted>
          {t('library.protocols.protocolInspector.noOneHasTrainingAssigned')}
        </Muted>
      )}
    </InspectorSection>
  )
}

/** The experiments that have started from this version, and any on an older one. */
export function ProtocolUsedBy({
  onVersion,
  onOthers,
  otherVersion,
}: {
  onVersion: readonly UsedByRow[]
  onOthers: readonly UsedByRow[]
  otherVersion: ProtocolVersion | undefined
}) {
  return (
    <InspectorSection title={t('library.protocols.protocolInspector.usedBy')}>
      {onVersion.length || onOthers.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
          {onVersion.map((r) => (
            <li key={r.id}>
              <Link
                to="/experiments/$expId"
                params={{ expId: r.id }}
                className="mono"
              >
                {r.identifier}
              </Link>{' '}
              <Status tone="none">{r.status.replace(/_/g, ' ')}</Status>
            </li>
          ))}
          {onOthers.length ? (
            <li className="text-fg-muted">
              {otherVersion
                ? t('library.protocols.protocolInspector.moreOnVStatus', {
                    count: onOthers.length,
                    version: otherVersion.version,
                    status: otherVersion.status,
                  })
                : t('library.protocols.protocolInspector.moreOnV', {
                    count: onOthers.length,
                    version: '—',
                  })}
            </li>
          ) : null}
        </ul>
      ) : (
        <Muted>
          {t('library.protocols.protocolInspector.noExperimentHasStartedFrom')}
        </Muted>
      )}
    </InspectorSection>
  )
}
