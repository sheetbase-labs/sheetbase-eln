import { Outlet, createFileRoute, useParams } from '@tanstack/react-router'

import { ReviewSections } from './-review-sections'

/** The Review tab: everything about the experiment being checked. What was
 * submitted, who signed it, what changed and each saved version. A submission
 * that is open draws the strip itself, so its panel can run the full height. */
export const Route = createFileRoute('/experiments/$expId/review')({
  component: ReviewTab,
})

function ReviewTab() {
  const params = Route.useParams()
  const { revisionId } = useParams({ strict: false })

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {revisionId ? null : <ReviewSections expId={params.expId} />}
      <div className="flex min-h-0 min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
