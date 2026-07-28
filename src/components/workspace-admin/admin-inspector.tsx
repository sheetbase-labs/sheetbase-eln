import { Badge, Button, Label, Select } from '#/components/ui'
import {
  formatDate,
  WORKSPACE_ROLE_LABELS,
  WORKSPACE_ROLE_TOKENS,
} from '#/lib/workspace-admin'
import type { WorkspaceMember, WorkspaceRole } from '#/lib/workspace-admin'

const roles = Object.keys(WORKSPACE_ROLE_LABELS) as WorkspaceRole[]

export function AdminInspector({
  member,
  currentUserId,
  isOwner,
  onSuspend,
  onReinstate,
  onRemove,
  onRoleChange,
}: {
  member: WorkspaceMember
  currentUserId: string
  isOwner: boolean
  onSuspend: () => void
  onReinstate: () => void
  onRemove: () => void
  onRoleChange: (role: WorkspaceRole) => void
}) {
  const self = member.userId === currentUserId
  return (
    <div className="space-y-6 p-4">
      <header className="space-y-2">
        <h2 className="font-semibold break-all">
          User {member.userId.slice(0, 8)}
        </h2>
        <p className="break-all text-xs text-muted-foreground">
          {member.userId}
        </p>
        <div className="flex gap-2">
          <Badge className={WORKSPACE_ROLE_TOKENS[member.role]}>
            {WORKSPACE_ROLE_LABELS[member.role]}
          </Badge>
          <Badge
            className={
              member.suspendedAt
                ? 'bg-red-100 text-red-700'
                : 'bg-emerald-100 text-emerald-700'
            }
          >
            {member.suspendedAt ? 'Suspended' : 'Active'}
          </Badge>
        </div>
      </header>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Role &amp; access</h3>
        <div>
          <Label htmlFor="member-role">Role</Label>
          <Select
            id="member-role"
            value={member.role}
            disabled={!isOwner}
            onChange={(e) => onRoleChange(e.target.value as WorkspaceRole)}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {WORKSPACE_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Status:</span>{' '}
          {member.suspendedAt ? 'Suspended' : 'Active'}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Joined:</span>{' '}
          {formatDate(member.createdAt)}
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Actions</h3>
        <Button
          className="w-full"
          variant="outline"
          disabled={!isOwner || self}
          onClick={member.suspendedAt ? onReinstate : onSuspend}
        >
          {member.suspendedAt ? 'Reinstate member' : 'Suspend member'}
        </Button>
        <Button
          className="w-full"
          variant="destructive"
          disabled={!isOwner || self}
          onClick={onRemove}
        >
          Remove member
        </Button>
        <p className="text-xs text-muted-foreground">
          <strong>Self-lockout protection:</strong> Owners cannot remove
          themselves or the last owner.
        </p>
      </section>
    </div>
  )
}
