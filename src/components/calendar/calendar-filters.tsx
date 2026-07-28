/**
 * OPS-004 — Calendar filter bar: Team, Instrument, Project, Location.
 * Matches the mockup's filter row above the calendar grid.
 */
import { Filter } from 'lucide-react'

import { Badge, Select } from '#/components/ui'
import type { CalendarResource } from '#/lib/calendar'

export interface CalendarFilterValue {
  resourceId: string
  projectId: string
  resourceType: string
  location: string
  status: string
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilterValue = {
  resourceId: '',
  projectId: '',
  resourceType: '',
  location: '',
  status: '',
}

export function CalendarFilters({
  resources,
  value,
  onChange,
  projectOptions,
}: {
  resources: CalendarResource[]
  value: CalendarFilterValue
  onChange: (next: CalendarFilterValue) => void
  projectOptions: Array<{ id: string; title: string }>
}) {
  const locations = Array.from(
    new Set(resources.map((r) => r.location).filter(Boolean) as string[]),
  ).sort()
  const activeCount = Object.values(value).filter(Boolean).length

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Filter className="size-4" />
        <span>Filters</span>
        {activeCount > 0 ? (
          <Badge variant="secondary" className="ml-1">
            {activeCount}
          </Badge>
        ) : null}
      </div>

      <Select
        className="w-auto"
        aria-label="Instrument"
        value={value.resourceId}
        onChange={(e) => onChange({ ...value, resourceId: e.target.value })}
      >
        <option value="">All instruments</option>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto"
        aria-label="Resource type"
        value={value.resourceType}
        onChange={(e) => onChange({ ...value, resourceType: e.target.value })}
      >
        <option value="">All types</option>
        <option value="instrument">Instruments</option>
        <option value="room">Rooms</option>
        <option value="equipment">Equipment</option>
      </Select>

      <Select
        className="w-auto"
        aria-label="Project"
        value={value.projectId}
        onChange={(e) => onChange({ ...value, projectId: e.target.value })}
      >
        <option value="">All projects</option>
        {projectOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto"
        aria-label="Location"
        value={value.location}
        onChange={(e) => onChange({ ...value, location: e.target.value })}
      >
        <option value="">All locations</option>
        {locations.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto"
        aria-label="Booking status"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value })}
      >
        <option value="">All statuses</option>
        <option value="confirmed">Confirmed</option>
        <option value="tentative">Tentative</option>
        <option value="cancelled">Cancelled</option>
      </Select>

      {activeCount > 0 ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onChange(EMPTY_CALENDAR_FILTERS)}
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}
