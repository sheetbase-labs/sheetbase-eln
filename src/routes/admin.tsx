import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  Activity,
  Database,
  KeyRound,
  Settings,
  Shield,
  UserRoundCog,
  Users,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  AdminActivity,
  AdminInspector,
  AdminMembers,
  AdminProjectAccess,
  AdminSessions,
  AdminSettings,
} from '#/components/workspace-admin'
import { AdminModelFields } from '#/components/workspace-admin/admin-model-fields'
import { Button } from '#/components/ui'
import { hasCapability } from '#/lib/capability'
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

export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>) => ({
    model: typeof search.model === 'string' ? search.model : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AdminRoute,
})

const dataClient = createDataClient()

const ADMIN_SECTIONS = [
  {
    key: 'users',
    label: 'Users',
    description: 'Manage workspace membership, roles and invitations.',
    group: 'Workspace',
    icon: Users,
  },
  {
    key: 'project-access',
    label: 'Project access',
    description: 'Control explicit user access to individual projects.',
    group: 'Workspace',
    icon: KeyRound,
  },
  {
    key: 'model-fields',
    label: 'Model fields',
    description: 'Configure governed workspace fields for domain models.',
    group: 'Workspace',
    icon: Database,
  },
  {
    key: 'settings',
    label: 'Workspace settings',
    description: 'Set registration, review, signature and retention policies.',
    group: 'Workspace',
    icon: Settings,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    description: 'Review and revoke authenticated user sessions.',
    group: 'Security and audit',
    icon: UserRoundCog,
  },
  {
    key: 'activity',
    label: 'Activity',
    description: 'Inspect and export the workspace audit trail.',
    group: 'Security and audit',
    icon: Activity,
  },
] as const

type AdminSection = (typeof ADMIN_SECTIONS)[number]['key']

function sectionFromPath(pathname: string): AdminSection {
  const candidate = pathname.split('/')[2]
  return ADMIN_SECTIONS.some((section) => section.key === candidate)
    ? (candidate as AdminSection)
    : 'users'
}

function AdminRoute() {
  const { context } = Route.useRouteContext()
  const routeSearch = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const isOwner = context.workspace?.role === 'owner'
  const canManageModelFields = hasCapability(
    context.workspace?.role,
    'schema.edit',
  )
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const activeSection = sectionFromPath(pathname)
  const section = ADMIN_SECTIONS.find((item) => item.key === activeSection)!
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [memberSearch, setMemberSearch] = useState('')

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
      { label: 'Workspace Settings & Permissions' },
    ],
    inspectorLabel: 'Member details',
    inspector: selectedMember ? (
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
    ) : null,
    primaryAction:
      isOwner && activeSection === 'activity' ? (
        <Button onClick={exportAudit} disabled={auditExport.isPending}>
          Export audit log
        </Button>
      ) : undefined,
  })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-4 pt-6 pb-5 md:px-8">
        <header>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold">Administration</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Govern workspace access, scientific models, security and compliance.
          </p>
        </header>
        {!isOwner && (
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            You can view workspace administration data. Admin actions are
            owner-only.
          </div>
        )}
      </div>

      <nav aria-label="Administration sections" className="border-y">
        <div className="mx-auto flex w-full max-w-[1600px] overflow-x-auto px-4 md:px-8">
          {ADMIN_SECTIONS.map((item, index) => {
            const Icon = item.icon
            const active = item.key === activeSection
            const startsNewGroup =
              index > 0 && ADMIN_SECTIONS[index - 1].group !== item.group
            return (
              <Link
                key={item.key}
                to="/admin/$section"
                params={{ section: item.key }}
                search={{
                  model:
                    item.key === 'model-fields' ? routeSearch.model : undefined,
                }}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-11 shrink-0 items-center gap-2 px-3 text-sm no-underline transition-colors ${startsNewGroup ? 'ml-2 border-l pl-5' : ''} ${active ? 'font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-8">
        <section className="min-w-0 space-y-5">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{section.label}</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {section.description}
              </p>
            </div>
          </header>

          {activeSection === 'users' ? (
            <AdminMembers
              members={members}
              invitations={invitations}
              currentUserId={context.user.id}
              isOwner={isOwner}
              selectedUserId={selectedUserId}
              onSelect={setSelectedUserId}
              search={memberSearch}
              onSearchChange={setMemberSearch}
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
          {activeSection === 'activity' ? (
            <AdminActivity
              events={activityQuery.data ?? []}
              isOwner={isOwner}
              onExport={exportAudit}
            />
          ) : null}
          {activeSection === 'settings' ? (
            <AdminSettings
              settings={settings}
              isOwner={isOwner}
              saving={saveSettings.isPending}
              onSave={(value) => saveSettings.mutate(value)}
            />
          ) : null}
          {activeSection === 'model-fields' ? (
            <AdminModelFields
              client={dataClient}
              workspaceId={workspaceId}
              canManage={canManageModelFields}
              selectedModelKey={routeSearch.model ?? 'sample'}
              onSelectedModelKeyChange={(model) =>
                void navigate({
                  to: '/admin/$section',
                  params: { section: 'model-fields' },
                  search: { model },
                })
              }
            />
          ) : null}
        </section>
        {actionError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {actionError}
          </p>
        )}
      </div>
    </div>
  )
}
