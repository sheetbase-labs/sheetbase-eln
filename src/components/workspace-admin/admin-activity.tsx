import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { formatDate } from '#/lib/workspace-admin'
import type { AuditEvent } from '#/lib/workspace-admin'

export function AdminActivity({
  events,
  isOwner,
  onExport,
}: {
  events: AuditEvent[]
  isOwner: boolean
  onExport: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {isOwner && (
          <Button variant="outline" onClick={onExport}>
            Export
          </Button>
        )}
      </div>
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sequence</TableHead>
              <TableHead>Entity type</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="tabular-nums">{event.sequence}</TableCell>
                <TableCell>{event.entityType}</TableCell>
                <TableCell>{event.operation}</TableCell>
                <TableCell>{event.actorUserId ?? 'System'}</TableCell>
                <TableCell>{formatDate(event.createdAt)}</TableCell>
                <TableCell
                  className="max-w-64 truncate font-mono text-xs"
                  title={JSON.stringify(event.payload)}
                >
                  {JSON.stringify(event.payload)}
                </TableCell>
              </TableRow>
            ))}
            {!events.length && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  No activity recorded.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
