/**
 * POST /api/assistant/chat — a streamed assistant turn with conversation
 * history. See src/lib/assistant-chat.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleAssistantChat } from '#/lib/assistant-chat.server'

export const Route = createFileRoute('/api/assistant/chat')({
  server: {
    handlers: { POST: ({ request }) => handleAssistantChat(request) },
  },
})
