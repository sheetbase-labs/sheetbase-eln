/**
 * Studies and their planner from the assistant: start a study, change it, add
 * an experiment or project to it, snapshot its plan, and everything on the
 * planner (lanes, due dates, who sees a task, dependencies, bookings,
 * deliverables). The operations are declared with the other planning
 * operations; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'studies',
})
