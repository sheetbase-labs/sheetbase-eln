/**
 * OPS-005 — Study Planner workload view.
 *
 * Shows each assignee's tasks as stacked bars across the same weekly timeline,
 * making it easy to spot over-allocation. Derived entirely from the same task
 * model — no separate workload table.
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
        const row = map.get(key) ?? { key, name, tasks: [] }
        row.tasks.push(task)
        map.set(key, row)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
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
      {rows.map((row) => (
        <div
          key={row.key}
          className="border-b border-border/30 px-3 py-2"
          style={{ minHeight: 56 }}
        >
          <div className="flex">
            <div
              className="shrink-0 text-sm font-medium"
              style={{ width: leftColWidth - 24 }}
            >
              {row.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {row.tasks.length}
              </span>
            </div>
            <div
              className="relative flex-1"
              style={{ minWidth: weekWidth * weekCount }}
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
              {/* Task bars stacked vertically */}
              <div className="relative flex flex-col gap-1">
                {row.tasks.map((task) => {
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
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onSelectTask(task.id)}
                      className={cn(
                        'rounded border px-2 py-0.5 text-left text-xs font-medium transition-all hover:opacity-80',
                        TASK_STATUS_TOKENS[task.status],
                        isSelected && 'ring-2 ring-blue-400',
                      )}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: 0,
                      }}
                      title={`${task.title}: ${formatDateInZone(start, timeZone)} – ${formatDateInZone(end, timeZone)}`}
                    >
                      <span className="truncate">{task.title}</span>
                      <span className="ml-1.5 opacity-60">
                        {TASK_STATUS_LABELS[task.status]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
