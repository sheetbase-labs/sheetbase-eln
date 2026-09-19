import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Globe,
  HardDrive,
  KeyRound,
  Lock,
  Puzzle,
  Settings,
  Shield,
  Terminal,
  UserRoundCog,
  Users,
  Webhook,
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
  AdminExtensions,
  AdminExternalAccess,
  AdminInspector,
  AdminMembers,
  AdminPipelines,
  AdminProjectAccess,
  AdminSessions,
  AdminSettings,
  AdminStorage,
  AdminUsage,
  AdminWebhooks,
} from '#/components/workspace-admin'
import { Button } from '#/components/ui'
import { cn } from '#/lib/utils'
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
  staticData: { shellFullBleed: true },
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

export const ADMIN_SECTIONS: AdminSectionDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Platform health, activity, usage, and attention indicators.',
    group: 'Overview',
    icon: Gauge,
    capability: null,
  },
  {
    key: 'external-access',
    label: 'External access',
    description:
      'Unified lifecycle view over members, credentials, connectors, webhooks and extensions.',
    group: 'Overview',
    icon: Globe,
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
    label: 'Access',
    description: 'Control explicit user access to individual projects.',
    group: 'Workspace',
    icon: KeyRound,
    capability: 'workspace.admin',
  },
  {
    key: 'settings',
    label: 'Workspace settings',
    description:
      'Workspace registration, review, signature and retention policies.',
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
    label: 'API',
    description:
      'Create, rotate and revoke scoped credentials for external automation.',
    group: 'Security and audit',
    icon: Lock,
    capability: 'workspace.admin',
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
    key: 'extensions',
    label: 'Extensions',
    description:
      'Install, update, disable and remove workspace extensions; review authority, compatibility and history.',
    group: 'Integrations',
    icon: Puzzle,
    capability: 'extensions.manage',
  },
  {
    key: 'webhooks',
    label: 'Webhooks',
    description:
      'Webhook subscriptions, endpoint health, delivery history and replay.',
    group: 'Integrations',
    icon: Webhook,
    capability: 'integrations.manage',
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
    key: 'diagnostics',
    label: 'Diagnostics',
    description: 'Health checks, scheduler, executor, and configuration state.',
    group: 'Platform',
    icon: Terminal,
    capability: null,
  },
  {
    key: 'deployment',
    label: 'Deploy',
    description:
      'Version, environment, migration state, and operational links.',
    group: 'Platform',
    icon: Shield,
    capability: null,
  },
]

type AdminSectionKey = (typeof ADMIN_SECTIONS)[number]['key']

function sectionFromPath(pathname: string): AdminSectionKey {
  const candidate = pathname.split('/')[2]
  return ADMIN_SECTIONS.some((section) => section.key === candidate)
    ? candidate
    : 'dashboard'
}

interface AdminSectionGroup {
  label: string
  sections: AdminSectionDef[]
}

/**
 * Horizontally scrolling nav strip. The right-edge fade is the affordance
 * that more items exist, so it only renders while content actually sits
 * beyond the edge — it clears at the scroll end and never shows when the
 * strip fits without scrolling.
 */
function AdminNavStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [showFade, setShowFade] = useState(false)

  const update = useCallback(() => {
    const strip = ref.current
    if (!strip) return
    setShowFade(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const strip = ref.current
    if (!strip) return
    update()
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [update])

  // The item set can change without a resize (e.g. switching group), so
  // re-check after every render; the state setter bails when unchanged.
  useEffect(update)

  return (
    <div
      ref={ref}
      onScroll={update}
      className={cn(
        'flex w-full items-center gap-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        showFade &&
          '[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)]',
      )}
    >
      {children}
    </div>
  )
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
  // Bucket the visible sections into their declared groups, preserving
  // ADMIN_SECTIONS order, so the nav renders six areas rather than a flat
  // sixteen-item strip.
  const visibleGroups = visibleSections.reduce<AdminSectionGroup[]>(
    (groups, item) => {
      const group = groups.find((entry) => entry.label === item.group)
      if (group) group.sections.push(item)
      else groups.push({ label: item.group, sections: [item] })
      return groups
    },
    [],
  )
  const activeGroup = visibleGroups.find((group) =>
    group.sections.some((item) => item.key === activeSection),
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
    mutation(
      ({ userId, role: newRole }: { userId: string; role: WorkspaceRole }) =>
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
    context: shellContext,
    breadcrumbs: [
      { label: 'Administration' },
      { label: 'Platform Administration' },
    ],
    inspectorLabel: 'Member details',
    inspector:
      selectedMember && activeSection === 'users' ? (
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
      <div className="w-full px-4 pt-4 pb-3">
        <header>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-headline font-heading tracking-tight">
              Administration
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage workspace access and activity. Edit models in{' '}
            <Link
              to="/configure"
              search={{ kind: 'model', id: undefined, model: undefined }}
              className="font-medium text-primary hover:underline"
            >
              Configuration
            </Link>{' '}
            and personal API tokens in{' '}
            <Link
              to="/settings"
              className="font-medium text-primary hover:underline"
            >
              Settings
            </Link>
            .
          </p>
        </header>
      </div>

      <div className="border-b border-border">
        {/* The group row is the coarse area selector; each group links to
            its first visible section so the URL stays canonical. */}
        <nav aria-label="Administration areas">
          <AdminNavStrip>
            {visibleGroups.map((group) => {
              const current = group.sections.some(
                (item) => item.key === activeSection,
              )
              return (
                <Link
                  key={group.label}
                  to="/admin/$section"
                  params={{ section: group.sections[0].key }}
                  search={{ model: undefined }}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'flex shrink-0 items-center px-1 pt-1.5 pb-1 text-sm no-underline transition-colors',
                    current
                      ? 'font-label text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="whitespace-nowrap">{group.label}</span>
                </Link>
              )
            })}
          </AdminNavStrip>
        </nav>
        {/* The active group's sections keep the line-tab treatment on the
            shared baseline. Hidden when the active section is gated. */}
        {activeGroup ? (
          <nav aria-label="Administration sections">
            <AdminNavStrip>
              {activeGroup.sections.map((item) => {
                const active = item.key === activeSection
                return (
                  <Link
                    key={item.key}
                    to="/admin/$section"
                    params={{ section: item.key }}
                    search={{ model: undefined }}
                    aria-current={active ? 'page' : undefined}
                    className={`-mb-px flex shrink-0 items-center border-b-2 px-1 py-2 text-sm font-medium no-underline transition-colors ${active ? 'border-primary font-label text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    <span className="whitespace-nowrap">{item.label}</span>
                  </Link>
                )
              })}
            </AdminNavStrip>
          </nav>
        ) : null}
      </div>

      <div className="w-full px-4 py-4">
        {sectionDenied ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>
              You do not have permission to access this administration section.
            </p>
            <p>
              Steward data-language configuration lives in{' '}
              <Link
                to="/configure"
                search={{ kind: 'model', id: undefined, model: undefined }}
                className="font-medium underline"
              >
                Configuration
              </Link>
              , and personal API tokens in{' '}
              <Link to="/settings" className="font-medium underline">
                Settings
              </Link>
              .
            </p>
          </div>
        ) : (
          <section className="min-w-0 space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{section.label}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
            </header>

            {activeSection === 'dashboard' ? (
              <AdminDashboard workspaceId={workspaceId} />
            ) : null}
            {activeSection === 'external-access' ? (
              <AdminExternalAccess
                workspaceId={workspaceId}
                role={role ?? ''}
              />
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
            {activeSection === 'extensions' ? (
              <AdminExtensions workspaceId={workspaceId} role={role ?? ''} />
            ) : null}
            {activeSection === 'webhooks' ? (
              <AdminWebhooks workspaceId={workspaceId} role={role ?? ''} />
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
