import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import {
  Activity,
  Boxes,
  Database,
  Gauge,
  HardDrive,
  KeyRound,
  Lock,
  Settings,
  Shield,
  Terminal,
  UserRoundCog,
  Users,
  Workflow,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  AdminApiCredentials,
  AdminAuditExplorer,
  AdminConnectors,
  AdminDashboard,
  AdminDeployment,
  AdminDiagnostics,
  AdminInspector,
  AdminMembers,
  AdminPipelines,
  AdminProjectAccess,
  AdminSessions,
  AdminSettings,
  AdminStorage,
  AdminUsage,
} from '#/components/workspace-admin'
import { Button } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import type { Capability } from '#/lib/capability'
import {
  adminQueryKeys,
  changeMemberRole,
  createInvitation,
  describeAdminError,
  exportAuditLog,
  fetchInvitations,
  fetchProjectAccess,
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
import {
  apiCredentialQueryKey,
  createApiCredentialFn,
  listApiCredentialsFn,
  rotateApiCredentialFn,
  revokeApiCredentialFn,
} from '#/lib/api-credential-admin'
import type { CreatedCredentialWire } from '#/lib/api-credential-admin'
import type { Scope } from '#/lib/api-credential-scopes'
import { fetchMemberNamesFn } from '#/lib/admin-platform'

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AdminRoute,
})

const dataClient = createDataClient()

interface AdminSectionDef {
  key: string
  label: string
  description: string
  group: string
  icon: React.ComponentType<{ className?: string }>
  /** Capability required to see this section in nav and access it. */
  capability: Capability | null
}

const ADMIN_SECTIONS: AdminSectionDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Platform health, activity, usage, and attention indicators.',
    group: 'Overview',
    icon: Gauge,
    capability: null,
  },
  {
    key: 'users',
    label: 'Members',
    description: 'Manage workspace membership, roles and invitations.',
    group: 'Workspace',
    icon: Users,
    capability: 'workspace.admin',
  },
  {
    key: 'project-access',
    label: 'Project access',
    description: 'Control explicit user access to individual projects.',
    group: 'Workspace',
    icon: KeyRound,
    capability: 'workspace.admin',
  },
  {
    key: 'settings',
    label: 'Workspace settings',
    description: 'Set registration, review, signature and retention policies.',
    group: 'Workspace',
    icon: Settings,
    capability: 'workspace.admin',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    description: 'Review and revoke authenticated user sessions.',
    group: 'Security and audit',
    icon: UserRoundCog,
    capability: 'workspace.admin',
  },
  {
    key: 'api-credentials',
    label: 'API credentials',
    description:
      'Create, rotate and revoke scoped credentials for external automation.',
    group: 'Security and audit',
    icon: Lock,
    capability: 'workspace.admin',
  },
  {
    key: 'connectors',
    label: 'Connectors',
    description: 'Administer connector status, secrets, and run health.',
    group: 'Integrations',
    icon: Boxes,
    capability: 'integrations.manage',
  },
  {
    key: 'pipelines',
    label: 'Pipelines',
    description: 'Pipeline definitions, schedules, and run health.',
    group: 'Integrations',
    icon: Workflow,
    capability: 'pipelines.manage',
  },
  {
    key: 'storage',
    label: 'Storage',
    description: 'File storage overview and largest files.',
    group: 'Data',
    icon: HardDrive,
    capability: null,
  },
  {
    key: 'usage',
    label: 'Usage',
    description: 'Workspace usage counts and capacity indicators.',
    group: 'Data',
    icon: Database,
    capability: null,
  },
  {
    key: 'activity',
    label: 'Audit',
    description: 'Inspect and export the workspace audit trail.',
    group: 'Security and audit',
    icon: Activity,
    capability: null,
  },
  {
    key: 'diagnostics',
    label: 'Diagnostics',
    description: 'Health checks, scheduler, executor, and configuration state.',
    group: 'Platform',
    icon: Terminal,
    capability: null,
  },
  {
    key: 'deployment',
    label: 'Deployment',
    description: 'Version, environment, migration state, and operational links.',
    group: 'Platform',
    icon: Shield,
    capability: null,
  },
]

type AdminSectionKey = (typeof ADMIN_SECTIONS)[number]['key']

function sectionFromPath(pathname: string): AdminSectionKey {
  const candidate = pathname.split('/')[2]
  return ADMIN_SECTIONS.some((section) => section.key === candidate)
    ? (candidate)
    : 'dashboard'
}

function AdminRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const role = context.workspace?.role ?? null
  const isOwner = role === 'owner'
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const activeSection = sectionFromPath(pathname)

  // Filter sections by capability — nav only shows what the user can access.
  const visibleSections = ADMIN_SECTIONS.filter(
    (section) => !section.capability || hasCapability(role, section.capability),
  )
  const section = ADMIN_SECTIONS.find((item) => item.key === activeSection)!

  // Gate: if the user navigates to a section they can't access, redirect.
  if (section.capability && !hasCapability(role, section.capability)) {
    // Don't redirect — just show a permission notice. The nav won't show
    // inaccessible sections, but a direct URL should show a clear message.
  }

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [revealedCredential, setRevealedCredential] =
    useState<CreatedCredentialWire | null>(null)

  const enabled = Boolean(workspaceId)
  const membersQuery = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled,
  })
  const memberNamesQuery = useQuery({
    queryKey: ['admin-member-names', workspaceId],
    queryFn: () => fetchMemberNamesFn({ data: { workspaceId } }),
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

  const credentialsQuery = useQuery({
    queryKey: apiCredentialQueryKey(workspaceId),
    queryFn: () => listApiCredentialsFn({ data: { workspaceId } }),
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
        role: inviteRole,
        days,
      }: {
        email: string
        role: WorkspaceRole
        days: number
      }) =>
        createInvitation(dataClient, {
          workspaceId,
          email,
          role: inviteRole,
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
    mutation(({ userId, role: newRole }: { userId: string; role: WorkspaceRole }) =>
      changeMemberRole(dataClient, { workspaceId, userId, newRole }),
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
  const createCredential = useMutation({
    mutationFn: ({
      name,
      scopes,
      expiresAt,
    }: {
      name: string
      scopes: Scope[]
      expiresAt: string | null
    }) =>
      createApiCredentialFn({
        data: { workspaceId, name, scopes, expiresAt },
      }),
    onSuccess: (created) => {
      setActionError(null)
      setRevealedCredential(created)
      invalidate()
    },
    onError: (cause: unknown) =>
      setActionError(
        cause instanceof Error ? cause.message : describeAdminError(cause),
      ),
  })
  const revokeCredential = useMutation(
    mutation((credentialId: string) =>
      revokeApiCredentialFn({ data: { workspaceId, credentialId } }),
    ),
  )
  const rotateCredential = useMutation({
    mutationFn: (credentialId: string) =>
      rotateApiCredentialFn({ data: { workspaceId, credentialId } }),
    onSuccess: (created) => {
      setActionError(null)
      setRevealedCredential(created)
      invalidate()
    },
    onError: (cause: unknown) =>
      setActionError(
        cause instanceof Error ? cause.message : describeAdminError(cause),
      ),
  })
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
  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  useShell({
    fullBleed: true,
    context: shellContext,
    breadcrumbs: [
      { label: 'Settings' },
      { label: 'Platform Administration' },
    ],
    inspectorLabel: 'Member details',
    inspector: selectedMember && activeSection === 'users' ? (
      <AdminInspector
        member={selectedMember}
        currentUserId={context.user.id}
        isOwner={isOwner}
        onSuspend={() => suspend.mutate(selectedMember.userId)}
        onReinstate={() => reinstate.mutate(selectedMember.userId)}
        onRemove={() => remove.mutate(selectedMember.userId)}
        onRoleChange={(newRole) =>
          roleChange.mutate({ userId: selectedMember.userId, role: newRole })
        }
      />
    ) : null,
    primaryAction:
      isOwner && activeSection === 'activity' ? (
        <Button onClick={exportAudit} disabled={auditExport.isPending}>
          Export audit log
        </Button>
      ) : undefined,
  })

  // Check if the active section requires a capability the user lacks.
  const sectionDenied =
    section.capability && !hasCapability(role, section.capability)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-4 pt-6 pb-5 md:px-8">
        <header>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold">Platform Administration</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Administer workspace access, integrations, diagnostics and audit.
          </p>
        </header>
      </div>

      <nav aria-label="Administration sections" className="border-y bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] gap-0 overflow-x-auto px-4 md:px-8">
          {visibleSections.map((item, index) => {
            const Icon = item.icon
            const active = item.key === activeSection
            const startsNewGroup =
              index > 0 && visibleSections[index - 1].group !== item.group
            return (
              <Link
                key={item.key}
                to="/admin/$section"
                params={{ section: item.key }}
                search={{ model: undefined }}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-sm no-underline transition-colors ${startsNewGroup ? 'ml-1 border-l pl-4 md:ml-3 md:pl-6' : ''} ${active ? 'font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-8">
        {sectionDenied ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            You do not have permission to access this administration section.
          </div>
        ) : (
          <section className="min-w-0 space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{section.label}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
            </header>

            {activeSection === 'dashboard' ? (
              <AdminDashboard workspaceId={workspaceId} />
            ) : null}
            {activeSection === 'users' ? (
              <AdminMembers
                members={members}
                memberNames={memberNamesQuery.data ?? {}}
                invitations={invitations}
                currentUserId={context.user.id}
                isOwner={isOwner}
                selectedUserId={selectedUserId}
                onSelect={setSelectedUserId}
                search={memberSearch}
                onSearchChange={setMemberSearch}
                onInvite={(email, inviteRole, days) =>
                  invite.mutate({ email, role: inviteRole, days })
                }
                onRevokeInvitation={(id) => revokeInvite.mutate(id)}
                onRoleChange={(userId, newRole) =>
                  roleChange.mutate({ userId, role: newRole })
                }
                onSuspend={(id) => suspend.mutate(id)}
                onReinstate={(id) => reinstate.mutate(id)}
                onRemove={(id) => remove.mutate(id)}
              />
            ) : null}
            {activeSection === 'project-access' ? (
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
            ) : null}
            {activeSection === 'sessions' ? (
              <AdminSessions
                sessions={sessionsQuery.data ?? []}
                isOwner={isOwner}
                onRevoke={(id) => revokeSession.mutate(id)}
              />
            ) : null}
            {activeSection === 'api-credentials' ? (
              <AdminApiCredentials
                credentials={credentialsQuery.data ?? []}
                isOwner={isOwner}
                revealed={revealedCredential}
                onCreate={(name, scopes, expiresAt) =>
                  createCredential.mutate({ name, scopes, expiresAt })
                }
                onRevoke={(id) => revokeCredential.mutate(id)}
                onRotate={(id) => rotateCredential.mutate(id)}
                onDismissRevealed={() => setRevealedCredential(null)}
              />
            ) : null}
            {activeSection === 'connectors' ? (
              <AdminConnectors workspaceId={workspaceId} role={role ?? ''} />
            ) : null}
            {activeSection === 'pipelines' ? (
              <AdminPipelines workspaceId={workspaceId} role={role ?? ''} />
            ) : null}
            {activeSection === 'storage' ? (
              <AdminStorage workspaceId={workspaceId} />
            ) : null}
            {activeSection === 'usage' ? (
              <AdminUsage workspaceId={workspaceId} />
            ) : null}
            {activeSection === 'activity' ? (
              <AdminAuditExplorer
                actors={members.map((member) => ({
                  id: member.userId,
                  label: `${member.role}: ${member.userId.slice(0, 8)}`,
                }))}
              />
            ) : null}
            {activeSection === 'diagnostics' ? (
              <AdminDiagnostics workspaceId={workspaceId} role={role ?? ''} />
            ) : null}
            {activeSection === 'deployment' ? (
              <AdminDeployment workspaceId={workspaceId} />
            ) : null}
            {activeSection === 'settings' ? (
              <AdminSettings
                settings={settings}
                isOwner={isOwner}
                saving={saveSettings.isPending}
                onSave={(value) => saveSettings.mutate(value)}
              />
            ) : null}
          </section>
        )}
        {actionError && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {actionError}
          </p>
        )}
      </div>
    </div>
  )
}
