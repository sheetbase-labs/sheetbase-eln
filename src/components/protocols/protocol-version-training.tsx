import type {
  ProtocolAcknowledgement,
  ProtocolVersion,
} from '#/lib/controlled-protocols'
import { Button } from '../ui/button'
import { Muted, Section } from '../ui/layout'
import { Status } from '../ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/** Acknowledgement belongs to the exact frozen version, never the record. */
export function ProtocolVersionTraining({
  version,
  members,
  acknowledgements,
  currentUserId,
  acknowledging,
  error,
  writer,
  onAcknowledge,
}: {
  version: ProtocolVersion
  members: { user_id: string; name: string }[]
  acknowledgements: ProtocolAcknowledgement[]
  currentUserId: string
  acknowledging: boolean
  error?: string
  /**
   * GOV-01 / LAB-07 — whether the signed-in identity is a workspace writer,
   * the exact capability `api.acknowledge_protocol_version` gates on
   * (former migration 0335). A viewer's write is refused, so the control must not be
   * offered to them. Supplied by the surface from the same
   * `api.is_workspace_writer` RPC the server checks.
   */
  writer: boolean
  onAcknowledge: () => void
}) {
  const acknowledged = new Map(
    acknowledgements
      .filter((row) => row.protocol_version_id === version.id)
      .map((row) => [row.user_id, row]),
  )
  const current = acknowledged.has(currentUserId)
  const lifecycleAllows =
    version.status === 'in_review' || version.status === 'effective'
  const canAcknowledge = writer && lifecycleAllows
  return (
    <Section
      title={t('library.protocols.protocolVersionTraining.trainingOnV', {
        version: version.version,
      })}
      action={
        <Button
          variant="primary"
          disabled={acknowledging || current || !canAcknowledge}
          onClick={() => onAcknowledge()}
        >
          {current
            ? t('library.protocols.protocolVersionTraining.acknowledged')
            : acknowledging
              ? t('library.protocols.protocolVersionTraining.acknowledging')
              : t(
                  'library.protocols.protocolVersionTraining.readAndAcknowledge',
                )}
        </Button>
      }
    >
      <Muted>
        {t(
          'library.protocols.protocolVersionTraining.yourAcknowledgementAppliesOnlyTo',
        )}
      </Muted>
      {error ? (
        <p role="alert" className="text-body">
          {error}
        </p>
      ) : null}
      <Table
        aria-label={t(
          'library.protocols.protocolVersionTraining.protocolVAcknowledgements',
          { version: version.version },
        )}
      >
        <TableHeader>
          <TableRow>
            <TableHead>
              {t('library.protocols.protocolVersionTraining.person')}
            </TableHead>
            <TableHead>
              {t('library.protocols.protocolVersionTraining.status')}
            </TableHead>
            <TableHead>
              {t('library.protocols.protocolVersionTraining.acknowledged')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const acknowledgement = acknowledged.get(member.user_id)
            return (
              <TableRow key={member.user_id}>
                <TableCell>{member.name}</TableCell>
                <TableCell>
                  <Status tone={acknowledgement ? 'ok' : 'warn'}>
                    {acknowledgement
                      ? t(
                          'library.protocols.protocolVersionTraining.acknowledged',
                        )
                      : t('common.states.required')}
                  </Status>
                </TableCell>
                <TableCell>
                  {formatDate(acknowledgement?.acknowledged_at)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {!canAcknowledge ? (
        <Muted>
          {!writer
            ? t(
                'library.protocols.protocolVersionTraining.onlyAWorkspaceWriterCan',
              )
            : t(
                'library.protocols.protocolVersionTraining.thisVersionIsNotAvailable',
              )}
        </Muted>
      ) : null}
    </Section>
  )
}
