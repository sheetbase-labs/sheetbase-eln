import { useMemo, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Dot } from '#/components/v3/ui/status'
import { Muted } from '#/components/v3/ui/layout'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Icon } from '#/components/v3/icons'
import { toast } from '#/components/v3/ui/sonner'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  bookInstrument,
  useRangeBookings,
  useScheduleResources,
  useWorkspaceMemberNames,
} from '#/components/v3/schedule/schedule-data'
import type {
  ScheduleBooking,
  ScheduleInstrument,
} from '#/components/v3/schedule/schedule-data'
import { useWorkItems } from '#/lib/work-items/data'
import { cn } from '#/lib/utils'

/** UI port (roadmap-4/ui-app3): the Schedule day/week instrument grid, wired
 * to calendar_resources and calendar_bookings; booking writes go through
 * create_booking. */

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
const DAY_START = 8 * 60
const DAY_END = 18 * 60
const pct = (t: string) =>
  ((toMin(t) - DAY_START) / (DAY_END - DAY_START)) * 100
const hatch =
  'bg-[repeating-linear-gradient(135deg,var(--hatch)_0_6px,transparent_6px_12px)]'

export const Route = createFileRoute('/schedule')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: Schedule,
})

function Schedule() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id
  const today = useMemo(() => iso(new Date()), [])
  const [view, setView] = useState<'week' | 'day'>('week')
  const [anchor, setAnchor] = useState<string>(today)
  const [added, setAdded] = useState<ScheduleBooking[]>([])

  const weekStart = view === 'day' ? anchor : monday(anchor)
  const rangeFrom = weekStart
  const rangeTo = addDays(weekStart, view === 'day' ? 1 : 7)
  const resourcesQuery = useScheduleResources(workspaceId)
  const bookingsQuery = useRangeBookings(
    workspaceId,
    `${rangeFrom}T00:00:00.000Z`,
    `${rangeTo}T00:00:00.000Z`,
  )
  const instruments: ScheduleInstrument[] = resourcesQuery.data ?? []
  const membersQuery = useWorkspaceMemberNames()
  const meId = context.user.id
  const memberNames = membersQuery.data
  const bookings = [...(bookingsQuery.data ?? []), ...added].map((b) => ({
    ...b,
    mine: Boolean(meId && b.createdByUserId === meId),
    who: b.createdByUserId
      ? (memberNames?.get(b.createdByUserId) ?? 'A colleague')
      : 'A colleague',
  }))
  const mineCount = bookings.filter((b) => b.mine).length
  const workItemsQuery = useWorkItems()
  const reviews = (workItemsQuery.data ?? []).filter(
    (i) => i.kind === 'review_requested',
  )

  const go = (dir: -1 | 0 | 1) => {
    setAnchor(
      dir === 0 ? today : addDays(weekStart, dir * (view === 'day' ? 1 : 7)),
    )
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
          className="max-md:hidden"
          aria-label={view === 'day' ? 'Previous day' : 'Previous week'}
          onClick={() => go(-1)}
        >
          <Icon name="chevronRight" size={12} className="rotate-180" />
        </Button>
        <Button size="sm" className="max-md:hidden" onClick={() => go(0)}>
          Today
        </Button>
        <Button
          size="sm"
          className="max-md:hidden"
          aria-label={view === 'day' ? 'Next day' : 'Next week'}
          onClick={() => go(1)}
        >
          <Icon name="chevronRight" size={12} />
        </Button>
        <div
          role="group"
          aria-label="View"
          className="ml-2 flex gap-1 max-md:hidden"
        >
          <Button
            size="sm"
            variant={view === 'day' ? 'secondary' : 'quiet'}
            aria-pressed={view === 'day'}
            onClick={() => setView('day')}
          >
            Day
          </Button>
          <Button
            size="sm"
            variant={view === 'week' ? 'secondary' : 'quiet'}
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            Week
          </Button>
        </div>
        <BookDialog
          instruments={instruments}
          defaultDate={view === 'day' ? anchor : addDays(today, 3)}
          onBooked={(b) => {
            setAdded((a) => [...a, b])
            toast('Booked')
          }}
        />
      </div>

      <PhoneDay
        day={view === 'day' ? anchor : today}
        instruments={instruments}
        bookings={bookings}
      />
      {view === 'day' ? (
        <DayGrid day={anchor} instruments={instruments} bookings={bookings} />
      ) : (
        <WeekGrid
          start={weekStart}
          instruments={instruments}
          bookings={bookings}
          onDay={(x) => {
            setView('day')
            setAnchor(x)
          }}
          today={today}
        />
      )}

      {bookings.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          Nothing booked on these instruments yet. Weekend access needs a
          supervisor-approved booking.
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
        />
      )}
    </div>
  )
}

function DayGrid({
  day,
  instruments,
  bookings,
}: {
  day: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
}) {
  const hours = Array.from(
    { length: 10 },
    (_, i) => `${String(8 + i).padStart(2, '0')}:00`,
  )
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
                style={{ left: `calc(${pct(h)}% + 4px)` }}
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
                {ins.name}
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
                    style={{ left: `${pct(h)}%` }}
                  />
                ))}
                {bookings
                  .filter((b) => b.resourceId === ins.id && b.date === day)
                  .map((b) => (
                    <div
                      key={b.id}
                      role="listitem"
                      title={`${b.start}–${b.end} · ${b.mine ? 'you' : b.who} · ${b.title}`}
                      className={cn(
                        'absolute top-1 flex h-7 items-center truncate rounded-sm border px-1.5 text-label',
                        b.mine
                          ? 'border-link bg-selection text-fg'
                          : 'border-border bg-surface-muted text-fg-muted',
                      )}
                      style={{
                        left: `calc(${pct(b.start)}% + 1px)`,
                        width: `calc(${pct(b.end) - pct(b.start)}% - 2px)`,
                      }}
                    >
                      <span className="sr-only">
                        {b.start}–{b.end}{' '}
                      </span>
                      {b.mine ? '' : `${b.who} · `}
                      {b.title}
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
                Weekend access needs a supervisor-approved booking.
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
  onDay,
  today,
}: {
  start: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
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
                <div className="flex h-9 items-center">{ins.name}</div>
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
                        <li
                          key={b.id}
                          title={`${b.start}–${b.end} · ${b.mine ? 'you' : b.who} · ${b.title}`}
                          className={cn(
                            'truncate rounded-sm border px-1 leading-[18px]',
                            b.mine
                              ? 'border-link bg-selection text-fg'
                              : 'border-border bg-surface-muted text-fg-muted',
                          )}
                        >
                          {b.start} {b.mine ? '' : `${b.who} · `}
                          {b.title}
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
}: {
  day: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
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
          {list.map((b) => (
            <li
              key={b.id}
              className="grid min-h-14 grid-cols-[64px_1fr] gap-3 border-b border-border-subtle px-4 py-2.5"
            >
              <span className="num text-body">
                {b.start}
                <span className="block text-label text-fg-muted">{b.end}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium">{b.title}</span>
                <span className="block text-label text-fg-muted">
                  {instruments.find((i) => i.id === b.resourceId)?.name ?? '—'}
                  {' · '}
                  {b.mine ? 'you' : b.who}
                </span>
              </span>
            </li>
          ))}
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
}: {
  reviews: {
    id: string
    title: string
    recordId: string | null
    due: string
    urgent: boolean
  }[]
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
        </div>
        <Muted>
          Material availability arrives with the materials capability.
        </Muted>
      </section>
    </div>
  )
}

function BookDialog({
  instruments,
  defaultDate,
  onBooked,
}: {
  instruments: ScheduleInstrument[]
  defaultDate: string
  onBooked: (b: ScheduleBooking) => void
}) {
  const { context } = Route.useRouteContext()
  const [open, setOpen] = useState(false)
  const [resourceId, setResourceId] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const wsId = context.workspace?.id
    if (!wsId) return
    if (!resourceId || !title.trim()) {
      setError('Choose an instrument and give the booking a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const b = await bookInstrument({
        workspaceId: wsId,
        resourceId,
        title: title.trim(),
        startsAt: `${date}T${start}:00.000Z`,
        endsAt: `${date}T${end}:00.000Z`,
        timezone: 'UTC',
      })
      onBooked(b)
      setOpen(false)
      setTitle('')
      setResourceId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the booking.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        className="ml-2 max-md:ml-0 max-md:h-11 max-md:w-full"
        onClick={() => setOpen(true)}
      >
        Book instrument
      </Button>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title="Book an instrument" />
        <DialogBody>
          <Field label="Instrument" required>
            <NativeSelect
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
            >
              <option value="">Choose…</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="What" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <Input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="To" required>
              <Input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? 'Booking…' : 'Book'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
