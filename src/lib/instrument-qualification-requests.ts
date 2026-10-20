/**
 * Asking to be qualified on an instrument.
 *
 * Booking is refused until an owner grants a qualification. A request tells the
 * owners (an Inbox item) and, once granted, the requester, so neither side has
 * to message the other. The server owns the rules: one open request per person
 * and instrument, and no request from someone already qualified.
 */
import { z } from 'zod'

import type { DataClient } from './data-client'

const requestSchema = z.object({
  id: z.uuid(),
  instrument_id: z.string(),
  user_id: z.string(),
  note: z.string().nullable(),
  status: z.enum(['pending', 'granted', 'dismissed']),
  created_at: z.string(),
  updated_at: z.string(),
})

export type InstrumentQualificationRequest = z.infer<typeof requestSchema>

export function qualificationRequestsQueryKey(instrumentId: string) {
  return ['ui-port', 'instrument-qualification-requests', instrumentId] as const
}

/** Ask to be qualified. Asking again while a request is open is harmless. */
export async function requestInstrumentQualification(
  client: DataClient,
  input: { instrumentId: string; note?: string },
): Promise<InstrumentQualificationRequest> {
  return requestSchema.parse(
    await client.rpc('request_instrument_qualification', {
      p_instrument_id: input.instrumentId,
      p_note: input.note?.trim() || null,
    }),
  )
}

/**
 * The open requests for an instrument that the caller may see: their own, or
 * everyone's for an owner (the table's policy decides, not this call).
 */
export async function fetchOpenQualificationRequests(
  client: DataClient,
  instrumentId: string,
): Promise<InstrumentQualificationRequest[]> {
  return z
    .array(requestSchema)
    .parse(
      await client.list(
        'instrument_qualification_requests',
        `?instrument_id=eq.${encodeURIComponent(instrumentId)}&status=eq.pending&order=created_at.asc`,
      ),
    )
}

export async function dismissQualificationRequest(
  client: DataClient,
  requestId: string,
): Promise<void> {
  await client.rpc('dismiss_instrument_qualification_request', {
    p_request_id: requestId,
  })
}
