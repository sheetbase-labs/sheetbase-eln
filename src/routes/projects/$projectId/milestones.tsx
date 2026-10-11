import { Fragment, useMemo, useState } from 'react'
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
import { Banner, Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
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
import {
  MilestoneTimeline,
  phaseBands,
} from '#/components/v3/projects/milestone-timeline'
import type {
  MilestoneScale,
  PlanDependency,
  PlanMilestone,
} from '#/components/v3/projects/milestone-timeline'
import {
  fetchProjectSummaries,
  fetchWorkspaceMemberIdentities,
  PROJECTS_KEY,
  workspaceMemberQueryKeys,
} from '#/components/v3/projects/project-data'
import { hasCapability } from '#/lib/capability'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  createPlanFromProject,
  createStudyTask,
  describePlannerError,
  editStudyTask,
  fetchMilestoneRisks,
  fetchStudyDeliverables,
  fetchStudyDependencies,
  fetchStudyTaskDueChanges,
  fetchStudyTasks,
  fetchStudyWorkstreams,
  moveStudyTaskDue,
  setStudyTaskClientVisible,
  toStudyTask,
} from '#/lib/planner'
import type { MilestoneRisk, StudyTask } from '#/lib/planner'
import { cn } from '#/lib/utils'

/**
 * UI port (roadmap-4/ui-app3): the project Milestones tab (PROJ-02), extended
 * by R5-CONFIG-05. Milestones are study_tasks of type 'milestone'; the "done
 * when" criteria are their study_deliverables, so done comes from delivered
 * evidence. Client visibility, date history (migration 0263), risk
 * (`api.milestone_risks`) and plan copying (`create_plan_from_project`) are
 * read from the canonical boundary. `?state=denied|empty` drives the
 * acceptance suite; a stale write is a real 409/SB001 conflict, never a query
 * parameter.
 */
export const Route = createFileRoute('/projects/$projectId/milestones')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { m?: string; scale?: MilestoneScale; state?: 'denied' | 'empty' } => ({
    m: typeof search.m === 'string' ? search.m : undefined,
    scale:
      search.scale === 'week' || search.scale === 'month'
        ? search.scale
        : undefined,
    state:
      search.state === 'denied' || search.state === 'empty'
        ? search.state
        : undefined,
  }),
  component: Milestones,
})

/** The at-risk rule, stated once here and once in the plan header copy. */
const AT_RISK_RULE =
  'At risk means due within 14 days while a condition is still open or a milestone it depends on is not done. Late means the due date has passed.'

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

function daysUntil(dueAt: string, now = Date.now()): number {
  const due = new Date(dueAt)
  due.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

function relativeDay(dueAt: string, now = Date.now()): string {
  const days = daysUntil(dueAt, now)
  if (days === 0) return 'today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  const late = -days
  return `${late} day${late === 1 ? '' : 's'} late`
}

interface PlanTemplateCandidate {
  projectId: string
  title: string
  milestones: StudyTask[]
}

function Milestones() {
  const { projectId } = Route.useParams()
  const { m, scale: scaleParam, state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canEdit = hasCapability(context.workspace?.role, 'schema.edit')
  const denied = state === 'denied' || !canEdit
  const scale: MilestoneScale = scaleParam ?? 'month'
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateSourceId, setTemplateSourceId] = useState<string | null>(null)
  const [stale, setStale] = useState<string | null>(null)

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
  const risks = useQuery({
    queryKey: ['ui-port', 'milestones', 'risks', workspaceId],
    queryFn: () => fetchMilestoneRisks(notebookDataClient, workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
  })
  const dependencies = useQuery({
    queryKey: ['ui-port', 'milestones', 'dependencies', workspaceId],
    queryFn: () => fetchStudyDependencies(notebookDataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const members = useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: () => fetchWorkspaceMemberIdentities(),
  })
  const projects = useQuery({
    queryKey: [...PROJECTS_KEY, 'summary'],
    queryFn: () => fetchProjectSummaries(undefined),
  })
  const project = projects.data?.find((item) => item.id === projectId) ?? null
  const clientLabel = project?.clientCode ?? 'the client'

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
  const riskByTask = useMemo(() => {
    const map = new Map<string, MilestoneRisk>()
    for (const risk of risks.data ?? []) map.set(risk.taskId, risk)
    return map
  }, [risks.data])
  const dependenciesFor = useMemo(() => {
    const ids = new Set(milestones.map((t) => t.id))
    return (dependencies.data ?? []).filter(
      (d) => ids.has(d.predecessorId) || ids.has(d.successorId),
    )
  }, [dependencies.data, milestones])

  const planMilestones: PlanMilestone[] = useMemo(
    () =>
      milestones.map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt,
        status: task.status,
        risk: riskByTask.get(task.id)?.risk ?? 'unknown',
        clientVisible: task.clientVisible,
        workstreamId: task.workstreamId,
      })),
    [milestones, riskByTask],
  )
  const planDependencies: PlanDependency[] = dependenciesFor.map((d) => ({
    id: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
  }))
  const bands = useMemo(
    () => phaseBands(planMilestones, phases),
    [planMilestones, phases],
  )
  const titleOf = (taskId: string) =>
    milestones.find((t) => t.id === taskId)?.title ?? 'another milestone'

  const clientDates = useMemo(
    () =>
      milestones
        .filter((t) => t.clientVisible && t.status !== 'completed' && t.dueAt)
        .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!)),
    [milestones],
  )
  const nextClientDate = clientDates.at(0)

  const templateCandidates: PlanTemplateCandidate[] = useMemo(() => {
    const byProject = new Map<string, StudyTask[]>()
    for (const task of tasks.data ?? []) {
      if (task.taskType !== 'milestone' || !task.projectId) continue
      if (task.projectId === projectId) continue
      const bucket = byProject.get(task.projectId)
      if (bucket) bucket.push(task)
      else byProject.set(task.projectId, [task])
    }
    const titles = new Map(
      (projects.data ?? []).map((summary) => [summary.id, summary.title]),
    )
    return [...byProject].map(([candidateId, items]) => ({
      projectId: candidateId,
      title: titles.get(candidateId) ?? 'Untitled project',
      milestones: items
        .slice()
        .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    }))
  }, [tasks.data, projects.data, projectId])

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

  const selected: StudyTask | undefined =
    milestones.find((t) => t.id === m) ?? clientDates.at(0) ?? milestones.at(0)
  const selectedRisk = selected ? riskByTask.get(selected.id) : undefined
  const dueChanges = useQuery({
    queryKey: ['ui-port', 'milestones', 'due-changes', selected?.id ?? ''],
    queryFn: () =>
      selected
        ? fetchStudyTaskDueChanges(notebookDataClient, selected.id)
        : Promise.resolve([]),
    enabled: Boolean(selected),
    staleTime: 15_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'milestones'] })

  const reportWriteError = (error: unknown, what: string) => {
    if (error instanceof DataClientError && error.code === 'SB001') {
      setStale(
        'This plan changed while you had it open. Your change was not saved and nothing was overwritten.',
      )
      return true
    }
    toast(`Could not ${what}`, { description: describePlannerError(error) })
    return false
  }

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
    onError: (error) => reportWriteError(error, 'add the milestone'),
  })
  const move = useMutation({
    mutationFn: (input: {
      task: StudyTask
      dueAt: string
      reason: string
      notifyClient: boolean
    }) =>
      moveStudyTaskDue(notebookDataClient, {
        taskId: input.task.id,
        dueAt: input.dueAt,
        reason: input.reason,
        notifyClient: input.notifyClient,
        expectedMetadataVersion: input.task.metadataVersion,
      }),
    onSuccess: () => {
      void invalidate()
      setMoveOpen(false)
      toast('Date changed')
    },
    onError: (error) => {
      if (reportWriteError(error, 'move the date')) setMoveOpen(false)
    },
  })
  const setVisibility = useMutation({
    mutationFn: (input: {
      task: StudyTask
      clientVisible: boolean
      reason: string
    }) =>
      setStudyTaskClientVisible(notebookDataClient, {
        taskId: input.task.id,
        clientVisible: input.clientVisible,
        reason: input.reason,
        expectedMetadataVersion: input.task.metadataVersion,
      }),
    onSuccess: () => {
      void invalidate()
      toast('Visibility changed')
    },
    onError: (error) => reportWriteError(error, 'change visibility'),
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
    onError: (error) => reportWriteError(error, 'mark it done'),
  })
  const applyTemplate = useMutation({
    mutationFn: (input: { sourceProjectId: string; startDate: string }) =>
      createPlanFromProject(notebookDataClient, {
        targetProjectId: projectId,
        sourceProjectId: input.sourceProjectId,
        startDate: input.startDate,
      }),
    onSuccess: (result) => {
      void invalidate()
      setTemplateOpen(false)
      toast('Plan created', {
        description: `${result.milestones} milestones and ${result.phases} phases copied through the milestone RPCs.`,
      })
    },
    onError: (error) => {
      if (reportWriteError(error, 'create the plan')) setTemplateOpen(false)
    },
  })

  const reloadPlan = () => {
    setStale(null)
    void invalidate()
  }

  const staleBanner = stale ? (
    <Banner
      tone="warn"
      title="This plan changed elsewhere"
      action={
        <Button size="sm" onClick={reloadPlan}>
          Reload plan
        </Button>
      }
    >
      {stale} Reload, then make the change again.
    </Banner>
  ) : null

  const riskNotice =
    selectedRisk?.risk === 'late' ? (
      <Notice tone="bad" title="Late">
        {selectedRisk.riskReason}. {AT_RISK_RULE}
      </Notice>
    ) : selectedRisk?.risk === 'at_risk' ? (
      <Notice tone="warn" title="At risk">
        {selectedRisk.riskReason}. {AT_RISK_RULE}
      </Notice>
    ) : null

  const dependsOn = selected
    ? dependenciesFor
        .filter((d) => d.successorId === selected.id)
        .map((d) => titleOf(d.predecessorId))
    : []
  const neededFor = selected
    ? dependenciesFor
        .filter((d) => d.predecessorId === selected.id)
        .map((d) => titleOf(d.successorId))
    : []
  const memberName = (userId: string | null) =>
    (userId &&
      members.data?.find((member) => member.user_id === userId)?.name) ||
    'Someone'

  if (tasks.isLoading) {
    return (
      <div className="px-4 py-5 md:px-6" aria-busy="true">
        <Muted>Loading milestones…</Muted>
      </div>
    )
  }

  const templateSection = (
    <div className="mt-4 flex flex-col gap-2">
      <h3 className="text-label font-medium text-fg-muted">
        Start from a template
      </h3>
      {templateCandidates.length ? (
        <>
          <Muted>
            A template is a plan already built on another project in this
            workspace. Copying it keeps each milestone’s spacing from its own
            first date; completion, records and evidence are not copied.
          </Muted>
          <div className="flex flex-wrap gap-2">
            {templateCandidates.map((candidate) => (
              <div
                key={candidate.projectId}
                className="w-[240px] rounded-md border border-border bg-surface p-3"
              >
                <div className="text-body font-medium">{candidate.title}</div>
                <div className="text-label text-fg-muted">
                  {candidate.milestones.length} milestones ·{' '}
                  {candidate.milestones
                    .slice(0, 3)
                    .map((milestone) => milestone.title)
                    .join(' · ')}
                  {candidate.milestones.length > 3 ? '…' : ''}
                </div>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={denied}
                  onClick={() => {
                    setTemplateSourceId(candidate.projectId)
                    setTemplateOpen(true)
                  }}
                >
                  Use this template…
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Muted>
          No other project in this workspace has milestones to start from yet.
          Add milestones one by one.
        </Muted>
      )}
    </div>
  )

  if (!selected) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {staleBanner}
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
          {templateSection}
        </div>
        {addOpen ? (
          <AddMilestoneDialog
            phases={phases.map((p) => ({ id: p.id, name: p.name }))}
            onClose={() => setAddOpen(false)}
            onSubmit={(input) => add.mutate(input)}
            busy={add.isPending}
          />
        ) : null}
        {templateOpen ? (
          <StartFromTemplateDialog
            candidates={templateCandidates}
            initialSourceId={
              templateSourceId ?? templateCandidates.at(0)?.projectId ?? ''
            }
            onClose={() => setTemplateOpen(false)}
            onSubmit={(input) => applyTemplate.mutate(input)}
            busy={applyTemplate.isPending}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {staleBanner}
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
            <Button
              size="sm"
              disabled={denied}
              onClick={() => setAddOpen(true)}
            >
              Add milestone
            </Button>
            <Button
              size="sm"
              disabled={denied || templateCandidates.length === 0}
              onClick={() => setTemplateOpen(true)}
            >
              Start from a template…
            </Button>
          </div>
          <Muted className="mb-2 block">
            {nextClientDate
              ? `Next date ${clientLabel} sees: ${nextClientDate.title}, ${nextClientDate.dueAt!.slice(0, 10)} (${relativeDay(nextClientDate.dueAt!)})`
              : `Nothing is shared with ${clientLabel} yet.`}
          </Muted>
          <Muted className="mb-3 block">{AT_RISK_RULE}</Muted>
          {risks.isError ? (
            <Notice tone="warn" className="mb-3">
              Risk could not be read right now, so milestones show as unknown.
            </Notice>
          ) : null}

          <MilestoneTimeline
            milestones={planMilestones}
            phases={phases.map((phase) => ({
              id: phase.id,
              name: phase.name,
            }))}
            dependencies={planDependencies}
            scale={scale}
            onScaleChange={(next) =>
              void navigate({
                to: '/projects/$projectId/milestones',
                params: { projectId },
                search: (prev: Record<string, unknown>) => ({
                  ...prev,
                  scale: next,
                }),
                replace: true,
              })
            }
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

          <div className="overflow-x-auto rounded-md border border-border">
            <Table aria-label="Milestones">
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">Milestone</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Done when</TableHead>
                  <TableHead className="pr-3">{clientLabel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bands.map((band) => (
                  <Fragment key={`band-${band.id}`}>
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="bg-surface-muted text-label font-medium text-fg-muted"
                      >
                        {band.name} · {band.milestones.length}
                      </TableCell>
                    </TableRow>
                    {band.milestones.map((planMilestone) => {
                      const task = milestones.find(
                        (t) => t.id === planMilestone.id,
                      )
                      if (!task) return null
                      const items = deliverablesFor(task.id)
                      const met = items.filter(
                        (d) => d.status === 'delivered',
                      ).length
                      const status = milestoneStatus(task)
                      const risk = riskByTask.get(task.id)
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
                          <TableCell
                            className={cn(
                              'text-fg-muted',
                              risk?.risk === 'late' && 'text-danger-text',
                            )}
                          >
                            {task.dueAt ? task.dueAt.slice(0, 10) : '—'}
                            {risk?.late && task.dueAt
                              ? ` · ${relativeDay(task.dueAt)}`
                              : ''}
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
                            {task.clientVisible
                              ? `Visible since ${task.sharedSince?.slice(0, 10) ?? '—'}`
                              : 'Internal'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <Muted className="mt-3">
            A milestone only counts as done once its linked records are
            delivered.
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
            <div className="flex items-center gap-2">
              <Status tone={milestoneStatus(selected).tone}>
                {milestoneStatus(selected).label}
              </Status>
              {riskByTask.get(selected.id)?.risk === 'at_risk' ? (
                <Status tone="review">At risk</Status>
              ) : null}
            </div>
          </div>
          {riskNotice}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={denied}
              onClick={() => setMoveOpen(true)}
            >
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
          {deliverablesFor(selected.id).some(
            (d) => d.status !== 'delivered',
          ) ? (
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

          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg-muted">Depends on</h3>
            {dependsOn.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
                {dependsOn.map((name, index) => (
                  <li key={`${name}-${index}`}>{name}</li>
                ))}
              </ul>
            ) : (
              <Muted>No dependencies recorded.</Muted>
            )}
            <h3 className="text-label font-medium text-fg-muted">Needed for</h3>
            {neededFor.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
                {neededFor.map((name, index) => (
                  <li key={`${name}-${index}`}>{name}</li>
                ))}
              </ul>
            ) : (
              <Muted>Nothing depends on this milestone.</Muted>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg-muted">
              Client portal
            </h3>
            <label className="flex items-start gap-2 text-body">
              <input
                type="checkbox"
                aria-label={`Show to ${clientLabel}`}
                disabled={denied || setVisibility.isPending}
                checked={selected.clientVisible}
                onChange={(e) =>
                  setVisibility.mutate({
                    task: selected,
                    clientVisible: e.target.checked,
                    reason: e.target.checked
                      ? ''
                      : (window.prompt(
                          `Why are you hiding this milestone from ${clientLabel}?`,
                        ) ?? ''),
                  })
                }
              />
              <span>
                Show to {clientLabel}
                {selected.clientVisible && selected.sharedSince ? (
                  <span className="block text-label text-fg-muted">
                    Shared since {selected.sharedSince.slice(0, 10)}
                  </span>
                ) : null}
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg-muted">
              Date history
            </h3>
            {dueChanges.data?.length ? (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {dueChanges.data.map((c) => (
                  <li key={c.id} className="text-label leading-[17px]">
                    <span className="text-fg-muted">
                      {c.fromDueAt ? c.fromDueAt.slice(0, 10) : '—'} →{' '}
                      {c.toDueAt ? c.toDueAt.slice(0, 10) : '—'}
                    </span>{' '}
                    {c.reason}
                    <span className="block text-fg-muted">
                      {memberName(c.changedByUserId)} ·{' '}
                      {c.changedAt.slice(0, 16).replace('T', ' ')}
                      {c.clientNotified ? ` · ${clientLabel} told` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>No date changes yet.</Muted>
            )}
          </div>

          <Muted>
            Plan revision {selected.metadataVersion} · updated{' '}
            {selected.updatedAt.slice(0, 10)}
          </Muted>
        </aside>
      </div>

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
          clientLabel={clientLabel}
          onClose={() => setMoveOpen(false)}
          onSubmit={(input) => move.mutate({ task: selected, ...input })}
          busy={move.isPending}
        />
      ) : null}
      {templateOpen ? (
        <StartFromTemplateDialog
          candidates={templateCandidates}
          initialSourceId={
            templateSourceId ?? templateCandidates.at(0)?.projectId ?? ''
          }
          onClose={() => setTemplateOpen(false)}
          onSubmit={(input) => applyTemplate.mutate(input)}
          busy={applyTemplate.isPending}
        />
      ) : null}
    </div>
  )
}

function StartFromTemplateDialog({
  candidates,
  initialSourceId,
  onClose,
  onSubmit,
  busy,
}: {
  candidates: PlanTemplateCandidate[]
  initialSourceId: string
  onClose: () => void
  onSubmit: (input: { sourceProjectId: string; startDate: string }) => void
  busy: boolean
}) {
  const [sourceProjectId, setSourceProjectId] = useState(initialSourceId)
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const source = candidates.find((c) => c.projectId === sourceProjectId)
  const firstTime = source?.milestones.find((mile) => mile.dueAt)?.dueAt
    ? Date.parse(source.milestones.find((mile) => mile.dueAt)!.dueAt!)
    : null
  const previewDue = (dueAt: string | null) => {
    if (!dueAt || firstTime === null) return '—'
    const offset = Math.round((Date.parse(dueAt) - firstTime) / 86_400_000)
    const due = new Date(`${startDate}T00:00:00Z`)
    due.setDate(due.getDate() + offset)
    return due.toISOString().slice(0, 10)
  }
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Start from a template"
          description="The source plan’s milestones are copied into this project through the milestone RPCs. Completion, records and evidence are not copied."
        />
        <DialogBody>
          <Field label="Template" required>
            <select
              aria-label="Template"
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
              value={sourceProjectId}
              onChange={(e) => setSourceProjectId(e.target.value)}
            >
              {candidates.map((candidate) => (
                <option key={candidate.projectId} value={candidate.projectId}>
                  {candidate.title} · {candidate.milestones.length} milestones
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date" required>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          {source ? (
            <div className="overflow-hidden rounded-md border border-border">
              <Table aria-label="Template preview">
                <TableHeader>
                  <TableRow>
                    <TableHead className="first:pl-3">Milestone</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="pr-3">Visibility</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {source.milestones.map((milestone) => (
                    <TableRow key={milestone.id}>
                      <TableCell className="first:pl-3">
                        {milestone.title}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {previewDue(milestone.dueAt)}
                      </TableCell>
                      <TableCell className="pr-3 text-fg-muted">
                        {milestone.clientVisible ? 'Visible' : 'Internal'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !sourceProjectId || !startDate}
            onClick={() => onSubmit({ sourceProjectId, startDate })}
          >
            Create plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  clientLabel,
  onClose,
  onSubmit,
  busy,
}: {
  task: StudyTask
  clientLabel: string
  onClose: () => void
  onSubmit: (input: {
    dueAt: string
    reason: string
    notifyClient: boolean
  }) => void
  busy: boolean
}) {
  const [dueAt, setDueAt] = useState(task.dueAt?.slice(0, 10) ?? '')
  const [reason, setReason] = useState('')
  const [notifyClient, setNotifyClient] = useState(task.clientVisible)
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title="Move date"
          description="Later milestones don’t move automatically. Every change is kept with its reason."
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
          <Field
            label="Reason for change"
            required
            hint={
              task.clientVisible
                ? `${clientLabel} sees this date, so the reason is kept with the change.`
                : undefined
            }
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Material release slipped a week"
            />
          </Field>
          {task.clientVisible ? (
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={notifyClient}
                onChange={(e) => setNotifyClient(e.target.checked)}
              />
              Tell {clientLabel} about the new date
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !dueAt || reason.trim().length < 3}
            onClick={() =>
              onSubmit({ dueAt, reason: reason.trim(), notifyClient })
            }
          >
            Move date
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
