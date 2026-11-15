/**
 * Plans: several assistant cards approved together and run in order.
 *
 * A plan is not stored. It is a list of the cards the assistant would have
 * offered one by one; each step runs through the ordinary RPCs as the person
 * who approved it, so each makes its own audit entry and change event. What
 * pauses and who may run everything at once are two settings with the other
 * agent permissions.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'plans',
})
