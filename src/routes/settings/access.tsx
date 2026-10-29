import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field } from '#/components/v3/ui/input'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import {
  personOption,
  projectOption,
} from '#/components/v3/record-picker/entity-options'
import { Select } from '#/components/v3/ui/select'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { DataAccessRoles } from '#/components/v3/settings/data-access-roles'
import { createDataClient } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import { formatDate } from '#/lib/workspace-admin'
import {
  fetchWorkspaceMemberIdentities,
  fetchProjectSummaries,
} from '#/components/v3/projects/project-data'
import {
  decideProjectAccessRequest,
  fetchProjectAccessDefaults,
  fetchProjectAccessRequests,
  fetchMyProjectPermissions,
  fetchWorkspaceAccessRules,
  fetchWorkspaceGroups,
  removeProjectAccessRule,
  setProjectAccessDefaults,
  setProjectAccessRule,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import type {
  ProjectAccessRule,
  ProjectPermissions,
  WorkspaceGroup,
} from '#/lib/workspace-access'
import { canManageSettings } from '#/lib/settings-access'

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
    queryKey: ['settings-access-permissions', workspaceId],
    queryFn: () => fetchMyProjectPermissions(dataClient),
    enabled: Boolean(workspaceId),
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
  const matrixColumns: RegistryColumn<(typeof visibleProjects)[number]>[] = [
    {
      id: 'project',
      header: 'Project',
      cell: ({ row }) => row.original.title,
    },
    ...columns.map(
      (column): RegistryColumn<(typeof visibleProjects)[number]> => ({
        id: column.key,
        header: column.label,
        cell: ({ row }) => {
          const activeRules = (rules.data ?? []).filter(
            (rule) =>
              rule.project_id === row.original.id &&
              rule[column.key] &&
              (!groupFilter || rule.group_id === groupFilter),
          )
          if (!activeRules.length) return '—'
          const editable = permissions.data?.get(row.original.id)?.can_manage
          // A long list of names stops at the column's edge, so the matrix
          // fits the pane instead of scrolling sideways; the full list is in
          // the tooltip.
          return (
            <span
              className="block max-w-36 truncate"
              title={activeRules.map((rule) => rule.principal_name).join(', ')}
            >
              {activeRules.map((rule, index) => (
                <span key={rule.id}>
                  {index ? ', ' : ''}
                  {editable ? (
                    <button
                      className="text-left hover:underline focus-visible:outline focus-visible:outline-2"
                      onClick={() => setDialog({ kind: 'edit', rule })}
                    >
                      {rule.principal_name}
                    </button>
                  ) : (
                    rule.principal_name
                  )}
                </span>
              ))}
            </span>
          )
        },
      }),
    ),
  ]
  const requestColumns: RegistryColumn<(typeof requestRows)[number]>[] = [
    {
      id: 'person',
      header: 'Person',
      cell: ({ row }) => userLabel(row.original.user_id),
    },
    {
      id: 'project',
      header: 'Project',
      cell: ({ row }) =>
        projects.data?.find((p) => p.id === row.original.project_id)?.title ??
        '—',
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: ({ row }) => row.original.reason,
    },
    {
      id: 'decision',
      header: 'Decision',
      cell: ({ row }) => {
        const request = row.original
        const canDecide =
          request.status === 'pending' &&
          permissions.data?.get(request.project_id)?.can_manage === true
        if (canDecide) {
          return (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ requestId: request.id, approve: true })
                }
              >
                Approve edit access
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ requestId: request.id, approve: false })
                }
              >
                Deny
              </Button>
            </div>
          )
        }
        if (request.status === 'pending')
          return <span>Waiting for approval</span>
        return (
          <span>
            {request.status === 'approved' ? 'Approved' : 'Denied'}
            {request.decided_by_user_id
              ? ` by ${userLabel(request.decided_by_user_id)}`
              : ''}
            {' · '}
            {formatDate(request.updated_at)}
          </span>
        )
      },
    },
  ]
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
          ) : projects.isPending || permissions.isPending ? null : (
            <Muted>
              Only a project manager can add rules. You don’t manage any
              project.
            </Muted>
          )
        }
      >
        Who can open each project. Roles decide what they can do there.
      </SettingsHeader>
      <div className="flex gap-3 border-y border-border-subtle px-4 py-2 md:px-6">
        <label className="text-label">
          Project:{' '}
          <Select
            aria-label="Filter project"
            className="inline-block text-label"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">any</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-label">
          Group:{' '}
          <Select
            aria-label="Filter group"
            className="inline-block text-label"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">any</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
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
        ) : visibleProjects.length ? (
          <RegistryGrid
            label="Project access matrix"
            rows={visibleProjects}
            columns={matrixColumns}
            getRowId={(project) => project.id}
            selectable={false}
          />
        ) : null}
        {!projects.isPending &&
        !projects.isError &&
        visibleProjects.length === 0 ? (
          <SettingsBody>
            <EmptyState
              icon="lock"
              title="No accessible projects"
              description="An explicit project rule is required. Workspace roles do not grant project access."
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
          <QaDefault
            workspaceId={workspaceId}
            groups={groups.data ?? []}
            canManage={canManageSettings(context.workspace, 'access')}
          />
        </Section>
        {requestRows.length ? (
          <Section title="Access requests" count={requestRows.length}>
            <RegistryGrid
              label="Access requests"
              rows={requestRows}
              columns={requestColumns}
              getRowId={(request) => request.id}
              selectable={false}
            />
          </Section>
        ) : null}
        {context.workspace?.role === 'owner' ||
        context.workspace?.role === 'admin' ? (
          <DataAccessRoles workspaceId={workspaceId} canManage />
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

/** The group that can view every project created from now on. View only: edit,
 * review, manage and the client portal are never granted by this default, and
 * projects that already exist keep the access they have. */
function QaDefault({
  workspaceId,
  groups,
  canManage,
}: {
  workspaceId: string
  groups: WorkspaceGroup[]
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const defaults = useQuery({
    queryKey: workspaceAccessKeys.defaults(workspaceId),
    queryFn: () => fetchProjectAccessDefaults(dataClient),
    enabled: Boolean(workspaceId),
  })
  const save = useMutation({
    mutationFn: (groupId: string | null) =>
      setProjectAccessDefaults(dataClient, groupId),
    onSuccess: (_result, groupId) => {
      void queryClient.invalidateQueries({
        queryKey: workspaceAccessKeys.defaults(workspaceId),
      })
      toast(
        groupId
          ? 'QA access default saved'
          : 'New projects will no longer be shared with a QA group',
      )
    },
    onError: (error: Error) =>
      toast('Could not save the QA access default', {
        description: error.message,
      }),
  })
  const current = defaults.data?.qa_view_group_id ?? ''
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1 text-label">
        <span className="font-medium text-fg">QA group with view access</span>
        <PickerSelect
          noun="group"
          aria-label="QA group with view access"
          value={current}
          disabled={!canManage || defaults.isPending || save.isPending}
          onChange={(id) => save.mutate(id || null)}
          clearLabel="No group"
          options={groups.map((g) => ({ id: g.id, label: g.name }))}
        />
      </label>
      <Muted>
        {defaults.isError
          ? 'The current default could not be read.'
          : canManage
            ? 'Every project created from now on can be viewed by this group. It cannot edit, review or manage, and existing projects are not changed. A role never adds someone to a group.'
            : 'Only a workspace admin can change this default.'}
      </Muted>
    </div>
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
            <PickerSelect
              noun="project"
              aria-label="Project"
              disabled={Boolean(rule)}
              value={projectId}
              onChange={(id) => setProjectId(id)}
              options={projects.map((p) => projectOption(p))}
            />
          </Field>
          <Field label="Principal type">
            <Select
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
            </Select>
          </Field>
          <Field label={kind === 'group' ? 'Group' : 'Person'}>
            <PickerSelect
              noun={kind === 'group' ? 'group' : 'person'}
              aria-label={kind === 'group' ? 'Group' : 'Person'}
              disabled={Boolean(rule)}
              value={principalId}
              onChange={(id) => setPrincipalId(id)}
              options={
                kind === 'group'
                  ? groups.map((g) => ({ id: g.id, label: g.name }))
                  : people.map((p) => personOption(p.user_id, p.name))
              }
            />
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
