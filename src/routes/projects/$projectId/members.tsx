import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCanManageProject } from '#/lib/project-permissions'
import { createDataClient } from '#/lib/data-client'
import {
  decideProjectAccessRequest,
  fetchProjectAccessRequests,
  workspaceAccessKeys,
} from '#/lib/workspace-access'

import { Section } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Field } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { personOption } from '#/components/v3/record-picker/entity-options'
import { Select } from '#/components/v3/ui/select'
import {
  fetchProjectMembers,
  fetchWorkspaceMemberIdentities,
  removeProjectMember,
  setProjectMember,
  useProjectSummary,
} from '#/components/v3/projects/project-data'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/** The project-access levels a lead can grant here. They are the permission
 * `set_project_member` accepts, and they match the Access column and the
 * "How access works" copy. The lead's own level (owner) is set with the
 * project, not on this screen. */
const accessLevels = [
  { value: 'editor' },
  { value: 'reviewer' },
  { value: 'viewer' },
] as const
const accessClient = createDataClient()
const accessLabel = (level: string) =>
  level === 'owner' ||
  level === 'editor' ||
  level === 'reviewer' ||
  level === 'viewer'
    ? t(`projects.projectMembers.access.${level}`)
    : undefined

/** UI port (roadmap-4/ui-app3): the project Members tab, backed by
 * `project_members` / `set_project_member` / `remove_project_member`. Training
 * and groups are not in the model yet; client users arrive with the portal. */
export const Route = createFileRoute('/projects/$projectId/members')({
  component: ProjectMembers,
})

function ProjectMembers() {
  const { projectId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const { project } = useProjectSummary(projectId)
  const queryClient = useQueryClient()
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => fetchProjectMembers(projectId),
  })
  const peopleQuery = useQuery({
    queryKey: ['workspace-member-identities'],
    queryFn: fetchWorkspaceMemberIdentities,
  })
  const members = membersQuery.data ?? []
  const { canManage: isLead } = useCanManageProject(
    projectId,
    project?.leadUserId,
    context.user.id,
  )
  const requestsQuery = useQuery({
    queryKey: [
      ...workspaceAccessKeys.requests(context.workspace?.id ?? ''),
      projectId,
    ],
    queryFn: async () =>
      (await fetchProjectAccessRequests(accessClient)).filter(
        (r) => r.project_id === projectId && r.status === 'pending',
      ),
    enabled: isLead,
  })
  const pendingRequests = requestsQuery.data ?? []
  const decide = useMutation({
    mutationFn: (input: { requestId: string; approve: boolean }) =>
      decideProjectAccessRequest(accessClient, input),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: ['project-members', projectId],
      })
      void queryClient.invalidateQueries({
        queryKey: workspaceAccessKeys.all(context.workspace?.id ?? ''),
      })
      toast(
        input.approve
          ? t('projects.projectMembers.granted')
          : t('projects.projectMembers.denied'),
      )
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('projects.projectMembers.decideFailed'),
      ),
  })
  const [pendingRemove, setPendingRemove] = useState<{
    id: string
    name: string
  } | null>(null)

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ['project-members', projectId],
    })

  const setRole = useMutation({
    mutationFn: (input: { userId: string; accessLevel: string }) =>
      setProjectMember(projectId, input.userId, input.accessLevel),
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('projects.projectMembers.changeFailed'),
      ),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId),
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('projects.projectMembers.removeFailed'),
      ),
  })

  const available = useMemo(() => {
    const present = new Set(members.map((m) => m.user_id))
    return (peopleQuery.data ?? []).filter((p) => !present.has(p.user_id))
  }, [peopleQuery.data, members])

  const columns: RegistryColumn<(typeof members)[number]>[] = [
    {
      id: 'person',
      header: t('projects.projectMembers.columns.person'),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.name}
          {row.original.is_lead ? (
            <span className="ml-1.5 text-label text-fg-muted">
              {t('projects.projectMembers.lead')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'role',
      header: t('projects.projectMembers.columns.role'),
      cell: ({ row }) =>
        row.original.project_role ??
        (row.original.is_lead ? t('projects.projectMembers.lead') : '—'),
    },
    {
      id: 'access',
      header: t('projects.projectMembers.columns.access'),
      cell: ({ row }) =>
        accessLabel(row.original.access_level) ?? row.original.access_level,
    },
    {
      id: 'added',
      header: t('projects.projectMembers.columns.added'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatDate(row.original.added_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">
          {t('projects.projectMembers.columns.actions')}
        </span>
      ),
      cell: ({ row }) =>
        isLead && !row.original.is_lead ? (
          <RoleMenu
            name={row.original.name}
            accessLevel={row.original.access_level}
            busy={setRole.isPending || remove.isPending}
            onRole={(access) =>
              setRole.mutate({
                userId: row.original.user_id,
                accessLevel: access,
              })
            }
            onRemove={() =>
              setPendingRemove({
                id: row.original.user_id,
                name: row.original.name,
              })
            }
          />
        ) : null,
      meta: rightAligned<(typeof members)[number]>().meta,
    },
  ]

  if (!project) return null

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        {!isLead ? (
          <Notice
            icon="lock"
            title={t('projects.projectMembers.readOnly.title')}
          >
            {t('projects.projectMembers.readOnly.body', {
              name: project.leadName ?? t('projects.projectMembers.theLead'),
            })}
          </Notice>
        ) : null}

        <Section
          title={t('projects.projectMembers.team')}
          count={members.length}
          action={
            isLead ? (
              <AddPeople
                projectId={projectId}
                available={available}
                onDone={invalidate}
              />
            ) : null
          }
        >
          <TableBox>
            <RegistryGrid
              label={t('projects.projectMembers.label')}
              rows={members}
              columns={columns}
              getRowId={(m) => m.user_id}
              selectable={false}
            />
          </TableBox>
        </Section>

        {isLead && pendingRequests.length ? (
          <Section
            title={t('projects.projectMembers.requests.title')}
            count={pendingRequests.length}
          >
            <div className="flex flex-col gap-2">
              {pendingRequests.map((request) => {
                const name =
                  peopleQuery.data?.find((p) => p.user_id === request.user_id)
                    ?.name ?? t('projects.projectMembers.requests.viewer')
                return (
                  <div
                    key={request.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{name}</div>
                      <div className="text-label text-fg-muted">
                        {request.reason}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ requestId: request.id, approve: true })
                      }
                    >
                      {t('projects.projectMembers.requests.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ requestId: request.id, approve: false })
                      }
                    >
                      {t('projects.projectMembers.requests.deny')}
                    </Button>
                  </div>
                )
              })}
            </div>
          </Section>
        ) : null}

        <Section title={t('projects.projectMembers.how.title')}>
          <div className="grid grid-cols-1 gap-3 text-label leading-[18px] md:grid-cols-2 md:gap-6 xl:grid-cols-4">
            <div>
              <b className="font-semibold">
                {t('projects.projectMembers.access.owner')}
              </b>
              <div className="text-fg-muted">
                {t('projects.projectMembers.how.owner')}
              </div>
            </div>
            <div>
              <b className="font-semibold">
                {t('projects.projectMembers.access.editor')}
              </b>
              <div className="text-fg-muted">
                {t('projects.projectMembers.how.editor')}
              </div>
            </div>
            <div>
              <b className="font-semibold">
                {t('projects.projectMembers.access.reviewer')}
              </b>
              <div className="text-fg-muted">
                {t('projects.projectMembers.how.reviewer')}
              </div>
            </div>
            <div>
              <b className="font-semibold">
                {t('projects.projectMembers.access.viewer')}
              </b>
              <div className="text-fg-muted">
                {t('projects.projectMembers.how.viewer')}
              </div>
            </div>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('projects.projectMembers.confirmRemove.title', {
                name: pendingRemove?.name ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('projects.projectMembers.confirmRemove.description')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={remove.isPending}
              onClick={() => {
                if (!pendingRemove) return
                remove.mutate(pendingRemove.id)
                setPendingRemove(null)
              }}
            >
              {t('projects.projectMembers.removeFromProject')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function RoleMenu({
  name,
  accessLevel,
  busy,
  onRole,
  onRemove,
}: {
  name: string
  accessLevel: string
  busy: boolean
  onRole: (access: string) => void
  onRemove: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            size="sm"
            aria-label={t('projects.projectMembers.menu.label', { name })}
            disabled={busy}
          />
        }
      >
        {t('projects.projectMembers.menu.trigger')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('projects.projectMembers.menu.heading')}
          </DropdownMenuLabel>
          {accessLevels.map((level) => (
            <DropdownMenuItem
              key={level.value}
              icon={accessLevel === level.value ? 'check' : undefined}
              className={accessLevel === level.value ? '' : 'pl-[30px]'}
              onClick={() => onRole(level.value)}
            >
              {t(`projects.projectMembers.access.${level.value}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger onClick={onRemove}>
          {t('projects.projectMembers.removeFromProject')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddPeople({
  projectId,
  available,
  onDone,
}: {
  projectId: string
  available: { user_id: string; name: string }[]
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [person, setPerson] = useState('')
  const [access, setAccess] = useState<string>('editor')
  const [error, setError] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () => setProjectMember(projectId, person, access),
    onSuccess: () => {
      onDone()
      setOpen(false)
      setPerson('')
      setError(null)
      toast(t('projects.projectMembers.added'))
    },
    onError: (caught: unknown) =>
      toast.error(
        caught instanceof Error
          ? caught.message
          : t('projects.projectMembers.addFailed'),
      ),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="primary"
        size="sm"
        icon="plus"
        onClick={() => setOpen(true)}
      >
        {t('projects.projectMembers.add.title')}
      </Button>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.projectMembers.add.title')}
          description={t('projects.projectMembers.add.description')}
        />
        <DialogBody>
          <Field label="Person" required error={error ?? undefined}>
            <PickerSelect
              noun="person"
              value={person}
              onChange={(id) => {
                setPerson(id)
                setError(null)
              }}
              options={available.map((p) => personOption(p.user_id, p.name))}
            />
          </Field>
          <Field label={t('projects.projectMembers.menu.heading')}>
            <Select value={access} onChange={(e) => setAccess(e.target.value)}>
              {accessLevels.map((level) => (
                <option key={level.value} value={level.value}>
                  {t(`projects.projectMembers.access.${level.value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => {
              if (!person) {
                setError(t('projects.projectMembers.add.choosePerson'))
                return
              }
              add.mutate()
            }}
          >
            {t('projects.projectMembers.add.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
