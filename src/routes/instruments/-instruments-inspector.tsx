/**
 * The registry list's inspector: one instrument's intake, use, calibration and
 * registry standing, with the two writes the registry owns (retire/reinstate,
 * and the intake method).
 *
 * The reads and their derived labels live in `useInstrumentInspector`; each
 * section is a named piece of the panel, so the panel itself reads as a list.
 */
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Dot } from '#/components/ui/status'
import { Notice } from '#/components/ui/alert'
import { DescriptionList, Inspector, Muted } from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { CalibrationOverdueNotice } from '#/components/instruments/calibration-overdue'
import { IntakeDeliveryNotice } from '#/components/instruments/intake-delivery-notice'
import { ParserFollowUpNotice } from '#/components/instruments/parser-follow-up'
import {
  INTAKE_METHODS,
  formatInstrumentDay,
  intakeDeliveryProblem,
  intakeHealth,
  intakeMethodLabel,
  intakeMethodNeedsParser,
  isOutOfService,
  parserFollowUp,
  setInstrumentIntakeMethod,
  setInstrumentRetired,
  useInstrumentLastImport,
  useInstrumentNextBooking,
  useInstrumentParsers,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentRow,
  InstrumentNextBooking,
  IntakeMethod,
} from '#/components/instruments/instruments-data'
import type { CalibrationState } from '#/components/instruments/calibration-standing'
import type { InstrumentGateMode } from '#/lib/workspace-admin'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import { cn } from '#/lib/utils'
import { undoToast } from '#/lib/undo-toast'
import { intakeMethodOf } from './-instruments-model'

/** The calibration standing the list already worked out for this instrument. */
interface CalibrationStandingProp {
  state: CalibrationState
  label: string
  tone: string
}

/** What the inspector's header and sections read and can do. */
function useInstrumentInspector(instrument: InstrumentRow) {
  const queryClient = useQueryClient()
  const parsers = useInstrumentParsers(instrument.id)
  const lastImport = useInstrumentLastImport(instrument.id)
  const booking = useInstrumentNextBooking(instrument.id)
  const parserRows = parsers.data ?? []

  const parserReady = parserRows.some((parser) => parser.validated)

  const needsParser = intakeMethodNeedsParser(instrument.intakeMethod)

  const followUp = parserFollowUp(
    instrument.id,
    instrument.intakeMethod,
    parsers.data,
  )

  const health = intakeHealth(instrument.intakeMethod, {
    parserReady: parsers.isSuccess ? parserReady : undefined,
    lastImport: lastImport.data ?? null,
  })

  const deliveryProblem = intakeDeliveryProblem(health.label)

  const lastDataAt =
    lastImport.data?.status === 'committed' ? lastImport.data.createdAt : null

  const nextBooking = nextBookingLabel(booking)

  const parserLabel = parserStandingLabel({
    needsParser,
    parsers: parserRows,
  })

  const retire = useMutation({
    mutationFn: (retired: boolean) =>
      setInstrumentRetired(instrument.id, retired),
    onSuccess: (_row, retired) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      undoToast(
        retired
          ? t('library.instruments.list.instrumentRetired')
          : t('library.instruments.list.instrumentReinstated'),
        () => setInstrumentRetired(instrument.id, !retired),
        () =>
          void queryClient.invalidateQueries({
            queryKey: ['ui-port', 'instruments'],
          }),
      )
    },
    onError: () =>
      toast.error(t('library.instruments.list.couldNotChangeTheInstrument')),
  })

  const changeMethod = useMutation({
    mutationFn: (method: IntakeMethod) =>
      setInstrumentIntakeMethod(instrument.id, method),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      toast(t('library.instruments.list.howDataGetsInUpdated'), {
        description: t('library.instruments.list.dataAlreadyImportedIsNot'),
      })
    },
    onError: () =>
      toast.error(t('library.instruments.list.couldNotChangeHowData')),
  })

  return {
    health,
    needsParser,
    followUp,
    deliveryProblem,
    lastDataAt,
    nextBooking,
    parserLabel,
    retire,
    changeMethod,
  }
}

/** What the next-booking row says, given the booking read. */
function nextBookingLabel(booking: {
  isSuccess: boolean
  data?: { bookable: boolean; next: InstrumentNextBooking | null }
}): string {
  if (!booking.isSuccess) return '—'

  if (!booking.data?.bookable) return t('library.instruments.list.notBookable')

  if (!booking.data.next) return 'None'

  return `${booking.data.next.startsAt.slice(0, 16).replace('T', ' ')} · ${booking.data.next.title}`
}

/** The parser row: which parser, and whether it is validated. */
function parserStandingLabel(input: {
  needsParser: boolean
  parsers: { name: string; validated: boolean }[]
}): string {
  if (!input.needsParser) return t('library.instruments.list.notUsed')

  if (!input.parsers.length)
    return t('library.instruments.list.noParserAttached')

  return input.parsers
    .map(
      (parser) =>
        `${parser.name} · ${parser.validated ? 'validated' : 'not validated'}`,
    )
    .join(', ')
}

/**
 * The inspector's sections are the registry page's top-level sections, so they
 * are h2 — `InspectorSection` is h3-only and belongs inside an already-titled
 * page. Same label typography, one level up.
 */
function RegistrySection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-1.5 font-sans text-label font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function InstrumentInspector({
  instrument,
  calibration,
  ownerLabel,
  canManage,
  canEditParsers,
  canRecordCalibration = false,
  canImport = false,
  gateMode = 'warn',
}: {
  instrument: InstrumentRow
  calibration: { state: CalibrationState; label: string; tone: string }
  ownerLabel: string
  canManage: boolean
  canEditParsers: boolean
  canRecordCalibration?: boolean
  canImport?: boolean
  gateMode?: InstrumentGateMode
}) {
  const view = useInstrumentInspector(instrument)

  return (
    <Inspector
      aria-label={t('library.instruments.list.instrumentDetails')}
      className="w-[340px] gap-0 p-0"
    >
      <InstrumentInspectorHeader
        instrument={instrument}
        canRecordCalibration={canRecordCalibration}
      />
      <div className="flex flex-col gap-5 px-4 py-3.5">
        <InstrumentNotices
          instrument={instrument}
          calibration={calibration}
          gateMode={gateMode}
          canRecordCalibration={canRecordCalibration}
          canEditParsers={canEditParsers}
          canImport={canImport}
          followUp={view.followUp}
          deliveryProblem={view.deliveryProblem}
        />
        <IntakeSection
          instrument={instrument}
          health={view.health}
          lastDataAt={view.lastDataAt}
          parserLabel={view.parserLabel}
          needsParser={view.needsParser}
          canManage={canManage}
          changeMethod={view.changeMethod}
        />
        <UseSection
          instrument={instrument}
          nextBooking={view.nextBooking}
          ownerLabel={ownerLabel}
        />
        <CalibrationSection calibration={calibration} />
        {canManage ? (
          <RegistrySection title={t('library.instruments.list.registry')}>
            <Button
              size="sm"
              disabled={view.retire.isPending}
              onClick={() => view.retire.mutate(!instrument.retiredAt)}
            >
              {instrument.retiredAt
                ? t('library.instruments.list.reinstateInstrument')
                : t('library.instruments.list.retireInstrument')}
            </Button>
            <Muted className="mt-1.5">
              {t('library.instruments.list.retiredInstrumentsStayForHistory')}
            </Muted>
          </RegistrySection>
        ) : null}
      </div>
    </Inspector>
  )
}

/** Name, identity, and the three ways on from the registry row. */
function InstrumentInspectorHeader({
  instrument,
  canRecordCalibration,
}: {
  instrument: InstrumentRow
  canRecordCalibration: boolean
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
      <span className="mono text-fg-muted">
        {instrument.displayId ?? instrument.id.slice(0, 8)} ·{' '}
        {instrumentTypeLabel(instrument.instrumentType)}
      </span>
      <div className="font-heading text-doc font-semibold">
        {instrument.name}
      </div>
      <div className="text-label text-fg-muted">
        {instrument.vendor ?? '—'} {instrument.model ?? ''}{' '}
        {t('library.instruments.list.serial')} {instrument.serialNumber ?? '—'}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="primary"
          nativeButton={false}
          render={
            <Link
              to="/instruments/$instrumentId"
              params={{ instrumentId: instrument.id }}
            />
          }
        >
          {t('library.instruments.list.openRecord')}
        </Button>
        {canRecordCalibration ? (
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link to="/import" search={{ instrument: instrument.id }} />
            }
          >
            {t('common.actions.upload')}
          </Button>
        ) : null}
        {!instrument.retiredAt && !isOutOfService(instrument) ? (
          <Button
            size="sm"
            nativeButton={false}
            // The Schedule opens its book dialog with this instrument already
            // chosen, so the registry does not send the person back to a list
            // to find the instrument they were just looking at.
            render={<Link to="/schedule" search={{ book: instrument.id }} />}
          >
            {t('library.instruments.list.book')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** The one warning that applies: out of service, calibration, parser or intake. */
function InstrumentNotices({
  instrument,
  calibration,
  gateMode,
  canRecordCalibration,
  canEditParsers,
  canImport,
  followUp,
  deliveryProblem,
}: {
  instrument: InstrumentRow
  calibration: CalibrationStandingProp
  gateMode: InstrumentGateMode
  canRecordCalibration: boolean
  canEditParsers: boolean
  canImport: boolean
  followUp: ReturnType<typeof parserFollowUp>
  deliveryProblem: ReturnType<typeof intakeDeliveryProblem>
}) {
  if (isOutOfService(instrument)) {
    return (
      <Notice tone="warn" title={t('library.instruments.outOfService.title')}>
        {' '}
        {[
          instrument.outOfServiceReason,
          instrument.expectedBackOn
            ? t('library.instruments.outOfService.expectedBack', {
                date: formatInstrumentDay(instrument.expectedBackOn),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Notice>
    )
  }

  if (calibration.state === 'overdue') {
    return (
      <CalibrationOverdueNotice
        instrumentName={instrument.name}
        gateMode={gateMode}
        action={
          canRecordCalibration ? (
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/instruments/$instrumentId"
                  params={{ instrumentId: instrument.id }}
                  search={{ record: '1' }}
                />
              }
            >
              {t('library.instruments.list.recordCalibration')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (followUp) {
    return (
      <ParserFollowUpNotice
        instrumentName={instrument.name}
        followUp={followUp}
        canEdit={canEditParsers}
      />
    )
  }

  if (deliveryProblem) {
    return (
      <IntakeDeliveryNotice
        instrumentId={instrument.id}
        instrumentName={instrument.name}
        problem={deliveryProblem}
        canImport={canImport}
      />
    )
  }

  return null
}

/** How data gets in: its health, its parser, and the method control. */
function IntakeSection({
  instrument,
  health,
  lastDataAt,
  parserLabel,
  needsParser,
  canManage,
  changeMethod,
}: {
  instrument: InstrumentRow
  health: ReturnType<typeof intakeHealth>
  lastDataAt: string | null
  parserLabel: string
  needsParser: boolean
  canManage: boolean
  changeMethod: {
    isPending: boolean
    mutate: (method: IntakeMethod) => void
  }
}) {
  return (
    <RegistrySection title={t('library.instruments.list.howDataGetsIn')}>
      <DescriptionList
        labelWidth={96}
        items={[
          ['Method', intakeMethodLabel(instrument.intakeMethod)],
          [
            'Health',
            <span className="inline-flex items-center gap-1.5">
              <Dot tone={health.tone} />
              {health.label}
            </span>,
          ],
          [
            t('library.instruments.list.lastData'),
            lastDataAt
              ? lastDataAt.slice(0, 16).replace('T', ' ')
              : t('library.instruments.list.nothingReceived'),
          ],
          ['Parser', parserLabel],
        ]}
      />
      {needsParser ? (
        <Link
          to="/settings/lab/instruments"
          search={{ instrumentId: instrument.id }}
          className="mt-1.5 inline-block text-label text-link hover:underline"
        >
          {t('library.instruments.list.parserAndImports')}
        </Link>
      ) : null}
      {canManage ? (
        <div className="mt-3 flex flex-col gap-1">
          <Select
            aria-label={t('library.instruments.list.howDataGetsIn')}
            className="h-[26px] text-label"
            value={instrument.intakeMethod}
            disabled={changeMethod.isPending}
            onChange={(e) => {
              const method = intakeMethodOf(e.target.value)

              if (method) changeMethod.mutate(method)
            }}
          >
            {INTAKE_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.title}
              </option>
            ))}
          </Select>
          <Muted>
            {t('library.instruments.list.affectsFutureDataOnlyData')}
          </Muted>
        </div>
      ) : null}
    </RegistrySection>
  )
}

/** Next booking, where it sits, and who owns it. */
function UseSection({
  instrument,
  nextBooking,
  ownerLabel,
}: {
  instrument: InstrumentRow
  nextBooking: string
  ownerLabel: string
}) {
  return (
    <RegistrySection title={t('library.instruments.list.use')}>
      <DescriptionList
        labelWidth={96}
        items={[
          [t('library.instruments.list.nextBooking'), nextBooking],
          ['Location', instrument.location ?? '—'],
          ['Owner', ownerLabel],
        ]}
      />
    </RegistrySection>
  )
}

/** When the calibration falls due, in the list's own tone. */
function CalibrationSection({
  calibration,
}: {
  calibration: CalibrationStandingProp
}) {
  return (
    <RegistrySection title={t('library.instruments.list.calibration')}>
      <DescriptionList
        labelWidth={96}
        items={[
          [
            'Due',
            <span
              className={cn(
                calibration.tone === 'bad' && 'text-danger-text',
                calibration.tone === 'warn' && 'text-warning-text',
              )}
            >
              {calibration.label}
            </span>,
          ],
        ]}
      />
      <Muted className="mt-1.5">
        {t('library.instruments.list.certificatesAndHistoryAreOn')}
      </Muted>
    </RegistrySection>
  )
}
