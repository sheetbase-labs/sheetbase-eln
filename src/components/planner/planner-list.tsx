/**
 * OPS-005 — Study Planner list view.
 *
 * Table view over the same task model using the shared Table primitives.
 * Columns: Title, Workstream, Status, Priority, Assignee, Start, Due,
 * Progress, Dependencies.
 */
import { useMemo } from 'react'

import { cn } from '#/lib/utils'
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import type {
  StudyTask,
  StudyTaskDependency,
  StudyWorkstream,
} from '#/lib/planner'
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE_VARIANT,
  PRIORITY_LABELS,
  PRIORITY_TOKENS,
  formatDateInZone,
} from '#/lib/planner'

export interface PlannerListProps {
  tasks: StudyTask[]
  workstreams: StudyWorkstream[]
  dependencies: StudyTaskDependency[]
  timeZone: string
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}

export function PlannerList({
  tasks,
  workstreams,
  dependencies,
  timeZone,
  selectedTaskId,
  onSelectTask,
}: PlannerListProps) {
  const workstreamMap = useMemo(
    () => new Map(workstreams.map((w) => [w.id, w.name])),
    [workstreams],
  )

  const successorDeps = useMemo(() => {
    const map = new Map<string, number>()
    for (const dep of dependencies) {
      map.set(dep.successorId, (map.get(dep.successorId) ?? 0) + 1)
    }
    return map
  }, [dependencies])

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
        No tasks yet. Use Add task to create one.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="text-left text-xs text-muted-foreground">
            <TableHead className="min-w-[200px] font-medium">Title</TableHead>
            <TableHead className="whitespace-nowrap font-medium">
              Workstream
            </TableHead>
            <TableHead className="whitespace-nowrap font-medium">
              Status
            </TableHead>
            <TableHead className="whitespace-nowrap font-medium">
              Priority
            </TableHead>
            <TableHead className="min-w-[120px] font-medium">
              Assignee
            </TableHead>
            <TableHead className="whitespace-nowrap font-medium">
              Start
            </TableHead>
            <TableHead className="whitespace-nowrap font-medium">Due</TableHead>
            <TableHead className="whitespace-nowrap font-medium">
              Progress
            </TableHead>
            <TableHead className="whitespace-nowrap font-medium">
              Deps
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks
            .filter((t) => t.status !== 'cancelled')
            .map((task) => {
              const isSelected = task.id === selectedTaskId
              const assigneeLabel =
                task.assignments
                  .filter((a) => a.role === 'assignee')
                  .map((a) => a.displayName ?? a.userId ?? '—')
                  .join(', ') || '—'
              const depCount = successorDeps.get(task.id) ?? 0
              return (
                <TableRow
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-muted/30',
                    isSelected && 'bg-primary/5',
                  )}
                >
                  <TableCell className="py-2 font-medium">
                    <span className="line-clamp-2">{task.title}</span>
                  </TableCell>
                  <TableCell className="py-2 text-muted-foreground">
                    {task.workstreamId
                      ? (workstreamMap.get(task.workstreamId) ?? '—')
                      : '—'}
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge
                      variant={TASK_STATUS_BADGE_VARIANT[task.status]}
                      className="whitespace-nowrap px-1.5 py-0.5 text-xs"
                    >
                      {TASK_STATUS_LABELS[task.status]}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'py-2 text-xs font-medium',
                      PRIORITY_TOKENS[task.priority],
                    )}
                  >
                    {PRIORITY_LABELS[task.priority]}
                  </TableCell>
                  <TableCell className="py-2 text-muted-foreground">
                    {assigneeLabel}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                    {task.startsAt
                      ? formatDateInZone(new Date(task.startsAt), timeZone)
                      : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                    {task.dueAt
                      ? formatDateInZone(new Date(task.dueAt), timeZone)
                      : task.endsAt
                        ? formatDateInZone(new Date(task.endsAt), timeZone)
                        : '—'}
                  </TableCell>
                  <TableCell className="py-2">
                    {task.progressPercent > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${task.progressPercent}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {task.progressPercent}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {depCount > 0 ? depCount : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
        </TableBody>
      </Table>
    </div>
  )
}
