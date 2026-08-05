/**
 * OPS-005 — Study Planner route.
 *
 * Timeline, calendar, list, workload and resource views over one task model.
 * The left side shows swimlane-grouped tasks; the right inspector shows the
 * selected task's detail, protocol, samples, conflicts and approval
 * requirements. Timeline edits are transactional via the controlled RPCs and
 * accessible through equivalent form controls (the task dialog).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Plus,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  EMPTY_PLANNER_FILTERS,
  PlannerFilters,
  PlannerInspector,
  PlannerList,
  PlannerResourceView,
  PlannerTimeline,
  PlannerWorkload,
  TaskDialog,
} from '#/components/planner'
import type { PlannerFilterValue } from '#/components/planner'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  PageHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  addDays,
  createStudyTask,
  deleteStudyTask,
  describePlannerError,
  editStudyTask,
  fetchCalendarResourcesAsPlanner,
  fetchStudyDependencies,
  fetchStudyDeliverables,
  fetchStudyTaskAssignments,
  fetchStudyTaskResources,
  fetchStudyTasks,
  fetchStudyWorkstreams,
  plannerQueryKeys,
  startOfWeekInZone,
  toStudyTask,
} from '#/lib/planner'
import type {
  PlannerView,
  StudyTask,
  StudyTaskInput,
  StudyTaskPriority,
  StudyTaskStatus,
  StudyWorkstream,
} from '#/lib/planner'
import { fetchCalendarResources } from '#/lib/calendar'

export const Route = createFileRoute('/planner')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: PlannerRoute,
})

const dataClient = createDataClient()
const VIEW_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function PlannerRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [view, setView] = useState<PlannerView>('timeline')
  const [cursor, setCursor] = useState(() => new Date())
  const [filters, setFilters] = useState<PlannerFilterValue>(
    EMPTY_PLANNER_FILTERS,
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<StudyTask | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const weekStart = useMemo(
    () => startOfWeekInZone(cursor, VIEW_TIMEZONE),
    [cursor],
  )
  const weekCount = 7

  const workstreamsQuery = useQuery({
    queryKey: plannerQueryKeys.workstreams(workspaceId),
    queryFn: () => fetchStudyWorkstreams(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const tasksQuery = useQuery({
    queryKey: plannerQueryKeys.tasks(workspaceId),
    queryFn: () => fetchStudyTasks(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const resourcesQuery = useQuery({
    queryKey: ['ops-005', 'calendar-resources', workspaceId],
    queryFn: () => fetchCalendarResources(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const dependenciesQuery = useQuery({
    queryKey: plannerQueryKeys.dependencies(workspaceId),
    queryFn: () => fetchStudyDependencies(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  // All task resources across workspace (for conflict detection).
  const allTaskResourcesQuery = useQuery({
    queryKey: ['ops-005', 'all-task-resources', workspaceId],
    queryFn: () => fetchCalendarResourcesAsPlanner(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  // ── TEMPORARY: mock workstreams for screenshots (revert before merge) ──
  const mockWorkstreams: StudyWorkstream[] =
    workstreamsQuery.data && workstreamsQuery.data.length > 0
      ? workstreamsQuery.data
      : [
          {
            id: 'ws-mock-1',
            workspaceId,
            projectId: null,
            name: 'Upstream Process Development',
            color: '#3b82f6',
            position: 0,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'ws-mock-2',
            workspaceId,
            projectId: null,
            name: 'Analytical Development',
            color: '#8b5cf6',
            position: 1,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]
  // ── END TEMPORARY ──

  // Hydrate tasks with assignments, resources and deliverables.
  const tasks = useMemo<StudyTask[]>(() => {
    const wires = tasksQuery.data ?? []
    const real = wires.map((w) => toStudyTask(w, [], [], []))
    if (real.length > 0) return real
    // ── TEMPORARY: mock data for screenshots (revert before merge) ──
    const now = new Date()
    const iso = (d: Date) => d.toISOString()
    const day = (offset: number) => {
      const d = new Date(now)
      d.setDate(d.getDate() + offset)
      return d
    }
    const ws1 = 'ws-mock-1'
    const ws2 = 'ws-mock-2'
    const mkTask = (
      id: string,
      title: string,
      workstreamId: string,
      status: StudyTaskStatus,
      priority: StudyTaskPriority,
      taskType: 'task' | 'milestone',
      startOffset: number,
      endOffset: number,
      progress: number,
      assignees: Array<{ id: string; name: string }>,
    ): StudyTask => ({
      id,
      workspaceId,
      workstreamId,
      projectId: null,
      title,
      description: null,
      taskType,
      status,
      priority,
      startsAt: taskType === 'milestone' ? iso(day(endOffset)) : iso(day(startOffset)),
      endsAt: iso(day(endOffset)),
      dueAt: iso(day(endOffset)),
      timezone: VIEW_TIMEZONE,
      position: 0,
      color: null,
      progressPercent: progress,
      linkedExperimentRecordId: null,
      linkedExperimentIdentifier: null,
      linkedExperimentTitle: null,
      linkedProtocolRecordId: null,
      linkedProtocolIdentifier: null,
      approvalRequired: status === 'review',
      approvalStatus: status === 'review' ? 'pending' : 'not_required',
      tags: [],
      metadataVersion: 1,
      createdAt: iso(day(startOffset)),
      updatedAt: iso(day(0)),
      assignments: assignees.map((a) => ({
        id: `${id}-asg-${a.id}`,
        taskId: id,
        userId: a.id,
        displayName: a.name,
        role: 'assignee' as const,
        effortPercent: 50,
        createdAt: iso(day(startOffset)),
      })),
      resources: [],
      deliverables: [],
    })
    return [
      mkTask('t1', 'Cell line expansion — CHO-K1', ws1, 'in_progress', 'high', 'task', -2, 10, 45, [
        { id: 'u1', name: 'Dr. Sarah Chen' },
      ]),
      mkTask('t2', 'Stability study design', ws1, 'completed', 'medium', 'task', -7, -1, 100, [
        { id: 'u2', name: 'Marcus Webb' },
      ]),
      mkTask('t3', 'Phase 1 readout', ws1, 'review', 'critical', 'milestone', 14, 14, 100, [
        { id: 'u1', name: 'Dr. Sarah Chen' },
        { id: 'u2', name: 'Marcus Webb' },
      ]),
      mkTask('t4', 'Analytical method transfer', ws2, 'not_started', 'medium', 'task', 5, 20, 0, [
        { id: 'u3', name: 'Priya Sharma' },
      ]),
      mkTask('t5', 'Buffer screening DoE', ws2, 'blocked', 'high', 'task', 3, 12, 20, [
        { id: 'u3', name: 'Priya Sharma' },
        { id: 'u1', name: 'Dr. Sarah Chen' },
      ]),
      mkTask('t6', 'Raw material qualification', ws2, 'in_progress', 'low', 'task', -1, 8, 60, [
        { id: 'u2', name: 'Marcus Webb' },
      ]),
    ]
    // ── END TEMPORARY ──
  }, [tasksQuery.data])

  // Apply filters.
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filters.status && t.status !== filters.status) return false
      if (filters.priority && t.priority !== filters.priority) return false
      if (filters.workstreamId && t.workstreamId !== filters.workstreamId)
        return false
      if (filters.assignee) {
        if (!t.assignments.some((a) => (a.userId ?? '') === filters.assignee))
          return false
      }
      return true
    })
  }, [tasks, filters])

  const selectedTask = useMemo(
    () => filteredTasks.find((t) => t.id === selectedTaskId) ?? null,
    [filteredTasks, selectedTaskId],
  )

  // Fetch full detail for the selected task.
  const assignmentsQuery = useQuery({
    queryKey: plannerQueryKeys.assignments(selectedTaskId ?? 'none'),
    queryFn: () => fetchStudyTaskAssignments(dataClient, selectedTaskId!),
    enabled: Boolean(selectedTaskId),
  })
  const taskResourcesQuery = useQuery({
    queryKey: plannerQueryKeys.resources(selectedTaskId ?? 'none'),
    queryFn: () => fetchStudyTaskResources(dataClient, selectedTaskId!),
    enabled: Boolean(selectedTaskId),
  })
  const deliverablesQuery = useQuery({
    queryKey: plannerQueryKeys.deliverables(selectedTaskId ?? 'none'),
    queryFn: () => fetchStudyDeliverables(dataClient, selectedTaskId!),
    enabled: Boolean(selectedTaskId),
  })

  const selectedTaskFull = useMemo<StudyTask | null>(() => {
    if (!selectedTask) return null
    return {
      ...selectedTask,
      assignments: assignmentsQuery.data ?? [],
      resources: taskResourcesQuery.data ?? [],
      deliverables: deliverablesQuery.data ?? [],
    }
  }, [
    selectedTask,
    assignmentsQuery.data,
    taskResourcesQuery.data,
    deliverablesQuery.data,
  ])

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tasks) {
      for (const a of t.assignments) {
        const key = a.userId ?? a.displayName ?? ''
        if (key) seen.set(key, a.displayName ?? a.userId ?? key)
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [tasks])

  function invalidateAll() {
    void queryClient.invalidateQueries({
      queryKey: ['ops-005', 'tasks', workspaceId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-005', 'all-task-resources', workspaceId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-005', 'assignments', selectedTaskId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-005', 'resources', selectedTaskId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-005', 'deliverables', selectedTaskId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-005', 'dependencies', workspaceId],
    })
  }

  const createMutation = useMutation({
    mutationFn: (input: StudyTaskInput) =>
      createStudyTask(dataClient, workspaceId, input),
    onSuccess: async () => {
      setDialogOpen(false)
      setDialogError(null)
      invalidateAll()
    },
    onError: (cause) => setDialogError(describePlannerError(cause)),
  })
  const editMutation = useMutation({
    mutationFn: (input: {
      taskId: string
      patch: StudyTaskInput
      expectedMetadataVersion: number
    }) =>
      editStudyTask(dataClient, {
        taskId: input.taskId,
        title: input.patch.title,
        description: input.patch.description,
        taskType: input.patch.taskType,
        status: input.patch.status,
        priority: input.patch.priority,
        startsAt: input.patch.startsAt,
        endsAt: input.patch.endsAt,
        dueAt: input.patch.dueAt,
        workstreamId: input.patch.workstreamId,
        progressPercent: input.patch.progressPercent,
        approvalRequired: input.patch.approvalRequired,
        tags: input.patch.tags,
        expectedMetadataVersion: input.expectedMetadataVersion,
      }),
    onSuccess: async () => {
      setDialogOpen(false)
      setDialogError(null)
      invalidateAll()
    },
    onError: (cause) => setDialogError(describePlannerError(cause)),
  })
  const deleteMutation = useMutation({
    mutationFn: (task: StudyTask) => deleteStudyTask(dataClient, task.id),
    onSuccess: async () => {
      setActionError(null)
      setSelectedTaskId(null)
      invalidateAll()
    },
    onError: (cause) => setActionError(describePlannerError(cause)),
  })

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  function stepView(direction: -1 | 1) {
    setCursor((c) => addDays(c, 7 * direction * (weekCount / 7)))
  }

  function openCreate() {
    setEditingTask(null)
    setDialogError(null)
    setDialogOpen(true)
  }
  function openEdit(task: StudyTask) {
    setEditingTask(task)
    setDialogError(null)
    setDialogOpen(true)
  }

  const viewTabs: Array<{ key: PlannerView; label: string }> = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'list', label: 'List' },
    { key: 'workload', label: 'Workload' },
    { key: 'resource', label: 'Resource view' },
  ]

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Study Planner' }],
    fullBleed: true,
    inspectorLabel: 'Task',
    inspector: (
      <PlannerInspector
        task={selectedTaskFull}
        resources={resourcesQuery.data ?? []}
        taskResources={taskResourcesQuery.data ?? []}
        allTaskResources={allTaskResourcesQuery.data ?? []}
        timeZone={VIEW_TIMEZONE}
        onEdit={openEdit}
        onDelete={(t) => deleteMutation.mutate(t)}
      />
    ),
  })

  return (
    <>
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="px-4 pt-4">
          <PageHeader
            eyebrow={context.workspace?.name ?? undefined}
            title="Study Planner"
            description="Tasks, milestones, and dependencies across the workspace."
            className="border-0 pb-4"
          >
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" /> Add task
            </Button>
          </PageHeader>
          <div className="space-y-1.5 border-b border-border/60 pb-2.5">
            {/* Tabs + date navigation on the same row */}
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                value={view}
                onValueChange={(v) => setView(v as PlannerView)}
              >
                <TabsList className="h-auto gap-0 bg-transparent p-0">
                  {viewTabs.map((v) => (
                    <TabsTrigger
                      key={v.key}
                      value={v.key}
                      className="rounded-none border-b-2 border-b-transparent px-3 pb-1.5 pt-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    >
                      {v.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="ml-auto flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => stepView(-1)}
                  aria-label="Previous"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCursor(new Date())}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => stepView(1)}
                  aria-label="Next"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            <PlannerFilters
              value={filters}
              onChange={setFilters}
              workstreams={mockWorkstreams}
              resources={resourcesQuery.data ?? []}
              assignees={assigneeOptions}
            />
            {actionError ? (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
          </div>
        </div>

        {/* Body */}
        {tasksQuery.isLoading || workstreamsQuery.isLoading ? (
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : tasksQuery.error || workstreamsQuery.error ? (
          <Alert variant="destructive" className="m-6 max-w-md">
            <AlertCircle className="size-4" />
            <AlertTitle>Couldn't load planner</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>{describePlannerError(tasksQuery.error ?? workstreamsQuery.error)}</span>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => {
                  if (tasksQuery.error) void tasksQuery.refetch()
                  if (workstreamsQuery.error) void workstreamsQuery.refetch()
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : filteredTasks.length === 0 ? (
          <Empty className="flex-1 border-0 rounded-none">
            <EmptyIcon>
              <ClipboardList className="size-5" />
            </EmptyIcon>
            <EmptyTitle>No tasks yet</EmptyTitle>
            <EmptyDescription>
              Create your first study task to start planning milestones,
              dependencies, and resource assignments.
            </EmptyDescription>
            <EmptyActions>
              <Button onClick={openCreate} size="sm">
                <Plus className="size-4" /> Add task
              </Button>
            </EmptyActions>
          </Empty>
        ) : view === 'timeline' ? (
          <PlannerTimeline
            tasks={filteredTasks}
            workstreams={mockWorkstreams}
            dependencies={dependenciesQuery.data ?? []}
            resources={resourcesQuery.data ?? []}
            timeZone={VIEW_TIMEZONE}
            weekStart={weekStart}
            weekCount={weekCount}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        ) : view === 'list' ? (
          <PlannerList
            tasks={filteredTasks}
            workstreams={mockWorkstreams}
            dependencies={dependenciesQuery.data ?? []}
            timeZone={VIEW_TIMEZONE}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        ) : view === 'workload' ? (
          <PlannerWorkload
            tasks={filteredTasks}
            timeZone={VIEW_TIMEZONE}
            weekStart={weekStart}
            weekCount={weekCount}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        ) : view === 'resource' ? (
          <PlannerResourceView
            resources={resourcesQuery.data ?? []}
            taskResources={allTaskResourcesQuery.data ?? []}
            tasks={filteredTasks}
            timeZone={VIEW_TIMEZONE}
            weekStart={weekStart}
            weekCount={weekCount}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
            Calendar view — use the Lab Calendar for resource scheduling. The
            Study Planner timeline provides the Gantt overview.
          </div>
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o)
          if (!o) setEditingTask(null)
        }}
        workstreams={mockWorkstreams}
        workspaceId={workspaceId}
        task={editingTask}
        onSubmit={async (input) => {
          if (editingTask) {
            await editMutation.mutateAsync({
              taskId: editingTask.id,
              patch: input,
              expectedMetadataVersion: editingTask.metadataVersion,
            })
          } else {
            await createMutation.mutateAsync(input)
          }
        }}
        error={dialogError}
      />
    </>
  )
}
