import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'

/** UI port: the experiment Results tab. Results storage is its own capability
 * and not built, so this states the gap. */
export const Route = createFileRoute('/experiments/$expId/results')({
  component: () => (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <EmptyState
        icon="chart"
        title="Results are not built yet"
        body="Curated results and key figures arrive with the results capability."
      />
    </div>
  ),
})
