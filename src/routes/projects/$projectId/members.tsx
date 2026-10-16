import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { NativeSelect } from '#/components/v3/projects/select'
import {
  fetchProjectMembers,
  fetchWorkspaceMemberIdentities,
  removeProjectMember,
  setProjectMember,
  useProjectSummary,
} from '#/components/v3/projects/project-data'

/** The project-access levels a lead can grant here. They are the permission
 * `set_project_member` accepts, and they match the Access column and the
 * "How access works" copy. The lead's own level (owner) is set with the
 * project, not on this screen. */
const accessLevels = [
  { label: 'Editor', value: 'editor' },
  { label: 'Reviewer', value: 'reviewer' },
  { label: 'Viewer', value: 'viewer' },
] as const
const accessLabel: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
}

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
  const isLead = project?.leadUserId === context.user.id
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
        error instanceof Error ? error.message : 'Could not change access.',
      ),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId),
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not remove them from the project.',
      ),
  })

  const available = useMemo(() => {
    const present = new Set(members.map((m) => m.user_id))
    return (peopleQuery.data ?? []).filter((p) => !present.has(p.user_id))
  }, [peopleQuery.data, members])

  if (!project) return null

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        {!isLead ? (
          <Notice icon="lock" title="You can see the team but not change it.">
            {project.leadName ?? 'The lead'} is the lead. Ask them to add people
            or change their access.
          </Notice>
        ) : null}

        <Section
          title="Team"
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
            <Table>
              <TableHeader>
                <TableRow>
                  {['Person', 'Project role', 'Access', 'Added'].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                  <TableHead aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      {m.name}
                      {m.is_lead ? (
                        <span className="ml-1.5 text-label text-fg-muted">
                          Lead
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {m.project_role ?? (m.is_lead ? 'Lead' : '—')}
                    </TableCell>
                    <TableCell>
                      {accessLabel[m.access_level] ?? m.access_level}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {m.added_at.slice(0, 10)}
                    </TableCell>
                    <TableCell align="right">
                      {isLead && !m.is_lead ? (
                        <RoleMenu
                          name={m.name}
                          accessLevel={m.access_level}
                          busy={setRole.isPending || remove.isPending}
                          onRole={(access) =>
                            setRole.mutate({
                              userId: m.user_id,
                              accessLevel: access,
                            })
                          }
                          onRemove={() =>
                            setPendingRemove({ id: m.user_id, name: m.name })
                          }
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        </Section>

        <Section title="How access works">
          <div className="grid grid-cols-1 gap-3 text-label leading-[18px] md:grid-cols-2 md:gap-6 xl:grid-cols-4">
            <div>
              <b className="font-semibold">Owner</b>
              <div className="text-fg-muted">
                The project lead. Manages the project, its members and its
                settings.
              </div>
            </div>
            <div>
              <b className="font-semibold">Editor</b>
              <div className="text-fg-muted">
                Creates and edits experiments, samples and datasets here. Signs
                as author.
              </div>
            </div>
            <div>
              <b className="font-semibold">Reviewer</b>
              <div className="text-fg-muted">
                Everything an editor can do, plus review and sign others'
                records in this project.
              </div>
            </div>
            <div>
              <b className="font-semibold">Viewer</b>
              <div className="text-fg-muted">
                Reads, comments and exports. Can request edit access.
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
              Remove {pendingRemove?.name} from this project?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              They lose access to every record in this project. You can add them
              again later.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={remove.isPending}
              onClick={() => {
                if (!pendingRemove) return
                remove.mutate(pendingRemove.id)
                setPendingRemove(null)
              }}
            >
              Remove from project
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
            aria-label={`Change access for ${name}`}
            disabled={busy}
          />
        }
      >
        Change access…
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Project access</DropdownMenuLabel>
          {accessLevels.map((level) => (
            <DropdownMenuItem
              key={level.value}
              icon={accessLevel === level.value ? 'check' : undefined}
              className={accessLevel === level.value ? '' : 'pl-[30px]'}
              onClick={() => onRole(level.value)}
            >
              {level.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger onClick={onRemove}>
          Remove from project
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
      toast('Added to project')
    },
    onError: (caught: unknown) =>
      toast.error(
        caught instanceof Error ? caught.message : 'Could not add them.',
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
        Add people
      </Button>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title="Add people"
          description="They get access to every record in this project."
        />
        <DialogBody>
          <Field label="Person" required error={error ?? undefined}>
            <NativeSelect
              value={person}
              onChange={(e) => {
                setPerson(e.target.value)
                setError(null)
              }}
            >
              <option value="">Choose…</option>
              {available.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Project access">
            <NativeSelect
              value={access}
              onChange={(e) => setAccess(e.target.value)}
            >
              {accessLevels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => {
              if (!person) {
                setError('Choose a person.')
                return
              }
              add.mutate()
            }}
          >
            Add to project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
