import { Checkbox } from '#/components/ui/checkbox'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  addSeriesMember,
  seriesQueryKeys,
  useSeriesMembership,
} from '#/lib/experiment-series'
import type { SeriesMembership } from '#/lib/experiment-series'
import { notebookDataClient } from '#/lib/notebook-data'
import { useQueryClient } from '@tanstack/react-query'

/**
 * "Add the new experiment to EXP-0142": offered by New run and Repeat when the
 * experiment being copied is in a series. Nothing shows for one that is not.
 * It is off until the person ticks it, because a repeat is not always part of
 * the same piece of work.
 */
export function SeriesOffer({
  sourceId,
  checked,
  onChange,
}: {
  sourceId: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const membership = useSeriesMembership(sourceId)
  if (!membership.data) return null
  return (
    <label className="flex cursor-pointer items-start gap-2 text-label">
      <Checkbox
        checked={checked}
        onCheckedChange={(on) => onChange(Boolean(on))}
        className="mt-0.5"
      />
      <span className="flex flex-col">
        <span>
          {t('projects.series.offer.label', {
            identifier: membership.data.series_identifier,
          })}
        </span>
        <span className="text-fg-muted">
          {t('projects.series.offer.hint', {
            title: membership.data.series_title,
          })}
        </span>
      </span>
    </label>
  )
}

/**
 * Put a new experiment in the series the one it was copied from is in. The
 * copy exists either way, so a refusal is said in a toast and not thrown.
 */
export function useJoinSeries() {
  const queryClient = useQueryClient()
  return async (
    membership: SeriesMembership | null | undefined,
    recordId: string,
  ) => {
    if (!membership) return
    try {
      await addSeriesMember(notebookDataClient, {
        seriesId: membership.series_record_id,
        memberId: recordId,
      })
      void queryClient.invalidateQueries({ queryKey: seriesQueryKeys.all })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('projects.series.tab.failed'),
      )
    }
  }
}
