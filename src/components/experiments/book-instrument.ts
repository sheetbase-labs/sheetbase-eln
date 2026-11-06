/**
 * "Book instrument" from an experiment: opens the Schedule's booking form for
 * this experiment (its name starts the title, its samples are offered) and
 * comes back to the experiment once the booking is made or dismissed.
 *
 * It lives in the experiment's ⋯ menu. Booking is something you do around an
 * experiment, not its next step, so it does not get a button of its own.
 */
export function bookInstrumentLink(experimentId: string) {
  return {
    to: '/schedule' as const,
    search: {
      experiment: experimentId,
      returnTo: `/experiments/${encodeURIComponent(experimentId)}`,
    },
  }
}
