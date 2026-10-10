import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field } from '#/components/v3/ui/input'
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import { formatDate } from '#/lib/workspace-admin'
import {
  fetchWorkspaceMemberIdentities,
  fetchProjectSummaries,
} from '#/components/v3/projects/project-data'
import {
  decideProjectAccessRequest,
  fetchProjectAccessRequests,
  fetchProjectPermissions,
  fetchWorkspaceAccessRules,
  fetchWorkspaceGroups,
  removeProjectAccessRule,
  setProjectAccessRule,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import type {
  ProjectAccessRule,
  ProjectPermissions,
  WorkspaceGroup,
} from '#/lib/workspace-access'

export const Route = createFileRoute('/settings/access')({ component: Access })
const dataClient = createDataClient()
const columns = [
  { key: 'can_edit', label: 'Edit' },
  { key: 'can_review', label: 'Review' },
  { key: 'can_view', label: 'View' },
  { key: 'client_portal', label: 'Client portal' },
] as const

function Access() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<
    { kind: 'add' } | { kind: 'edit'; rule: ProjectAccessRule } | null
  >(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const rules = useQuery({
    queryKey: workspaceAccessKeys.rules(workspaceId),
    queryFn: () => fetchWorkspaceAccessRules(dataClient),
    enabled: Boolean(workspaceId),
  })
  const groups = useQuery({
    queryKey: workspaceAccessKeys.groups(workspaceId),
    queryFn: () => fetchWorkspaceGroups(dataClient),
    enabled: Boolean(workspaceId),
  })
  const projects = useQuery({
    queryKey: ['settings-access-projects', workspaceId],
    queryFn: () => fetchProjectSummaries(workspaceId),
    enabled: Boolean(workspaceId),
  })
  const people = useQuery({
    queryKey: ['settings-access-people', workspaceId],
    queryFn: () => fetchWorkspaceMemberIdentities(),
    enabled: Boolean(workspaceId),
  })
  const permissions = useQuery({
    queryKey: [
      'settings-access-permissions',
      workspaceId,
      projects.data?.map((p) => p.id),
    ],
    queryFn: async () =>
      new Map(
        await Promise.all(
          (projects.data ?? []).map(
            async (p) =>
              [p.id, await fetchProjectPermissions(dataClient, p.id)] as const,
          ),
        ),
      ),
    enabled: Boolean(projects.data),
  })
  const requests = useQuery({
    queryKey: workspaceAccessKeys.requests(workspaceId),
    queryFn: () => fetchProjectAccessRequests(dataClient),
    enabled: Boolean(workspaceId),
  })
  const manageableProjects = (projects.data ?? []).filter(
    (p) => permissions.data?.get(p.id)?.can_manage,
  )
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: workspaceAccessKeys.all(workspaceId),
    })
    void queryClient.invalidateQueries({
      queryKey: ['settings-access-permissions', workspaceId],
    })
    void queryClient.invalidateQueries({ queryKey: ['ui-port', 'projects'] })
  }
  const save = useMutation({
    mutationFn: (input: Parameters<typeof setProjectAccessRule>[1]) =>
      setProjectAccessRule(dataClient, input),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      toast('Access rule saved')
    },
    onError: (error: Error) =>
      toast('Could not save access rule', { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => removeProjectAccessRule(dataClient, id),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      toast('Access rule removed')
    },
    onError: (error: Error) =>
      toast('Could not remove access rule', { description: error.message }),
  })
  const decide = useMutation({
    mutationFn: (input: { requestId: string; approve: boolean }) =>
      decideProjectAccessRequest(dataClient, input),
    onSuccess: () => {
      invalidate()
      toast('Access request decided')
    },
    onError: (error: Error) =>
      toast('Could not decide access request', { description: error.message }),
  })
  const requestRows = requests.data ?? []
  // Requesters and deciders are workspace members; one resolver names both so
  // a decision is attributable, never a bare user id.
  const { userLabel } = useUserNames(
    requestRows.flatMap((r) => [r.user_id, r.decided_by_user_id ?? '']),
    context.user,
  )
  const visibleProjects = (projects.data ?? []).filter(
    (p) => !projectFilter || p.id === projectFilter,
  )
  return (
    <>
      <SettingsHeader
        title="Project access"
        border={false}
        actions={
          manageableProjects.length ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setDialog({ kind: 'add' })}
            >
              Add rule
            </Button>
          ) : null
        }
      >
        Who can open each project. Roles decide what they can do there.
      </SettingsHeader>
      <div className="flex gap-3 border-y border-border-subtle px-4 py-2 md:px-6">
        <label className="text-label">
          Project:{' '}
          <select
            aria-label="Filter project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">any</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-label">
          Group:{' '}
          <select
            aria-label="Filter group"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">any</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rules.isError || projects.isError || permissions.isError ? (
          <SettingsBody>
            <p role="alert">
              Could not load project access. No permissions have changed.
            </p>
            <Button
              onClick={() => {
                void rules.refetch()
                void projects.refetch()
                void permissions.refetch()
              }}
            >
              Retry
            </Button>
          </SettingsBody>
        ) : rules.isPending || projects.isPending ? (
          <SettingsBody>
            <Muted>Loading project access…</Muted>
          </SettingsBody>
        ) : (
          <Table aria-label="Project access matrix">
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProjects.map((p) => {
                const projectRules = rules.data.filter(
                  (r) =>
                    r.project_id === p.id &&
                    (!groupFilter || r.group_id === groupFilter),
                )
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.title}</TableCell>
                    {columns.map((c) => (
                      <TableCell key={c.key}>
                        {projectRules
                          .filter((r) => r[c.key])
                          .map((r, index) => (
                            <span key={r.id}>
                              {index ? ', ' : ''}
                              {permissions.data?.get(p.id)?.can_manage ? (
                                <button
                                  className="text-left hover:underline focus-visible:outline focus-visible:outline-2"
                                  onClick={() =>
                                    setDialog({ kind: 'edit', rule: r })
                                  }
                                >
                                  {r.principal_name}
                                </button>
                              ) : (
                                r.principal_name
                              )}
                            </span>
                          ))}
                        {!projectRules.some((r) => r[c.key]) ? '—' : null}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {!projects.isPending &&
        !projects.isError &&
        visibleProjects.length === 0 ? (
          <SettingsBody>
            <EmptyState
              icon="lock"
              title="No accessible projects"
              body="An explicit project rule is required. Workspace roles do not grant project access."
            />
          </SettingsBody>
        ) : null}
      </div>
      <SettingsBody className="border-t border-border-subtle">
        <Section title="Defaults for new projects">
          <Muted>
            New projects are private to the lead until explicit rules are added.
            Client portal access is off by default.
          </Muted>
          <Muted>
            QA access requires an explicit rule for a workspace group. A role
            never adds someone to a group.
          </Muted>
        </Section>
        {requestRows.length ? (
          <Section title="Access requests" count={requestRows.length}>
            <Table aria-label="Access requests">
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requestRows.map((r) => {
                  const canDecide =
                    r.status === 'pending' &&
                    permissions.data?.get(r.project_id)?.can_manage === true
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{userLabel(r.user_id)}</TableCell>
                      <TableCell>
                        {projects.data?.find((p) => p.id === r.project_id)
                          ?.title ?? '—'}
                      </TableCell>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell>
                        {canDecide ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({
                                  requestId: r.id,
                                  approve: true,
                                })
                              }
                            >
                              Approve edit access
                            </Button>
                            <Button
                              size="sm"
                              variant="quiet"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({
                                  requestId: r.id,
                                  approve: false,
                                })
                              }
                            >
                              Deny
                            </Button>
                          </div>
                        ) : r.status === 'pending' ? (
                          <span>Waiting for approval</span>
                        ) : (
                          <span>
                            {r.status === 'approved' ? 'Approved' : 'Denied'}
                            {r.decided_by_user_id
                              ? ` by ${userLabel(r.decided_by_user_id)}`
                              : ''}
                            {' · '}
                            {formatDate(r.updated_at)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Section>
        ) : null}
        {requests.isError ? (
          <p role="alert">Access requests are unavailable.</p>
        ) : null}
      </SettingsBody>
      {dialog ? (
        <RuleDialog
          projects={manageableProjects}
          groups={groups.data ?? []}
          people={people.data ?? []}
          rule={dialog.kind === 'edit' ? dialog.rule : undefined}
          busy={save.isPending || remove.isPending}
          onClose={() => setDialog(null)}
          onSave={(input) => save.mutate(input)}
          onRemove={
            dialog.kind === 'edit'
              ? () => remove.mutate(dialog.rule.id)
              : undefined
          }
        />
      ) : null}
    </>
  )
}

function RuleDialog({
  projects,
  groups,
  people,
  rule,
  busy,
  onClose,
  onSave,
  onRemove,
}: {
  projects: { id: string; title: string }[]
  groups: WorkspaceGroup[]
  people: { user_id: string; name: string; role: string }[]
  rule?: ProjectAccessRule
  busy: boolean
  onClose: () => void
  onSave: (input: Parameters<typeof setProjectAccessRule>[1]) => void
  onRemove?: () => void
}) {
  const [projectId, setProjectId] = useState(
    rule?.project_id ?? projects.at(0)?.id ?? '',
  )
  const [kind, setKind] = useState<'group' | 'user'>(
    rule?.user_id ? 'user' : 'group',
  )
  const [principalId, setPrincipalId] = useState(
    rule?.group_id ?? rule?.user_id ?? '',
  )
  const [flags, setFlags] = useState<ProjectPermissions>(
    rule ?? {
      can_view: true,
      can_edit: false,
      can_review: false,
      client_portal: false,
      can_manage: false,
    },
  )
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={rule ? 'Edit access rule' : 'Add access rule'}
          description="Changes take effect on the next request and are audited. Group membership is explicit."
        />
        <DialogBody>
          <Field label="Project">
            <select
              aria-label="Project"
              disabled={Boolean(rule)}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Principal type">
            <select
              aria-label="Principal type"
              disabled={Boolean(rule)}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value === 'user' ? 'user' : 'group')
                setPrincipalId('')
              }}
            >
              <option value="group">Group</option>
              <option value="user">Person</option>
            </select>
          </Field>
          <Field label={kind === 'group' ? 'Group' : 'Person'}>
            <select
              aria-label={kind === 'group' ? 'Group' : 'Person'}
              disabled={Boolean(rule)}
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
            >
              <option value="">Choose…</option>
              {kind === 'group'
                ? groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))
                : people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name}
                    </option>
                  ))}
            </select>
          </Field>
          {[
            ...columns,
            { key: 'can_manage', label: 'Manage project access' } as const,
          ].map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={flags[c.key]}
                onChange={(e) =>
                  setFlags({ ...flags, [c.key]: e.target.checked })
                }
              />
              {c.label}
            </label>
          ))}
          <Muted>
            Edit and Review include reading. Management is separate. Workspace
            capabilities remain the upper bound.
          </Muted>
        </DialogBody>
        <DialogFooter>
          {onRemove ? (
            <Button variant="danger" disabled={busy} onClick={onRemove}>
              Remove rule
            </Button>
          ) : null}
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !projectId || !principalId}
            onClick={() =>
              onSave({
                projectId,
                principal:
                  kind === 'group'
                    ? { kind: 'group', groupId: principalId }
                    : { kind: 'user', userId: principalId },
                ...flags,
              })
            }
          >
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
