/**
 * OPS-005 — Study Planner workload view.
 *
 * Shows each assignee's tasks as stacked bars across the same weekly timeline,
 * making it easy to spot over-allocation. Derived entirely from the same task
 * model — no separate workload table.
 *
 * When multiple tasks for the same assignee overlap in time, they are stacked
 * into separate lanes within that assignee's row (standard Gantt stacking).
 */
import { useMemo } from 'react'

import { cn } from '#/lib/utils'
import type { StudyTask } from '#/lib/planner'
import {
  TASK_STATUS_TOKENS,
  TASK_STATUS_LABELS,
  addDays,
  formatDateInZone,
  taskEndDate,
  taskStartDate,
  weekLabel,
} from '#/lib/planner'

export interface PlannerWorkloadProps {
  tasks: StudyTask[]
  timeZone: string
  weekStart: Date
  weekCount: number
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}

interface AssigneeRow {
  key: string
  name: string
  tasks: StudyTask[]
  /** Stacked lanes: each lane is a non-overlapping set of tasks. */
  lanes: StudyTask[][]
}

export function PlannerWorkload({
  tasks,
  timeZone,
  weekStart,
  weekCount,
  selectedTaskId,
  onSelectTask,
}: PlannerWorkloadProps) {
  const weeks = useMemo(
    () =>
      Array.from({ length: weekCount }, (_, i) => ({
        start: addDays(weekStart, i * 7),
        label: weekLabel(addDays(weekStart, i * 7), timeZone),
      })),
    [weekStart, weekCount, timeZone],
  )

  const totalDays = weekCount * 7

  const rows = useMemo<AssigneeRow[]>(() => {
    const map = new Map<string, AssigneeRow>()
    for (const task of tasks) {
      if (task.status === 'cancelled') continue
      for (const a of task.assignments) {
        if (a.role !== 'assignee') continue
        const key = a.userId ?? a.displayName ?? 'unknown'
        const name = a.displayName ?? a.userId ?? 'Unknown'
        const row = map.get(key) ?? { key, name, tasks: [], lanes: [] }
        row.tasks.push(task)
        map.set(key, row)
      }
    }

    // Stack tasks into lanes: sort by start date, place each task in the
    // first lane where it doesn't overlap with any existing task.
    for (const row of map.values()) {
      const sorted = [...row.tasks].sort(
        (a, b) =>
          taskStartDate(a).getTime() - taskStartDate(b).getTime(),
      )
      const lanes: StudyTask[][] = []
      for (const task of sorted) {
        const taskStart = taskStartDate(task).getTime()
        let placed = false
        for (const lane of lanes) {
          const lastEnd = lane.length > 0
            ? taskEndDate(lane[lane.length - 1]).getTime()
            : -Infinity
          if (taskStart >= lastEnd) {
            lane.push(task)
            placed = true
            break
          }
        }
        if (!placed) {
          lanes.push([task])
        }
      }
      row.lanes = lanes
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [tasks])

  function dayOffset(date: Date): number {
    return Math.round((date.getTime() - weekStart.getTime()) / 86_400_000)
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
        No assigned tasks in the visible range.
      </div>
    )
  }

  const leftColWidth = 200
  const weekWidth = 140
  const barHeight = 24
  const barGap = 4
  const rowVerticalPadding = 8

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 flex border-b border-border bg-background">
        <div
          className="shrink-0 border-r border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground"
          style={{ width: leftColWidth }}
        >
          Assignee
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

      {/* Rows */}
      {rows.map((row) => {
        const laneCount = Math.max(1, row.lanes.length)
        const rowContentHeight =
          laneCount * barHeight + (laneCount - 1) * barGap
        return (
          <div
            key={row.key}
            className="border-b border-border/30"
            style={{ minHeight: rowContentHeight + rowVerticalPadding * 2 }}
          >
            <div className="flex">
              {/* Left column: assignee name */}
              <div
                className="shrink-0 px-3 py-2"
                style={{ width: leftColWidth }}
              >
                <span className="truncate text-sm font-medium">
                  {row.name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.tasks.length}
                </span>
              </div>
              {/* Right: timeline grid + task bars */}
              <div
                className="relative flex-1 py-2"
                style={{
                  minWidth: weekWidth * weekCount,
                  minHeight: rowContentHeight + rowVerticalPadding,
                }}
              >
                {/* Week grid lines — extend full height */}
                <div className="absolute inset-0 flex">
                  {weeks.map((w) => (
                    <div
                      key={w.start.toISOString()}
                      className="border-r border-border/20"
                      style={{ width: weekWidth }}
                    />
                  ))}
                </div>
                {/* Task bars: each lane is a horizontal strip */}
                {row.lanes.map((lane, laneIndex) =>
                  lane.map((task) => {
                    const start = taskStartDate(task)
                    const end = taskEndDate(task)
                    const offset = Math.max(0, dayOffset(start))
                    const duration = Math.max(
                      1,
                      Math.min(
                        totalDays - offset,
                        Math.round(
                          (end.getTime() - start.getTime()) / 86_400_000,
                        ) + 1,
                      ),
                    )
                    const leftPct = (offset / totalDays) * 100
                    const widthPct = (duration / totalDays) * 100
                    const isSelected = task.id === selectedTaskId
                    const top = laneIndex * (barHeight + barGap)
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onSelectTask(task.id)}
                        className={cn(
                          'flex items-center truncate rounded border px-2 text-left text-xs font-medium transition-all hover:opacity-80',
                          TASK_STATUS_TOKENS[task.status],
                          isSelected && 'ring-2 ring-blue-400',
                        )}
                        style={{
                          position: 'absolute',
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          top,
                          height: barHeight,
                        }}
                        title={`${task.title}: ${formatDateInZone(start, timeZone)} – ${formatDateInZone(end, timeZone)}`}
                      >
                        <span className="truncate">{task.title}</span>
                        <span className="ml-1.5 shrink-0 opacity-60">
                          {TASK_STATUS_LABELS[task.status]}
                        </span>
                      </button>
                    )
                  }),
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
