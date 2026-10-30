import { createFileRoute } from '@tanstack/react-router'

import { isDevAuthFreeEnabled } from '#/lib/dev-auth'
import { demoWebhookSinkResponse } from '#/lib/demo-webhook-sink'

/** Receiver for the sign-in-free demo's outgoing webhooks. Not found elsewhere. */
export const Route = createFileRoute('/api/demo/webhook-sink')({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) =>
        demoWebhookSinkResponse(request, isDevAuthFreeEnabled()),
    },
  },
})
