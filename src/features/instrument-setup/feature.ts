/**
 * Instrument set-up from the assistant: robot jobs and settings, live-feed
 * limits, qualification requests, copied bookings, bookable resources,
 * connectors and parsers. The operations are declared with the instrument
 * operations; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'instrument-setup',
})
