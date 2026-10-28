import { useMemo, useState } from 'react'
import { formatDate } from '#/lib/format-date'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
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
import { Select } from '#/components/v3/ui/select'
import { Muted } from '#/components/v3/ui/layout'
import {
  RegistryGrid,
  bandRow,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/v3/inventory/registry-grid'
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
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { DataClientError } from '#/lib/data-client'
import {
  fetchRecordsForProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { statusLabel } from '../$projectId'
import { fetchProjectPermissions } from '#/lib/workspace-access'
import {
  createPlanFromProject,
  createStudyDeliverable,
  createStudyTask,
  describePlannerError,
  editStudyTask,
  fetchMilestoneRisks,
  fetchStudyDeliverables,
  fetchStudyTaskAssignments,
  fetchStudyDependencies,
  fetchStudyTaskDueChanges,
  fetchStudyTasks,
  fetchStudyWorkstreams,
  linkStudyDeliverableEvidence,
  moveStudyTaskDue,
  setStudyDeliverableStatus,
  setStudyTaskClientVisible,
  toStudyTask,
} from '#/lib/planner'
import type { MilestoneRisk, StudyTask } from '#/lib/planner'
import { cn } from '#/lib/utils'
import { now as appNow } from '#/lib/clock'

/**
 * UI port (roadmap-4/ui-app3): the project Milestones tab (PROJ-02), extended
 * by R5-CONFIG-05. Milestones are study_tasks of type 'milestone'; the "done
 * when" criteria are their study_deliverables, so done comes from delivered
 * evidence. Client visibility, date history (migration 0263), risk
 * (`api.milestone_risks`) and plan copying (`create_plan_from_project`) are
 * read from the canonical boundary. A stale write is a real 409/SB001
 * conflict, never a query parameter: `?state=denied` is a development-only
 * affordance for the acceptance suite and does nothing in a production build.
 */
export const Route = createFileRoute('/projects/$projectId/milestones')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { m?: string; scale?: MilestoneScale; state?: 'denied' } => ({
    m: typeof search.m === 'string' ? search.m : undefined,
    scale:
      search.scale === 'week' || search.scale === 'month'
        ? search.scale
        : undefined,
    // QA-049: the parameter only ever asks for the denied view, so a URL can
    // never claim the plan is editable again. Production ignores it outright —
    // what the plan allows is the project's permission answer, never a query
    // string (`state=empty` was dead and is gone).
    state:
      import.meta.env.PROD || search.state !== 'denied' ? undefined : 'denied',
  }),
  component: Milestones,
})

/** The at-risk rule, stated once here and once in the plan header copy. */
const AT_RISK_RULE =
  'At risk means due within 14 days while a condition is still open or a milestone it depends on is not done. Late means the due date has passed.'

function milestoneStatus(task: StudyTask): { tone: Tone; label: string } {
  if (task.status === 'completed') return { tone: 'ok', label: 'Done' }
  // QA-053: `AT_RISK_RULE` defines Late by the due date alone, and the risk
  // read (`api.milestone_risks`) reports `late` on that same rule. A done
  // milestone is never late; every other overdue milestone is, whatever its
  // workflow status, so the status column and the risk notice agree.
  const due = task.dueAt ? Date.parse(task.dueAt) : null
  if (due && due < appNow().getTime()) return { tone: 'bad', label: 'Late' }
  if (task.status === 'blocked') return { tone: 'bad', label: 'Blocked' }
  if (task.status === 'review') return { tone: 'review', label: 'In review' }
  if (task.status === 'in_progress')
    return { tone: 'progress', label: 'In progress' }
  return { tone: 'none', label: 'Not started' }
}

function daysUntil(dueAt: string, now = appNow().getTime()): number {
  const due = new Date(dueAt)
  due.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

/** "21 Aug": the day as the plan's own time zone sees it. */
function formatDay(iso: string, timezone = 'UTC'): string {
  try {
    return new Date(iso)
      .toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: timezone,
      })
      .replace('Sept', 'Sep')
  } catch {
    return iso.slice(0, 10)
  }
}

function relativeDay(dueAt: string, now = appNow().getTime()): string {
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
  // QA-048: milestone writes are writes to the project's plan, so the gate is
  // the project's own edit permission — `api.project_permissions` answers with
  // `internal.can_edit_project`, the same predicate the milestone RPCs assert
  // (`assert_object_access('project', …, 'edit')`). The workspace's
  // governed-schema capability is the wrong question: a project editor who is
  // not an owner/admin/steward could not edit, and a governed-schema role who
  // is not on the project was allowed to try. Until the answer arrives editing
  // stays unavailable rather than optimistically allowed; the notice below
  // says why.
  const permissions = useQuery({
    queryKey: ['project-permissions', workspaceId, projectId],
    queryFn: () => fetchProjectPermissions(notebookDataClient, projectId),
    enabled: Boolean(projectId),
  })
  const canEdit = permissions.data?.can_edit === true
  const denied = state === 'denied' || !canEdit
  const scale: MilestoneScale = scaleParam ?? 'month'
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [hideOpen, setHideOpen] = useState(false)
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
  // Evidence is picked from this project's own records, not typed by identifier.
  const projectRecords = useQuery({
    queryKey: notebookQueryKeys.records(projectId),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId),
    enabled: Boolean(projectId),
  })
  const evidenceChoices = (projectRecords.data ?? []).filter(
    (r) => !r.archivedAt,
  )
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
  const assignments = useQueries({
    queries: milestones.map((task) => ({
      queryKey: ['ui-port', 'milestones', 'assignments', task.id],
      queryFn: () => fetchStudyTaskAssignments(notebookDataClient, task.id),
      staleTime: 15_000,
    })),
  })
  const ownerOf = (taskId: string) => {
    const index = milestones.findIndex((t) => t.id === taskId)
    const owner = assignments[index]?.data?.find((a) => a.role === 'assignee')
    return owner?.displayName ?? null
  }
  const deliverablesFor = (taskId: string) => {
    const index = milestones.findIndex((t) => t.id === taskId)
    return deliverables[index]?.data ?? []
  }

  const selected: StudyTask | undefined =
    milestones.find((t) => t.id === m) ?? clientDates.at(0) ?? milestones.at(0)
  const selectedRisk = selected ? riskByTask.get(selected.id) : undefined

  // One grid row per task, with a band before each group — the grouped table the
  // bespoke body drew with a spanning strip cell.
  const gridRows: RegistryRow<StudyTask>[] = bands.flatMap((band) => [
    // The band keeps the bespoke strip's own label: name, then its count.
    bandRow(`${band.name} · ${band.milestones.length}`),
    ...band.milestones.flatMap((planMilestone) => {
      const task = milestones.find((t) => t.id === planMilestone.id)
      return task ? [task] : []
    }),
  ])
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selected?.id ?? null,
    (id) =>
      void navigate({
        to: '/projects/$projectId/milestones',
        params: { projectId },
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          m: id ?? undefined,
        }),
        replace: true,
      }),
  )
  const milestoneColumns: RegistryColumn<StudyTask>[] = [
    {
      id: 'milestone',
      header: () => <span className="-ml-3">Milestone</span>,
      // The bespoke table inset this column to 12px. The grid positions a
      // grouped band's label from the cell's own inset, so the cell keeps the
      // 24px inset the grid gives it and the *content* carries the 12px, which
      // leaves the band label inside the card and the column widths unchanged.
      cell: ({ row }) => (
        <span className="-ml-3 font-medium">{row.original.title}</span>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      cell: ({ row }) => {
        const risk = riskByTask.get(row.original.id)
        return (
          <span
            className={cn(
              'text-fg-muted',
              risk?.risk === 'late' && 'text-danger-text',
            )}
          >
            {row.original.dueAt
              ? formatDay(row.original.dueAt, row.original.timezone)
              : '—'}
            {risk?.late && row.original.dueAt
              ? ` · ${relativeDay(row.original.dueAt)}`
              : ''}
          </span>
        )
      },
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: ({ row }) => (
        <span className="text-fg-muted">{ownerOf(row.original.id) ?? '—'}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = milestoneStatus(row.original)
        return <Status tone={status.tone}>{status.label}</Status>
      },
    },
    {
      id: 'doneWhen',
      header: 'Done when',
      cell: ({ row }) => {
        const items = deliverablesFor(row.original.id)
        const met = items.filter((d) => d.status === 'delivered').length
        return (
          <span className="text-fg-muted">
            {items.length ? `${met} of ${items.length} met` : 'No conditions'}
          </span>
        )
      },
    },
    {
      id: 'evidence',
      header: 'Evidence',
      cell: ({ row }) => {
        const ids = [
          ...new Set(
            deliverablesFor(row.original.id).flatMap((d) =>
              d.linkedRecordIdentifier ? [d.linkedRecordIdentifier] : [],
            ),
          ),
        ]
        return ids.length ? (
          <span className="font-mono text-label text-link">
            {ids.join(', ')}
          </span>
        ) : (
          <span className="text-fg-muted">None yet</span>
        )
      },
    },
    {
      id: 'visibility',
      header: clientLabel,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.clientVisible
            ? `Visible since ${row.original.sharedSince ? formatDay(row.original.sharedSince, row.original.timezone) : '—'}`
            : 'Internal'}
        </span>
      ),
      meta: { headerClassName: 'pr-3!', cellClassName: 'pr-3! text-fg-muted' },
    },
  ]

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
      setHideOpen(false)
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
  const addCondition = useMutation({
    mutationFn: (input: { taskId: string; name: string }) =>
      createStudyDeliverable(notebookDataClient, input),
    onSuccess: () => {
      void invalidate()
      toast('Condition added')
    },
    onError: (error) => reportWriteError(error, 'add the condition'),
  })
  const setConditionStatus = useMutation({
    mutationFn: (input: { id: string; status: 'delivered' | 'planned' }) =>
      setStudyDeliverableStatus(notebookDataClient, input),
    onSuccess: () => void invalidate(),
    onError: (error) => reportWriteError(error, 'update the condition'),
  })
  const linkCondition = useMutation({
    mutationFn: (input: { id: string; recordIdentifier: string }) =>
      linkStudyDeliverableEvidence(notebookDataClient, input),
    onSuccess: () => {
      void invalidate()
      toast('Record linked')
    },
    onError: (error) => reportWriteError(error, 'link the record'),
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

  // Shown in both the empty and the populated plan, so a disabled add or
  // template button always has its reason beside it.
  const deniedNotice = permissions.isLoading ? (
    <Muted className="mb-3 block">
      Checking whether you can edit this plan…
    </Muted>
  ) : denied ? (
    <Notice tone="info" className="mb-3" icon="lock">
      You can view this plan but not change it. Only project editors can add
      milestones, move dates or mark them done.
      {project?.leadName
        ? ` ${project.leadName} leads this project: ask them to add you as an editor.`
        : ' Ask the project lead to add you as an editor.'}
    </Notice>
  ) : null

  if (tasks.isError) {
    return (
      <div className="px-4 py-5 md:px-6">
        <ProjectListFailure
          error={tasks.error}
          what="this plan"
          onRetry={() => void tasks.refetch()}
        />
      </div>
    )
  }

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
          {deniedNotice}
          <EmptyState
            icon="calendar"
            title="No milestones yet"
            description="Milestones are what this project has promised. Each names the records that prove it’s done, so progress comes from delivered evidence."
            action={
              <Button
                variant="primary"
                disabled={denied}
                onClick={() => setAddOpen(true)}
              >
                Add a milestone
              </Button>
            }
          />
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
      <div className="flex min-w-0 flex-1 flex-col overflow-auto xl:flex-row xl:overflow-hidden">
        <div className="min-w-0 flex-1 px-4 py-4 md:px-6 xl:overflow-auto">
          {deniedNotice}
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
              ? `Next date ${clientLabel} sees: ${nextClientDate.title}, ${formatDay(nextClientDate.dueAt!, nextClientDate.timezone)} (${relativeDay(nextClientDate.dueAt!)})`
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
            <RegistryGrid
              label="Milestones"
              rows={gridRows}
              columns={milestoneColumns}
              getRowId={(task) => task.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              selectable={false}
            />
          </div>
          <Muted className="mt-3">
            A milestone only counts as done once its linked records are
            delivered.
          </Muted>
        </div>

        <aside
          aria-label={`${selected.title} details`}
          className="flex w-full shrink-0 flex-col gap-4 border-t border-border bg-surface p-4 xl:w-[340px] xl:overflow-auto xl:border-l xl:border-t-0"
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
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {deliverablesFor(selected.id).map((d) => (
                  <ConditionItem
                    key={d.id}
                    condition={d}
                    choices={evidenceChoices}
                    denied={denied}
                    busy={
                      setConditionStatus.isPending || linkCondition.isPending
                    }
                    onToggle={() =>
                      setConditionStatus.mutate({
                        id: d.id,
                        status:
                          d.status === 'delivered' ? 'planned' : 'delivered',
                      })
                    }
                    onLink={(recordIdentifier) =>
                      linkCondition.mutate({ id: d.id, recordIdentifier })
                    }
                  />
                ))}
              </ul>
            ) : (
              <Muted>
                No conditions recorded for this milestone.{' '}
                {denied
                  ? 'Mark done is unavailable until a project editor adds one.'
                  : 'Add a condition to enable Mark done.'}
              </Muted>
            )}
            {denied ? null : (
              <AddConditionForm
                busy={addCondition.isPending}
                onAdd={(name) =>
                  addCondition.mutate({ taskId: selected.id, name })
                }
              />
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
                onChange={(e) => {
                  // QA-047: hiding needs a reason the server will accept, so it
                  // asks for one in a dialog (a cancelled `window.prompt` used
                  // to send an empty reason and hide the milestone anyway);
                  // showing needs no reason.
                  if (e.target.checked)
                    setVisibility.mutate({
                      task: selected,
                      clientVisible: true,
                      reason: '',
                    })
                  else setHideOpen(true)
                }}
              />
              <span>
                Show to {clientLabel}
                {selected.clientVisible && selected.sharedSince ? (
                  <span className="block text-label text-fg-muted">
                    Shared since{' '}
                    {formatDay(selected.sharedSince, selected.timezone)}
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
                      {c.fromDueAt
                        ? formatDay(c.fromDueAt, selected.timezone)
                        : '—'}{' '}
                      →{' '}
                      {c.toDueAt
                        ? formatDay(c.toDueAt, selected.timezone)
                        : '—'}
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
            {formatDate(selected.updatedAt)}
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
      {hideOpen ? (
        <HideFromClientDialog
          clientLabel={clientLabel}
          onClose={() => setHideOpen(false)}
          onSubmit={(reason) =>
            setVisibility.mutate({
              task: selected,
              clientVisible: false,
              reason,
            })
          }
          busy={setVisibility.isPending}
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
    appNow().toISOString().slice(0, 10),
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
  const previewColumns: RegistryColumn<
    NonNullable<typeof source>['milestones'][number]
  >[] = [
    {
      id: 'milestone',
      header: 'Milestone',
      cell: ({ row }) => row.original.title,
      meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
    },
    {
      id: 'due',
      header: 'Due',
      cell: ({ row }) => (
        <span className="text-fg-muted">{previewDue(row.original.dueAt)}</span>
      ),
    },
    {
      id: 'visibility',
      header: 'Visibility',
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.clientVisible ? 'Visible' : 'Internal'}
        </span>
      ),
      meta: {
        headerClassName: 'pr-3!',
        cellClassName: 'pr-3! text-fg-muted',
      },
    },
  ]

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Start from a template"
          description="The source plan’s milestones are copied into this project through the milestone RPCs. Completion, records and evidence are not copied."
        />
        <DialogBody>
          <Field label="Template" required>
            <Select
              aria-label="Template"
              value={sourceProjectId}
              onChange={(e) => setSourceProjectId(e.target.value)}
            >
              {candidates.map((candidate) => (
                <option key={candidate.projectId} value={candidate.projectId}>
                  {candidate.title} · {candidate.milestones.length} milestones
                </option>
              ))}
            </Select>
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
              <RegistryGrid
                label="Template preview"
                rows={source.milestones}
                columns={previewColumns}
                getRowId={(milestone) => milestone.id}
                selectable={false}
              />
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
          <Field
            label="Name"
            required
            error={
              title.length > 0 && title.trim().length < 3
                ? 'Use at least 3 characters so the plan names the milestone.'
                : undefined
            }
          >
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
              <Select
                aria-label="Phase"
                value={workstreamId}
                onChange={(e) => setWorkstreamId(e.target.value)}
              >
                <option value="">No phase</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
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

function ConditionItem({
  condition,
  choices,
  denied,
  busy,
  onToggle,
  onLink,
}: {
  condition: {
    name: string
    status: string
    linkedRecordId: string | null
    linkedRecordIdentifier: string | null
  }
  choices: { id: string; identifier: string; title: string; status: string }[]
  denied: boolean
  busy: boolean
  onToggle: () => void
  onLink: (recordIdentifier: string) => void
}) {
  const met = condition.status === 'delivered'
  const [linking, setLinking] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const linked = choices.find((r) => r.id === condition.linkedRecordId)
  const linkedStatus = linked ? `· ${statusLabel(linked.status)}` : null
  return (
    <li className="flex flex-col gap-1 text-body">
      <div className="flex items-start gap-2">
        <Status tone={met ? 'ok' : 'none'}>{met ? 'Met' : 'Open'}</Status>
        <span>{condition.name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-1 text-label text-fg-muted">
        {condition.linkedRecordId ? (
          <>
            <Link
              to="/records/$recordId"
              params={{ recordId: condition.linkedRecordId }}
              className="text-accent-text underline"
            >
              {condition.linkedRecordIdentifier ?? 'Linked record'}
            </Link>
            {linkedStatus ? <span>{linkedStatus}</span> : null}
          </>
        ) : (
          <span>No record linked</span>
        )}
        {denied ? null : (
          <>
            <Button size="sm" disabled={busy} onClick={onToggle}>
              {met ? 'Reopen' : 'Mark met'}
            </Button>
            <Button size="sm" onClick={() => setLinking((on) => !on)}>
              {condition.linkedRecordId ? 'Change record' : 'Link record'}
            </Button>
          </>
        )}
      </div>
      {linking && !denied ? (
        <div className="flex items-center gap-1.5">
          <Select
            aria-label={`Evidence record for ${condition.name}`}
            className="h-8 min-w-0 flex-1 text-xs"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          >
            <option value="">Choose a record in this project…</option>
            {choices.map((r) => (
              <option key={r.id} value={r.identifier}>
                {r.identifier} · {r.title} · {statusLabel(r.status)}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || identifier.trim().length === 0}
            onClick={() => {
              onLink(identifier.trim())
              setLinking(false)
              setIdentifier('')
            }}
          >
            Link
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function AddConditionForm({
  busy,
  onAdd,
}: {
  busy: boolean
  onAdd: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label="New condition"
        className="h-8 text-xs"
        placeholder="e.g. Release report signed"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        size="sm"
        disabled={busy || name.trim().length === 0}
        onClick={() => {
          onAdd(name.trim())
          setName('')
        }}
      >
        Add condition
      </Button>
    </div>
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

function HideFromClientDialog({
  clientLabel,
  onClose,
  onSubmit,
  busy,
}: {
  clientLabel: string
  onClose: () => void
  onSubmit: (reason: string) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('')
  const tooShort = reason.trim().length < 3
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={`Hide from ${clientLabel}`}
          description={`${clientLabel} stops seeing this milestone. The reason is recorded on the plan with the change.`}
        />
        <DialogBody>
          <Field
            label="Reason for hiding"
            required
            error={
              reason.length > 0 && tooShort
                ? 'Give at least 3 characters so the plan explains the change.'
                : undefined
            }
          >
            <Input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Not agreed with the client yet"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || tooShort}
            onClick={() => onSubmit(reason.trim())}
          >
            Hide milestone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
