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
import type { WorkspaceSession } from '#/lib/workspace-admin'

export function AdminSessions({
  sessions,
  isOwner,
  onRevoke,
}: {
  sessions: WorkspaceSession[]
  isOwner: boolean
  onRevoke: (sessionId: string) => void
}) {
  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>IP address</TableHead>
            <TableHead>User agent</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell>
                {session.userName || `User ${session.userId.slice(0, 8)}`}
              </TableCell>
              <TableCell>{session.ipAddress ?? 'Unknown'}</TableCell>
              <TableCell
                className="max-w-56 truncate"
                title={session.userAgent ?? undefined}
              >
                {session.userAgent ?? 'Unknown'}
              </TableCell>
              <TableCell>{formatDate(session.createdAt)}</TableCell>
              <TableCell>{formatDate(session.expiresAt)}</TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isOwner}
                  onClick={() => onRevoke(session.id)}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!sessions.length && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-muted-foreground"
              >
                No active sessions.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
