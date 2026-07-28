import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Shield } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
  AdminActivity,
  AdminInspector,
  AdminMembers,
  AdminProjectAccess,
  AdminSessions,
  AdminSettings,
} from '#/components/workspace-admin'
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  adminQueryKeys,
  changeMemberRole,
  createInvitation,
  describeAdminError,
  exportAuditLog,
  fetchInvitations,
  fetchProjectAccess,
  fetchWorkspaceActivity,
  fetchWorkspaceMembers,
  fetchWorkspaceSessions,
  fetchWorkspaceSettings,
  grantProjectAccess,
  reinstateMember,
  removeMember,
  revokeInvitation,
  revokeProjectAccess,
  revokeUserSession,
  suspendMember,
  updateWorkspaceSettings,
} from '#/lib/workspace-admin'
import type {
  ProjectAccessLevel,
  WorkspaceRole,
  WorkspaceSettings,
} from '#/lib/workspace-admin'

const getAdminContext = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  return getCurrentContext(getRequestHeaders())
})

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const context = await getAdminContext()
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AdminRoute,
})

const dataClient = createDataClient()

export function AdminRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const isOwner = context.workspace?.role === 'owner'
  const [activeTab, setActiveTab] = useState('users')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const enabled = Boolean(workspaceId)
  const membersQuery = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled,
  })
  const invitationsQuery = useQuery({
    queryKey: adminQueryKeys.invitations(workspaceId),
    queryFn: () => fetchInvitations(dataClient, workspaceId),
    enabled,
  })
  const settingsQuery = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId),
    enabled,
  })
  const sessionsQuery = useQuery({
    queryKey: adminQueryKeys.sessions(workspaceId),
    queryFn: () => fetchWorkspaceSessions(dataClient, workspaceId),
    enabled,
  })
  const accessQuery = useQuery({
    queryKey: adminQueryKeys.projectAccess(workspaceId),
    queryFn: () => fetchProjectAccess(dataClient, workspaceId),
    enabled,
  })
  const activityQuery = useQuery({
    queryKey: adminQueryKeys.activity(workspaceId),
    queryFn: () => fetchWorkspaceActivity(dataClient, workspaceId, 250),
    enabled,
  })
  const members = membersQuery.data ?? [],
    invitations = invitationsQuery.data ?? [],
    settings = settingsQuery.data ?? null
  const selectedMember = useMemo(
    () => members.find((member) => member.userId === selectedUserId) ?? null,
    [members, selectedUserId],
  )

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin-001'] })
  }
  function mutation<T, TValue>(fn: (value: TValue) => Promise<T>) {
    return {
      mutationFn: fn,
      onSuccess: () => {
        setActionError(null)
        invalidate()
      },
      onError: (cause: unknown) => setActionError(describeAdminError(cause)),
    }
  }
  const invite = useMutation(
    mutation(
      ({
        email,
        role,
        days,
      }: {
        email: string
        role: WorkspaceRole
        days: number
      }) =>
        createInvitation(dataClient, {
          workspaceId,
          email,
          role,
          expiresAfterDays: days,
        }),
    ),
  )
  const revokeInvite = useMutation(
    mutation((id: string) =>
      revokeInvitation(dataClient, { workspaceId, invitationId: id }),
    ),
  )
  const roleChange = useMutation(
    mutation(({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      changeMemberRole(dataClient, { workspaceId, userId, newRole: role }),
    ),
  )
  const remove = useMutation(
    mutation((userId: string) =>
      removeMember(dataClient, { workspaceId, userId }),
    ),
  )
  const suspend = useMutation(
    mutation((userId: string) =>
      suspendMember(dataClient, { workspaceId, userId }),
    ),
  )
  const reinstate = useMutation(
    mutation((userId: string) =>
      reinstateMember(dataClient, { workspaceId, userId }),
    ),
  )
  const revokeSession = useMutation(
    mutation((sessionId: string) =>
      revokeUserSession(dataClient, { workspaceId, sessionId }),
    ),
  )
  const saveSettings = useMutation(
    mutation((value: Partial<WorkspaceSettings>) =>
      updateWorkspaceSettings(dataClient, {
        workspaceId,
        registrationMode: value.registrationMode,
        reviewWorkflowEnabled: value.reviewWorkflowEnabled,
        reviewWorkflowConfig: value.reviewWorkflowConfig,
        signaturePolicy: value.signaturePolicy,
        auditRetentionDays: value.auditRetentionDays,
        integrationSettings: value.integrationSettings,
      }),
    ),
  )
  const grant = useMutation(
    mutation(
      ({
        projectId,
        userId,
        level,
      }: {
        projectId: string
        userId: string
        level: ProjectAccessLevel
      }) =>
        grantProjectAccess(dataClient, {
          workspaceId,
          projectId,
          userId,
          accessLevel: level,
        }),
    ),
  )
  const revokeAccess = useMutation(
    mutation(({ projectId, userId }: { projectId: string; userId: string }) =>
      revokeProjectAccess(dataClient, { workspaceId, projectId, userId }),
    ),
  )
  const auditExport = useMutation({
    mutationFn: () => exportAuditLog(dataClient, { workspaceId, limit: 5000 }),
    onSuccess: (events) => {
      const blob = new Blob([JSON.stringify(events, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `workspace-audit-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setActionError(null)
    },
    onError: (cause) => setActionError(describeAdminError(cause)),
  })
  const exportAudit = () => auditExport.mutate()
  const retention = settings?.auditRetentionDays ?? 0
  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[
        { label: 'Settings' },
        { label: 'Workspace Settings & Permissions' },
      ]}
      inspectorLabel="Member details"
      inspector={
        selectedMember ? (
          <AdminInspector
            member={selectedMember}
            currentUserId={context.user.id}
            isOwner={isOwner}
            onSuspend={() => suspend.mutate(selectedMember.userId)}
            onReinstate={() => reinstate.mutate(selectedMember.userId)}
            onRemove={() => remove.mutate(selectedMember.userId)}
            onRoleChange={(role) =>
              roleChange.mutate({ userId: selectedMember.userId, role })
            }
          />
        ) : null
      }
      primaryAction={
        isOwner ? (
          <Button onClick={exportAudit} disabled={auditExport.isPending}>
            Export audit log
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <header>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold">
              Workspace Settings &amp; Permissions
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage workspace users, access, security, and operational settings.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Active users', members.filter((m) => !m.suspendedAt).length],
            [
              'Pending invites',
              invitations.filter((i) => i.status === 'pending').length,
            ],
            [
              'Registration mode',
              settings?.registrationMode === 'open'
                ? 'Open'
                : 'Invitation only',
            ],
            [
              'Audit retention',
              retention >= 365 && retention % 365 === 0
                ? `${retention / 365} years`
                : `${retention} days`,
            ],
            [
              'Review workflow',
              settings?.reviewWorkflowEnabled ? 'Enabled' : 'Disabled',
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-background p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
        {!isOwner && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            You can view workspace administration data. Admin actions are
            owner-only.
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="access">Project Access</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <AdminMembers
              members={members}
              invitations={invitations}
              currentUserId={context.user.id}
              isOwner={isOwner}
              selectedUserId={selectedUserId}
              onSelect={setSelectedUserId}
              search={search}
              onSearchChange={setSearch}
              onInvite={(email, role, days) =>
                invite.mutate({ email, role, days })
              }
              onRevokeInvitation={(id) => revokeInvite.mutate(id)}
              onRoleChange={(userId, role) =>
                roleChange.mutate({ userId, role })
              }
              onSuspend={(id) => suspend.mutate(id)}
              onReinstate={(id) => reinstate.mutate(id)}
              onRemove={(id) => remove.mutate(id)}
            />
          </TabsContent>
          <TabsContent value="access">
            <AdminProjectAccess
              access={accessQuery.data ?? []}
              isOwner={isOwner}
              onGrant={(projectId, userId, level) =>
                grant.mutate({ projectId, userId, level })
              }
              onRevoke={(projectId, userId) =>
                revokeAccess.mutate({ projectId, userId })
              }
            />
          </TabsContent>
          <TabsContent value="sessions">
            <AdminSessions
              sessions={sessionsQuery.data ?? []}
              isOwner={isOwner}
              onRevoke={(id) => revokeSession.mutate(id)}
            />
          </TabsContent>
          <TabsContent value="activity">
            <AdminActivity
              events={activityQuery.data ?? []}
              isOwner={isOwner}
              onExport={exportAudit}
            />
          </TabsContent>
          <TabsContent value="settings">
            <AdminSettings
              settings={settings}
              isOwner={isOwner}
              saving={saveSettings.isPending}
              onSave={(value) => saveSettings.mutate(value)}
            />
          </TabsContent>
        </Tabs>
        {actionError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {actionError}
          </p>
        )}
      </div>
    </AppShell>
  )
}
