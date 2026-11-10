/**
 * The tone a recent item's status is painted with. Apart from the Home surface
 * so that file holds only the component.
 */
import { experimentStatus } from '#/components/experiments/experiments-data'
import type { Tone } from '#/components/ui/status'
import type { RecentItem } from '#/lib/recents'

/** Status tone for a resolved recent item, from the v3 palette. Record
 * statuses reuse the experiment status mapping; lifecycle objects map
 * active/archived directly. */
export function recentTone(item: Pick<RecentItem, 'kind' | 'status'>): Tone {
  if (item.kind === 'record') return experimentStatus(item.status ?? '').tone

  if (item.status === 'active') return 'progress'

  if (item.status === 'archived' || item.status === 'retired') return 'stored'

  return 'none'
}
