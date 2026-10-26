import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Inspector, InspectorSection, Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { useModelApprovalIndex } from '#/components/v3/models/model-approval-data'
import { buildApprovalTrail } from '#/components/v3/models/model-approval'
import { PROTOCOL_REVISION_KIND } from '#/lib/controlled-protocols'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { formatInstant } from '#/lib/display-time-zone'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

interface UsedByRow {
  id: string
  identifier: string
  title: string
  status: string
  protocol_version_id: string | null
}

interface TrainingRow {
  user_id: string
  status: string
}

const TECHNICAL = new Set(['scientist', 'steward'])

function shortDate(iso: string): string {
  return formatInstant(iso, { day: 'numeric', month: 'short' })
}

/**
 * The ProtocolDetail board's right-hand panel for the version being read: who
 * approved it, what changed since the version before, who is trained on it and
 * which experiments run on it. Everything is read from the approval store, the
 * version's change summary, the training roster and the experiments' pinned
 * protocol version.
 */
export function ProtocolInspector({
  protocolId,
  version,
  versions,
}: {
  protocolId: string
  version: ProtocolVersion | undefined
  versions: ProtocolVersion[]
}) {
  const approvals = useModelApprovalIndex(
    versions.map((v) => v.id),
    notebookDataClient,
    PROTOCOL_REVISION_KIND,
  )
  const request = version
    ? approvals.data?.byVersion.get(version.id)?.at(0)
    : undefined
  const trail = request
    ? buildApprovalTrail(
        request,
        approvals.data?.byRequest.get(request.id) ?? [],
      )
    : []
  const previous = version
    ? versions
        .filter((v) => v.version < version.version)
        .sort((a, b) => b.version - a.version)
        .at(0)
    : undefined

  const training = useQuery({
    queryKey: ['ui-port', 'protocol-inspector', 'training', protocolId],
    queryFn: () =>
      notebookDataClient.list<TrainingRow>(
        'protocol_training',
        `?protocol_record_id=eq.${protocolId}&select=user_id,status`,
      ),
  })
  const usedBy = useQuery({
    queryKey: ['ui-port', 'protocol-inspector', 'used-by', protocolId],
    enabled: versions.length > 0,
    queryFn: () =>
      notebookDataClient.list<UsedByRow>(
        'records',
        `?protocol_version_id=in.(${versions.map((v) => v.id).join(',')})&select=id,identifier,title,status,protocol_version_id&order=identifier.desc`,
      ),
  })
  const names = useUserNames([
    ...trail.flatMap((t) => (t.actorUserId ? [t.actorUserId] : [])),
    ...(training.data ?? []).map((t) => t.user_id),
  ])

  const trained = (training.data ?? []).filter((t) => t.status === 'trained')
  const waiting = (training.data ?? []).filter((t) => t.status !== 'trained')
  const onVersion = (usedBy.data ?? []).filter(
    (r) => r.protocol_version_id === version?.id,
  )
  const onOthers = (usedBy.data ?? []).filter(
    (r) => r.protocol_version_id !== version?.id,
  )
  const otherVersion = onOthers.length
    ? versions.find((v) => v.id === onOthers[0].protocol_version_id)
    : undefined

  return (
    <Inspector label="Protocol version" width={290}>
      <InspectorSection
        title={version ? `Approvals, version ${version.version}` : 'Approvals'}
      >
        {trail.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
            {trail.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-2">
                <span>
                  {entry.actorUserId ? names.userLabel(entry.actorUserId) : '—'}{' '}
                  ·{' '}
                  <span className="text-fg-muted">
                    {entry.kind === 'submitted'
                      ? 'Authored'
                      : entry.role && TECHNICAL.has(entry.role)
                        ? 'Technical review'
                        : 'QA · Approved'}
                  </span>
                </span>
                <span className="text-fg-muted">{shortDate(entry.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>No approval recorded for this version.</Muted>
        )}
      </InspectorSection>

      {version?.change_summary ? (
        <InspectorSection
          title={
            previous ? `Changes from v${previous.version}` : 'First version'
          }
        >
          <Muted>{version.change_summary}</Muted>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Training">
        {training.data?.length ? (
          <Muted>
            {trained.length} of {training.data.length} users trained.
            {waiting.length && version
              ? ` ${waiting.map((t) => names.userLabel(t.user_id)).join(', ')} must read and acknowledge v${version.version} before starting an experiment from it.`
              : ''}
          </Muted>
        ) : (
          <Muted>No one has training assigned yet.</Muted>
        )}
      </InspectorSection>

      <InspectorSection title="Used by">
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
                {onOthers.length} more on v{otherVersion?.version ?? '—'}
                {otherVersion ? ` (${otherVersion.status})` : ''}
              </li>
            ) : null}
          </ul>
        ) : (
          <Muted>No experiment has started from this protocol.</Muted>
        )}
      </InspectorSection>
    </Inspector>
  )
}
