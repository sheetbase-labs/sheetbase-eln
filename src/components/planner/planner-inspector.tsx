/**
 * OPS-005 — Study Planner selected-task inspector.
 *
 * Shows the selected task's overview (workstream, assignee, status, priority,
 * start, due, duration, progress, tags), linked protocol, required samples,
 * resource conflicts and approval requirements. Matches the mockup's
 * Details/Activity tabbed inspector.
 */
import { AlertTriangle, CheckCircle2, Clock, FileText } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import { cn } from '#/lib/utils'
import type { StudyTask, StudyTaskResource } from '#/lib/planner'
import type { CalendarResource } from '#/lib/calendar'
import {
  TASK_STATUS_TOKENS,
  TASK_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TOKENS,
  formatDateInZone,
  taskDurationDays,
} from '#/lib/planner'

export interface PlannerInspectorProps {
  task: StudyTask | null
  resources: CalendarResource[]
  taskResources: StudyTaskResource[]
  allTaskResources: StudyTaskResource[]
  timeZone: string
  onEdit?: (task: StudyTask) => void
  onDelete?: (task: StudyTask) => void
}

export function PlannerInspector({
  task,
  resources,
  taskResources,
  allTaskResources,
  timeZone,
  onEdit,
  onDelete,
}: PlannerInspectorProps) {
  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          No task selected
        </p>
        <p className="text-xs text-muted-foreground">
          Select a task from the timeline, list, workload or resource view to
          see its details.
        </p>
      </div>
    )
  }

  const resourceMap = new Map(resources.map((r) => [r.id, r]))
  const conflicts = taskResources.filter((tr) =>
    allTaskResources.some(
      (other) =>
        other.id !== tr.id &&
        other.calendarResourceId === tr.calendarResourceId &&
        new Date(other.startsAt) < new Date(tr.endsAt) &&
        new Date(tr.startsAt) < new Date(other.endsAt),
    ),
  )
  const duration = taskDurationDays(task)
  const assignees = task.assignments.filter((a) => a.role === 'assignee')

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold">{task.title}</h2>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium',
              TASK_STATUS_TOKENS[task.status],
            )}
          >
            {TASK_STATUS_LABELS[task.status]}
          </span>
          {task.linkedExperimentIdentifier ? (
            <span className="text-xs text-muted-foreground">
              {task.linkedExperimentIdentifier}
            </span>
          ) : null}
        </div>
      </div>

      {/* Overview */}
      <section className="border-b border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Overview
        </h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Workstream</dt>
          <dd className="font-medium">—</dd>
          <dt className="text-muted-foreground">Assignee</dt>
          <dd className="font-medium">
            {assignees.map((a) => a.displayName ?? a.userId).join(', ') || '—'}
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">{TASK_STATUS_LABELS[task.status]}</dd>
          <dt className="text-muted-foreground">Priority</dt>
          <dd className={cn('font-medium', PRIORITY_TOKENS[task.priority])}>
            {PRIORITY_LABELS[task.priority]}
          </dd>
          <dt className="text-muted-foreground">Start</dt>
          <dd className="font-medium">
            {task.startsAt
              ? formatDateInZone(new Date(task.startsAt), timeZone)
              : task.dueAt
                ? formatDateInZone(new Date(task.dueAt), timeZone)
                : '—'}
          </dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd className="font-medium">
            {task.dueAt
              ? formatDateInZone(new Date(task.dueAt), timeZone)
              : task.endsAt
                ? formatDateInZone(new Date(task.endsAt), timeZone)
                : '—'}
          </dd>
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="font-medium">
            {task.taskType === 'milestone' ? '—' : `${duration} days`}
          </dd>
        </dl>
        {task.progressPercent > 0 ? (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">% Complete</span>
              <span className="font-medium">{task.progressPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${task.progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
        {task.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </section>

      {/* Linked protocol */}
      {task.linkedProtocolIdentifier ? (
        <section className="border-b border-border p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Linked protocol
          </h3>
          <div className="flex items-center gap-2 rounded-md border border-border p-2">
            <FileText className="size-4 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">
                {task.linkedProtocolIdentifier}
              </p>
              <p className="truncate text-xs text-muted-foreground">Protocol</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Required samples / resources */}
      {taskResources.length > 0 ? (
        <section className="border-b border-border p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Resources
          </h3>
          <ul className="space-y-1.5">
            {taskResources.map((tr) => {
              const res = resourceMap.get(tr.calendarResourceId)
              return (
                <li key={tr.id} className="flex items-center gap-2 text-xs">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{res?.name ?? 'Unknown'}</span>
                  <span className="text-muted-foreground">
                    {formatDateInZone(new Date(tr.startsAt), timeZone)} –{' '}
                    {formatDateInZone(new Date(tr.endsAt), timeZone)}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {/* Resource conflicts */}
      {conflicts.length > 0 ? (
        <section className="border-b border-border p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Resource conflicts
          </h3>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <AlertTriangle className="size-4" />
              {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}{' '}
              detected
            </div>
            <ul className="mt-1.5 space-y-1 text-xs text-destructive">
              {conflicts.map((c) => {
                const res = resourceMap.get(c.calendarResourceId)
                return (
                  <li key={c.id}>
                    {res?.name ?? 'Resource'} is overbooked on{' '}
                    {formatDateInZone(new Date(c.startsAt), timeZone)}
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Approvals */}
      <section className="border-b border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Approvals
        </h3>
        {task.approvalRequired ? (
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-xs">
              <span>
                Required{' '}
                <span className="font-semibold text-warning-foreground">
                  (1)
                </span>
              </span>
              <span>
                Approved{' '}
                <span className="font-semibold text-success">
                  ({task.approvalStatus === 'approved' ? 1 : 0})
                </span>
              </span>
            </div>
            <Button variant="outline" size="sm" className="w-full text-xs">
              Request approval
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No approval required.</p>
        )}
      </section>

      {/* Deliverables */}
      {task.deliverables.length > 0 ? (
        <section className="border-b border-border p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Deliverables
          </h3>
          <ul className="space-y-1.5">
            {task.deliverables.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <CheckCircle2
                  className={cn(
                    'size-3.5',
                    d.status === 'delivered'
                      ? 'text-success'
                      : 'text-muted-foreground',
                  )}
                />
                <span className="font-medium">{d.name}</span>
                <span className="ml-auto text-muted-foreground">
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Footer: metadata + actions */}
      <div className="mt-auto border-t border-border p-4">
        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <dt>Created</dt>
            <dd>{formatDateInZone(new Date(task.createdAt), timeZone)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Updated</dt>
            <dd>{formatDateInZone(new Date(task.updatedAt), timeZone)}</dd>
          </div>
        </dl>
        {onEdit ? (
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => onEdit(task)}
            >
              Edit
            </Button>
            {onDelete ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-destructive"
                onClick={() => onDelete(task)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
