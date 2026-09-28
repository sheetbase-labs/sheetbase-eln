import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'

/** UI port: the sample Measurements tab. Measurement storage is owned by the
 * results capability, so this states the gap. */
export const Route = createFileRoute('/samples/$sampleId/measurements')({
  component: () => (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <EmptyState
        icon="chart"
        title="Measurements are not built yet"
        body="Assay results against this sample arrive with the results capability."
      />
    </div>
  ),
})
