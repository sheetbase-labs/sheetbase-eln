/**
 * OPS-005 — Study Planner resource view.
 *
 * Shows each calendar resource's utilisation as segmented bars across the
 * weekly timeline, with percentage labels and colour heat-mapping (green <
 * 70%, amber 70–90%, red > 90%). Derived from study_task_resources joined to
 * the same task model.
 */
import { useMemo } from 'react'

import { cn } from '#/lib/utils'
import type { StudyTask, StudyTaskResource } from '#/lib/planner'
import type { CalendarResource } from '#/lib/calendar'
import { addDays, formatDateInZone, weekLabel } from '#/lib/planner'

export interface PlannerResourceViewProps {
  resources: CalendarResource[]
  taskResources: StudyTaskResource[]
  tasks: StudyTask[]
  timeZone: string
  weekStart: Date
  weekCount: number
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}

export function PlannerResourceView({
  resources,
  taskResources,
  tasks,
  timeZone,
  weekStart,
  weekCount,
  selectedTaskId,
  onSelectTask,
}: PlannerResourceViewProps) {
  const weeks = useMemo(
    () =>
      Array.from({ length: weekCount }, (_, i) => ({
        start: addDays(weekStart, i * 7),
        label: weekLabel(addDays(weekStart, i * 7), timeZone),
      })),
    [weekStart, weekCount, timeZone],
  )

  const totalDays = weekCount * 7

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  // Group task resources by calendar resource.
  const byResource = useMemo(() => {
    const map = new Map<string, StudyTaskResource[]>()
    for (const tr of taskResources) {
      const arr = map.get(tr.calendarResourceId) ?? []
      arr.push(tr)
      map.set(tr.calendarResourceId, arr)
    }
    return map
  }, [taskResources])

  // Detect overlaps (conflicts) per resource.
  const conflictsByResource = useMemo(() => {
    const map = new Map<string, StudyTaskResource[]>()
    for (const [resourceId, trs] of byResource) {
      const conflicts: StudyTaskResource[] = []
      for (let i = 0; i < trs.length; i++) {
        for (let j = i + 1; j < trs.length; j++) {
          if (
            new Date(trs[i].startsAt) < new Date(trs[j].endsAt) &&
            new Date(trs[j].startsAt) < new Date(trs[i].endsAt)
          ) {
            conflicts.push(trs[i], trs[j])
          }
        }
      }
      if (conflicts.length > 0) {
        map.set(resourceId, Array.from(new Set(conflicts)))
      }
    }
    return map
  }, [byResource])

  function dayOffset(date: Date): number {
    return Math.round((date.getTime() - weekStart.getTime()) / 86_400_000)
  }

  function utilisationPct(trs: StudyTaskResource[]): number {
    if (trs.length === 0) return 0
    const weekMs = 7 * 86_400_000
    let bookedMs = 0
    for (const tr of trs) {
      const start = new Date(tr.startsAt)
      const end = new Date(tr.endsAt)
      bookedMs += Math.min(end.getTime() - start.getTime(), weekMs)
    }
    return Math.min(100, Math.round((bookedMs / weekMs) * 100))
  }

  function heatClass(pct: number): string {
    if (pct > 90) return 'bg-red-200 text-red-900 border-red-400'
    if (pct >= 70) return 'bg-amber-200 text-amber-900 border-amber-400'
    return 'bg-green-200 text-green-900 border-green-400'
  }

  if (resources.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
        No calendar resources configured. Create resources in Lab Calendar
        first.
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
          Instrument
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

      {/* Resource rows */}
      {resources.map((resource) => {
        const trs = byResource.get(resource.id) ?? []
        const conflicts = conflictsByResource.get(resource.id) ?? []
        return (
          <div
            key={resource.id}
            className="border-b border-border/30 px-3 py-2"
            style={{ minHeight: 52 }}
          >
            <div className="flex">
              <div className="shrink-0" style={{ width: leftColWidth - 24 }}>
                <div className="text-sm font-medium">{resource.name}</div>
                <div className="text-xs text-muted-foreground">
                  {resource.resourceType}
                  {conflicts.length > 0 ? (
                    <span className="ml-1.5 text-red-600">
                      ⚠ {conflicts.length} conflict
                      {conflicts.length > 1 ? 's' : ''}
                    </span>
                  ) : null}
                </div>
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
                {/* Utilisation bars per week */}
                <div className="absolute inset-0 flex">
                  {weeks.map((w) => {
                    const ws = w.start
                    const we = addDays(ws, 7)
                    const weekTrs = trs.filter(
                      (tr) =>
                        new Date(tr.startsAt) < we && new Date(tr.endsAt) > ws,
                    )
                    const pct = utilisationPct(weekTrs)
                    if (pct === 0) {
                      return (
                        <div
                          key={w.start.toISOString()}
                          style={{ width: weekWidth }}
                        />
                      )
                    }
                    return (
                      <div
                        key={w.start.toISOString()}
                        className="flex items-center px-1"
                        style={{ width: weekWidth }}
                      >
                        <div
                          className={cn(
                            'flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold',
                            heatClass(pct),
                          )}
                          style={{ width: `${pct}%` }}
                          title={`${resource.name} ${w.label}: ${pct}%`}
                        >
                          {pct}%
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Individual task resource bars */}
                <div className="relative">
                  {trs.map((tr) => {
                    const task = taskById.get(tr.taskId)
                    if (!task) return null
                    const start = new Date(tr.startsAt)
                    const end = new Date(tr.endsAt)
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
                        key={tr.id}
                        type="button"
                        onClick={() => onSelectTask(task.id)}
                        className={cn(
                          'absolute rounded border px-1.5 py-0.5 text-left text-[10px] font-medium transition-all hover:opacity-80',
                          conflicts.includes(tr)
                            ? 'border-red-400 bg-red-100 text-red-900'
                            : 'border-blue-300 bg-blue-100 text-blue-900',
                          isSelected && 'ring-2 ring-blue-400',
                        )}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          top: 24,
                        }}
                        title={`${task.title}: ${formatDateInZone(start, timeZone)} – ${formatDateInZone(end, timeZone)}`}
                      >
                        <span className="truncate">{task.title}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
