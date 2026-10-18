import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Dot } from '#/components/v3/ui/status'
import { Tabs } from '#/components/v3/ui/tabs'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import { Icon } from '#/components/v3/icons'
import { toast } from '#/components/v3/ui/sonner'
import { BookDialog } from '#/components/v3/schedule/book-dialog'
import {
  useBookingSamples,
  useRangeBookings,
  useScheduleInstruments,
} from '#/components/v3/schedule/schedule-data'
import type {
  BookingSample,
  ScheduleBooking,
  ScheduleInstrument,
} from '#/components/v3/schedule/schedule-data'
import { useWorkspaceMemberNames } from '#/components/v3/projects/project-data'
import { useWorkItems } from '#/lib/work-items/data'
import { homeIsoDay } from '#/lib/home-quiet'
import { cancelBooking, describeCalendarError } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import { cn } from '#/lib/utils'

/** UI port (roadmap-4/ui-app3): the Schedule day/week instrument grid, wired
 * to the instruments registry and calendar_bookings; a booking's resource_id is
 * the instrument id (ADR-0054) and booking writes go through create_booking. */

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T12:00:00Z`)
const addDays = (s: string, n: number) => {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const monday = (s: string) => {
  const d = parse(s)
  return addDays(s, -((d.getUTCDay() + 6) % 7))
}
const fmt = (s: string, o: Intl.DateTimeFormatOptions) =>
  parse(s).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })
const isWeekend = (s: string) => [0, 6].includes(parse(s).getUTCDay())
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
/** The core hours the day grid draws; it widens to cover the day's bookings. */
const DAY_START = 8 * 60
const DAY_END = 18 * 60
const hatch =
  'bg-[repeating-linear-gradient(135deg,var(--hatch)_0_6px,transparent_6px_12px)]'

/**
 * ADR-0054 — a Schedule row is an instrument, so it links to the registry
 * record and shows the instrument's INS display id beside its name.
 */
function InstrumentLabel({ instrument }: { instrument: ScheduleInstrument }) {
  return (
    <Link
      to="/instruments/$instrumentId"
      params={{ instrumentId: instrument.id }}
      className="flex min-w-0 items-center gap-1.5"
    >
      {instrument.displayId ? (
        <span className="mono shrink-0 text-label text-fg-muted">
          {instrument.displayId}
        </span>
      ) : null}
      <span className="truncate">{instrument.name}</span>
    </Link>
  )
}

export const Route = createFileRoute('/schedule')({
  // A deep link may ask to book one instrument (the registry inspector's Book
  // action): `?book=<instrumentId>` opens the dialog with it preselected.
  validateSearch: (search: Record<string, unknown>): { book?: string } =>
    typeof search.book === 'string' && search.book ? { book: search.book } : {},
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: Schedule,
})

export function Schedule() {
  const { context } = Route.useRouteContext()
  const { book } = Route.useSearch()
  const workspaceId = context.workspace?.id
  // QA-022: a Schedule day is the workspace's day. Home groups the same
  // bookings by the workspace timezone, so "today" comes from that clock rather
  // than the UTC calendar day, which can be a day ahead or behind.
  const workspaceQuery = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
    enabled: Boolean(workspaceId),
  })
  const timeZone = workspaceQuery.data?.timezone ?? 'UTC'
  const today = useMemo(() => homeIsoDay(new Date(), timeZone), [timeZone])
  const [view, setView] = useState<'week' | 'day'>('week')
  const [anchor, setAnchor] = useState<string>(today)
  const [added, setAdded] = useState<ScheduleBooking[]>([])
  // QA3: a booking is cancellable. The id opens the detail/cancel dialog, the
  // error is the server's reason when it refuses, and cancelled ids drop the
  // row immediately so the grid matches what the server now holds.
  const queryClient = useQueryClient()
  const [openBookingId, setOpenBookingId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())

  const weekStart = view === 'day' ? anchor : monday(anchor)
  const weekEnd = addDays(weekStart, 7)
  // QA-023: on a phone the day list is the only schedule surface, so it follows
  // the navigated anchor instead of being pinned to today: the anchor day in Day
  // view, today while the viewed week contains it, otherwise the week's first
  // day — so stepping the week changes what a phone shows.
  const phoneDay =
    view === 'day'
      ? anchor
      : today >= weekStart && today < weekEnd
        ? today
        : weekStart
  const rangeFrom = weekStart
  const rangeTo = addDays(weekStart, view === 'day' ? 1 : 7)
  const instrumentsQuery = useScheduleInstruments(workspaceId)
  const bookingsQuery = useRangeBookings(
    workspaceId,
    `${rangeFrom}T00:00:00.000Z`,
    `${rangeTo}T00:00:00.000Z`,
  )
  const instruments: ScheduleInstrument[] = instrumentsQuery.data ?? []
  const membersQuery = useWorkspaceMemberNames()
  const meId = context.user.id
  const memberNames = membersQuery.data
  const bookings = [...(bookingsQuery.data ?? []), ...added]
    .filter((b) => !cancelledIds.has(b.id))
    .map((b) => ({
      ...b,
      mine: Boolean(meId && b.createdByUserId === meId),
      who: b.createdByUserId
        ? (memberNames?.get(b.createdByUserId) ?? 'A colleague')
        : 'A colleague',
    }))
  const mineCount = bookings.filter((b) => b.mine).length
  const bookingSamples = useBookingSamples(
    bookings.filter((b) => b.date === today).map((b) => b.id),
  )
  const workItemsQuery = useWorkItems()
  const reviews = (workItemsQuery.data ?? []).filter(
    (i) => i.kind === 'review_requested',
  )

  const go = (dir: -1 | 0 | 1) => {
    setAnchor(
      dir === 0 ? today : addDays(weekStart, dir * (view === 'day' ? 1 : 7)),
    )
  }
  const selectedBooking = bookings.find((b) => b.id === openBookingId) ?? null
  const selectedInstrument = selectedBooking
    ? instruments.find((i) => i.id === selectedBooking.resourceId)
    : undefined
  const openBooking = (id: string) => {
    setOpenBookingId(id)
    setCancelError(null)
  }
  const confirmCancel = async () => {
    if (!selectedBooking) return
    const bookingId = selectedBooking.id
    setCancelling(true)
    setCancelError(null)
    try {
      await cancelBooking(notebookDataClient, { bookingId })
      setCancelledIds((prev) => new Set(prev).add(bookingId))
      setAdded((items) => items.filter((b) => b.id !== bookingId))
      void queryClient.invalidateQueries({ queryKey: ['schedule', 'bookings'] })
      toast('Booking cancelled')
      setOpenBookingId(null)
    } catch (error) {
      // The server owns whether this booking may be cancelled; show its reason
      // (already cancelled, not found, someone else's) rather than guessing.
      setCancelError(describeCalendarError(error))
    } finally {
      setCancelling(false)
    }
  }
  const instrumentsUsed = new Set(bookings.map((b) => b.resourceId)).size
  const subtitle =
    view === 'day'
      ? `${fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long' })}${mineCount ? ` · ${mineCount} bookings of yours` : ' · no bookings of yours'}${instrumentsUsed ? ` · ${instrumentsUsed} instruments` : ''}`
      : `Week of ${fmt(weekStart, { day: 'numeric', month: 'long' })}${mineCount ? ` · ${mineCount} bookings of yours` : ' · no bookings of yours'}${instrumentsUsed ? ` · ${instrumentsUsed} instruments` : ''}`

  return (
    <div className="relative flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 pb-6 pt-[18px] md:px-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 max-md:basis-full">
          <h1 className="text-title">Schedule</h1>
          <div className="mt-0.5 text-body text-fg-muted">{subtitle}</div>
        </div>
        <Button
          size="sm"
          aria-label={view === 'day' ? 'Previous day' : 'Previous week'}
          onClick={() => go(-1)}
        >
          <Icon name="chevronRight" size={12} className="rotate-180" />
        </Button>
        <Button size="sm" onClick={() => go(0)}>
          Today
        </Button>
        <Button
          size="sm"
          aria-label={view === 'day' ? 'Next day' : 'Next week'}
          onClick={() => go(1)}
        >
          <Icon name="chevronRight" size={12} />
        </Button>
        <Tabs
          mode="state"
          variant="segment"
          label="View"
          value={view}
          onValueChange={(next) => setView(next as 'week' | 'day')}
          className="ml-2"
          items={[
            { key: 'day', label: 'Day' },
            { key: 'week', label: 'Week' },
          ]}
        />
        <BookDialog
          instruments={instruments}
          workspaceId={workspaceId}
          defaultDate={view === 'day' ? anchor : addDays(today, 3)}
          defaultResourceId={book}
          defaultOpen={Boolean(book)}
          onBooked={(b) => {
            setAdded((a) => [...a, b])
            toast('Booked')
          }}
        />
      </div>

      {instrumentsQuery.isSuccess && instruments.length === 0 ? (
        <EmptyState
          icon="flask"
          title="No instruments configured"
          description="The Schedule draws the workspace's instrument registry. Add an instrument and it appears here as a bookable row."
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/instruments" />}
            >
              Open the instrument registry
            </Button>
          }
        />
      ) : (
        <>
          <PhoneDay
            day={phoneDay}
            instruments={instruments}
            bookings={bookings}
            onSelect={openBooking}
          />
          {view === 'day' ? (
            <DayGrid
              day={anchor}
              instruments={instruments}
              bookings={bookings}
              onSelect={openBooking}
            />
          ) : (
            <WeekGrid
              start={weekStart}
              instruments={instruments}
              bookings={bookings}
              onSelect={openBooking}
              onDay={(x) => {
                setView('day')
                setAnchor(x)
              }}
              today={today}
            />
          )}
        </>
      )}

      {bookings.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          Nothing booked on these instruments yet. Bookings are created as
          tentative and weekends are bookable like any other day.
        </p>
      ) : (
        <Below
          reviews={reviews.map((r) => ({
            id: r.identifier ?? '—',
            title: r.title,
            recordId: r.recordId,
            due: r.dueAt ? r.dueAt.slice(0, 10) : '—',
            urgent: r.state === 'overdue',
          }))}
          materials={bookingSamples.data ?? []}
        />
      )}

      <Dialog
        open={Boolean(selectedBooking)}
        onOpenChange={(next) => {
          if (!next) {
            setOpenBookingId(null)
            setCancelError(null)
          }
        }}
      >
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader title="Booking" description={selectedBooking?.title} />
          <DialogBody>
            {selectedBooking ? (
              <dl className="m-0 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1.5 text-body">
                <dt className="text-fg-muted">Instrument</dt>
                <dd className="m-0">
                  {selectedInstrument
                    ? `${selectedInstrument.displayId ? `${selectedInstrument.displayId} · ` : ''}${selectedInstrument.name}`
                    : '—'}
                </dd>
                <dt className="text-fg-muted">Date</dt>
                <dd className="m-0">
                  {fmt(selectedBooking.date, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </dd>
                <dt className="text-fg-muted">Time</dt>
                <dd className="num m-0">
                  {selectedBooking.start}–{selectedBooking.end} (
                  {selectedBooking.timezone})
                </dd>
                <dt className="text-fg-muted">Booked by</dt>
                <dd className="m-0">
                  {selectedBooking.mine ? 'You' : selectedBooking.who}
                </dd>
              </dl>
            ) : null}
            {cancelError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {cancelError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Keep booking</DialogClose>
            <Button
              variant="danger-fill"
              disabled={cancelling}
              onClick={confirmCancel}
            >
              {cancelling ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * QA-024: the grid's hour window. 08:00–18:00 by default, widened to whole
 * hours that cover every booking on the day, so a booking the dialog allowed
 * outside core hours is still drawn where it belongs instead of being clipped
 * to a negative offset or a >100% width.
 */
function dayWindow(dayBookings: ScheduleBooking[]): {
  start: number
  end: number
} {
  let start = DAY_START
  let end = DAY_END
  for (const booking of dayBookings) {
    const from = toMin(booking.start)
    const to = toMin(booking.end)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    start = Math.min(start, Math.floor(from / 60) * 60)
    end = Math.max(end, Math.ceil(to / 60) * 60)
  }
  return { start, end: Math.max(end, start + 60) }
}

function DayGrid({
  day,
  instruments,
  bookings,
  onSelect,
}: {
  day: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
  onSelect: (id: string) => void
}) {
  const dayBookings = bookings.filter((b) => b.date === day)
  const bounds = dayWindow(dayBookings)
  const span = bounds.end - bounds.start
  const position = (t: string) => ((toMin(t) - bounds.start) / span) * 100
  const hours = Array.from({ length: span / 60 }, (_, i) => {
    const hour = bounds.start + i * 60
    return `${String(hour / 60).padStart(2, '0')}:00`
  })
  const closed = isWeekend(day)
  return (
    <section
      aria-label="Instrument schedule"
      className="overflow-x-auto rounded-md border border-border max-md:hidden"
    >
      <div className="relative min-w-[720px]">
        <div className="grid grid-cols-[180px_1fr]">
          <div className="h-6 border-b border-border bg-surface-muted" />
          <div className="relative h-6 border-b border-border bg-surface-muted">
            {hours.map((h) => (
              <span
                key={h}
                className="num absolute top-1 text-[11px] text-fg-muted"
                style={{ left: `calc(${position(h)}% + 4px)` }}
              >
                {h}
              </span>
            ))}
          </div>
          {instruments.map((ins, r) => (
            <div key={ins.id} className="contents">
              <div
                className={cn(
                  'flex h-9 items-center px-2.5 text-body font-medium',
                  r < instruments.length - 1 && 'border-b border-border-subtle',
                )}
              >
                <InstrumentLabel instrument={ins} />
              </div>
              <div
                className={cn(
                  'relative h-9',
                  r < instruments.length - 1 && 'border-b border-border-subtle',
                )}
                role="list"
                aria-label={ins.name}
              >
                {hours.map((h) => (
                  <span
                    key={h}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-border-subtle"
                    style={{ left: `${position(h)}%` }}
                  />
                ))}
                {dayBookings
                  .filter((b) => b.resourceId === ins.id)
                  .map((b) => (
                    <div
                      key={b.id}
                      role="listitem"
                      className="absolute top-1 h-7"
                      style={{
                        left: `calc(${position(b.start)}% + 1px)`,
                        width: `calc(${position(b.end) - position(b.start)}% - 2px)`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(b.id)}
                        title={`${b.start}–${b.end} · ${b.mine ? 'you' : b.who} · ${b.title}`}
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center truncate rounded-sm border px-1.5 text-left text-label',
                          b.mine
                            ? 'border-link bg-selection text-fg'
                            : 'border-border bg-surface-muted text-fg-muted',
                        )}
                      >
                        <span className="sr-only">
                          {b.start}–{b.end}{' '}
                        </span>
                        {b.mine ? '' : `${b.who} · `}
                        {b.title}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
        {closed ? (
          <div
            className={cn(
              'absolute bottom-0 left-[180px] right-0 top-6 flex items-center justify-center',
              hatch,
            )}
          >
            <div className="rounded-md border border-border bg-surface px-3.5 py-2.5 text-center">
              <div className="font-medium">
                No bookings on {fmt(day, { weekday: 'long' })}
              </div>
              <div className="mt-0.5 text-label text-fg-muted">
                Bookings are created as tentative and weekends are bookable like
                any other day.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function WeekGrid({
  start,
  instruments,
  bookings,
  onSelect,
  onDay,
  today,
}: {
  start: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
  onSelect: (id: string) => void
  onDay: (d: string) => void
  today: string
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <section
      aria-label="Instrument schedule"
      className="overflow-x-auto rounded-md border border-border max-md:hidden"
    >
      <table className="num w-full table-fixed border-collapse text-label">
        <thead>
          <tr>
            <th
              scope="col"
              className="w-[180px] border-b border-border bg-surface-muted"
            >
              <span className="sr-only">Instrument</span>
            </th>
            {days.map((x) => (
              <th
                key={x}
                scope="col"
                className={cn(
                  'h-7 border-b border-l border-border bg-surface-muted px-2 text-left font-medium text-fg-muted',
                  x === today && 'text-fg',
                )}
              >
                <button
                  type="button"
                  onClick={() => onDay(x)}
                  className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-link"
                  aria-label={`Open ${fmt(x, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                >
                  {fmt(x, { weekday: 'short', day: 'numeric' })}
                  {x === today ? (
                    <span className="ml-1.5 rounded-[3px] bg-inverse px-1 text-[10px] font-semibold text-inverse-foreground">
                      Today
                    </span>
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {instruments.map((ins, r) => (
            <tr key={ins.id}>
              <th
                scope="row"
                className={cn(
                  'px-2.5 text-left align-top text-body font-medium',
                  r < instruments.length - 1 && 'border-b border-border-subtle',
                )}
              >
                <div className="flex h-9 items-center">
                  <InstrumentLabel instrument={ins} />
                </div>
              </th>
              {days.map((x) => {
                const list = bookings
                  .filter((b) => b.resourceId === ins.id && b.date === x)
                  .sort((a, b) => a.start.localeCompare(b.start))
                return (
                  <td
                    key={x}
                    className={cn(
                      'h-[52px] border-l border-border-subtle p-1 align-top',
                      r < instruments.length - 1 && 'border-b',
                      isWeekend(x) && hatch,
                    )}
                  >
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                      {list.map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(b.id)}
                            title={`${b.start}–${b.end} · ${b.mine ? 'you' : b.who} · ${b.title}`}
                            className={cn(
                              'w-full cursor-pointer truncate rounded-sm border px-1 text-left leading-[18px]',
                              b.mine
                                ? 'border-link bg-selection text-fg'
                                : 'border-border bg-surface-muted text-fg-muted',
                            )}
                          >
                            {b.start} {b.mine ? '' : `${b.who} · `}
                            {b.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function PhoneDay({
  day,
  instruments,
  bookings,
  onSelect,
}: {
  day: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
  onSelect: (id: string) => void
}) {
  const list = bookings
    .filter((b) => b.date === day)
    .sort((a, b) => a.start.localeCompare(b.start))
  return (
    <section
      aria-label={`Bookings, ${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}`}
      className="-mx-4 md:hidden"
    >
      <div className="flex items-center gap-2 border-y border-border bg-surface-muted px-2 py-1.5">
        <div className="flex-1 text-center text-body font-medium">
          {fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>
      {list.length ? (
        <ul className="m-0 list-none p-0">
          {list.map((b) => {
            const instrument = instruments.find((i) => i.id === b.resourceId)
            return (
              <li
                key={b.id}
                className="grid min-h-14 grid-cols-[64px_1fr_auto] items-center gap-3 border-b border-border-subtle px-4 py-2.5"
              >
                <span className="num text-body">
                  {b.start}
                  <span className="block text-label text-fg-muted">
                    {b.end}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-medium">{b.title}</span>
                  <span className="flex items-center gap-1.5 text-label text-fg-muted">
                    {instrument ? (
                      <InstrumentLabel instrument={instrument} />
                    ) : (
                      <span>—</span>
                    )}
                    <span aria-hidden="true">·</span>
                    {b.mine ? 'you' : b.who}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => onSelect(b.id)}
                  aria-label={`Cancel or view booking ${b.title}`}
                >
                  Cancel
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center" role="status">
          <div className="font-medium">
            No bookings on {fmt(day, { weekday: 'long' })}
          </div>
        </div>
      )}
    </section>
  )
}

function Below({
  reviews,
  materials,
}: {
  reviews: {
    id: string
    title: string
    recordId: string | null
    due: string
    urgent: boolean
  }[]
  materials: BookingSample[]
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
      <section>
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-body">Reviews due</h2>
          <span className="num text-body text-fg-muted">{reviews.length}</span>
          <Link to="/inbox" className="ml-auto text-label">
            Inbox
          </Link>
        </div>
        {reviews.length ? (
          reviews.map((r, i) => (
            <div
              key={`${r.id}-${i}`}
              className={cn(
                'grid grid-cols-[12px_1fr_auto] items-center gap-2 py-2 text-body',
                i < reviews.length - 1 && 'border-b border-border-subtle',
              )}
            >
              <Dot tone="review" />
              <span>
                {r.recordId ? (
                  <Link
                    to="/records/$recordId"
                    params={{ recordId: r.recordId }}
                  >
                    <span className="mono text-fg-muted">{r.id}</span> {r.title}
                  </Link>
                ) : (
                  <>
                    <span className="mono text-fg-muted">{r.id}</span> {r.title}
                  </>
                )}
              </span>
              <span
                className={r.urgent ? 'text-danger-text' : 'num text-fg-muted'}
              >
                {r.due}
              </span>
            </div>
          ))
        ) : (
          <Muted>Nothing due.</Muted>
        )}
      </section>
      <section>
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-body">Materials for today</h2>
          <span className="num text-body text-fg-muted">
            {materials.length}
          </span>
        </div>
        {materials.length ? (
          materials.map((m, i) => (
            <div
              key={m.id}
              className={cn(
                'grid grid-cols-[76px_1fr_auto] items-center gap-2 py-2 text-body',
                i < materials.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {m.sampleRecordId ? (
                <Link
                  to="/samples/$sampleId"
                  params={{ sampleId: m.sampleRecordId }}
                  className="mono"
                >
                  {m.identifier}
                </Link>
              ) : (
                <span className="mono text-fg-muted">{m.identifier}</span>
              )}
              <span>{m.title}</span>
              <span className="num text-fg-muted">{m.left}</span>
            </div>
          ))
        ) : (
          <Muted>No samples are booked for today.</Muted>
        )}
      </section>
    </div>
  )
}
