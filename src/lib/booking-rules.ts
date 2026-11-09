/**
 * Booking rules (migration 0078): the training a person needs before they can
 * book an instrument, the longest booking and the furthest ahead. The database
 * is the authority and refuses a booking that breaks a rule; this module reads
 * the rules so the instrument page can show them and the booking dialog can say
 * what stands in the way before someone tries.
 */
import type { DataClient } from '#/lib/data-client'

export const bookingRuleKeys = {
  all: ['booking-rules'] as const,
  forInstrument: (instrumentId: string) =>
    ['booking-rules', 'instrument', instrumentId] as const,
  gaps: (instrumentId: string) =>
    ['booking-rules', 'gaps', instrumentId] as const,
  protocols: ['booking-rules', 'protocols'] as const,
}

export interface BookingRules {
  maxBookingMinutes: number | null
  maxAdvanceDays: number | null
  training: Array<{ protocolId: string; identifier: string; title: string }>
}

export const NO_RULES: BookingRules = {
  maxBookingMinutes: null,
  maxAdvanceDays: null,
  training: [],
}

export function hasAnyRule(rules: BookingRules): boolean {
  return (
    rules.maxBookingMinutes !== null ||
    rules.maxAdvanceDays !== null ||
    rules.training.length > 0
  )
}

/** "90 minutes", "2 hours", "1 hour 30 minutes". */
export function describeMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const h = hours === 1 ? '1 hour' : `${hours} hours`
  const m = rest === 1 ? '1 minute' : `${rest} minutes`

  if (hours === 0) return m

  return rest === 0 ? h : `${h} ${m}`
}

interface RulesWire {
  max_booking_minutes: number | null
  max_advance_days: number | null
}

interface TrainingWire {
  protocol_record_id: string
}

interface ProtocolWire {
  id: string
  identifier: string
  title: string
}

export interface ProtocolOption {
  id: string
  identifier: string
  title: string
}

export async function fetchProtocolOptions(
  client: DataClient,
): Promise<ProtocolOption[]> {
  return client.list<ProtocolWire>(
    'records',
    '?kind=eq.protocol_template&deleted_at=is.null&archived_at=is.null&order=identifier.asc&limit=500&select=id,identifier,title',
  )
}

export async function fetchBookingRules(
  client: DataClient,
  instrumentId: string,
): Promise<BookingRules> {
  const id = encodeURIComponent(instrumentId)

  const [rules, required] = await Promise.all([
    client.list<RulesWire>(
      'instrument_booking_rules',
      `?instrument_id=eq.${id}&select=max_booking_minutes,max_advance_days`,
    ),
    client.list<TrainingWire>(
      'instrument_required_training',
      `?instrument_id=eq.${id}&select=protocol_record_id`,
    ),
  ])

  let training: BookingRules['training'] = []

  if (required.length > 0) {
    const protocols = await client.list<ProtocolWire>(
      'records',
      `?id=in.(${required.map((r) => r.protocol_record_id).join(',')})&select=id,identifier,title&order=identifier.asc`,
    )

    training = protocols.map((p) => ({
      protocolId: p.id,
      identifier: p.identifier,
      title: p.title,
    }))
  }

  return {
    maxBookingMinutes: rules[0]?.max_booking_minutes ?? null,
    maxAdvanceDays: rules[0]?.max_advance_days ?? null,
    training,
  }
}

export async function setBookingRules(
  client: DataClient,
  input: {
    instrumentId: string
    protocolIds: string[]
    maxBookingMinutes: number | null
    maxAdvanceDays: number | null
  },
): Promise<void> {
  await client.rpc<unknown>('set_instrument_booking_rules', {
    p_instrument_id: input.instrumentId,
    p_required_protocol_ids: input.protocolIds,
    p_max_booking_minutes: input.maxBookingMinutes,
    p_max_advance_days: input.maxAdvanceDays,
  })
}

export interface TrainingGap {
  protocol_record_id: string
  identifier: string
  title: string
}

/** The required procedures the caller has not been trained on. */
export async function fetchTrainingGaps(
  client: DataClient,
  instrumentId: string,
): Promise<TrainingGap[]> {
  return client.rpc<TrainingGap[]>('my_instrument_training_gaps', {
    p_instrument_id: instrumentId,
  })
}
