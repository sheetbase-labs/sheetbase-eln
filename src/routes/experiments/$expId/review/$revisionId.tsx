import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'

import { embeddedWorkspaceSearchSchema } from '#/routes/review/-workspace-search'

/**
 * One submitted version of the experiment, reviewed in place: what changed,
 * the comments, the checks, the history, and Approve and sign. The review
 * workspace itself lives with the review route and loads on demand.
 */
export const Route = createFileRoute('/experiments/$expId/review/$revisionId')({
  validateSearch: embeddedWorkspaceSearchSchema,
  component: lazyRouteComponent(
    () => import('#/routes/review/-revision-page'),
    'ExperimentReviewRoute',
  ),
})
