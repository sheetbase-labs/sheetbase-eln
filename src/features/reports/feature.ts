/**
 * Reports from the assistant: start one, change it, build its sections, point
 * a section at the evidence it shows, and the emailed schedules (save, pause,
 * send now, delete). Generating a report has a card of its own with the
 * planner cards. Approving or publishing a report stays with a person, in the
 * app. The operations are declared with the other planning operations; this
 * folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'reports',
})
