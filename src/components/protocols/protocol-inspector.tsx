import { Inspector, InspectorSection, Muted } from '#/components/ui/layout'
import { AddedFields } from '#/components/models/added-fields'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { t } from '#/copy'

import { useProtocolInspectorData } from './protocol-inspector-data'
import {
  ProtocolApprovalTrail,
  ProtocolTraining,
  ProtocolUsedBy,
} from './protocol-inspector-sections'

/**
 * The ProtocolDetail board's right-hand panel for the version being read: who
 * approved it, what changed since the version before, who is trained on it and
 * which experiments run on it. Everything is read from the approval store, the
 * version's change summary, the training roster and the experiments' pinned
 * protocol version; the reading lives in `protocol-inspector-data.ts` and the
 * three lists in `protocol-inspector-sections.tsx`.
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
  const {
    trail,
    previous,
    training,
    userLabel,
    trained,
    waiting,
    onVersion,
    onOthers,
    otherVersion,
  } = useProtocolInspectorData({ protocolId, version, versions })

  return (
    <Inspector
      label={t('library.protocols.protocolInspector.protocolVersion')}
      width={290}
    >
      <ProtocolApprovalTrail
        trail={trail}
        version={version}
        userLabel={userLabel}
      />

      {version?.change_summary ? (
        <InspectorSection
          title={
            previous
              ? t('library.protocols.protocolInspector.changesFromV', {
                  version: previous.version,
                })
              : t('library.protocols.protocolInspector.firstVersion')
          }
        >
          <Muted>{version.change_summary}</Muted>
        </InspectorSection>
      ) : null}

      <AddedFields modelKey="protocol_template" objectId={protocolId} />

      <ProtocolTraining
        training={training.data ?? []}
        trained={trained}
        waiting={waiting}
        version={version}
        userLabel={userLabel}
      />

      <ProtocolUsedBy
        onVersion={onVersion}
        onOthers={onOthers}
        otherVersion={otherVersion}
      />
    </Inspector>
  )
}
