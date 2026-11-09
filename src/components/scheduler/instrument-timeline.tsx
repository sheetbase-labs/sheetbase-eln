/**
 * An instrument's week: what is booked, with the slots the scheduler has
 * proposed outlined, one lane per day.
 */
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/ui/layout'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import { formatDate, formatTime } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { scheduleQueryKeys } from '#/lib/scheduler'
import type { ScheduleProposalWire } from '#/lib/scheduler'

const client = notebookDataClient
const DAYS = 7
const DAY_MS = 86_400_000

interface Slot {
  key: string
  title: string
  start: number
  end: number
  proposed: boolean
}

/** The slot's share of each day it touches, as [dayIndex, leftPercent, widthPercent]. */
export function slotSegments(
  slot: Pick<Slot, 'start' | 'end'>,
  origin: number,
  days = DAYS,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []

  for (let day = 0; day < days; day += 1) {
    const from = origin + day * DAY_MS
    const to = from + DAY_MS
    const start = Math.max(slot.start, from)
    const end = Math.min(slot.end, to)

    if (end <= start) continue
    out.push([
      day,
      ((start - from) / DAY_MS) * 100,
      Math.max(((end - start) / DAY_MS) * 100, 0.8),
    ])
  }

  return out
}

function startOfToday(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)

  return d.getTime()
}

export function InstrumentTimeline({ instrumentId }: { instrumentId: string }) {
  const origin = startOfToday(Date.now())
  const until = origin + DAYS * DAY_MS

  const slots = useQuery({
    queryKey: [...scheduleQueryKeys.lane(instrumentId), origin],
    queryFn: async (): Promise<Slot[]> => {
      const [bookings, proposals] = await Promise.all([
        client.list<{
          id: string
          title: string
          starts_at: string
          ends_at: string
        }>(
          'calendar_bookings',
          `?select=id,title,starts_at,ends_at&resource_id=eq.${encodeURIComponent(instrumentId)}&status=neq.cancelled&ends_at=gt.${new Date(origin).toISOString()}&starts_at=lt.${new Date(until).toISOString()}&order=starts_at.asc&limit=200`,
        ),
        client.list<ScheduleProposalWire>(
          'schedule_proposals',
          '?select=id,items&status=eq.proposed&limit=50',
        ),
      ])

      const proposed = proposals.flatMap((p) =>
        p.items
          .filter(
            (item) =>
              item.resourceId === instrumentId && item.startsAt && item.endsAt,
          )
          .map((item): Slot => ({
            key: `${p.id}-${item.partId}`,
            title: `${item.partNumber}. ${item.partTitle}`,
            start: Date.parse(item.startsAt as string),
            end: Date.parse(item.endsAt as string),
            proposed: true,
          })),
      )

      return [
        ...bookings.map((b): Slot => ({
          key: b.id,
          title: b.title,
          start: Date.parse(b.starts_at),
          end: Date.parse(b.ends_at),
          proposed: false,
        })),
        ...proposed,
      ]
    },
    staleTime: 15_000,
  })

  const list = (slots.data ?? []).filter(
    (s) => s.end > origin && s.start < until,
  )

  if (slots.isPending) return null

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('automation.schedule.timeline.title')}
    >
      <div className="flex flex-col gap-2">
        <p className="m-0 text-body text-fg-muted">
          {list.length === 0
            ? t('automation.schedule.timeline.empty')
            : t('automation.schedule.timeline.explain')}
        </p>
        <div
          role="table"
          aria-label={t('automation.schedule.timeline.tableLabel')}
          className="flex flex-col"
        >
          {Array.from({ length: DAYS }, (_, day) => {
            const dayStart = origin + day * DAY_MS

            return (
              <div
                role="row"
                key={day}
                className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 border-t border-border py-1.5 first:border-t-0"
              >
                <span role="rowheader" className="text-label text-fg-muted">
                  {formatDate(new Date(dayStart + 12 * 3_600_000), {
                    year: false,
                  })}
                </span>
                <div
                  role="cell"
                  className="relative h-6 rounded-sm bg-surface-muted"
                >
                  {list.flatMap((slot) =>
                    slotSegments(slot, origin)
                      .filter(([d]) => d === day)
                      .map(([, left, width]) => (
                        <Tooltip
                          key={`${slot.key}-${day}`}
                          content={t(
                            slot.proposed
                              ? 'automation.schedule.timeline.slotProposed'
                              : 'automation.schedule.timeline.slotBooked',
                            {
                              title: slot.title,
                              from: formatTime(new Date(slot.start)),
                              to: formatTime(new Date(slot.end)),
                            },
                          )}
                        >
                          <span
                            className={
                              slot.proposed
                                ? 'absolute top-0.5 bottom-0.5 rounded-sm border border-dashed border-link bg-transparent'
                                : 'absolute top-0.5 bottom-0.5 rounded-sm bg-link'
                            }
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                        </Tooltip>
                      )),
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Section>
  )
}
