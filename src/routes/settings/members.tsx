import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { useId, useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
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
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { WorkspaceGroups } from '#/components/v3/settings/workspace-groups'
import { createDataClient } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import { MemberUsernameDialog } from '#/components/v3/settings/member-username-dialog'
import { MemberSessionsDialog } from '#/components/v3/settings/member-sessions-dialog'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'
import {
  fetchMyProjectPermissions,
  fetchWorkspaceGroups,
  fetchWorkspaceMemberStatus,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import { fetchProjectSummaries } from '#/components/v3/projects/project-data'
import {
  adminQueryKeys,
  changeMemberRole,
  createInvitation,
  reissueInvitation,
  describeAdminError,
  invitationLink,
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
import type {
  InvitationProjectGrant,
  InvitedProjectLevel,
  WorkspaceRole,
} from '#/lib/workspace-admin'
import { canManageSettings } from '#/lib/settings-access'
import { formatDate } from '#/lib/format-date'

/** UI port (roadmap-4/ui-app3): members and roles on workspace_memberships and
 * workspace_invitations. Roles decide what people can do; the role change,
 * suspend, reinstate, remove and invite RPCs hold the rules server-side. */
export const Route = createFileRoute('/settings/members')({
  validateSearch: (search: Record<string, unknown>): { invite?: 'admin' } => ({
    invite: search.invite === 'admin' ? 'admin' : undefined,
  }),
  component: Members,
})

const dataClient = createDataClient()
const roles = Object.keys(WORKSPACE_ROLE_LABELS) as WorkspaceRole[]

function Members() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
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
            description="This is a client account. It shows the records your CDMO team shares with your client, not the workspace's own members and invitations."
            action={
              <Button
                nativeButton={false}
                render={<Link to="/client-portal" />}
              >
                Open the client portal
              </Button>
            }
          />
        </div>
      </>
    )
  }
  const queryClient = useQueryClient()
  const canManage = canManageSettings(context.workspace, 'members')
  const [dialog, setDialog] = useState<
    | { kind: 'invite' }
    | { kind: 'groups' }
    | { kind: 'invite-link'; email: string; link: string; reissued?: boolean }
    | {
        kind: 'role'
        userId: string
        name: string
        role: WorkspaceRole
        clientId: string | null
      }
    | { kind: 'remove'; userId: string; name: string }
    | { kind: 'sessions'; userId: string; name: string }
    | { kind: 'username'; userId: string; name: string; username: string }
    | { kind: 'suspend'; userId: string; name: string }
    | { kind: 'reinstate'; userId: string; name: string }
    | { kind: 'revoke'; invitationId: string; email: string }
    | null
  >(
    // J-SET-02: "invite another administrator" deep-links here with the dialog
    // already open on the Administrator role.
    search.invite === 'admin' && canManage ? { kind: 'invite' } : null,
  )

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
  const [roleFilter, setRoleFilter] = useState('')
  const [trainingFilter, setTrainingFilter] = useState('')
  const trainingOf = (userId: string) => {
    const status = memberStatus.data?.find((s) => s.user_id === userId)
    if (!status) return null
    return status.training_overdue
      ? 'overdue'
      : status.training_required
        ? 'to-read'
        : 'current'
  }
  const shownRows = rows.filter(
    (m) =>
      (!roleFilter || m.role === roleFilter) &&
      (!trainingFilter || trainingOf(m.userId) === trainingFilter),
  )
  const names = useUserNames(
    rows.map((m) => m.userId),
    context.user,
  )
  // The projects the inviter can add someone to: the ones they manage. The
  // database holds the same rule when the invitation is created.
  const grantableProjects = useQuery({
    queryKey: ['settings-members-grantable-projects', workspaceId],
    queryFn: async () => {
      const projects = await fetchProjectSummaries(workspaceId)
      const open = projects.filter((p) => !p.archivedAt)
      const permissions = await fetchMyProjectPermissions(dataClient)
      return open
        .filter((p) => permissions.get(p.id)?.can_manage)
        .map((p) => ({ id: p.id, title: p.title }))
    },
    enabled: Boolean(workspaceId) && canManage && dialog?.kind === 'invite',
    staleTime: 30_000,
  })
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
      projectGrants: InvitationProjectGrant[]
    }) =>
      createInvitation(dataClient, {
        workspaceId,
        email: input.email,
        role: input.role,
        expiresAfterDays: 7,
        clientId: input.clientId,
        projectGrants: input.projectGrants,
      }),
    onSuccess: (result) => {
      invalidate()
      // No email is sent: the link is the invitation. It is shown once, as the
      // database keeps only a hash of the token.
      setDialog({
        kind: 'invite-link',
        email: result.invitation.email,
        link: invitationLink(window.location.origin, result.token),
      })
    },
    onError: (error: unknown) =>
      toast('Could not invite', { description: describeAdminError(error) }),
  })

  // A lost link cannot be shown again, but a pending invitation can be given a
  // new one without revoking it and starting over.
  const reissue = useMutation({
    mutationFn: (invitationId: string) =>
      reissueInvitation(dataClient, { workspaceId, invitationId }),
    onSuccess: (result) => {
      invalidate()
      setDialog({
        kind: 'invite-link',
        email: result.invitation.email,
        link: invitationLink(window.location.origin, result.token),
        reissued: true,
      })
    },
    onError: (error: unknown) =>
      toast('Could not make a new link', {
        description: describeAdminError(error),
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

  const memberColumns: RegistryColumn<(typeof rows)[number]>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <>
          {names.userLabel(row.original.userId)}
          {row.original.userId === context.user.id ? (
            <span className="text-fg-muted"> · you</span>
          ) : null}
          {row.original.suspendedAt ? (
            <span className="text-warn-text"> · suspended</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'username',
      header: 'Username',
      cell: ({ row }) =>
        row.original.username ? (
          <span className="mono">{row.original.username}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <>
          {WORKSPACE_ROLE_LABELS[row.original.role]}
          {row.original.role === 'client_viewer' ? (
            <span
              className="ml-1 inline-block max-w-28 truncate align-bottom text-fg-muted"
              title={clientName(row.original.clientId)}
            >
              · {clientName(row.original.clientId)}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'groups',
      header: 'Groups',
      cell: ({ row }) => {
        if (groups.isError) return 'Unavailable'
        if (groups.isPending) return 'Loading…'
        const joined = groups.data
          .filter((group) => group.member_ids.includes(row.original.userId))
          .map((group) => group.name)
          .join(', ')
        return joined ? (
          <span className="block max-w-40 truncate" title={joined}>
            {joined}
          </span>
        ) : (
          '—'
        )
      },
    },
    {
      id: 'training',
      header: 'Training',
      cell: ({ row }) => {
        const member = row.original
        if (member.role === 'client_viewer') return '—'
        const status = memberStatus.data?.find(
          (entry) => entry.user_id === member.userId,
        )
        if (!status) return memberStatus.isPending ? 'Loading…' : 'Unavailable'
        return (
          <Status
            tone={
              status.training_overdue || status.training_required
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
      },
    },
    {
      id: 'signature',
      header: 'E-signature',
      cell: ({ row }) => {
        const member = row.original
        if (member.role === 'client_viewer') return '—'
        if (certifications.isPending) return 'Loading…'
        if (certifications.isError) return 'Unavailable'
        const certification = certifications.data.find(
          (entry) => entry.userId === member.userId,
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
      },
    },
    {
      id: 'lastActive',
      header: 'Last active',
      meta: {
        ...rightAligned<(typeof rows)[number]>().meta,
        cellClassName: 'text-right text-fg-muted',
      },
      cell: ({ row }) => {
        const member = row.original
        if (memberStatus.isError) return 'Unavailable'
        if (memberStatus.isPending) return 'Loading…'
        return formatDate(
          memberStatus.data.find((entry) => entry.user_id === member.userId)
            ?.last_active_at,
          { time: true, year: false },
        )
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: rightAligned<(typeof rows)[number]>().meta,
      cell: ({ row }) => {
        const member = row.original
        if (!canManage || member.userId === context.user.id) return null
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  aria-label={`Manage ${names.userLabel(member.userId)}`}
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
                    userId: member.userId,
                    name: names.userLabel(member.userId),
                    role: member.role,
                    clientId: member.clientId ?? null,
                  })
                }
              >
                Role
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setDialog({
                    kind: 'sessions',
                    userId: member.userId,
                    name: names.userLabel(member.userId),
                  })
                }
              >
                Sessions
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setDialog({
                    kind: 'username',
                    userId: member.userId,
                    name: names.userLabel(member.userId),
                    username: member.username ?? '',
                  })
                }
              >
                Username
              </DropdownMenuItem>
              {member.suspendedAt ? (
                <DropdownMenuItem
                  onClick={() =>
                    setDialog({
                      kind: 'reinstate',
                      userId: member.userId,
                      name: names.userLabel(member.userId),
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
                      userId: member.userId,
                      name: names.userLabel(member.userId),
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
                    userId: member.userId,
                    name: names.userLabel(member.userId),
                  })
                }
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const invitationColumns: RegistryColumn<(typeof pending)[number]>[] = [
    {
      id: 'email',
      header: 'Email',
      cell: ({ row }) => row.original.email,
    },
    {
      id: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <>
          {WORKSPACE_ROLE_LABELS[row.original.role]}
          {row.original.role === 'client_viewer' ? (
            <span className="text-fg-muted">
              {' '}
              · {clientName(row.original.clientId)}
            </span>
          ) : null}
          {row.original.projectGrants.length ? (
            <span className="text-fg-muted">
              {' '}
              · {row.original.projectGrants.length}{' '}
              {row.original.projectGrants.length === 1 ? 'project' : 'projects'}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => formatDate(row.original.expiresAt),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: rightAligned<(typeof pending)[number]>().meta,
      cell: ({ row }) =>
        canManage ? (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="quiet"
              disabled={reissue.isPending}
              onClick={() => reissue.mutate(row.original.id)}
            >
              Copy new link
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={revoke.isPending}
              onClick={() =>
                setDialog({
                  kind: 'revoke',
                  invitationId: row.original.id,
                  email: row.original.email,
                })
              }
            >
              Revoke
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <>
      <SettingsHeader
        title="Members and roles"
        count={rows.length}
        border={false}
        actions={
          <>
            <Button nativeButton={false} render={<Link to="/settings/roles" />}>
              Roles and permissions
            </Button>
            {canManage ? (
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
            ) : null}
          </>
        }
      >
        {context.workspace?.name ?? 'Workspace'} · roles decide what people can
        do; project membership decides where.
      </SettingsHeader>
      <div
        role="toolbar"
        aria-label="Filter members"
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-6"
      >
        <Select
          aria-label="Role"
          size="sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="">Role: any</option>
          {[...new Set(rows.map((m) => m.role))].map((role) => (
            <option key={role} value={role}>
              {WORKSPACE_ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Training"
          size="sm"
          value={trainingFilter}
          onChange={(e) => setTrainingFilter(e.target.value)}
        >
          <option value="">Training: any</option>
          <option value="current">Current</option>
          <option value="to-read">To read</option>
          <option value="overdue">Overdue</option>
        </Select>
        {roleFilter || trainingFilter ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setRoleFilter('')
              setTrainingFilter('')
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length || members.isLoading ? (
          <RegistryGrid
            label="Members"
            rows={shownRows}
            columns={memberColumns}
            getRowId={(member) => member.id}
            isLoading={members.isLoading}
            selectable={false}
          />
        ) : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="user"
              title="No members"
              description="Invite people to work in this workspace."
              action={
                canManage ? (
                  <Button
                    variant="primary"
                    onClick={() => setDialog({ kind: 'invite' })}
                  >
                    Invite people
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
      <div className="border-t border-border-subtle px-4 py-4 md:px-6">
        <Section title="Invitations" count={pending.length}>
          {pending.length ? (
            <TableBox>
              <RegistryGrid
                label="Pending invitations"
                rows={pending}
                columns={invitationColumns}
                getRowId={(invitation) => invitation.id}
                selectable={false}
              />
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
      ) : dialog?.kind === 'sessions' ? (
        <MemberSessionsDialog
          workspaceId={workspaceId}
          userId={dialog.userId}
          name={dialog.name}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === 'username' ? (
        <MemberUsernameDialog
          workspaceId={workspaceId}
          userId={dialog.userId}
          name={dialog.name}
          current={dialog.username}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === 'invite-link' ? (
        <InviteLinkDialog
          email={dialog.email}
          link={dialog.link}
          reissued={dialog.reissued}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === 'invite' ? (
        <InviteDialog
          initialRole={search.invite === 'admin' ? 'admin' : 'viewer'}
          clients={clients.data ?? []}
          projects={grantableProjects.data ?? []}
          busy={invite.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(email, role, clientId, projectGrants) =>
            invite.mutate({ email, role, clientId, projectGrants })
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
                The invitation link stops working immediately. They cannot join
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

const INVITED_PROJECT_LEVELS: { value: InvitedProjectLevel; label: string }[] =
  [
    { value: 'editor', label: 'Editor' },
    { value: 'reviewer', label: 'Reviewer' },
    { value: 'viewer', label: 'Viewer' },
    { value: 'owner', label: 'Owner' },
  ]

function InviteDialog({
  initialRole,
  clients,
  projects,
  busy,
  onClose,
  onSubmit,
}: {
  initialRole: WorkspaceRole
  clients: { id: string; code: string; name: string }[]
  /** Projects the inviter can add the person to. */
  projects: { id: string; title: string }[]
  busy: boolean
  onClose: () => void
  onSubmit: (
    email: string,
    role: WorkspaceRole,
    clientId: string | null,
    projectGrants: InvitationProjectGrant[],
  ) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>(initialRole)
  const [clientId, setClientId] = useState(clients.at(0)?.id ?? '')
  const [projectIds, setProjectIds] = useState<ReadonlySet<string>>(new Set())
  const [projectLevel, setProjectLevel] = useState<InvitedProjectLevel | null>(
    null,
  )
  // A viewer joins as a viewer, anyone else as an editor, unless chosen.
  const level: InvitedProjectLevel =
    projectLevel ?? (role === 'viewer' ? 'viewer' : 'editor')
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
          description="You get a one-time link to send them. It signs them in and adds them to this workspace with the role you choose."
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
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {WORKSPACE_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {role === 'client_viewer' ? (
            <Field label="Client" required error={clientError}>
              <PickerSelect
                noun="client"
                value={clientId}
                onChange={(id) => setClientId(id)}
                placeholder="Choose a client…"
                options={clients.map((c) => ({
                  id: c.id,
                  identifier: c.code,
                  label: c.name,
                }))}
              />
            </Field>
          ) : null}
          <Muted>{WORKSPACE_ROLE_DESCRIPTIONS[role]}</Muted>
          {role !== 'client_viewer' && projects.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-label font-medium">
                Add to projects
              </legend>
              <Muted>
                They join these projects as soon as they accept, so nobody has
                to add them afterwards.
              </Muted>
              <div className="flex max-h-40 flex-col gap-1 overflow-auto">
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex items-center gap-2 text-body"
                  >
                    <input
                      type="checkbox"
                      checked={projectIds.has(project.id)}
                      onChange={(e) => {
                        const next = new Set(projectIds)
                        if (e.target.checked) next.add(project.id)
                        else next.delete(project.id)
                        setProjectIds(next)
                      }}
                    />
                    {project.title}
                  </label>
                ))}
              </div>
              {projectIds.size > 0 ? (
                <Field label="Access on those projects">
                  <Select
                    value={level}
                    onChange={(e) =>
                      setProjectLevel(e.target.value as InvitedProjectLevel)
                    }
                  >
                    {INVITED_PROJECT_LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </fieldset>
          ) : null}
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
                role === 'client_viewer'
                  ? []
                  : [...projectIds].map((project_id) => ({
                      project_id,
                      access_level: level,
                    })),
              )
            }
          >
            Create invitation link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The one-time link for a new invitation, with a Copy control. */
function InviteLinkDialog({
  email,
  link,
  reissued = false,
  onClose,
}: {
  email: string
  link: string
  /** A replacement link: the one sent before no longer works. */
  reissued?: boolean
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Send this link to the invitee"
          description={`Sheetbase does not email invitations. Send ${email} this link yourself. It works once, for 7 days, and cannot be shown again, so copy it now. If you lose it, use Copy new link on the pending invitation.${reissued ? ' The link sent before no longer works.' : ''}`}
        />
        <DialogBody>
          <Field label="Invitation link">
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <DialogClose render={<Button variant="primary" />}>Done</DialogClose>
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
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {WORKSPACE_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {role === 'client_viewer' ? (
            <Field label="Client" required error={clientError}>
              <PickerSelect
                noun="client"
                value={clientId}
                onChange={(id) => setClientId(id)}
                placeholder="Choose a client…"
                options={clients.map((c) => ({
                  id: c.id,
                  identifier: c.code,
                  label: c.name,
                }))}
              />
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
