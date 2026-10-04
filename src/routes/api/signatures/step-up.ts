import { createFileRoute } from '@tanstack/react-router'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'

export const Route = createFileRoute('/api/signatures/step-up')({
  server: {
    handlers: { POST: ({ request }) => handleSignatureStepUp(request) },
  },
})
