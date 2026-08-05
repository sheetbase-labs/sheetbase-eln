/**
 * OPS-005 — Study Planner filter bar.
 *
 * Group-by, status, assignee, instrument and team filters for the planner
 * views. Mirrors the mockup toolbar: "Group by: Workstream", "Status: All",
 * "Priority: All", "Assignee: All", "Instrument: All", and a Clear link.
 *
 * Filters are styled as subtle chips (bg-muted/50, no visible border) rather
 * than bordered form inputs, so the toolbar reads as a calm filter row, not
 * a jagged sequence of boxes. The shared `Select` primitive already provides
 * `appearance-none` + a CSS chevron; the chip styling is layered on top.
 */
import { RotateCcw } from 'lucide-react'

import { Button, Select } from '#/components/ui'
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
  { value: '', label: 'Status: All' },
  ...(
    Object.entries(TASK_STATUS_LABELS) as Array<[StudyTaskStatus, string]>
  ).map(([value, label]) => ({ value, label })),
]

const PRIORITY_OPTIONS: Array<{
  value: StudyTaskPriority | ''
  label: string
}> = [
  { value: '', label: 'Priority: All' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const GROUP_BY_OPTIONS = [
  { value: 'workstream', label: 'Group by: Workstream' },
]

/** Shared chip className for all filter selects — subtle, no harsh border. */
const chipClassName =
  'h-7 min-w-[120px] w-auto rounded-md border-0 bg-muted/50 px-2 pr-7 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'

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
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto text-xs">
      <Select
        aria-label="Group by"
        className={chipClassName}
        value="workstream"
        onChange={() => {}}
      >
        {GROUP_BY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Status"
        className={chipClassName}
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
      </Select>
      <Select
        aria-label="Priority"
        className={chipClassName}
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
      </Select>
      <Select
        aria-label="Assignee"
        className={chipClassName}
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
      >
        <option value="">Assignee: All</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Instrument"
        className={chipClassName}
        value={value.calendarResourceId}
        onChange={(e) =>
          onChange({ ...value, calendarResourceId: e.target.value })
        }
      >
        <option value="">Instrument: All</option>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Workstream"
        className={chipClassName}
        value={value.workstreamId}
        onChange={(e) => onChange({ ...value, workstreamId: e.target.value })}
      >
        <option value="">Workstream: All</option>
        {workstreams.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
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
