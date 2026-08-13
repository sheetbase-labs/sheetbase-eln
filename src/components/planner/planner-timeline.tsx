/**
 * OPS-005 — Study Planner timeline (Gantt) view.
 *
 * Uses the reui Gantt component for swimlane-grouped task bars, milestone
 * markers, and a built-in nav bar (Today/prev/next/scale switcher).
 * Workstreams map to parent GanttResource rows; tasks map to child rows with
 * GanttEvent bars positioned by start/end dates.
 */
import { useMemo } from 'react'

import { Gantt } from '#/components/reui/gantt/gantt'
import type { GanttColumn } from '#/components/reui/gantt/gantt'
import type {
  GanttEvent,
  GanttResource,
} from '#/components/reui/gantt/gantt-types'
import {
  GanttNav,
  GanttNavNext,
  GanttNavPrev,
  GanttNavToday,
  GanttScaleSwitcher,
  GanttTitle,
  GanttToolbar,
} from '#/components/reui/gantt/gantt-nav'
import { GanttView } from '#/components/reui/gantt/gantt-view'
import type {
  StudyTask,
  StudyTaskDependency,
  StudyTaskStatus,
  StudyWorkstream,
} from '#/lib/planner'
import {
  TASK_STATUS_BADGE_VARIANT,
  TASK_STATUS_LABELS,
  taskEndDate,
  taskStartDate,
} from '#/lib/planner'
import { Badge } from '#/components/ui'

/** CSS colour per task status for Gantt bar fills. */
const STATUS_COLORS: Record<StudyTaskStatus, string> = {
  not_started: '#94a3b8',
  in_progress: '#3b82f6',
  review: '#f59e0b',
  completed: '#22c55e',
  blocked: '#ef4444',
  cancelled: '#94a3b8',
}

export interface PlannerTimelineProps {
  tasks: StudyTask[]
  workstreams: StudyWorkstream[]
  dependencies: StudyTaskDependency[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onEditTask?: (task: StudyTask) => void
  onCreateTask?: () => void
}

export function PlannerTimeline({
  tasks,
  workstreams,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
}: PlannerTimelineProps) {
  // Build the resource tree: workstream parent rows with task children.
  const resources = useMemo<GanttResource[]>(() => {
    const byWorkstream = new Map<string | null, StudyTask[]>()
    for (const task of tasks) {
      if (task.status === 'cancelled') continue
      const key = task.workstreamId
      const arr = byWorkstream.get(key) ?? []
      arr.push(task)
      byWorkstream.set(key, arr)
    }
    const tree: GanttResource[] = []
    for (const ws of workstreams) {
      const wsTasks = byWorkstream.get(ws.id) ?? []
      if (wsTasks.length === 0) continue
      tree.push({
        id: ws.id,
        title: ws.name,
        color: ws.color ?? undefined,
        children: wsTasks.map((t) => ({
          id: t.id,
          title: t.title,
        })),
      })
      byWorkstream.delete(ws.id)
    }
    // Ungrouped tasks
    const ungrouped = byWorkstream.get(null) ?? []
    if (ungrouped.length > 0) {
      tree.push({
        id: 'ungrouped',
        title: 'Ungrouped',
        children: ungrouped.map((t) => ({
          id: t.id,
          title: t.title,
        })),
      })
    }
    return tree
  }, [tasks, workstreams])

  // Build events: one GanttEvent per task, positioned by start/end.
  const events = useMemo<GanttEvent<StudyTask>[]>(() => {
    return tasks
      .filter((t) => t.status !== 'cancelled')
      .map((task) => {
        const start = taskStartDate(task)
        const end = taskEndDate(task)
        return {
          id: task.id,
          title: task.title,
          start,
          end,
          color: STATUS_COLORS[task.status],
          progress: task.progressPercent,
          resourceId: task.id,
          data: task,
        }
      })
  }, [tasks])

  // Custom columns in the tree panel: Status and Assignee.
  const columns = useMemo<GanttColumn[]>(
    () => [
      {
        id: 'status',
        title: 'Status',
        width: 110,
        render: ({ resource }) => {
          const task = tasks.find((t) => t.id === resource.id)
          if (!task) return null
          return (
            <Badge
              variant={TASK_STATUS_BADGE_VARIANT[task.status]}
              className="whitespace-nowrap px-1.5 py-0 text-xs"
            >
              {TASK_STATUS_LABELS[task.status]}
            </Badge>
          )
        },
      },
      {
        id: 'assignee',
        title: 'Assignee',
        width: 120,
        render: ({ resource }) => {
          const task = tasks.find((t) => t.id === resource.id)
          if (!task) return null
          const names = task.assignments
            .filter((a) => a.role === 'assignee')
            .map((a) => a.displayName ?? a.userId ?? '—')
            .join(', ')
          return names || '—'
        },
      },
    ],
    [tasks],
  )

  return (
    <Gantt<StudyTask>
      events={events}
      resources={resources}
      columns={columns}
      scale="week"
      nowIndicator
      selection={{
        eventKeys: selectedTaskId ? [selectedTaskId] : [],
        slot: null,
      }}
      onEventClick={(occurrence) => {
        onSelectTask(occurrence.event.id)
      }}
      onResourceClick={(ctx) => {
        if (!ctx.isGroup) {
          onSelectTask(ctx.resource.id)
        }
      }}
      onRangeChange={() => {}}
      className="flex-1 min-h-0"
      treePanel={{ width: 480 }}
      barLabel="inside"
      interactions={{ drag: false, resize: false, selectSlot: false }}
    >
      <GanttNav>
        <GanttNavToday />
        <GanttNavPrev />
        <GanttNavNext />
        <GanttTitle />
        <GanttScaleSwitcher />
      </GanttNav>
      {onCreateTask ? (
        <GanttToolbar>
          {/* Toolbar is a layout shell; Add task button is in PageHeader */}
        </GanttToolbar>
      ) : null}
      <GanttView />
    </Gantt>
  )
}
