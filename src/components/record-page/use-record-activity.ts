/**
 * A record's recent activity, from its timeline, with each person by name:
 * what the side panel and the notebook's Activity tab both list.
 */
import { useMemo } from 'react'

import { useRecordModelTimeline } from '#/components/models/models-data'
import {
  RECENT_ACTIVITY_LIMIT,
  recentActivityGroups,
} from '#/lib/record-activity'
import type { ActivityDay } from '#/lib/record-activity'
import { useUserNames } from '#/lib/user-names'

export interface RecordActivityRead {
  groups: ActivityDay[]
  total: number
  loading: boolean
}

export function useRecordActivity(
  recordId: string,
  limit = RECENT_ACTIVITY_LIMIT,
): RecordActivityRead {
  const timeline = useRecordModelTimeline(recordId)

  const actorIds = useMemo(
    () =>
      (timeline.data ?? []).flatMap((event) =>
        event.actorUserId ? [event.actorUserId] : [],
      ),
    [timeline.data],
  )

  const { names } = useUserNames(actorIds)

  const { groups, total } = recentActivityGroups(
    timeline.data ?? [],
    (id) => names[id],
    limit,
  )

  return { groups, total, loading: timeline.isLoading }
}
