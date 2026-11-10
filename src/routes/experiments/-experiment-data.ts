import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/ui/status'
import { experimentStatus } from '#/components/experiments/experiments-data'
import { daysSinceStart, lastDayOffset } from '#/lib/experiment-parts'
import type { ExperimentPart } from '#/lib/experiment-parts'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'

export interface RecordLinkWire {
  id: string
  target_kind: string
  target_identifier: string
  target_record_id: string | null
  link_type: string
  /** The part of the experiment it was made in; none for an experiment without parts. */
  part_id?: string | null
  created_at: string
}

/** The experiment row the page header reads, as the endpoint returns it. */
export interface ExperimentRecordRow {
  id: string
  workspace_id: string
  identifier: string
  title: string
  status: string
  project_id: string | null
  tags: string[] | null
  locked_at: string | null
  archived_at: string | null
  created_by_user_id: string
  reviewer_user_id: string | null
  planned_end: string | null
  created_at: string
  updated_at: string
}

export const experimentQueryKeys = {
  record: (recordId: string) => ['ui-port', 'experiment', recordId] as const,
  links: (recordId: string) =>
    ['ui-port', 'experiment-links', recordId] as const,
  revisions: (recordId: string) =>
    ['ui-port', 'experiment-revisions', recordId] as const,
}

export function useExperimentRecord(recordId: string) {
  return useQuery({
    queryKey: experimentQueryKeys.record(recordId),
    queryFn: () =>
      notebookDataClient
        .list<ExperimentRecordRow>(
          'records',
          `?id=eq.${recordId}&kind=eq.experiment&limit=1&select=id,workspace_id,identifier,title,status,project_id,tags,locked_at,archived_at,created_by_user_id,reviewer_user_id,planned_end,created_at,updated_at`,
        )
        .then((rows) => rows[0] ?? null),
  })
}

export function useExperimentLinks(recordId: string) {
  return useQuery({
    queryKey: experimentQueryKeys.links(recordId),
    queryFn: () =>
      notebookDataClient.list<RecordLinkWire>(
        'record_links',
        `?source_record_id=eq.${recordId}&select=id,target_kind,target_identifier,target_record_id,link_type,part_id,created_at&order=created_at.desc`,
      ),
  })
}

export function experimentStatusFor(status: string): {
  tone: Tone
  label: string
} {
  return experimentStatus(status)
}

/**
 * "Day 3 of 10" while an experiment with parts is running: how far along the
 * calendar it is, out of the day of its last part.
 */
export function experimentRunningDay({
  status,
  startedAt,
  parts,
}: {
  status: string | undefined
  startedAt: string
  parts: readonly ExperimentPart[]
}): string | null {
  const lastDay = lastDayOffset(parts)

  if (
    lastDay == null ||
    lastDay <= 0 ||
    (status !== 'in_progress' && status !== 'returned')
  ) {
    return null
  }

  return t('notebook.parts.dayOfTotal', {
    day: String(Math.min(daysSinceStart(startedAt), lastDay)),
    total: String(lastDay),
  })
}

/**
 * Why the pane header calls the notebook read-only: the reviewer reads the
 * submitted version, an approved record is locked, and any other lock is
 * read-only too.
 */
export function experimentFrozenReason({
  reviewing,
  status,
  lockedAt,
}: {
  reviewing: boolean
  status: string | undefined
  lockedAt: string | null | undefined
}): 'review' | 'approved' | true | false {
  if (reviewing) return 'review'

  if (!lockedAt) return false

  return status === 'approved' ? 'approved' : true
}
