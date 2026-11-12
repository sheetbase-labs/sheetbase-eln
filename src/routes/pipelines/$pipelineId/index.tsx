import { createFileRoute, redirect } from '@tanstack/react-router'

import { signInRedirect } from '#/lib/sign-in-redirect'

/** The pipeline's overview numbers now sit in its header; the page opens on its steps. */
export const Route = createFileRoute('/pipelines/$pipelineId/')({
  beforeLoad: async ({ context: rootContext, location, params }) => {
    if (!rootContext.auth) {
      throw redirect(signInRedirect(location))
    }

    throw redirect({
      to: '/pipelines/$pipelineId/steps',
      params: { pipelineId: params.pipelineId },
      replace: true,
    })
  },
})
