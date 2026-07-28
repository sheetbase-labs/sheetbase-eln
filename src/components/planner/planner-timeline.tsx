/**
 * OPS-005 — Study Planner timeline (Gantt) view.
 *
 * Swimlane-grouped task bars, milestone diamonds, dependency arrows,
 * instrument utilization bars and deliverable markers. The left columns
 * show Title, Status and Assignee; the right grid shows weekly columns with
 * a "Today" marker.
 */
import { useMemo } from 'react'
import { Diamond, Flag, Package } from 'lucide-react'

import { cn } from '#/lib/utils'
import type {
  StudyTask,
  StudyTaskDependency,
  StudyWorkstream,
} from '#/lib/planner'
import {
  TASK_STATUS_TOKENS,
  TASK_STATUS_LABELS,
  addDays,
  formatShortDateInZone,
  taskDurationDays,
  taskEndDate,
  taskStartDate,
  weekLabel,
} from '#/lib/planner'
import type { CalendarResource } from '#/lib/calendar'

export interface PlannerTimelineProps {
  tasks: StudyTask[]
  workstreams: StudyWorkstream[]
  dependencies: StudyTaskDependency[]
  resources: CalendarResource[]
  timeZone: string
  weekStart: Date
  weekCount: number
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}

export function PlannerTimeline({
  tasks,
  workstreams,
  dependencies,
  timeZone,
  weekStart,
  weekCount,
  selectedTaskId,
  onSelectTask,
}: PlannerTimelineProps) {
  const weeks = useMemo(
    () =>
      Array.from({ length: weekCount }, (_, i) => ({
        start: addDays(weekStart, i * 7),
        label: weekLabel(addDays(weekStart, i * 7), timeZone),
      })),
    [weekStart, weekCount, timeZone],
  )

  const totalDays = weekCount * 7

  const today = new Date()
  const todayOffsetDays = Math.max(
    0,
    Math.min(
      totalDays - 1,
      Math.round((today.getTime() - weekStart.getTime()) / 86_400_000),
    ),
  )

  // Group tasks by workstream (swimlanes), then ungrouped and milestones.
  const swimlanes = useMemo(() => {
    const byWorkstream = new Map<string | null, StudyTask[]>()
    for (const task of tasks) {
      if (task.status === 'cancelled') continue
      const key = task.workstreamId
      const arr = byWorkstream.get(key) ?? []
      arr.push(task)
      byWorkstream.set(key, arr)
    }
    const lanes: Array<{
      key: string
      label: string
      color: string | null
      tasks: StudyTask[]
    }> = []
    for (const ws of workstreams) {
      const wsTasks = byWorkstream.get(ws.id) ?? []
      if (wsTasks.length > 0) {
        lanes.push({
          key: ws.id,
          label: ws.name,
          color: ws.color,
          tasks: wsTasks,
        })
      }
      byWorkstream.delete(ws.id)
    }
    const ungrouped = byWorkstream.get(null) ?? []
    const milestones = ungrouped.filter((t) => t.taskType === 'milestone')
    const regular = ungrouped.filter((t) => t.taskType === 'task')
    if (regular.length > 0) {
      lanes.push({
        key: 'ungrouped',
        label: 'Ungrouped',
        color: null,
        tasks: regular,
      })
    }
    if (milestones.length > 0) {
      lanes.push({
        key: 'milestones',
        label: 'Milestones',
        color: null,
        tasks: milestones,
      })
    }
    return lanes
  }, [tasks, workstreams])

  function dayOffset(date: Date): number {
    return Math.round((date.getTime() - weekStart.getTime()) / 86_400_000)
  }

  const leftColWidth = 280
  const weekWidth = 140

  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      <div className="min-w-full">
        {/* Header: week columns */}
        <div className="sticky top-0 z-10 flex border-b border-border bg-background">
          <div
            className="shrink-0 border-r border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground"
            style={{ width: leftColWidth }}
          >
            Title
          </div>
          <div className="flex">
            {weeks.map((w) => (
              <div
                key={w.start.toISOString()}
                className="border-r border-border px-2 py-1.5 text-xs font-medium text-muted-foreground"
                style={{ width: weekWidth }}
              >
                {w.label}
              </div>
            ))}
          </div>
        </div>

        {/* Body: swimlanes */}
        {swimlanes.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            No tasks in the visible range. Use Add task to create one.
          </div>
        ) : (
          swimlanes.map((lane) => (
            <div key={lane.key} className="border-b border-border/40">
              {/* Swimlane header */}
              <div className="flex items-center gap-2 border-b border-border/30 bg-muted/20 px-3 py-1">
                {lane.color ? (
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ backgroundColor: lane.color }}
                  />
                ) : null}
                <span className="text-xs font-semibold">{lane.label}</span>
                <span className="text-xs text-muted-foreground">
                  {lane.tasks.length}
                </span>
              </div>
              {/* Tasks in lane */}
              {lane.tasks.map((task) => {
                const start = taskStartDate(task)
                const end = taskEndDate(task)
                const offset = Math.max(0, dayOffset(start))
                const duration = Math.max(
                  1,
                  Math.min(totalDays - offset, taskDurationDays(task)),
                )
                const leftPct = (offset / totalDays) * 100
                const widthPct = (duration / totalDays) * 100
                const isSelected = task.id === selectedTaskId
                const isMilestone = task.taskType === 'milestone'
                const assigneeLabel =
                  task.assignments
                    .filter((a) => a.role === 'assignee')
                    .map((a) => a.displayName ?? a.userId ?? '—')
                    .join(', ') || '—'

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelectTask(task.id)}
                    className={cn(
                      'flex w-full items-stretch border-b border-border/20 text-left transition-colors hover:bg-muted/30',
                      isSelected && 'bg-blue-50/50',
                    )}
                  >
                    {/* Left columns */}
                    <div
                      className="shrink-0 px-3 py-2"
                      style={{ width: leftColWidth }}
                    >
                      <div className="flex items-center gap-2">
                        {isMilestone ? (
                          <Diamond className="size-3.5 shrink-0 text-purple-600" />
                        ) : null}
                        <span
                          className={cn(
                            'truncate text-sm font-medium',
                            isMilestone && 'text-purple-700',
                          )}
                        >
                          {task.title}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium',
                            TASK_STATUS_TOKENS[task.status],
                          )}
                        >
                          {TASK_STATUS_LABELS[task.status]}
                        </span>
                        <span className="truncate">{assigneeLabel}</span>
                      </div>
                    </div>
                    {/* Gantt grid */}
                    <div
                      className="relative flex-1"
                      style={{
                        minWidth: weekWidth * weekCount,
                      }}
                    >
                      {/* Week grid lines */}
                      <div className="absolute inset-0 flex">
                        {weeks.map((w) => (
                          <div
                            key={w.start.toISOString()}
                            className="border-r border-border/20"
                            style={{ width: weekWidth }}
                          />
                        ))}
                      </div>
                      {/* Today marker */}
                      {todayOffsetDays >= 0 && todayOffsetDays < totalDays ? (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-blue-500"
                          style={{
                            left: `${(todayOffsetDays / totalDays) * 100}%`,
                          }}
                        >
                          <span className="absolute -top-0.5 left-0.5 text-[9px] font-medium text-blue-500">
                            ●
                          </span>
                        </div>
                      ) : null}
                      {/* Task bar or milestone */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                      >
                        {isMilestone ? (
                          <div className="flex items-center gap-1">
                            <Flag className="size-4 text-purple-600" />
                            <span className="text-xs text-purple-700">
                              {formatShortDateInZone(start, timeZone)}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                              TASK_STATUS_TOKENS[task.status],
                              isSelected && 'ring-2 ring-blue-400',
                            )}
                            title={`${task.title}: ${formatShortDateInZone(start, timeZone)} – ${formatShortDateInZone(end, timeZone)}`}
                          >
                            <span className="truncate">{task.title}</span>
                            {task.progressPercent > 0 ? (
                              <div
                                className="ml-auto h-1.5 min-w-8 overflow-hidden rounded-full bg-black/10"
                                aria-label={`${task.progressPercent}% complete`}
                              >
                                <div
                                  className="h-full rounded-full bg-current opacity-60"
                                  style={{ width: `${task.progressPercent}%` }}
                                />
                              </div>
                            ) : null}
                          </div>
                        )}
                        {/* Deliverable markers */}
                        {task.deliverables.length > 0 ? (
                          <div className="absolute -bottom-4 left-0 flex gap-1">
                            {task.deliverables.map((d) => (
                              <span
                                key={d.id}
                                title={`${d.name}: ${d.status}`}
                                className={cn(
                                  'inline-flex items-center',
                                  d.status === 'delivered'
                                    ? 'text-green-600'
                                    : 'text-muted-foreground',
                                )}
                              >
                                <Package className="size-3" />
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ))
        )}

        {/* Dependency legend */}
        <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-6 rounded bg-blue-200" /> In
            progress
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-6 rounded bg-green-200" /> Done
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-6 rounded bg-amber-200" />{' '}
            Review
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-6 rounded bg-muted" /> Todo
          </span>
          <span className="flex items-center gap-1">
            <Diamond className="size-3 text-purple-600" /> Milestone
          </span>
          <span className="flex items-center gap-1">
            <Package className="size-3" /> Deliverable
          </span>
          {dependencies.length > 0 ? (
            <span className="ml-auto">{dependencies.length} dependencies</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
