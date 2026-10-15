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
   * (drizzle/0335). A viewer's write is refused, so the control must not be
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
      title={`Training on v${version.version}`}
      action={
        <Button
          variant="primary"
          disabled={acknowledging || current || !canAcknowledge}
          onClick={() => onAcknowledge()}
        >
          {current
            ? 'Acknowledged'
            : acknowledging
              ? 'Acknowledging…'
              : 'Read and acknowledge'}
        </Button>
      }
    >
      <Muted>
        Your acknowledgement applies only to this frozen version. A new version
        requires a new acknowledgement.
      </Muted>
      {error ? (
        <p role="alert" className="text-body">
          {error}
        </p>
      ) : null}
      <Table aria-label={`Protocol v${version.version} acknowledgements`}>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Acknowledged</TableHead>
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
                    {acknowledgement ? 'Acknowledged' : 'Required'}
                  </Status>
                </TableCell>
                <TableCell>
                  {acknowledgement?.acknowledged_at.slice(0, 10) ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {!canAcknowledge ? (
        <Muted>
          {!writer
            ? 'Only a workspace writer can acknowledge a protocol version.'
            : 'This version is not available for acknowledgement.'}
        </Muted>
      ) : null}
    </Section>
  )
}
