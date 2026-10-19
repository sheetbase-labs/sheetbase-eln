import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'

/**
 * "Book instrument" on an experiment: opens the Schedule's booking form for
 * this experiment (its name starts the title, its samples are offered) and
 * comes back to the experiment once the booking is made or dismissed.
 */
export function BookInstrumentButton({
  experimentId,
  className,
}: {
  experimentId: string
  className?: string
}) {
  return (
    <Button
      className={className}
      nativeButton={false}
      render={
        <Link
          to="/schedule"
          search={{
            experiment: experimentId,
            returnTo: `/experiments/${encodeURIComponent(experimentId)}`,
          }}
        />
      }
    >
      Book instrument
    </Button>
  )
}
