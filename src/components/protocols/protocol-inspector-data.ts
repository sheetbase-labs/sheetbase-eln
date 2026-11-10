import { useQuery } from '@tanstack/react-query'

import { useModelApprovalIndex } from '#/components/models/model-approval-data'
import { buildApprovalTrail } from '#/components/models/model-approval'
import type { ApprovalTrailEntry } from '#/components/models/model-approval'
import { PROTOCOL_REVISION_KIND } from '#/lib/controlled-protocols'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

export interface UsedByRow {
  id: string
  identifier: string
  title: string
  status: string
  protocol_version_id: string | null
}

export interface TrainingRow {
  user_id: string
  status: string
}

/**
 * Everything the protocol inspector shows, read and derived in one place: the
 * approval trail for this version, the version before it, the training roster
 * split into who has read this version and who has not, and the experiments
 * running on this version versus an older one. The sections only render what
 * this returns.
 */
export function useProtocolInspectorData({
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

  const trail: ApprovalTrailEntry[] = request
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
        'protocol_training_status',
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
    ...trail.flatMap((item) => (item.actorUserId ? [item.actorUserId] : [])),
    ...(training.data ?? []).map((item) => item.user_id),
  ])

  const trained = (training.data ?? []).filter(
    (item) => item.status === 'trained',
  )

  // Out of date counts as waiting: they trained on a version that is no longer current.
  const waiting = (training.data ?? []).filter(
    (item) => item.status !== 'trained',
  )

  const onVersion = (usedBy.data ?? []).filter(
    (r) => r.protocol_version_id === version?.id,
  )

  const onOthers = (usedBy.data ?? []).filter(
    (r) => r.protocol_version_id !== version?.id,
  )

  const otherVersion = onOthers.length
    ? versions.find((v) => v.id === onOthers[0].protocol_version_id)
    : undefined

  return {
    trail,
    previous,
    training,
    userLabel: names.userLabel,
    trained,
    waiting,
    onVersion,
    onOthers,
    otherVersion,
  }
}
