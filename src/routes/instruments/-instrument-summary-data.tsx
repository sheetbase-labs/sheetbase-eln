import type { ReactNode } from 'react'

import { Status } from '#/components/ui/status'
import {
  AgentStatusLabel,
  AgentStatusLine,
} from '#/components/instruments/agent-download'
import {
  intakeHealth,
  intakeMethodLabel,
  intakeMethodNeedsParser,
  parserFollowUp,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentParserRow,
  InstrumentRunRow,
} from '#/components/instruments/instruments-data'
import type { QualificationRow } from './-instrument-columns'
import type { ConnectorWire } from '#/lib/connectors/types'
import type { Tone } from '#/components/ui/status'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/** How an instrument's health reads: a tone and the words for it. */
interface InstrumentStatus {
  tone: Tone
  label: string
}

/** The next booking, as one line: the time and title, or why there is none. */
export function nextBookingLabel({
  isSuccess,
  bookable,
  next,
}: {
  isSuccess: boolean
  bookable: boolean | undefined
  next: { startsAt: string; title: string } | null | undefined
}): string {
  if (!isSuccess) return '—'

  if (!bookable) return t('library.instruments.record.notBookable')

  if (!next) return 'None'

  return `${formatDate(next.startsAt, { time: true })} · ${next.title}`
}

/** The parser cell: the attached parser, the intake connector's, or why none. */
export function parserLabelOf({
  connector,
  intakeParsers,
  needsParser,
  parsers,
}: {
  connector: ConnectorWire | null
  intakeParsers: Array<{ key: string; name: string }> | undefined
  needsParser: boolean
  parsers: InstrumentParserRow[]
}): string {
  if (connector) {
    if (!connector.parser_id) {
      return t('library.instruments.intakeStatus.workItOut')
    }

    return (
      intakeParsers?.find((p) => p.key === connector.parser_id)?.name ?? '—'
    )
  }

  if (!needsParser) return t('library.instruments.record.notUsed')

  if (!parsers.length) return t('library.instruments.record.noParserAttached')

  return parsers
    .map(
      (parser) =>
        `${parser.name} · ${parser.validated ? 'validated' : 'not validated'}`,
    )
    .join(', ')
}

/** Whether this instrument needs a parser at all, from its intake method. */
export function needsParserOf(intakeMethod: string): boolean {
  return intakeMethodNeedsParser(intakeMethod)
}

/** The intake description list: method, health, last data, booking, parser. */
export function intakeItemsOf({
  intakeMethod,
  health,
  lastDataAt,
  nextBooking,
  parserLabel,
  connector,
}: {
  intakeMethod: string
  health: InstrumentStatus
  lastDataAt: string | null
  nextBooking: string
  parserLabel: string
  connector: ConnectorWire | null
}): Array<[ReactNode, ReactNode]> {
  const items: Array<[ReactNode, ReactNode]> = [
    ['Method', intakeMethodLabel(intakeMethod)],
    [
      'Health',
      <Status key="h" tone={health.tone}>
        {health.label}
      </Status>,
    ],
    [
      t('library.instruments.record.lastData'),
      lastDataAt
        ? formatDate(lastDataAt, { time: true })
        : t('library.instruments.record.nothingReceived'),
    ],
    [t('library.instruments.record.nextBooking'), nextBooking],
    ['Parser', parserLabel],
  ]

  if (connector) {
    items.push([
      <AgentStatusLabel key="al" />,
      <AgentStatusLine key="as" connectorId={connector.id} />,
    ])
  }

  return items
}

/** Every person the instrument record names, for one name read. */
export function instrumentUserIds({
  instrument,
  history,
  week,
  openRequests,
  calibrationRows,
  qualificationRows,
  members,
}: {
  instrument:
    | { ownerId?: string | null; createdByUserId?: string | null }
    | null
    | undefined
  history: Array<{ actorUserId: string | null }>
  week: Array<{ created_by_user_id: string | null }>
  openRequests: Array<{ user_id: string }>
  calibrationRows: Array<{ performedByUserId: string | null }>
  qualificationRows: Array<{ user_id: string }>
  members: Array<{ user_id: string }>
}): string[] {
  return [
    ...(instrument?.ownerId ? [instrument.ownerId] : []),
    ...(instrument?.createdByUserId ? [instrument.createdByUserId] : []),
    ...history.flatMap((c) => (c.actorUserId ? [c.actorUserId] : [])),
    ...week.flatMap((b) =>
      b.created_by_user_id ? [b.created_by_user_id] : [],
    ),
    ...openRequests.map((row) => row.user_id),
    ...calibrationRows.flatMap((c) =>
      c.performedByUserId ? [c.performedByUserId] : [],
    ),
    ...qualificationRows.map((row) => row.user_id),
    ...members.map((member) => member.user_id),
  ]
}

/**
 * How data reaches the instrument: its health, the last committed import, the
 * next booking, what a missing parser is waiting on, and the list that says so.
 */
export function instrumentIntake({
  instrumentId,
  intakeMethod,
  parsers,
  parsersSettled,
  connector,
  intakeParsers,
  lastImport,
  booking,
}: {
  instrumentId: string
  intakeMethod: string
  parsers: InstrumentParserRow[] | undefined
  parsersSettled: boolean
  connector: ConnectorWire | null
  intakeParsers: Array<{ key: string; name: string }> | undefined
  lastImport: { status: string; createdAt: string } | null | undefined
  booking:
    | { bookable: boolean; next: { startsAt: string; title: string } | null }
    | undefined
}) {
  const parserReady = (parsers ?? []).some((parser) => parser.validated)

  const health = intakeHealth(intakeMethod, {
    parserReady: connector
      ? undefined
      : parsersSettled
        ? parserReady
        : undefined,
    lastImport: lastImport ?? null,
  })

  const lastDataAt =
    lastImport?.status === 'committed' ? lastImport.createdAt : null

  const nextBooking = nextBookingLabel({
    isSuccess: booking !== undefined,
    bookable: booking?.bookable,
    next: booking?.next,
  })

  return {
    health,
    lastDataAt,
    nextBooking,
    followUp: connector
      ? null
      : parserFollowUp(instrumentId, intakeMethod, parsers),
    intakeItems: intakeItemsOf({
      intakeMethod,
      health,
      lastDataAt,
      nextBooking,
      parserLabel: parserLabelOf({
        connector,
        intakeParsers,
        needsParser: needsParserOf(intakeMethod),
        parsers: parsers ?? [],
      }),
      connector,
    }),
  }
}

/** The page's derived facts: rows, the latest calibration, and who may do what. */
export function instrumentPageFacts({
  runs,
  calibrations,
  projects,
  qualifications,
  openRequests,
  currentUserId,
}: {
  runs: InstrumentRunRow[] | undefined
  calibrations: InstrumentCalibrationRow[] | undefined
  projects: { id: string; title: string }[] | undefined
  qualifications: QualificationRow[] | undefined
  openRequests:
    { id: string; user_id: string; note: string | null }[] | undefined
  currentUserId: string
}) {
  const calibrationRows = calibrations ?? []
  const qualificationRows = qualifications ?? []
  const requestRows = openRequests ?? []

  return {
    rows: runs ?? [],
    calibrationRows,
    latest: calibrationRows.at(0) ?? null,
    projectOptions: projects ?? [],
    qualificationRows,
    requestRows,
    // The scope lives on the instrument; the read model reports it on each row.
    scope:
      qualificationRows.find((row) => row.qualified_for)?.qualified_for ?? null,
    iAmQualified: qualificationRows.some(
      (row) => row.user_id === currentUserId && row.current,
    ),
    iHaveAsked: requestRows.some((row) => row.user_id === currentUserId),
  }
}
