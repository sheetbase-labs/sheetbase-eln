import { formatDate } from '#/lib/format-date'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'

import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Dot } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { EmptyState } from '#/components/ui/empty-state'
import { Muted } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { Icon } from '#/components/icons'
import { toast } from '#/components/ui/sonner'
import { BookDialog } from '#/components/schedule/book-dialog'
import { SubscribeDialog } from '#/components/schedule/subscribe-dialog'
import { EditBookingDialog } from '#/components/schedule/edit-booking-dialog'
import {
  useBookingSamples,
  useExperimentSamples,
  useRangeBookings,
  useScheduleInstruments,
} from '#/components/schedule/schedule-data'
import type {
  BookableSample,
  BookingSample,
  ScheduleBooking,
  ScheduleInstrument,
} from '#/components/schedule/schedule-data'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { useWorkItems } from '#/lib/work-items/data'
import { homeIsoDay } from '#/lib/home-quiet'
import { cancelBooking, describeCalendarError } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchPartsInRange, partQueryKeys } from '#/lib/experiment-parts'
import type { DuePart } from '#/lib/experiment-parts'
import { describeRepeatResult } from '#/lib/recurring'
import type { RepeatResult } from '#/lib/recurring'
import { RepeatingDialog } from '#/components/recurring/repeating-dialog'
import { isUuid } from '#/lib/identifier-resolution'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import { cn } from '#/lib/utils'
import { now as appNow } from '#/lib/clock'
import { dateTimeFormat } from '#/lib/intl-cache'
import { t } from '#/copy'

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

const toMin = (time: string) => {
  const [h, m] = time.split(':').map(Number)

  return h * 60 + m
}

/** The core hours the day grid draws; it widens to cover the day's bookings. */
const DAY_START = 8 * 60
const DAY_END = 18 * 60

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
      <span className="truncate" title={instrument.name}>
        {instrument.name}
      </span>
      {instrument.outOfService ? (
        <span className="shrink-0 text-label text-warning-text">
          {t('library.instruments.outOfService.status')}
        </span>
      ) : null}
    </Link>
  )
}

const Route = getRouteApi('/schedule')

/**
 * The schedule's reads, its own screen state and its handlers, so the component
 * below renders one surface from one object.
 */
function useScheduleScreen({
  book,
  experiment,
  returnTo,
}: {
  book: string | undefined
  experiment: string | undefined
  returnTo: string | undefined
}) {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate()

  const forExperiment = useQuery({
    queryKey: ['ui-port', 'schedule-experiment', experiment ?? ''],
    queryFn: async () => {
      const filter = isUuid(experiment ?? '')
        ? `id=eq.${experiment}`
        : `identifier=eq.${encodeURIComponent(experiment ?? '')}`

      const rows = await notebookDataClient.list<{
        id: string
        identifier: string
        title: string
        project_id: string | null
      }>(
        'records',
        `?${filter}&kind=eq.experiment&select=id,identifier,title,project_id&limit=1`,
      )

      return rows.at(0) ?? null
    },
    enabled: Boolean(experiment),
  })

  const experimentSamples = useExperimentSamples(forExperiment.data?.id)

  const bookingTitle = forExperiment.data
    ? `${forExperiment.data.identifier} ${forExperiment.data.title}`
    : undefined

  const workspaceId = context.workspace?.id

  // QA-022: a Schedule day is the workspace's day. Home groups the same
  // bookings by the workspace timezone, so "today" comes from that clock rather
  // than the UTC calendar day, which can be a day ahead or behind.
  const workspaceQuery = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
    enabled: Boolean(workspaceId),
  })

  const timeZone = useDisplayTimeZone(workspaceQuery.data?.timezone)
  const today = useMemo(() => homeIsoDay(appNow(), timeZone), [timeZone])

  // Minutes past midnight in the workspace's zone, for the day view's now line.
  const nowMinute = useMemo(() => {
    const parts = dateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(appNow())

    const part = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0)

    return part('hour') * 60 + part('minute')
  }, [timeZone])

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
  // A booking saved from the edit dialog replaces the row the grid holds until
  // the range query reloads, so the grid never shows the old time.
  const [edited, setEdited] = useState<Map<string, ScheduleBooking>>(new Map())

  const weekStart = view === 'day' ? anchor : monday(anchor)
  const weekEnd = addDays(weekStart, 7)

  // QA-023: on a phone the day list is the only schedule surface, so it follows
  // the navigated anchor instead of being pinned to today: the anchor day in Day
  // view, today while the viewed week contains it, otherwise the week's first
  // day — so stepping the week changes what a phone shows.
  const phoneDay = phoneDayFor({ view, anchor, today, weekStart, weekEnd })

  const rangeFrom = weekStart
  const rangeTo = addDays(weekStart, view === 'day' ? 1 : 7)
  const instrumentsQuery = useScheduleInstruments(workspaceId)

  const bookingsQuery = useRangeBookings(
    workspaceId,
    `${rangeFrom}T00:00:00.000Z`,
    `${rangeTo}T00:00:00.000Z`,
  )

  const instruments: ScheduleInstrument[] = instrumentsQuery.data ?? []
  const instrumentNames = new Map(instruments.map((i) => [i.id, i.name]))
  const membersQuery = useWorkspaceMemberNames()
  const meId = context.user.id
  const memberNames = membersQuery.data
  // A booking made here is shown at once and then arrives from the refetch
  // too: keep one of them.
  const fetched = bookingsQuery.data ?? []
  const fetchedIds = new Set(fetched.map((b) => b.id))

  const bookings = visibleBookings({
    fetched,
    added,
    fetchedIds,
    cancelledIds,
    edited,
    meId,
    memberNames,
  })

  const mineCount = bookings.filter((b) => b.mine).length

  const bookingSamples = useBookingSamples(
    bookings.flatMap((b) => (b.date === today ? [b.id] : [])),
  )

  const partsDue = useQuery({
    queryKey: partQueryKeys.inRange(rangeFrom, rangeTo),
    queryFn: () => fetchPartsInRange(notebookDataClient, rangeFrom, rangeTo),
  })

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

  const selectedBookingSamples = useBookingSamples(
    selectedBooking ? [selectedBooking.id] : [],
  )

  const selectedExperimentSamples = useExperimentSamples(
    selectedBooking?.experiment?.id,
  )

  const selectedInstrument = selectedBooking
    ? instruments.find((i) => i.id === selectedBooking.resourceId)
    : undefined

  const openBooking = (id: string) => {
    setOpenBookingId(id)
    setCancelError(null)
  }

  const cancelSelected = async () => {
    if (!selectedBooking) return

    setCancelling(true)
    setCancelError(null)

    const outcome = await cancelBookingAndReport(selectedBooking.id)

    setCancelling(false)

    if (outcome.cancelled) {
      setCancelledIds((prev) => new Set(prev).add(selectedBooking.id))
      setAdded((items) => items.filter((b) => b.id !== selectedBooking.id))
      void queryClient.invalidateQueries({ queryKey: ['schedule', 'bookings'] })
      toast(t('projects.schedulePage.cancelled'))
      setOpenBookingId(null)

      return
    }

    setCancelError(outcome.error)
  }

  const instrumentsUsed = new Set(bookings.map((b) => b.resourceId)).size

  const subtitle = scheduleSubtitle({
    view,
    anchor,
    weekStart,
    mineCount,
    instrumentsUsed,
  })

  return {
    context,
    book,
    experiment,
    returnTo,
    navigate,
    queryClient,
    forExperiment,
    experimentSamples,
    bookingTitle,
    workspaceId,
    today,
    nowMinute,
    view,
    setView,
    anchor,
    setAnchor,
    bookings,
    instrumentNames,
    instruments: instrumentsQuery.data ?? [],
    partsDue,
    reviews,
    bookingSamples,
    phoneDay,
    weekStart,
    go,
    subtitle,
    openBooking,
    selectedBooking,
    selectedInstrument,
    selectedBookingSamples,
    selectedExperimentSamples,
    cancelError,
    cancelling,
    setOpenBookingId,
    setCancelError,
    cancelSelected,
    setEdited,
    setAdded,
    toast,
    instrumentsLoaded: instrumentsQuery.isSuccess,
  }
}

export function Schedule() {
  const { book, experiment, returnTo } = Route.useSearch()
  const screen = useScheduleScreen({ book, experiment, returnTo })

  return (
    <div className="relative flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 pb-6 pt-[18px] md:px-6">
      <ScheduleToolbar
        subtitle={screen.subtitle}
        view={screen.view}
        onView={screen.setView}
        onGo={screen.go}
        instruments={screen.instruments}
        instrumentNames={screen.instrumentNames}
        workspaceId={screen.workspaceId}
        anchor={screen.anchor}
        today={screen.today}
        bookedResourceId={screen.book}
        experiment={screen.experiment}
        experimentRecord={screen.forExperiment.data ?? null}
        experimentSamples={screen.experimentSamples.data}
        bookingTitle={screen.bookingTitle}
        onBooked={(b) => {
          screen.setAdded((a) => [...a, b])
          void screen.queryClient.invalidateQueries({ queryKey: ['schedule'] })
          screen.toast(t('projects.schedulePage.booked'))

          if (screen.returnTo) void screen.navigate({ to: screen.returnTo })
        }}
        onRepeated={({ result }) => {
          void screen.queryClient.invalidateQueries({ queryKey: ['schedule'] })
          void screen.queryClient.invalidateQueries({ queryKey: ['recurring'] })
          screen.toast(describeRepeatResult('booking', result))
        }}
        onCancel={() => {
          if (screen.returnTo) void screen.navigate({ to: screen.returnTo })
        }}
      />

      <ScheduleBody
        instruments={screen.instruments}
        instrumentsLoaded={screen.instrumentsLoaded}
        bookings={screen.bookings}
        view={screen.view}
        anchor={screen.anchor}
        phoneDay={screen.phoneDay}
        today={screen.today}
        nowMinute={screen.nowMinute}
        weekStart={screen.weekStart}
        onSelect={screen.openBooking}
        onDay={(day) => {
          screen.setView('day')
          screen.setAnchor(day)
        }}
        parts={screen.partsDue.data ?? []}
        reviews={screen.reviews.map((r) => ({
          id: r.identifier ?? '—',
          title: r.title,
          recordId: r.recordId,
          due: formatDate(r.dueAt),
          urgent: r.state === 'overdue',
        }))}
        materials={screen.bookingSamples.data ?? []}
      />

      <BookingDetailsDialog
        booking={screen.selectedBooking}
        instrument={screen.selectedInstrument}
        bookingSamples={screen.selectedBookingSamples.data ?? []}
        experimentSamples={screen.selectedExperimentSamples.data ?? []}
        cancelError={screen.cancelError}
        cancelling={screen.cancelling}
        onClose={() => {
          screen.setOpenBookingId(null)
          screen.setCancelError(null)
        }}
        onCancel={() => void screen.cancelSelected()}
        onSaved={(saved) => {
          screen.setEdited((current) => new Map(current).set(saved.id, saved))
          void screen.queryClient.invalidateQueries({ queryKey: ['schedule'] })
          screen.toast(t('projects.schedulePage.updated'))
        }}
      />
    </div>
  )
}

/** Cancel a booking and say whether it went, with the server's reason if not. */
async function cancelBookingAndReport(
  bookingId: string,
): Promise<{ cancelled: true } | { cancelled: false; error: string }> {
  try {
    await cancelBooking(notebookDataClient, { bookingId })

    return { cancelled: true }
  } catch (error) {
    // The server owns whether this booking may be cancelled; show its reason
    // (already cancelled, not found, someone else's) rather than guessing.
    return { cancelled: false, error: describeCalendarError(error) }
  }
}

/** The bookings the grid shows: saved here, cancelled here, edited here, named. */
function visibleBookings({
  fetched,
  added,
  fetchedIds,
  cancelledIds,
  edited,
  meId,
  memberNames,
}: {
  fetched: ScheduleBooking[]
  added: ScheduleBooking[]
  fetchedIds: Set<string>
  cancelledIds: Set<string>
  edited: Map<string, ScheduleBooking>
  meId: string
  memberNames: Map<string, string> | undefined
}): ScheduleBooking[] {
  const colleague = t('projects.schedulePage.colleague')

  return [...fetched, ...added.filter((b) => !fetchedIds.has(b.id))]
    .flatMap((b) => (cancelledIds.has(b.id) ? [] : [edited.get(b.id) ?? b]))
    .map((b) => ({
      ...b,
      mine: Boolean(meId && b.createdByUserId === meId),
      who: b.createdByUserId
        ? (memberNames?.get(b.createdByUserId) ?? colleague)
        : colleague,
    }))
}

/** What the heading says under "Schedule": the period, then what it holds. */
function scheduleSubtitle({
  view,
  anchor,
  weekStart,
  mineCount,
  instrumentsUsed,
}: {
  view: 'week' | 'day'
  anchor: string
  weekStart: string
  mineCount: number
  instrumentsUsed: number
}): string {
  const tail =
    (mineCount
      ? t('projects.schedulePage.mine', { count: mineCount })
      : t('projects.schedulePage.noneMine')) +
    (instrumentsUsed
      ? t('projects.schedulePage.instrumentsUsed', { count: instrumentsUsed })
      : '')

  if (view === 'day')
    return `${fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long' })}${tail}`

  return (
    t('projects.schedulePage.weekOf', {
      date: fmt(weekStart, { day: 'numeric', month: 'long' }),
    }) + tail
  )
}

/**
 * QA-023: on a phone the day list is the only schedule surface, so it follows
 * the navigated anchor instead of being pinned to today: the anchor day in Day
 * view, today while the viewed week contains it, otherwise the week's first day
 * — so stepping the week changes what a phone shows.
 */
function phoneDayFor({
  view,
  anchor,
  today,
  weekStart,
  weekEnd,
}: {
  view: 'week' | 'day'
  anchor: string
  today: string
  weekStart: string
  weekEnd: string
}): string {
  if (view === 'day') return anchor

  return today >= weekStart && today < weekEnd ? today : weekStart
}

/** The schedule's own surface: the empty state, the grids, and what is due. */
function ScheduleBody({
  instruments,
  instrumentsLoaded,
  bookings,
  view,
  anchor,
  phoneDay,
  today,
  nowMinute,
  weekStart,
  onSelect,
  onDay,
  parts,
  reviews,
  materials,
}: {
  instruments: ScheduleInstrument[]
  instrumentsLoaded: boolean
  bookings: ScheduleBooking[]
  view: 'week' | 'day'
  anchor: string
  phoneDay: string
  today: string
  nowMinute: number
  weekStart: string
  onSelect: (id: string) => void
  onDay: (day: string) => void
  parts: Awaited<ReturnType<typeof fetchPartsInRange>>
  reviews: React.ComponentProps<typeof Below>['reviews']
  materials: React.ComponentProps<typeof Below>['materials']
}) {
  return (
    <>
      {instrumentsLoaded && instruments.length === 0 ? (
        <EmptyState
          icon="flask"
          title={t('projects.schedulePage.noInstruments.title')}
          description={t('projects.schedulePage.noInstruments.body')}
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/instruments" />}
            >
              {t('projects.schedulePage.noInstruments.open')}
            </Button>
          }
        />
      ) : (
        <>
          <PhoneDay
            day={phoneDay}
            instruments={instruments}
            bookings={bookings}
            onSelect={onSelect}
          />
          {view === 'day' ? (
            <DayGrid
              day={anchor}
              instruments={instruments}
              bookings={bookings}
              onSelect={onSelect}
              nowMinute={anchor === today ? nowMinute : null}
            />
          ) : (
            <WeekGrid
              start={weekStart}
              instruments={instruments}
              bookings={bookings}
              onSelect={onSelect}
              onDay={onDay}
              today={today}
            />
          )}
        </>
      )}

      <PartsDue parts={parts} today={today} />

      {bookings.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('projects.schedulePage.nothingBooked')}
        </p>
      ) : (
        <Below reviews={reviews} materials={materials} />
      )}
    </>
  )
}

/** The schedule's heading, day and week navigation, and the booking dialogs. */
function ScheduleToolbar({
  subtitle,
  view,
  onView,
  onGo,
  instruments,
  instrumentNames,
  workspaceId,
  anchor,
  today,
  bookedResourceId,
  experiment,
  experimentRecord,
  experimentSamples,
  bookingTitle,
  onBooked,
  onRepeated,
  onCancel,
}: {
  subtitle: string
  view: 'week' | 'day'
  onView: (view: 'week' | 'day') => void
  onGo: (direction: -1 | 0 | 1) => void
  instruments: ScheduleInstrument[]
  instrumentNames: Map<string, string>
  workspaceId: string | undefined
  anchor: string
  today: string
  bookedResourceId: string | undefined
  experiment: string | undefined
  experimentRecord: {
    id: string
    identifier: string
    title: string
    project_id: string | null
  } | null
  experimentSamples: BookableSample[] | undefined
  bookingTitle: string | undefined
  onBooked: (booking: ScheduleBooking) => void
  onRepeated: (event: { result: RepeatResult }) => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex-1 max-md:basis-full">
        <h1 className="text-title">{t('projects.schedulePage.title')}</h1>
        <div className="mt-0.5 text-body text-fg-muted">{subtitle}</div>
      </div>
      <Button
        size="sm"
        aria-label={
          view === 'day'
            ? t('projects.schedulePage.previousDay')
            : t('projects.schedulePage.previousWeek')
        }
        onClick={() => onGo(-1)}
      >
        <Icon name="chevronRight" size={12} className="rotate-180" />
      </Button>
      <Button size="sm" onClick={() => onGo(0)}>
        {t('projects.schedulePage.today')}
      </Button>
      <Button
        size="sm"
        aria-label={
          view === 'day'
            ? t('projects.schedulePage.nextDay')
            : t('projects.schedulePage.nextWeek')
        }
        onClick={() => onGo(1)}
      >
        <Icon name="chevronRight" size={12} />
      </Button>
      <Tabs
        mode="state"
        variant="segment"
        label={t('projects.schedulePage.view')}
        value={view}
        onValueChange={(next) => {
          if (next === 'day' || next === 'week') onView(next)
        }}
        className="ml-2"
        items={[
          { key: 'day', label: t('projects.schedulePage.day') },
          { key: 'week', label: t('projects.schedulePage.week') },
        ]}
      />
      <SubscribeDialog instruments={instruments} />
      <RepeatingDialog
        kind="booking"
        workspaceId={workspaceId}
        names={instrumentNames}
      />
      <BookDialog
        instruments={instruments}
        workspaceId={workspaceId}
        defaultDate={view === 'day' ? anchor : addDays(today, 3)}
        defaultResourceId={bookedResourceId}
        defaultOpen={Boolean(bookedResourceId) || Boolean(experiment)}
        defaultTitle={bookingTitle}
        experiment={
          experimentRecord
            ? {
                ...experimentRecord,
                projectId: experimentRecord.project_id,
              }
            : undefined
        }
        sampleOptions={experimentSamples}
        onCancel={onCancel}
        onRepeated={onRepeated}
        onBooked={onBooked}
      />
    </div>
  )
}

/** What one booking says about itself: who, when, where and with what. */
function BookingFacts({
  booking,
  instrument,
  bookingSamples,
}: {
  booking: ScheduleBooking
  instrument: ScheduleInstrument | undefined
  bookingSamples: BookingSample[]
}) {
  return (
    <dl className="m-0 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1.5 text-body">
      <dt className="text-fg-muted">{t('projects.bookDialog.instrument')}</dt>
      <dd className="m-0">
        {instrument
          ? `${instrument.displayId ? `${instrument.displayId} · ` : ''}${instrument.name}`
          : '—'}
      </dd>
      <dt className="text-fg-muted">{t('projects.bookDialog.date')}</dt>
      <dd className="m-0">
        {fmt(booking.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </dd>
      <dt className="text-fg-muted">{t('projects.schedulePage.time')}</dt>
      <dd className="num m-0">
        {booking.start}–{booking.end} ({booking.timezone})
      </dd>
      <dt className="text-fg-muted">{t('projects.schedulePage.bookedBy')}</dt>
      <dd className="m-0">
        {booking.mine ? t('projects.schedulePage.you') : booking.who}
      </dd>
      {booking.experiment ? (
        <>
          <dt className="text-fg-muted">
            {t('projects.schedulePage.experiment')}
          </dt>
          <dd className="m-0">
            <ObjectLink
              kind="experiment"
              id={booking.experiment.id}
              identifier={booking.experiment.identifier}
            />{' '}
            {booking.experiment.title}
          </dd>
        </>
      ) : null}
      {bookingSamples.length ? (
        <>
          <dt className="text-fg-muted">
            {t('projects.schedulePage.samples')}
          </dt>
          <dd className="m-0 flex flex-col gap-0.5">
            {bookingSamples.map((sample) => (
              <span key={sample.id}>
                <ObjectLink
                  kind="sample"
                  id={sample.sampleRecordId}
                  identifier={sample.identifier}
                />{' '}
                {sample.title}
              </span>
            ))}
          </dd>
        </>
      ) : null}
      {booking.notes ? (
        <>
          <dt className="text-fg-muted">{t('projects.editBooking.notes')}</dt>
          <dd className="m-0">{booking.notes}</dd>
        </>
      ) : null}
    </dl>
  )
}

/** One booking's details, with its edit form and the way to cancel it. */
function BookingDetailsDialog({
  booking,
  instrument,
  bookingSamples,
  experimentSamples,
  cancelError,
  cancelling,
  onClose,
  onCancel,
  onSaved,
}: {
  booking: ScheduleBooking | null
  instrument: ScheduleInstrument | undefined
  bookingSamples: BookingSample[]
  experimentSamples: BookableSample[]
  cancelError: string | null
  cancelling: boolean
  onClose: () => void
  onCancel: () => void
  onSaved: (saved: ScheduleBooking) => void
}) {
  const [editing, setEditing] = useState(false)

  return (
    <>
      <Dialog
        open={Boolean(booking)}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader
            title={t('projects.schedulePage.booking')}
            description={booking?.title}
          />
          <DialogBody>
            {booking ? (
              <BookingFacts
                booking={booking}
                instrument={instrument}
                bookingSamples={bookingSamples}
              />
            ) : null}
            {cancelError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {cancelError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('projects.schedulePage.keep')}
            </DialogClose>
            <Button onClick={() => setEditing(true)}>
              {t('projects.schedulePage.edit')}
            </Button>
            <Button
              variant="danger-fill"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling
                ? t('projects.schedulePage.cancelling')
                : t('projects.schedulePage.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editing && booking ? (
        <EditBookingDialog
          booking={booking}
          sampleOptions={mergeSamples(experimentSamples, bookingSamples)}
          currentSampleIds={bookingSamples.flatMap((s) =>
            s.sampleRecordId ? [s.sampleRecordId] : [],
          )}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            onSaved(saved)
            setEditing(false)
          }}
        />
      ) : null}
    </>
  )
}

/** The experiment's samples plus any the booking already names, once each. */
function mergeSamples(
  fromExperiment: BookableSample[],
  onBooking: BookingSample[],
): BookableSample[] {
  const byId = new Map(fromExperiment.map((s) => [s.id, s]))

  for (const sample of onBooking) {
    if (sample.sampleRecordId && !byId.has(sample.sampleRecordId))
      byId.set(sample.sampleRecordId, {
        id: sample.sampleRecordId,
        identifier: sample.identifier,
        title: sample.title,
      })
  }

  return [...byId.values()]
}

/**
 * QA-024: the grid's hour window. 08:00–18:00 by default, widened to whole
 * hours that cover every booking on the day, so a booking the dialog allowed
 * outside core hours is still drawn where it belongs instead of being clipped
 * to a negative offset or a >100% width.
 */
/** The part of the day one instrument's lane covers, in minutes past midnight. */
interface DayWindow {
  start: number
  end: number
}

function dayWindow(dayBookings: ScheduleBooking[]): DayWindow {
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
  nowMinute = null,
}: {
  day: string
  instruments: ScheduleInstrument[]
  bookings: ScheduleBooking[]
  onSelect: (id: string) => void
  /** Minutes past midnight now, when the day shown is today. */
  nowMinute?: number | null
}) {
  const dayBookings = bookings.filter((b) => b.date === day)
  const bounds = dayWindow(dayBookings)
  const span = bounds.end - bounds.start
  const position = (time: string) => ((toMin(time) - bounds.start) / span) * 100

  const hours = Array.from({ length: span / 60 }, (_, i) => {
    const hour = bounds.start + i * 60

    return `${String(hour / 60).padStart(2, '0')}:00`
  })

  // Any empty day gets the note; weekends are bookable like every other day.
  const closed = dayBookings.length === 0

  return (
    <section
      aria-label={t('projects.schedulePage.grid')}
      className="overflow-x-auto rounded-md border border-border max-md:hidden"
    >
      <div className="relative min-w-[780px]">
        <div className="grid grid-cols-[240px_1fr]">
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
                  'flex h-12 items-center px-2.5 text-body font-medium',
                  r < instruments.length - 1 && 'border-b border-border-subtle',
                )}
              >
                <InstrumentLabel instrument={ins} />
              </div>
              <ul
                className={cn(
                  'relative m-0 h-12 list-none p-0',
                  r < instruments.length - 1 && 'border-b border-border-subtle',
                )}
                aria-label={ins.name}
              >
                <li aria-hidden="true" className="contents">
                  {hours.map((h) => (
                    <span
                      key={h}
                      className="absolute inset-y-0 w-px bg-border-subtle"
                      style={{ left: `${position(h)}%` }}
                    />
                  ))}
                </li>
                {dayBookings
                  .filter((b) => b.resourceId === ins.id)
                  .map((b) => (
                    <li
                      key={b.id}
                      className="absolute inset-y-1"
                      style={{
                        left: `calc(${position(b.start)}% + 1px)`,
                        width: `calc(${position(b.end) - position(b.start)}% - 2px)`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(b.id)}
                        title={t('projects.schedulePage.bookingTitle', {
                          start: b.start,
                          end: b.end,
                          who: b.mine
                            ? t('projects.schedulePage.youLower')
                            : (b.who ?? ''),
                          title: b.title,
                        })}
                        className={cn(
                          'flex h-full w-full cursor-pointer flex-col justify-center overflow-hidden rounded-sm border px-1.5 text-left text-label leading-[15px]',
                          b.mine
                            ? 'border-link bg-selection text-fg'
                            : 'border-border bg-surface-muted text-fg-muted',
                        )}
                      >
                        <span className="block truncate font-medium">
                          {b.title}
                        </span>
                        <span className="num block truncate text-[11px] text-fg-muted">
                          {b.start}–{b.end} ·{' '}
                          {b.mine ? t('projects.schedulePage.you') : b.who}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
        {nowMinute !== null &&
        nowMinute >= bounds.start &&
        nowMinute <= bounds.end ? (
          // Where today has got to, across every instrument.
          <div
            aria-hidden="true"
            data-testid="schedule-now"
            className="pointer-events-none absolute bottom-0 left-[240px] right-0 top-0"
          >
            <div
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-danger-text"
              style={{
                left: `${((nowMinute - bounds.start) / span) * 100}%`,
              }}
            >
              <span className="absolute -left-1 top-0 size-2.5 -translate-x-px rounded-full bg-danger-text" />
            </div>
          </div>
        ) : null}
        {closed ? (
          <div
            className={cn(
              'absolute bottom-0 left-[240px] right-0 top-6 flex items-center justify-center',
            )}
          >
            <div className="rounded-md border border-border bg-surface px-3.5 py-2.5 text-center">
              <div className="font-medium">
                {t('projects.schedulePage.noBookingsOn', {
                  day: fmt(day, { weekday: 'long' }),
                })}
              </div>
              <div className="mt-0.5 text-label text-fg-muted">
                {t('projects.schedulePage.tentative')}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Saturday or Sunday, for an ISO day. */
function isWeekend(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()

  return weekday === 0 || weekday === 6
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
      aria-label={t('projects.schedulePage.grid')}
      className="overflow-x-auto rounded-md border border-border max-md:hidden"
    >
      <table className="num w-full table-fixed border-collapse text-label">
        <thead>
          <tr>
            <th
              scope="col"
              className="w-[240px] border-b border-border bg-surface-muted"
            >
              <span className="sr-only">
                {t('projects.bookDialog.instrument')}
              </span>
            </th>
            {days.map((x) => (
              <th
                key={x}
                scope="col"
                className={cn(
                  'h-7 border-b border-l border-border bg-surface-muted px-2 text-left font-medium text-fg-muted',
                  x === today && 'bg-selection text-fg',
                )}
              >
                <button
                  type="button"
                  onClick={() => onDay(x)}
                  className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-link"
                  aria-label={t('projects.schedulePage.openDay', {
                    day: fmt(x, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    }),
                  })}
                >
                  {fmt(x, { weekday: 'short', day: 'numeric' })}
                  {x === today ? (
                    <span className="ml-1.5 rounded-[3px] bg-inverse px-1 text-[10px] font-semibold text-inverse-foreground">
                      {t('projects.schedulePage.today')}
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

                const weekend = isWeekend(x)

                return (
                  <td
                    key={x}
                    className={cn(
                      'h-[52px] min-w-[132px] border-l border-border-subtle p-1 align-top',
                      r < instruments.length - 1 && 'border-b',
                      // Today stands out; days gone by and weekends recede.
                      x === today
                        ? 'bg-selection/40'
                        : x < today || weekend
                          ? 'bg-surface-muted'
                          : undefined,
                    )}
                  >
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {list.map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(b.id)}
                            title={t('projects.schedulePage.bookingTitle', {
                              start: b.start,
                              end: b.end,
                              who: b.mine
                                ? t('projects.schedulePage.youLower')
                                : (b.who ?? ''),
                              title: b.title,
                            })}
                            className={cn(
                              'block w-full cursor-pointer rounded-sm border px-1.5 py-1 text-left leading-[16px]',
                              b.mine
                                ? 'border-link bg-selection text-fg'
                                : 'border-border bg-surface-muted text-fg-muted',
                              x < today && 'opacity-70',
                            )}
                          >
                            <span className="num block text-[11px] text-fg-muted">
                              {b.start}–{b.end}
                            </span>
                            <span className="line-clamp-2 break-words font-medium">
                              {b.title}
                            </span>
                            <span className="block truncate text-[11px] text-fg-muted">
                              {b.mine ? t('projects.schedulePage.you') : b.who}
                            </span>
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
      aria-label={t('projects.schedulePage.bookingsOn', {
        day: fmt(day, { weekday: 'long', day: 'numeric', month: 'long' }),
      })}
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
                  {/* The instrument name gives way on a narrow screen; the
                      person's name stays on one line. */}
                  <span className="flex min-w-0 items-center gap-1.5 text-label text-fg-muted">
                    {instrument ? (
                      <InstrumentLabel instrument={instrument} />
                    ) : (
                      <span>—</span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 whitespace-nowrap">
                      {b.mine ? t('projects.schedulePage.youLower') : b.who}
                    </span>
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => onSelect(b.id)}
                  aria-label={t('projects.schedulePage.cancelOrView', {
                    title: b.title,
                  })}
                >
                  {/* The button opens the booking. For your own booking that
                      is usually to cancel it; for anyone else's it is to look
                      at it (the dialog still offers Cancel where the server
                      allows it). */}
                  {b.mine
                    ? t('common.actions.cancel')
                    : t('common.actions.view')}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center" role="status">
          <div className="font-medium">
            {t('projects.schedulePage.noBookingsOn', {
              day: fmt(day, { weekday: 'long' }),
            })}
          </div>
        </div>
      )}
    </section>
  )
}

/** The parts of running experiments that fall in the days shown, with a link to each. */
function PartsDue({
  parts,
  today,
}: {
  parts: readonly DuePart[]
  today: string
}) {
  if (parts.length === 0) return null

  return (
    <section data-testid="schedule-parts">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-body">{t('projects.schedulePage.partsDue')}</h2>
        <span className="num text-body text-fg-muted">{parts.length}</span>
      </div>
      {parts.map((part, i) => (
        <div
          key={part.partId}
          className={cn(
            'grid grid-cols-[88px_1fr_auto] items-center gap-2 py-2 text-body',
            i < parts.length - 1 && 'border-b border-border-subtle',
          )}
        >
          <span className="num text-fg-muted">
            {fmt(part.dueOn, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <Link
            to="/experiments/$expId/notebook/$part"
            params={{ expId: part.recordId, part: String(part.number) }}
          >
            {t('notebook.parts.partTitle', {
              number: String(part.number),
              title: part.title,
            })}
            <span className="text-fg-muted"> · {part.identifier}</span>
          </Link>
          <span
            className={
              part.status !== 'done' && part.dueOn < today
                ? 'text-danger-text'
                : 'text-fg-muted'
            }
          >
            {part.status === 'done'
              ? t('notebook.parts.stateDone')
              : part.dueOn < today
                ? t('notebook.parts.late')
                : part.status === 'now'
                  ? t('notebook.parts.stateNow')
                  : t('notebook.parts.stateLater')}
          </span>
        </div>
      ))}
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
          <h2 className="text-body">{t('projects.schedulePage.reviewsDue')}</h2>
          <span className="num text-body text-fg-muted">{reviews.length}</span>
          <Link to="/inbox" className="ml-auto text-label">
            {t('projects.schedulePage.inbox')}
          </Link>
        </div>
        {reviews.length ? (
          reviews.map((r, i) => (
            <div
              key={r.id}
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
              {r.due && r.due !== '—' ? (
                <span
                  className={
                    r.urgent ? 'text-danger-text' : 'num text-fg-muted'
                  }
                >
                  {r.due}
                </span>
              ) : (
                <span />
              )}
            </div>
          ))
        ) : (
          <Muted>{t('projects.schedulePage.nothingDue')}</Muted>
        )}
      </section>
      <section>
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-body">{t('projects.schedulePage.materials')}</h2>
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
          <Muted>{t('projects.schedulePage.noMaterials')}</Muted>
        )}
      </section>
    </div>
  )
}
