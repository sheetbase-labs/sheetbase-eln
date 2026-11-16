/**
 * POST /api/assistant/attachments — read a file dropped into the chat. See
 * src/lib/assistant-attachments-route.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleAttachmentUpload } from '#/lib/assistant-attachments-route.server'

export const Route = createFileRoute('/api/assistant/attachments')({
  server: {
    handlers: { POST: ({ request }) => handleAttachmentUpload(request) },
  },
})
