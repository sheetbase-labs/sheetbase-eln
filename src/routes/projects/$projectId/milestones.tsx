import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  createStudyTask,
  editStudyTask,
  fetchStudyDeliverables,
  fetchStudyTasks,
  fetchStudyWorkstreams,
  toStudyTask,
} from '#/lib/planner'
import type { StudyTask } from '#/lib/planner'
import { capabilityRoadmap } from '#/lib/capabilities'
import { cn } from '#/lib/utils'

/**
 * UI port (roadmap-4/ui-app3): the project Milestones tab (PROJ-02), replacing
 * the legacy /planner. Milestones are study_tasks of type 'milestone'; the
 * "done when" criteria are their study_deliverables, so done comes from
 * delivered evidence. Client visibility and date history are not stored, so
 * they are stated as gaps. `?state=denied|empty` drives the acceptance suite.
 */
export const Route = createFileRoute('/projects/$projectId/milestones')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { m?: string; state?: 'denied' | 'empty' } => ({
    m: typeof search.m === 'string' ? search.m : undefined,
    state:
      search.state === 'denied' || search.state === 'empty'
        ? search.state
        : undefined,
  }),
  component: Milestones,
})

function milestoneStatus(task: StudyTask): { tone: Tone; label: string } {
  if (task.status === 'completed') return { tone: 'ok', label: 'Done' }
  if (task.status === 'blocked') return { tone: 'bad', label: 'Blocked' }
  if (task.status === 'review') return { tone: 'review', label: 'In review' }
  if (task.status === 'in_progress')
    return { tone: 'progress', label: 'In progress' }
  const due = task.dueAt ? Date.parse(task.dueAt) : null
  if (due && due < Date.now()) return { tone: 'bad', label: 'Late' }
  return { tone: 'none', label: 'Not started' }
}

function Milestones() {
  const { projectId } = Route.useParams()
  const { m, state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canEdit = hasCapability(context.workspace?.role, 'schema.edit')
  const denied = state === 'denied' || !canEdit
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  const tasks = useQuery({
    queryKey: ['ui-port', 'milestones', 'tasks', workspaceId],
    queryFn: () =>
      fetchStudyTasks(notebookDataClient, workspaceId).then((rows) =>
        rows.map((row) => toStudyTask(row)),
      ),
    enabled: Boolean(workspaceId),
  })
  const workstreams = useQuery({
    queryKey: ['ui-port', 'milestones', 'workstreams', workspaceId],
    queryFn: () => fetchStudyWorkstreams(notebookDataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  const milestones = useMemo(
    () =>
      (tasks.data ?? []).filter(
        (t) => t.projectId === projectId && t.taskType === 'milestone',
      ),
    [tasks.data, projectId],
  )
  const phases = useMemo(
    () => (workstreams.data ?? []).filter((w) => w.projectId === projectId),
    [workstreams.data, projectId],
  )

  const deliverables = useQueries({
    queries: milestones.map((task) => ({
      queryKey: ['ui-port', 'milestones', 'deliverables', task.id],
      queryFn: () => fetchStudyDeliverables(notebookDataClient, task.id),
      staleTime: 15_000,
    })),
  })
  const deliverablesFor = (taskId: string) => {
    const index = milestones.findIndex((t) => t.id === taskId)
    return deliverables[index]?.data ?? []
  }

  const selected = milestones.find((t) => t.id === m) ?? milestones[0]

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'milestones'] })

  const add = useMutation({
    mutationFn: (input: {
      title: string
      dueAt: string
      workstreamId: string
    }) =>
      createStudyTask(notebookDataClient, workspaceId, {
        title: input.title,
        taskType: 'milestone',
        projectId,
        workstreamId: input.workstreamId || null,
        dueAt: input.dueAt,
        status: 'not_started',
      }),
    onSuccess: () => {
      void invalidate()
      setAddOpen(false)
      toast('Milestone added')
    },
  })
  const move = useMutation({
    mutationFn: (input: { task: StudyTask; dueAt: string }) =>
      editStudyTask(notebookDataClient, {
        taskId: input.task.id,
        dueAt: input.dueAt,
        expectedMetadataVersion: input.task.metadataVersion,
      }),
    onSuccess: () => {
      void invalidate()
      setMoveOpen(false)
      toast('Date changed')
    },
    onError: () =>
      toast('Could not move the date', {
        description: 'The plan changed; reload and try again.',
      }),
  })
  const markDone = useMutation({
    mutationFn: (task: StudyTask) =>
      editStudyTask(notebookDataClient, {
        taskId: task.id,
        status: 'completed',
        expectedMetadataVersion: task.metadataVersion,
      }),
    onSuccess: () => {
      void invalidate()
      toast('Milestone marked done')
    },
    onError: () =>
      toast('Could not mark it done', {
        description: 'The plan changed; reload and try again.',
      }),
  })

  if (tasks.isLoading) {
    return (
      <div className="px-4 py-5 md:px-6" aria-busy="true">
        <Muted>Loading milestones…</Muted>
      </div>
    )
  }

  if (!milestones.length) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="calendar"
            title="No milestones yet"
            body="Milestones are what this project has promised. Each names the records that prove it’s done, so progress comes from delivered evidence."
          >
            <Button
              variant="primary"
              disabled={denied}
              onClick={() => setAddOpen(true)}
            >
              Add a milestone
            </Button>
          </EmptyState>
        </div>
        {addOpen ? (
          <AddMilestoneDialog
            phases={phases.map((p) => ({ id: p.id, name: p.name }))}
            onClose={() => setAddOpen(false)}
            onSubmit={(input) => add.mutate(input)}
            busy={add.isPending}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {denied ? (
          <Notice tone="info" className="mb-3" icon="lock">
            You can view this plan but not change it. Only project editors can
            add milestones, move dates or mark them done.
          </Notice>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Muted>
            {milestones.filter((t) => t.status === 'completed').length} of{' '}
            {milestones.length} done
          </Muted>
          <Button size="sm" disabled={denied} onClick={() => setAddOpen(true)}>
            Add milestone
          </Button>
        </div>

        <MilestoneTimeline
          milestones={milestones}
          selectedId={selected.id}
          onSelect={(id) =>
            void navigate({
              to: '/projects/$projectId/milestones',
              params: { projectId },
              search: (prev: Record<string, unknown>) => ({ ...prev, m: id }),
              replace: true,
            })
          }
        />

        <div className="overflow-hidden rounded-md border border-border">
          <Table aria-label="Milestones">
            <TableHeader>
              <TableRow>
                <TableHead className="first:pl-3">Milestone</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Done when</TableHead>
                <TableHead className="pr-3">Phase</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestones.map((task) => {
                const items = deliverablesFor(task.id)
                const met = items.filter((d) => d.status === 'delivered').length
                const status = milestoneStatus(task)
                return (
                  <TableRow
                    key={task.id}
                    selected={task.id === selected.id}
                    className="cursor-pointer"
                    onClick={() =>
                      void navigate({
                        to: '/projects/$projectId/milestones',
                        params: { projectId },
                        search: (prev: Record<string, unknown>) => ({
                          ...prev,
                          m: task.id,
                        }),
                        replace: true,
                      })
                    }
                  >
                    <TableCell className="first:pl-3 font-medium">
                      {task.title}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {task.dueAt ? task.dueAt.slice(0, 10) : '—'}
                    </TableCell>
                    <TableCell>
                      <Status tone={status.tone}>{status.label}</Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {items.length
                        ? `${met} of ${items.length} met`
                        : 'No conditions'}
                    </TableCell>
                    <TableCell className="pr-3 text-fg-muted">
                      {phases.find((p) => p.id === task.workstreamId)?.name ??
                        '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <Muted className="mt-3">
          A milestone only counts as done once its linked records are delivered.
        </Muted>
      </div>

      <aside
        aria-label={`${selected.title} details`}
        className="hidden w-[340px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex"
      >
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">
            {phases.find((p) => p.id === selected.workstreamId)?.name ??
              'Internal milestone'}
          </span>
          <div className="font-heading text-doc font-semibold">
            {selected.title}
          </div>
          <Status tone={milestoneStatus(selected).tone}>
            {milestoneStatus(selected).label}
          </Status>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={denied} onClick={() => setMoveOpen(true)}>
            Move date…
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={
              denied ||
              selected.status === 'completed' ||
              deliverablesFor(selected.id).some(
                (d) => d.status !== 'delivered',
              ) ||
              deliverablesFor(selected.id).length === 0
            }
            onClick={() => markDone.mutate(selected)}
          >
            Mark done
          </Button>
        </div>
        {deliverablesFor(selected.id).some((d) => d.status !== 'delivered') ? (
          <Muted>
            Mark done needs every condition met.{' '}
            {
              deliverablesFor(selected.id).filter(
                (d) => d.status !== 'delivered',
              ).length
            }{' '}
            still open.
          </Muted>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium text-fg-muted">Done when</h3>
          {deliverablesFor(selected.id).length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {deliverablesFor(selected.id).map((d) => (
                <li key={d.id} className="flex items-start gap-2 text-body">
                  <Status tone={d.status === 'delivered' ? 'ok' : 'none'}>
                    {d.status === 'delivered' ? 'Met' : 'Open'}
                  </Status>
                  <span>{d.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Muted>No conditions recorded for this milestone.</Muted>
          )}
        </div>

        <CapabilityGap
          variant="inline"
          title="Client visibility and date history aren’t stored yet"
          will="Whether the client sees a milestone, and every date change with its reason, will be recorded here."
          roadmap={capabilityRoadmap.portalReports}
          admin={!denied}
          instead={[
            {
              label: 'Project settings',
              link: {
                to: '/projects/$projectId/settings',
                params: { projectId },
              },
            },
          ]}
        />
      </aside>

      {addOpen ? (
        <AddMilestoneDialog
          phases={phases.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setAddOpen(false)}
          onSubmit={(input) => add.mutate(input)}
          busy={add.isPending}
        />
      ) : null}
      {moveOpen ? (
        <MoveDateDialog
          task={selected}
          onClose={() => setMoveOpen(false)}
          onSubmit={(dueAt) => move.mutate({ task: selected, dueAt })}
          busy={move.isPending}
        />
      ) : null}
    </div>
  )
}

function MilestoneTimeline({
  milestones,
  selectedId,
  onSelect,
}: {
  milestones: StudyTask[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const dates = milestones
    .map((m) => (m.dueAt ? Date.parse(m.dueAt) : null))
    .filter((d): d is number => d !== null)
  if (dates.length === 0) return null
  const now = Date.now()
  const min = Math.min(...dates, now)
  const max = Math.max(...dates, now)
  const span = max - min || 1
  const pos = (t: number) => ((t - min) / span) * 100
  // Month ticks across the range.
  const months: { label: string; left: number }[] = []
  const cursor = new Date(min)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= max) {
    months.push({
      label: cursor.toLocaleDateString('en-GB', { month: 'short' }),
      left: pos(cursor.getTime()),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return (
    <div
      aria-label="Milestone timeline"
      className="relative mb-3 h-16 rounded-md border border-border bg-surface-muted/40 max-md:hidden"
    >
      <div className="absolute inset-x-3 top-1/2 h-px bg-border" />
      {months.map((m) => (
        <span
          key={`${m.label}-${m.left}`}
          className="absolute top-1 -translate-x-1/2 text-caption text-fg-muted"
          style={{ left: `calc(${m.left}% )` }}
        >
          {m.label}
        </span>
      ))}
      {milestones.map((m) => {
        if (!m.dueAt) return null
        const status = milestoneStatus(m)
        const tone =
          status.tone === 'ok'
            ? 'bg-success'
            : status.tone === 'bad'
              ? 'bg-danger'
              : status.tone === 'review' || status.tone === 'progress'
                ? 'bg-warning'
                : 'bg-link'
        return (
          <button
            key={m.id}
            type="button"
            title={`${m.title} · ${m.dueAt.slice(0, 10)}`}
            aria-label={`${m.title}, due ${m.dueAt.slice(0, 10)}`}
            aria-pressed={m.id === selectedId}
            onClick={() => onSelect(m.id)}
            className={cn(
              'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer border-0 p-0',
              tone,
              m.id === selectedId && 'ring-2 ring-focus',
            )}
            style={{ left: `${pos(Date.parse(m.dueAt))}%` }}
          />
        )
      })}
      <span
        className="absolute top-1/2 h-10 -translate-x-1/2 -translate-y-1/2 border-l border-dashed border-fg-muted"
        style={{ left: `${pos(now)}%` }}
        title="Today"
      />
    </div>
  )
}

function AddMilestoneDialog({
  phases,
  onClose,
  onSubmit,
  busy,
}: {
  phases: { id: string; name: string }[]
  onClose: () => void
  onSubmit: (input: {
    title: string
    dueAt: string
    workstreamId: string
  }) => void
  busy: boolean
}) {
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [workstreamId, setWorkstreamId] = useState('')
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Add a milestone"
          description="A milestone names the records that prove it’s done."
        />
        <DialogBody>
          <Field label="Name" required>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. TFF and polish defined"
            />
          </Field>
          <Field label="Due date" required>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
          {phases.length ? (
            <Field label="Phase">
              <select
                aria-label="Phase"
                className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
                value={workstreamId}
                onChange={(e) => setWorkstreamId(e.target.value)}
              >
                <option value="">No phase</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || title.trim().length < 3 || !dueAt}
            onClick={() =>
              onSubmit({ title: title.trim(), dueAt, workstreamId })
            }
          >
            Add milestone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MoveDateDialog({
  task,
  onClose,
  onSubmit,
  busy,
}: {
  task: StudyTask
  onClose: () => void
  onSubmit: (dueAt: string) => void
  busy: boolean
}) {
  const [dueAt, setDueAt] = useState(task.dueAt?.slice(0, 10) ?? '')
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title="Move date"
          description="Later milestones don’t move automatically."
        />
        <DialogBody>
          <Field label="Current">
            <Input value={task.dueAt?.slice(0, 10) ?? '—'} disabled />
          </Field>
          <Field label="New date" required>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !dueAt}
            onClick={() => onSubmit(dueAt)}
          >
            Move date
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
