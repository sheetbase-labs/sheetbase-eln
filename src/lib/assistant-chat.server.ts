import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'

import { assistantChatSchema, streamAssistant } from './assistant'
import type {
  AssistantMessageMetadata,
  AssistantUIMessage,
} from './assistant-chat'
import { resolveAssistantRuntime } from './assistant-actions'
import { ModelGatewayError } from './ai-gateway'
import { logger, redact } from './logger'

/**
 * POST /api/assistant/chat — one streamed assistant turn.
 *
 * The body carries the conversation so far plus the page's stable object ids;
 * the actor, workspace, policy and provider come from the verified session,
 * exactly as for the one-shot assistant. The answer streams back as AI SDK UI
 * message parts, with sources and usage as message metadata. Every call still
 * goes through the governed gateway: budget checked before the first byte,
 * usage recorded when the stream ends, no retries, hash-only telemetry.
 */

function json(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A turn that cannot start is reported as an error part, so the chat shows it inline. */
function failureResponse(message: string): Response {
  const stream = createUIMessageStream<AssistantUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: 'error', errorText: message })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

export async function handleAssistantChat(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, 'The request was not valid JSON.')
  }
  const parsed = assistantChatSchema.safeParse(body)
  if (!parsed.success) return json(400, 'The question could not be read.')
  const input = parsed.data

  let runtime: Awaited<ReturnType<typeof resolveAssistantRuntime>>
  try {
    runtime = await resolveAssistantRuntime(input.workspaceId, request.headers)
  } catch {
    return json(403, 'You do not have access to this workspace.')
  }
  if (!runtime.ok) return failureResponse(runtime.result.message)

  const started = await streamAssistant(input, runtime.deps, request.signal)
  logger.info(
    'ai.assistant.chat',
    redact({
      workspaceId: input.workspaceId,
      actorUserId: runtime.session.userId,
      model: runtime.deps.settings.model,
      mode: runtime.mode,
      providerProfile: runtime.providerProfile,
      turns: input.messages.length,
      questionChars: input.messages.at(-1)?.content.length ?? 0,
      objectRefs: input.objectRefs.length,
      outcome: started.status,
    }),
  )
  if (started.status !== 'ok') return failureResponse(started.message)

  const { events } = started
  const stream = createUIMessageStream<AssistantUIMessage>({
    execute: async ({ writer }) => {
      const metadata: AssistantMessageMetadata = {
        mode: started.mode,
        providerProfile: started.providerProfile,
        sources: started.sources,
      }
      writer.write({ type: 'start', messageMetadata: metadata })
      const id = 'answer'
      writer.write({ type: 'text-start', id })
      try {
        for await (const event of events) {
          if (event.type === 'text') {
            writer.write({ type: 'text-delta', id, delta: event.delta })
          } else {
            writer.write({ type: 'text-end', id })
            writer.write({
              type: 'finish',
              messageMetadata: { ...metadata, usage: event.usage },
            })
          }
        }
      } catch (error) {
        writer.write({
          type: 'error',
          errorText:
            error instanceof ModelGatewayError &&
            error.code === 'budget_exhausted'
              ? 'This request exceeds the workspace AI budget.'
              : 'The selected provider did not return an answer.',
        })
      }
    },
    onError: () => 'The assistant could not answer. Try again in a moment.',
  })
  return createUIMessageStreamResponse({ stream })
}
