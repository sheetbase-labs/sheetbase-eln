/**
 * OPS-005 — Study Planner filter bar.
 *
 * Group-by, status, assignee, instrument and team filters for the planner
 * views. Mirrors the mockup toolbar: "Group by Workstream", "Filter All
 * tasks", "Assignee All", "Instrument All", "Team All", and a Clear link.
 */
import { LayoutGrid, RotateCcw } from 'lucide-react'

import { Button } from '#/components/ui'
import type { StudyTaskStatus, StudyTaskPriority } from '#/lib/planner'
import { TASK_STATUS_LABELS } from '#/lib/planner'

export interface PlannerFilterValue {
  status: StudyTaskStatus | ''
  priority: StudyTaskPriority | ''
  assignee: string
  workstreamId: string
  calendarResourceId: string
}

export const EMPTY_PLANNER_FILTERS: PlannerFilterValue = {
  status: '',
  priority: '',
  assignee: '',
  workstreamId: '',
  calendarResourceId: '',
}

export interface PlannerFiltersProps {
  value: PlannerFilterValue
  onChange: (value: PlannerFilterValue) => void
  workstreams: Array<{ id: string; name: string }>
  resources: Array<{ id: string; name: string }>
  assignees: Array<{ id: string; name: string }>
}

const STATUS_OPTIONS: Array<{ value: StudyTaskStatus | ''; label: string }> = [
  { value: '', label: 'All tasks' },
  ...(
    Object.entries(TASK_STATUS_LABELS) as Array<[StudyTaskStatus, string]>
  ).map(([value, label]) => ({ value, label })),
]

const PRIORITY_OPTIONS: Array<{
  value: StudyTaskPriority | ''
  label: string
}> = [
  { value: '', label: 'All priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export function PlannerFilters({
  value,
  onChange,
  workstreams,
  resources,
  assignees,
}: PlannerFiltersProps) {
  const hasFilters =
    value.status ||
    value.priority ||
    value.assignee ||
    value.workstreamId ||
    value.calendarResourceId

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <LayoutGrid className="size-3.5" />
        <span>Group by Workstream</span>
      </div>
      <select
        aria-label="Status"
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value={value.status}
        onChange={(e) =>
          onChange({
            ...value,
            status: e.target.value as PlannerFilterValue['status'],
          })
        }
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Priority"
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value={value.priority}
        onChange={(e) =>
          onChange({
            ...value,
            priority: e.target.value as PlannerFilterValue['priority'],
          })
        }
      >
        {PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Assignee"
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
      >
        <option value="">Assignee All</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Instrument"
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value={value.calendarResourceId}
        onChange={(e) =>
          onChange({ ...value, calendarResourceId: e.target.value })
        }
      >
        <option value="">Instrument All</option>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Workstream"
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value={value.workstreamId}
        onChange={(e) => onChange({ ...value, workstreamId: e.target.value })}
      >
        <option value="">Workstream All</option>
        {workstreams.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onChange(EMPTY_PLANNER_FILTERS)}
        >
          <RotateCcw className="size-3" /> Clear
        </Button>
      ) : null}
    </div>
  )
}
