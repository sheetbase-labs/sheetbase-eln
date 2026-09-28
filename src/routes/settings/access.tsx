import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
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
import { hasCapability } from '#/lib/capability'
import {
  fetchWorkspaceMemberIdentities,
  fetchProjectSummaries,
} from '#/components/v3/projects/project-data'
import {
  adminQueryKeys,
  fetchProjectAccess,
  grantProjectAccess,
  revokeProjectAccess,
} from '#/lib/workspace-admin'
import type { ProjectAccessLevel } from '#/lib/workspace-admin'

/** UI port (roadmap-4/ui-app3): project access. The registry grants a person a
 * level on a project; roles decide what they can do there. Grants and revokes
 * run through the workspace-admin RPCs and are gated on workspace.admin. */
export const Route = createFileRoute('/settings/access')({
  component: Access,
})

const dataClient = createDataClient()

const LEVELS: { value: ProjectAccessLevel; label: string; body: string }[] = [
  { value: 'viewer', label: 'View', body: 'Read, export and comment.' },
  {
    value: 'editor',
    label: 'Edit',
    body: 'Create and change records in the project.',
  },
  {
    value: 'owner',
    label: 'Owner',
    body: 'Edit and manage the project and its membership.',
  },
]

function Access() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = hasCapability(context.workspace?.role, 'workspace.admin')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const access = useQuery({
    queryKey: adminQueryKeys.projectAccess(workspaceId),
    queryFn: () => fetchProjectAccess(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const projects = useQuery({
    queryKey: ['ui-port', 'settings', 'projects'],
    queryFn: () => fetchProjectSummaries(undefined),
  })
  const people = useQuery({
    queryKey: ['ui-port', 'settings', 'people'],
    queryFn: () => fetchWorkspaceMemberIdentities(),
  })

  const projectLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects.data ?? [])
      map.set(p.id, p.displayId ? `${p.displayId} · ${p.title}` : p.title)
    return map
  }, [projects.data])

  const personLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of people.data ?? []) map.set(m.user_id, m.name)
    return map
  }, [people.data])

  const rows = access.data ?? []

  const grant = useMutation({
    mutationFn: (input: {
      projectId: string
      userId: string
      accessLevel: ProjectAccessLevel
    }) => grantProjectAccess(dataClient, { workspaceId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.projectAccess(workspaceId),
      })
      setOpen(false)
      toast('Access granted')
    },
    onError: (error: unknown) =>
      toast('Could not grant access', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const revoke = useMutation({
    mutationFn: (input: { projectId: string; userId: string }) =>
      revokeProjectAccess(dataClient, { workspaceId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.projectAccess(workspaceId),
      })
      toast('Access revoked')
    },
    onError: (error: unknown) =>
      toast('Could not revoke access', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const levelStatus = (level: ProjectAccessLevel) =>
    level === 'owner'
      ? { tone: 'ok' as const, label: 'Owner' }
      : level === 'editor'
        ? { tone: 'progress' as const, label: 'Editor' }
        : { tone: 'stored' as const, label: 'Viewer' }

  return (
    <>
      <SettingsHeader
        title="Project access"
        count={rows.length}
        border={false}
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon="plus"
              disabled={!projects.data?.length || !people.data?.length}
              onClick={() => setOpen(true)}
            >
              Grant access
            </Button>
          ) : null
        }
      >
        Who can open each project. Roles decide what they can do there.
      </SettingsHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label="Project access">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>Level</TableHead>
              <TableHead align="right">Granted</TableHead>
              <TableHead align="right">{''}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const s = levelStatus(a.accessLevel)
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    {projectLabel.get(a.projectId) ?? a.projectId.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    {personLabel.get(a.userId) ?? a.userId.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    <Status tone={s.tone}>{s.label}</Status>
                  </TableCell>
                  <TableCell align="right" className="text-fg-muted">
                    {a.createdAt.slice(0, 10)}
                  </TableCell>
                  <TableCell align="right">
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={revoke.isPending}
                        onClick={() =>
                          revoke.mutate({
                            projectId: a.projectId,
                            userId: a.userId,
                          })
                        }
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {!access.isLoading && rows.length === 0 ? (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="lock"
              title="No explicit project access"
              body="Everyone in the workspace can see workspace projects; grants add people to a project or raise their level."
            />
          </div>
        ) : null}
      </div>
      <SettingsBody className="border-t border-border-subtle">
        <div className="grid grid-cols-1 gap-4 text-label leading-[18px] sm:grid-cols-3">
          {LEVELS.map((l) => (
            <div key={l.value}>
              <b className="font-semibold">{l.label}</b>
              <div className="text-fg-muted">{l.body}</div>
            </div>
          ))}
        </div>
        <Muted>
          Project membership decides where; the workspace role decides what
          people may do.
        </Muted>
      </SettingsBody>

      {open ? (
        <GrantDialog
          projects={(projects.data ?? []).map((p) => ({
            id: p.id,
            label: p.displayId ? `${p.displayId} · ${p.title}` : p.title,
          }))}
          people={(people.data ?? []).map((m) => ({
            id: m.user_id,
            label: m.name,
          }))}
          busy={grant.isPending}
          onClose={() => setOpen(false)}
          onSubmit={(input) => grant.mutate(input)}
        />
      ) : null}
    </>
  )
}

function GrantDialog({
  projects,
  people,
  busy,
  onClose,
  onSubmit,
}: {
  projects: { id: string; label: string }[]
  people: { id: string; label: string }[]
  busy: boolean
  onClose: () => void
  onSubmit: (input: {
    projectId: string
    userId: string
    accessLevel: ProjectAccessLevel
  }) => void
}) {
  const [projectId, setProjectId] = useState(projects.at(0)?.id ?? '')
  const [userId, setUserId] = useState(people.at(0)?.id ?? '')
  const [level, setLevel] = useState<ProjectAccessLevel>('viewer')
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Grant project access"
          description="Adds a person to one project at a level. Their workspace role still decides what they can do."
        />
        <DialogBody>
          <Field label="Project">
            <select
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Person">
            <select
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level">
            <select
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
              value={level}
              onChange={(e) => setLevel(e.target.value as ProjectAccessLevel)}
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !projectId || !userId}
            onClick={() => onSubmit({ projectId, userId, accessLevel: level })}
          >
            Grant access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
