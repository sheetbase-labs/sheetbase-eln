import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import { hasCapability } from '#/lib/capability'
import {
  adminQueryKeys,
  changeMemberRole,
  createInvitation,
  fetchInvitations,
  fetchWorkspaceMembers,
  reinstateMember,
  removeMember,
  revokeInvitation,
  suspendMember,
  WORKSPACE_ROLE_DESCRIPTIONS,
  WORKSPACE_ROLE_LABELS,
} from '#/lib/workspace-admin'
import type { WorkspaceRole } from '#/lib/workspace-admin'

/** UI port (roadmap-4/ui-app3): members and roles on workspace_memberships and
 * workspace_invitations. Roles decide what people can do; the role change,
 * suspend, reinstate, remove and invite RPCs hold the rules server-side. */
export const Route = createFileRoute('/settings/members')({
  component: Members,
})

const dataClient = createDataClient()
const roles = Object.keys(WORKSPACE_ROLE_LABELS) as WorkspaceRole[]

function Members() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()
  const canManage = hasCapability(context.workspace?.role, 'workspace.admin')
  const [dialog, setDialog] = useState<
    | { kind: 'invite' }
    | { kind: 'role'; userId: string; name: string; role: WorkspaceRole }
    | { kind: 'remove'; userId: string; name: string }
    | null
  >(null)

  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const invitations = useQuery({
    queryKey: adminQueryKeys.invitations(workspaceId),
    queryFn: () => fetchInvitations(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const rows = members.data ?? []
  const names = useUserNames(
    rows.map((m) => m.userId),
    context.user,
  )
  const pending = (invitations.data ?? []).filter((i) => i.status === 'pending')

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: adminQueryKeys.members(workspaceId),
    })
    void queryClient.invalidateQueries({
      queryKey: adminQueryKeys.invitations(workspaceId),
    })
  }

  const act = useMutation({
    mutationFn: async (input: {
      kind: 'role' | 'suspend' | 'reinstate' | 'remove'
      userId: string
      role?: WorkspaceRole
    }) => {
      switch (input.kind) {
        case 'role':
          return changeMemberRole(dataClient, {
            workspaceId,
            userId: input.userId,
            newRole: input.role as WorkspaceRole,
          })
        case 'suspend':
          return suspendMember(dataClient, {
            workspaceId,
            userId: input.userId,
          })
        case 'reinstate':
          return reinstateMember(dataClient, {
            workspaceId,
            userId: input.userId,
          })
        case 'remove':
          return removeMember(dataClient, { workspaceId, userId: input.userId })
      }
    },
    onSuccess: (_result, input) => {
      invalidate()
      setDialog(null)
      toast(
        input.kind === 'remove'
          ? 'Member removed'
          : input.kind === 'suspend'
            ? 'Member suspended'
            : input.kind === 'reinstate'
              ? 'Member reinstated'
              : 'Role changed',
      )
    },
    onError: (error: unknown) =>
      toast('Could not change the member', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const invite = useMutation({
    mutationFn: (input: { email: string; role: WorkspaceRole }) =>
      createInvitation(dataClient, {
        workspaceId,
        email: input.email,
        role: input.role,
        expiresAfterDays: 7,
      }),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      toast('Invitation sent')
    },
    onError: (error: unknown) =>
      toast('Could not invite', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      revokeInvitation(dataClient, { workspaceId, invitationId }),
    onSuccess: () => {
      invalidate()
      toast('Invitation revoked')
    },
    onError: (error: unknown) =>
      toast('Could not revoke', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const memberRole = useMemo(
    () => rows.find((m) => m.userId === context.user.id)?.role,
    [rows, context.user.id],
  )

  return (
    <>
      <SettingsHeader
        title="Members and roles"
        count={rows.length}
        border={false}
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => setDialog({ kind: 'invite' })}
            >
              Invite people
            </Button>
          ) : null
        }
      >
        {context.workspace?.name ?? 'Workspace'} · roles decide what people can
        do; project membership decides where.
      </SettingsHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label="Members">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Added</TableHead>
              <TableHead align="right">{''}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  {names.userLabel(m.userId)}
                  {m.userId === context.user.id ? (
                    <span className="text-fg-muted"> · you</span>
                  ) : null}
                </TableCell>
                <TableCell>{WORKSPACE_ROLE_LABELS[m.role]}</TableCell>
                <TableCell>
                  <Status tone={m.suspendedAt ? 'warn' : 'ok'}>
                    {m.suspendedAt ? 'Suspended' : 'Active'}
                  </Status>
                </TableCell>
                <TableCell align="right" className="text-fg-muted">
                  {m.createdAt.slice(0, 10)}
                </TableCell>
                <TableCell align="right">
                  {canManage && m.userId !== context.user.id ? (
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        onClick={() =>
                          setDialog({
                            kind: 'role',
                            userId: m.userId,
                            name: names.userLabel(m.userId),
                            role: m.role,
                          })
                        }
                      >
                        Role
                      </Button>
                      {m.suspendedAt ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            act.mutate({ kind: 'reinstate', userId: m.userId })
                          }
                        >
                          Reinstate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() =>
                            act.mutate({ kind: 'suspend', userId: m.userId })
                          }
                        >
                          Suspend
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() =>
                          setDialog({
                            kind: 'remove',
                            userId: m.userId,
                            name: names.userLabel(m.userId),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!members.isLoading && rows.length === 0 ? (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="user"
              title="No members"
              body="Invite people to work in this workspace."
            />
          </div>
        ) : null}
      </div>
      <div className="border-t border-border-subtle px-4 py-4 md:px-6">
        <Section title="Invitations" count={pending.length}>
          {pending.length ? (
            <TableBox className="max-w-[720px]">
              <Table aria-label="Pending invitations">
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead align="right">{''}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.email}</TableCell>
                      <TableCell>{WORKSPACE_ROLE_LABELS[i.role]}</TableCell>
                      <TableCell className="text-fg-muted">
                        {i.expiresAt.slice(0, 10)}
                      </TableCell>
                      <TableCell align="right">
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="quiet"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(i.id)}
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No pending invitations.</Muted>
          )}
        </Section>
        <p className="mt-3 text-label text-fg-muted">
          {WORKSPACE_ROLE_DESCRIPTIONS[memberRole ?? 'viewer']}
        </p>
      </div>

      {dialog?.kind === 'invite' ? (
        <InviteDialog
          busy={invite.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(email, role) => invite.mutate({ email, role })}
        />
      ) : dialog?.kind === 'role' ? (
        <RoleDialog
          name={dialog.name}
          current={dialog.role}
          busy={act.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(role) =>
            act.mutate({ kind: 'role', userId: dialog.userId, role })
          }
        />
      ) : dialog?.kind === 'remove' ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setDialog(null))}>
          <DialogContent className="w-[min(480px,calc(100vw-32px))]">
            <DialogHeader
              title={`Remove ${dialog.name}?`}
              description="Their access ends now. Records they signed and their history stay as they are."
            />
            <DialogFooter>
              <DialogClose render={<Button />}>Cancel</DialogClose>
              <Button
                variant="danger-fill"
                disabled={act.isPending}
                onClick={() =>
                  act.mutate({ kind: 'remove', userId: dialog.userId })
                }
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

function InviteDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean
  onClose: () => void
  onSubmit: (email: string, role: WorkspaceRole) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const error = /.+@.+\..+/.test(email.trim())
    ? undefined
    : 'Enter an email address.'
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Invite someone"
          description="They get a sign-in link from your company sign-in. Access is decided by role and project membership."
        />
        <DialogBody>
          <Field label="Email address" required error={error}>
            <Input
              value={email}
              aria-invalid={Boolean(error) || undefined}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@cdmo.example"
            />
          </Field>
          <Field label="Role">
            <select
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {WORKSPACE_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Muted>{WORKSPACE_ROLE_DESCRIPTIONS[role]}</Muted>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || Boolean(error)}
            onClick={() => onSubmit(email.trim(), role)}
          >
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({
  name,
  current,
  busy,
  onClose,
  onSubmit,
}: {
  name: string
  current: WorkspaceRole
  busy: boolean
  onClose: () => void
  onSubmit: (role: WorkspaceRole) => void
}) {
  const [role, setRole] = useState<WorkspaceRole>(current)
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={`Change ${name}’s role`}
          description={`${WORKSPACE_ROLE_LABELS[current]} → ${WORKSPACE_ROLE_LABELS[role]}`}
        />
        <DialogBody>
          <Field label="Role">
            <select
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {WORKSPACE_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Muted>{WORKSPACE_ROLE_DESCRIPTIONS[role]}</Muted>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || role === current}
            onClick={() => onSubmit(role)}
          >
            Change role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
