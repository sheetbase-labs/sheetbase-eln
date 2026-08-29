import { useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  formatDate,
  INVITATION_STATUS_LABELS,
  INVITATION_STATUS_TOKENS,
  WORKSPACE_ROLE_LABELS,
  WORKSPACE_ROLE_DESCRIPTIONS,
  WORKSPACE_ROLE_TOKENS,
} from '#/lib/workspace-admin'
import type {
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
} from '#/lib/workspace-admin'

const roles = Object.keys(WORKSPACE_ROLE_LABELS) as WorkspaceRole[]

export interface AdminMembersProps {
  members: WorkspaceMember[]
  memberNames: Partial<Record<string, { name: string; email: string }>>
  currentUserId: string
  isOwner: boolean
  selectedUserId: string | null
  onSelect: (userId: string) => void
  onInvite: (email: string, role: WorkspaceRole, days: number) => void
  onRevokeInvitation: (id: string) => void
  invitations: WorkspaceInvitation[]
  search: string
  onSearchChange: (s: string) => void
  onRoleChange?: (userId: string, role: WorkspaceRole) => void
  onSuspend?: (userId: string) => void
  onReinstate?: (userId: string) => void
  onRemove?: (userId: string) => void
}

export function AdminMembers(props: AdminMembersProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [days, setDays] = useState(7)
  const visible = useMemo(
    () =>
      props.members.filter((member) => {
        const q = props.search.toLowerCase()
        const name = props.memberNames[member.userId]?.name ?? ''
        const email = props.memberNames[member.userId]?.email ?? ''
        return (
          member.userId.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          email.toLowerCase().includes(q)
        )
      }),
    [props.members, props.search, props.memberNames],
  )
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <Input
          aria-label="Search members"
          placeholder="Search users"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          className="max-w-sm"
        />
        {props.isOwner && (
          <Button onClick={() => setInviteOpen(true)}>Invite user</Button>
        )}
      </div>
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((member) => (
              <TableRow
                key={member.id}
                data-state={
                  props.selectedUserId === member.userId
                    ? 'selected'
                    : undefined
                }
                onClick={() => props.onSelect(member.userId)}
                className="cursor-pointer"
              >
                <TableCell className="font-medium">
                  {(() => {
                    const entry = props.memberNames[member.userId]
                    return (
                      <>
                        {entry?.name ?? `User ${member.userId.slice(0, 8)}`}
                        {entry?.email && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {entry.email}
                          </span>
                        )}
                      </>
                    )
                  })()}
                </TableCell>
                <TableCell>
                  <Badge className={WORKSPACE_ROLE_TOKENS[member.role]}>
                    {WORKSPACE_ROLE_LABELS[member.role]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      member.suspendedAt
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-success/10 text-success'
                    }
                  >
                    {member.suspendedAt ? 'Suspended' : 'Active'}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(member.createdAt)}</TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Member actions"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {roles.map((nextRole) => (
                        <DropdownMenuItem
                          key={nextRole}
                          disabled={!props.isOwner || nextRole === member.role}
                          onClick={() =>
                            props.onRoleChange?.(member.userId, nextRole)
                          }
                        >
                          Make {WORKSPACE_ROLE_LABELS[nextRole]}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem
                        disabled={
                          !props.isOwner ||
                          member.userId === props.currentUserId
                        }
                        onClick={() =>
                          member.suspendedAt
                            ? props.onReinstate?.(member.userId)
                            : props.onSuspend?.(member.userId)
                        }
                      >
                        {member.suspendedAt ? 'Reinstate' : 'Suspend'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={
                          !props.isOwner ||
                          member.userId === props.currentUserId
                        }
                        onClick={() => props.onRemove?.(member.userId)}
                        className="text-destructive"
                      >
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">Pending invitations</h2>
        {props.invitations
          .filter((item) => item.status === 'pending')
          .map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
            >
              <span className="font-medium">{item.email}</span>
              <Badge className={WORKSPACE_ROLE_TOKENS[item.role]}>
                {WORKSPACE_ROLE_LABELS[item.role]}
              </Badge>
              <Badge className={INVITATION_STATUS_TOKENS[item.status]}>
                {INVITATION_STATUS_LABELS[item.status]}
              </Badge>
              <span className="text-muted-foreground">
                Expires {formatDate(item.expiresAt)}
              </span>
              {props.isOwner && (
                <Button
                  className="ml-auto"
                  size="sm"
                  variant="outline"
                  onClick={() => props.onRevokeInvitation(item.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        {!props.invitations.some((item) => item.status === 'pending') && (
          <p className="text-sm text-muted-foreground">
            No pending invitations.
          </p>
        )}
      </section>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              Invite someone to this workspace. Viewer is read-only; Scientist,
              Analyst and Reviewer currently share Member data capabilities.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <Select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              >
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {WORKSPACE_ROLE_LABELS[value]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {WORKSPACE_ROLE_DESCRIPTIONS[role]}
              </p>
            </div>
            <div>
              <Label htmlFor="invite-expiry">Expiry</Label>
              <Select
                id="invite-expiry"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[7, 14, 30].map((value) => (
                  <option key={value} value={value}>
                    {value} days
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!email.trim()}
              onClick={() => {
                props.onInvite(email.trim(), role, days)
                setInviteOpen(false)
                setEmail('')
              }}
            >
              Create invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
