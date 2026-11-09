import { useQuery } from '@tanstack/react-query'

import { listByIds } from '#/lib/chunk-ids'
import type { DataClient } from '#/lib/data-client'
import { fetchNotebookTemplates } from '#/lib/notebook-template-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchRepeatSchedules, toRepeatOccurrence } from '#/lib/recurring'
import type {
  RepeatKind,
  RepeatOccurrence,
  RepeatOccurrenceWire,
  RepeatSchedule,
} from '#/lib/recurring'
import { dateTimeFormat } from '#/lib/intl-cache'

export interface RepeatRow {
  schedule: RepeatSchedule
  /** How many bookings or experiments it has made so far. */
  made: number
  /** The next one still to come (a booking, or an experiment's due day). */
  next: string | null
  /** What could not be made, soonest first. */
  notMade: RepeatOccurrence[]
}

export const recurringQueryKeys = {
  list: (workspaceId: string, kind: RepeatKind) =>
    ['recurring', 'list', workspaceId, kind] as const,
}

/** A schedule's own day, so "next" never depends on the viewer's zone. */
function dayIn(timeZone: string, at: Date): string {
  return dateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** The repeats of one kind with what each has made and could not make. */
export async function fetchRepeatRows(
  client: DataClient,
  kind: RepeatKind,
  at: Date = new Date(),
): Promise<RepeatRow[]> {
  const schedules = await fetchRepeatSchedules(client, kind)

  if (schedules.length === 0) return []

  const wires = await listByIds(
    schedules.map((s) => s.id),
    (inList) =>
      client.list<RepeatOccurrenceWire>(
        'recurring_occurrences',
        `?schedule_id=in.(${inList})&select=schedule_id,occurrence_on,outcome,message&order=occurrence_on.asc&limit=5000`,
      ),
  )

  const bySchedule = new Map<string, RepeatOccurrence[]>()

  for (const wire of wires) {
    const occurrence = toRepeatOccurrence(wire)
    bySchedule.set(occurrence.scheduleId, [
      ...(bySchedule.get(occurrence.scheduleId) ?? []),
      occurrence,
    ])
  }

  const rows = schedules.map((schedule): RepeatRow => {
    const all = bySchedule.get(schedule.id) ?? []
    const today = dayIn(schedule.timezone, at)
    const created = all.filter((o) => o.outcome === 'created')

    return {
      schedule,
      made: created.length,
      next: created.find((o) => o.on >= today)?.on ?? null,
      notMade: all.filter((o) => o.outcome !== 'created'),
    }
  })

  // What is still running first, then what has finished.
  const rank = { active: 0, paused: 1, ended: 2 } as const

  return rows.sort((a, b) => rank[a.schedule.status] - rank[b.schedule.status])
}

export function useRepeatRows(
  workspaceId: string | undefined,
  kind: RepeatKind,
  enabled = true,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recurringQueryKeys.list(workspaceId ?? 'none', kind),
    enabled: Boolean(workspaceId) && enabled,
    queryFn: () => fetchRepeatRows(client, kind),
  })
}

export interface StartableTemplate {
  id: string
  name: string
}

/** Notebook templates that have a published version, which is what a repeat starts from. */
export function useStartableTemplates(enabled = true) {
  return useQuery({
    queryKey: ['recurring', 'templates'],
    enabled,
    queryFn: async (): Promise<StartableTemplate[]> => {
      const templates = (
        await fetchNotebookTemplates(notebookDataClient)
      ).filter((template) => template.lifecycle === 'active')

      if (templates.length === 0) return []

      const versions = await listByIds(
        templates.map((template) => template.id),
        (inList) =>
          notebookDataClient.list<{ template_id: string }>(
            'notebook_template_versions',
            `?template_id=in.(${inList})&lifecycle=eq.published&select=template_id`,
          ),
      )

      const published = new Set(versions.map((v) => v.template_id))

      return templates
        .filter((template) => published.has(template.id))
        .map((template) => ({ id: template.id, name: template.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    staleTime: 30_000,
  })
}
