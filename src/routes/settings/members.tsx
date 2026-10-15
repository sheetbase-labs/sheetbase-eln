import { useId, useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
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
import { WorkspaceGroups } from '#/components/v3/settings/workspace-groups'
import { createDataClient } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import { hasCapability } from '#/lib/capability'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'
import {
  fetchWorkspaceGroups,
  fetchWorkspaceMemberStatus,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import {
  adminQueryKeys,
  changeMemberRole,
  createInvitation,
  fetchClients,
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
  // ADR-0049: a client account is not an internal member, so
  // `workspace_members_list` and the invitation list are refused to it. An
  // empty roster would claim this workspace has no members. The role decides
  // this for the whole life of the route, so the refusal returns before the
  // reads rather than issuing refused queries. The refusal precedes every other
  // hook, so the hook order is stable for as long as the route stays mounted.
  if (context.workspace?.role === 'client_viewer') {
    return (
      <>
        <SettingsHeader title="Members and roles" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="Only workspace members can see the roster"
            body="This is a client account. It shows the records your CDMO team shares with your client, not the workspace's own members and invitations."
          >
            <Button nativeButton={false} render={<Link to="/client-portal" />}>
              Open the client portal
            </Button>
          </EmptyState>
        </div>
      </>
    )
  }
  const queryClient = useQueryClient()
  const canManage = hasCapability(context.workspace?.role, 'workspace.admin')
  const [dialog, setDialog] = useState<
    | { kind: 'invite' }
    | { kind: 'groups' }
    | {
        kind: 'role'
        userId: string
        name: string
        role: WorkspaceRole
        clientId: string | null
      }
    | { kind: 'remove'; userId: string; name: string }
    | { kind: 'suspend'; userId: string; name: string }
    | { kind: 'reinstate'; userId: string; name: string }
    | { kind: 'revoke'; invitationId: string; email: string }
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
  const clients = useQuery({
    queryKey: ['ui-port', 'settings', 'clients', workspaceId],
    queryFn: () => fetchClients(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const groups = useQuery({
    queryKey: workspaceAccessKeys.groups(workspaceId),
    queryFn: () => fetchWorkspaceGroups(dataClient),
    enabled: Boolean(workspaceId),
  })
  const memberStatus = useQuery({
    queryKey: workspaceAccessKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMemberStatus(dataClient),
    enabled: Boolean(workspaceId),
  })
  const certifications = useQuery({
    queryKey: signatureCertificationQueryKeys.workspace(workspaceId),
    queryFn: () => fetchWorkspaceCertifications(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const clientName = (clientId: string | null | undefined) =>
    (clients.data ?? []).find((c) => c.id === clientId)?.name ?? '—'
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
      clientId?: string | null
    }) => {
      switch (input.kind) {
        case 'role':
          return changeMemberRole(dataClient, {
            workspaceId,
            userId: input.userId,
            newRole: input.role as WorkspaceRole,
            clientId: input.clientId ?? null,
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
    mutationFn: (input: {
      email: string
      role: WorkspaceRole
      clientId: string | null
    }) =>
      createInvitation(dataClient, {
        workspaceId,
        email: input.email,
        role: input.role,
        expiresAfterDays: 7,
        clientId: input.clientId,
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
      setDialog(null)
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
            <>
              <Button
                disabled={groups.isPending || groups.isError}
                onClick={() => setDialog({ kind: 'groups' })}
              >
                Groups
              </Button>
              <Button
                variant="primary"
                onClick={() => setDialog({ kind: 'invite' })}
              >
                Invite people
              </Button>
            </>
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
              <TableHead>Groups</TableHead>
              <TableHead>Training</TableHead>
              <TableHead>E-signature</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Last active</TableHead>
              <TableHead align="right" aria-label="Actions" />
            </TableRow>
          </TableHeader>
          <TableBody loading={members.isLoading} colSpan={8}>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  {names.userLabel(m.userId)}
                  {m.userId === context.user.id ? (
                    <span className="text-fg-muted"> · you</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {WORKSPACE_ROLE_LABELS[m.role]}
                  {m.role === 'client_viewer' ? (
                    <span className="text-fg-muted">
                      {' '}
                      · {clientName(m.clientId)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {groups.isError
                    ? 'Unavailable'
                    : groups.isPending
                      ? 'Loading…'
                      : groups.data
                          .filter((g) => g.member_ids.includes(m.userId))
                          .map((g) => g.name)
                          .join(', ') || '—'}
                </TableCell>
                <TableCell>
                  {m.role === 'client_viewer'
                    ? '—'
                    : (() => {
                        const status = memberStatus.data?.find(
                          (s) => s.user_id === m.userId,
                        )
                        if (!status)
                          return memberStatus.isPending
                            ? 'Loading…'
                            : 'Unavailable'
                        return (
                          <Status
                            tone={
                              status.training_overdue ||
                              status.training_required
                                ? 'warn'
                                : 'ok'
                            }
                          >
                            {status.training_overdue
                              ? `${status.training_overdue} overdue`
                              : status.training_required
                                ? `${status.training_required} to read`
                                : 'Current'}
                          </Status>
                        )
                      })()}
                </TableCell>
                <TableCell>
                  {m.role === 'client_viewer'
                    ? '—'
                    : (() => {
                        if (certifications.isPending) return 'Loading…'
                        if (certifications.isError) return 'Unavailable'
                        const certification = certifications.data.find(
                          (c) => c.userId === m.userId,
                        )
                        return certification?.revokedAt
                          ? 'Revoked'
                          : isCurrentStatement(certification)
                            ? 'Certified'
                            : certification?.verificationRequested
                              ? 'Pending verification'
                              : certification?.identityVerifiedAt
                                ? 'Identity verified / not certified'
                                : 'Not certified'
                      })()}
                </TableCell>
                <TableCell>
                  <Status tone={m.suspendedAt ? 'warn' : 'ok'}>
                    {m.suspendedAt ? 'Suspended' : 'Active'}
                  </Status>
                </TableCell>
                <TableCell align="right" className="text-fg-muted">
                  {memberStatus.isError
                    ? 'Unavailable'
                    : memberStatus.isPending
                      ? 'Loading…'
                      : (memberStatus.data
                          .find((s) => s.user_id === m.userId)
                          ?.last_active_at?.replace('T', ' ')
                          .slice(0, 16) ?? '—')}
                </TableCell>
                <TableCell align="right">
                  {canManage && m.userId !== context.user.id ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="sm"
                            aria-label={`Manage ${names.userLabel(m.userId)}`}
                          />
                        }
                      >
                        Manage
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setDialog({
                              kind: 'role',
                              userId: m.userId,
                              name: names.userLabel(m.userId),
                              role: m.role,
                              clientId: m.clientId ?? null,
                            })
                          }
                        >
                          Role
                        </DropdownMenuItem>
                        {m.suspendedAt ? (
                          <DropdownMenuItem
                            onClick={() =>
                              setDialog({
                                kind: 'reinstate',
                                userId: m.userId,
                                name: names.userLabel(m.userId),
                              })
                            }
                          >
                            Reinstate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              setDialog({
                                kind: 'suspend',
                                userId: m.userId,
                                name: names.userLabel(m.userId),
                              })
                            }
                          >
                            Suspend
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          danger
                          onClick={() =>
                            setDialog({
                              kind: 'remove',
                              userId: m.userId,
                              name: names.userLabel(m.userId),
                            })
                          }
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                    <TableHead align="right" aria-label="Actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.email}</TableCell>
                      <TableCell>
                        {WORKSPACE_ROLE_LABELS[i.role]}
                        {i.role === 'client_viewer' ? (
                          <span className="text-fg-muted">
                            {' '}
                            · {clientName(i.clientId)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {i.expiresAt.slice(0, 10)}
                      </TableCell>
                      <TableCell align="right">
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="quiet"
                            disabled={revoke.isPending}
                            onClick={() =>
                              setDialog({
                                kind: 'revoke',
                                invitationId: i.id,
                                email: i.email,
                              })
                            }
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

      {dialog?.kind === 'groups' ? (
        <WorkspaceGroups
          workspaceId={workspaceId}
          groups={groups.data ?? []}
          people={rows
            .filter((m) => !m.suspendedAt)
            .map((m) => ({ id: m.userId, name: names.userLabel(m.userId) }))}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === 'invite' ? (
        <InviteDialog
          clients={clients.data ?? []}
          busy={invite.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(email, role, clientId) =>
            invite.mutate({ email, role, clientId })
          }
        />
      ) : dialog?.kind === 'role' ? (
        <RoleDialog
          clients={clients.data ?? []}
          name={dialog.name}
          current={dialog.role}
          currentClientId={dialog.clientId}
          busy={act.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(role, clientId) =>
            act.mutate({ kind: 'role', userId: dialog.userId, role, clientId })
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
      ) : dialog?.kind === 'suspend' ? (
        <MembershipConfirmDialog
          kind="suspend"
          name={dialog.name}
          busy={act.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            act.mutate({ kind: 'suspend', userId: dialog.userId })
          }
        />
      ) : dialog?.kind === 'reinstate' ? (
        <MembershipConfirmDialog
          kind="reinstate"
          name={dialog.name}
          busy={act.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            act.mutate({ kind: 'reinstate', userId: dialog.userId })
          }
        />
      ) : dialog?.kind === 'revoke' ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => (o ? undefined : setDialog(null))}
        >
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                Revoke the invitation to {dialog.email}?
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                The sign-in link stops working immediately. They cannot join
                until you invite them again.
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel disabled={revoke.isPending}>
                Cancel
              </ConfirmDialogCancel>
              <ConfirmDialogAction
                variant="danger-fill"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(dialog.invitationId)}
              >
                Revoke invitation
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      ) : null}
    </>
  )
}

/** Suspending and reinstating both change access at once, so both ask first. */
function MembershipConfirmDialog({
  kind,
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: 'suspend' | 'reinstate'
  name: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const suspending = kind === 'suspend'
  return (
    <ConfirmDialog open onOpenChange={(o) => (o ? undefined : onCancel())}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {suspending ? `Suspend ${name}?` : `Reinstate ${name}?`}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {suspending
              ? 'They lose access to this workspace immediately. Their records, signatures and history stay as they are, and you can reinstate them.'
              : 'They regain access to this workspace with the role they hold now.'}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={busy}>Cancel</ConfirmDialogCancel>
          <ConfirmDialogAction
            variant={suspending ? 'danger-fill' : 'primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {suspending ? 'Suspend' : 'Reinstate'}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

function InviteDialog({
  clients,
  busy,
  onClose,
  onSubmit,
}: {
  clients: { id: string; code: string; name: string }[]
  busy: boolean
  onClose: () => void
  onSubmit: (
    email: string,
    role: WorkspaceRole,
    clientId: string | null,
  ) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const [clientId, setClientId] = useState(clients.at(0)?.id ?? '')
  // The empty address is invalid from the first paint, but the dialog opens
  // before anyone has used the field, so the message waits for the first
  // keystroke or blur. Send stays disabled until the address is valid either
  // way, which needs no message.
  const [emailUsed, setEmailUsed] = useState(false)
  const emailErrorId = useId()
  const emailValid = /.+@.+\..+/.test(email.trim())
  const error = emailValid || !emailUsed ? undefined : 'Enter an email address.'
  const clientError =
    role === 'client_viewer' && !clientId ? 'Choose a client.' : undefined
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Invite someone"
          description="They get a sign-in link from your company sign-in. Access is decided by role and project membership."
        />
        <DialogBody>
          <Field
            label="Email address"
            required
            error={error ? <span id={emailErrorId}>{error}</span> : undefined}
          >
            <Input
              value={email}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? emailErrorId : undefined}
              onChange={(e) => {
                setEmail(e.target.value)
                setEmailUsed(true)
              }}
              onBlur={() => setEmailUsed(true)}
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
          {role === 'client_viewer' ? (
            <Field label="Client" required error={clientError}>
              <select
                className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Muted>{WORKSPACE_ROLE_DESCRIPTIONS[role]}</Muted>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !emailValid || Boolean(clientError)}
            onClick={() =>
              onSubmit(
                email.trim(),
                role,
                role === 'client_viewer' ? clientId : null,
              )
            }
          >
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({
  clients,
  name,
  current,
  currentClientId,
  busy,
  onClose,
  onSubmit,
}: {
  clients: { id: string; code: string; name: string }[]
  name: string
  current: WorkspaceRole
  currentClientId: string | null
  busy: boolean
  onClose: () => void
  onSubmit: (role: WorkspaceRole, clientId: string | null) => void
}) {
  const [role, setRole] = useState<WorkspaceRole>(current)
  const [clientId, setClientId] = useState(
    currentClientId ?? clients.at(0)?.id ?? '',
  )
  const clientError =
    role === 'client_viewer' && !clientId ? 'Choose a client.' : undefined
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
          {role === 'client_viewer' ? (
            <Field label="Client" required error={clientError}>
              <select
                className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Muted>{WORKSPACE_ROLE_DESCRIPTIONS[role]}</Muted>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={
              busy ||
              Boolean(clientError) ||
              (role === current &&
                (role !== 'client_viewer' || clientId === currentClientId))
            }
            onClick={() =>
              onSubmit(role, role === 'client_viewer' ? clientId : null)
            }
          >
            Change role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
