import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'

/** UI port: the sample Lineage tab. The derived-sample capability is not built
 * yet, so this states the gap rather than faking a tree. */
export const Route = createFileRoute('/samples/$sampleId/lineage')({
  component: () => (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <EmptyState
        icon="folder"
        title="Lineage is not built yet"
        body="Derived samples and their parents arrive with the lineage capability."
      />
    </div>
  ),
})
