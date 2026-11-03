import { z } from 'zod'

import { AI_OBJECT_REF_KINDS, assembleAiContext } from './ai-context'
import type {
  AiContextActor,
  AiContextEnvelope,
  AiFreshness,
  AiObjectRef,
  AiObjectRefKind,
  AiVersionPin,
} from './ai-context'
import {
  ModelGatewayError,
  StubModelProvider,
  callModel,
  streamModel,
} from './ai-gateway'
import type {
  GatewayModel,
  GatewayStreamEvent,
  GatewayUsage,
  ModelProvider,
} from './ai-gateway'
import type { ChatTurn } from './ai-providers/types'
import { ASSISTANT_MAX_QUESTION_CHARS } from './assistant-chat'
import { AnswerCleaner, EMPTY_ANSWER_MESSAGE } from './assistant-output'
import { aiReadiness, aiReadinessMessage } from './ai-settings'
import type { AiReadiness, WorkspaceAiSettings } from './ai-settings'
import { defaultAiFeatureFlags } from './ai-feature-flags'
import type { AiFeatureFlags } from './ai-feature-flags'
import type { PublicProviderProfile } from './ai-providers/profiles'
import type { DataClient } from './data-client'

/**
 * ASSIST-04 — grounded, cited, draft-only assistant.
 *
 * The assistant is one more consumer of the existing AI-01..03 substrate: it
 * assembles permitted context from stable ids, sends it through the governed
 * gateway, and returns the answer plus the exact sources it was given. It
 * never writes. A draft is a suggestion the person must apply through the
 * ordinary canonical operation.
 *
 * The built-in mode runs the gateway's deterministic stub so the full policy
 * path (allowlist, actor match, budgets, telemetry) is exercised without a
 * provider. It is labelled as a built-in model, never passed off as a live
 * provider answer.
 */

export { ASSISTANT_MAX_QUESTION_CHARS }
export const ASSISTANT_MAX_OBJECT_REFS = 8
export const ASSISTANT_CONTEXT_BUDGET_CHARS = 12_000
export const ASSISTANT_MAX_SAMPLE_ROWS = 5

export const askAssistantSchema = z
  .object({
    workspaceId: z.string().uuid(),
    question: z.string().min(1).max(ASSISTANT_MAX_QUESTION_CHARS),
    objectRefs: z
      .array(
        z
          .object({
            kind: z.enum(AI_OBJECT_REF_KINDS),
            id: z.string().uuid(),
            pinnedVersionId: z.string().uuid().nullish(),
          })
          .strict(),
      )
      .max(ASSISTANT_MAX_OBJECT_REFS)
      .default([]),
  })
  .strict()

export type AskAssistantInput = z.infer<typeof askAssistantSchema>

/** Turns of earlier conversation sent along with a new question. */
export const ASSISTANT_MAX_HISTORY_TURNS = 20
/** Prior answers are clipped, so a long reply cannot crowd out the context. */
export const ASSISTANT_MAX_HISTORY_TURN_CHARS = 4_000

const objectRefSchema = z
  .object({
    kind: z.enum(AI_OBJECT_REF_KINDS),
    id: z.string().uuid(),
    pinnedVersionId: z.string().uuid().nullish(),
  })
  .strict()

/**
 * A chat turn: the whole conversation so far, ending with the person's new
 * question. Text only; sources and usage are never echoed back as history.
 */
export const assistantChatSchema = z
  .object({
    workspaceId: z.string().uuid(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(ASSISTANT_MAX_HISTORY_TURN_CHARS),
          })
          .strict(),
      )
      .min(1)
      .max(ASSISTANT_MAX_HISTORY_TURNS * 2),
    objectRefs: z
      .array(objectRefSchema)
      .max(ASSISTANT_MAX_OBJECT_REFS)
      .default([]),
  })
  .strict()
  .refine((input) => input.messages.at(-1)?.role === 'user', {
    message: 'The last message must be a question.',
  })
  .refine(
    (input) =>
      (input.messages.at(-1)?.content.length ?? 0) <=
      ASSISTANT_MAX_QUESTION_CHARS,
    { message: 'The question is too long.' },
  )

export type AssistantChatInput = z.infer<typeof assistantChatSchema>

/** Keep the most recent turns, starting on a question, clipped to size. */
export function trimHistory(messages: ChatTurn[]): ChatTurn[] {
  const recent = messages.slice(-ASSISTANT_MAX_HISTORY_TURNS).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, ASSISTANT_MAX_HISTORY_TURN_CHARS),
  }))
  while (recent.length > 0 && recent[0]?.role !== 'user') recent.shift()
  return recent
}

export interface AssistantSource {
  kind: AiObjectRefKind
  id: string
  title: string
  deepLink: string | null
  freshness: AiFreshness
  pins: AiVersionPin[]
}

export interface AssistantUsage {
  tokensUsed: number
  costMicrousd: number
  latencyMs: number
}

export type AskAssistantResult =
  | {
      status: 'ok'
      text: string
      model: GatewayModel
      mode: 'built-in' | 'provider'
      providerProfile: string | null
      sources: AssistantSource[]
      omissions: number
      usage: AssistantUsage
      generated: true
    }
  | {
      status: 'unavailable'
      reason: Extract<AiReadiness, { ready: false }>['reason']
      message: string
    }
  | {
      status: 'error'
      code:
        | 'provider_unavailable'
        | 'provider_error'
        | 'gateway_error'
        | 'context_error'
      message: string
    }

export interface AssistantDeps {
  actor: AiContextActor
  workspaceId: string
  settings: WorkspaceAiSettings
  featureFlags?: AiFeatureFlags
  profiles: PublicProviderProfile[]
  providerConfigError: string | null
  client: DataClient
  /** Supplied only when readiness resolved to a provider profile. */
  provider?: ModelProvider
  /** Provider rate for the pre-call budget estimate. */
  pricing?: number
}

function toObjectRef(
  ref: AskAssistantInput['objectRefs'][number],
): AiObjectRef {
  return {
    kind: ref.kind,
    id: ref.id,
    pinnedVersionId: ref.pinnedVersionId ?? null,
  }
}

type Failure = Extract<AskAssistantResult, { status: 'unavailable' | 'error' }>

interface Prepared {
  envelope: AiContextEnvelope
  provider: ModelProvider
  mode: 'built-in' | 'provider'
  providerProfile: string | null
  sources: AssistantSource[]
}

/**
 * Policy decision and context assembly, shared by the one-shot and streaming
 * paths: readiness, provider presence, then permitted context from stable ids.
 */
async function prepare(
  input: { objectRefs: AskAssistantInput['objectRefs'] },
  deps: AssistantDeps,
): Promise<Failure | Prepared> {
  const readiness = aiReadiness(
    deps.settings,
    deps.profiles,
    deps.providerConfigError,
    deps.featureFlags ?? defaultAiFeatureFlags(),
  )
  if (!readiness.ready) {
    return {
      status: 'unavailable',
      reason: readiness.reason,
      message: aiReadinessMessage(readiness),
    }
  }
  if (readiness.mode === 'provider' && !deps.provider) {
    return {
      status: 'error',
      code: 'provider_unavailable',
      message: 'The selected provider could not be constructed.',
    }
  }

  let envelope: AiContextEnvelope
  try {
    envelope = await assembleAiContext(deps.client, deps.actor, {
      workspaceId: deps.workspaceId,
      objectRefs: input.objectRefs.map(toObjectRef),
      budgets: {
        maxCharsTotal: ASSISTANT_CONTEXT_BUDGET_CHARS,
        maxRowsPerDataset: ASSISTANT_MAX_SAMPLE_ROWS,
      },
    })
  } catch {
    return {
      status: 'error',
      code: 'context_error',
      message: 'Sheetbase context could not be assembled for this request.',
    }
  }

  const provider =
    readiness.mode === 'provider' && deps.provider
      ? deps.provider
      : new StubModelProvider(
          deps.settings.model,
          'Built-in deterministic answer',
        )

  return {
    envelope,
    provider,
    mode: readiness.mode,
    providerProfile: readiness.mode === 'provider' ? readiness.profileId : null,
    sources: envelope.objects.map((object) => ({
      kind: object.kind,
      id: object.id,
      title: object.title,
      deepLink: object.deepLink,
      freshness: object.freshness,
      pins: object.pins,
    })),
  }
}

function gatewayFailure(error: unknown): Failure {
  if (error instanceof ModelGatewayError) {
    return {
      status: 'error',
      code: 'gateway_error',
      message:
        error.code === 'budget_exhausted'
          ? 'This request exceeds the workspace AI budget.'
          : 'The AI policy rejected this request.',
    }
  }
  return {
    status: 'error',
    code: 'provider_error',
    message: 'The selected provider did not return an answer.',
  }
}

function pricingFor(
  prepared: Prepared,
  deps: AssistantDeps,
): Partial<Record<GatewayModel, number>> | undefined {
  return prepared.mode === 'provider' && deps.pricing !== undefined
    ? { [deps.settings.model]: deps.pricing }
    : undefined
}

/**
 * Pure orchestration: policy decision, context assembly, governed call and
 * source projection. The server function supplies the actor, settings,
 * provider and RLS-scoped client.
 */
export async function askAssistant(
  input: AskAssistantInput,
  deps: AssistantDeps,
): Promise<AskAssistantResult> {
  const prepared = await prepare(input, deps)
  if ('status' in prepared) return prepared

  try {
    const result = await callModel(
      deps.actor,
      {
        model: deps.settings.model,
        tools: [],
        contextEnvelope: prepared.envelope,
        citations: [],
        messages: [{ role: 'user', content: input.question }],
        limits: {
          maxTokens: deps.settings.maxTokensPerCall,
          maxCostMicrousd: deps.settings.maxCostMicrousdPerCall,
        },
      },
      { provider: prepared.provider, pricing: pricingFor(prepared, deps) },
    )
    return {
      status: 'ok',
      text: result.text,
      model: result.model,
      mode: prepared.mode,
      providerProfile: prepared.providerProfile,
      sources: prepared.sources,
      omissions: prepared.envelope.omissions.length,
      usage: result.usage,
      generated: true,
    }
  } catch (error) {
    return gatewayFailure(error)
  }
}

export type AssistantStreamEvent =
  { type: 'text'; delta: string } | { type: 'finish'; usage: GatewayUsage }

export type AssistantStreamStart =
  | Failure
  | {
      status: 'ok'
      mode: 'built-in' | 'provider'
      providerProfile: string | null
      sources: AssistantSource[]
      omissions: number
      /**
       * The answer as it arrives, cleaned of junk tokens. Ends with `finish`
       * once usage is recorded. A failure part-way is thrown as a
       * `ModelGatewayError` for the caller to turn into an error part.
       */
      events: AsyncGenerator<AssistantStreamEvent, void, void>
    }

/**
 * Streaming chat turn. Everything before the first byte (readiness, context,
 * budget) is decided here and returned as a plain result, so the caller can
 * answer with a normal error response; only a mid-stream provider failure
 * surfaces inside `events`.
 */
export async function streamAssistant(
  input: AssistantChatInput,
  deps: AssistantDeps,
  signal?: AbortSignal,
): Promise<AssistantStreamStart> {
  const prepared = await prepare(input, deps)
  if ('status' in prepared) return prepared

  const gateway = streamModel(
    deps.actor,
    {
      model: deps.settings.model,
      tools: [],
      contextEnvelope: prepared.envelope,
      citations: [],
      messages: trimHistory(input.messages),
      signal,
      limits: {
        maxTokens: deps.settings.maxTokensPerCall,
        maxCostMicrousd: deps.settings.maxCostMicrousdPerCall,
      },
    },
    { provider: prepared.provider, pricing: pricingFor(prepared, deps) },
  )

  // Pull the first event now: the gateway's pre-call policy runs on the first
  // `next()`, so a budget or allowlist rejection becomes a plain failure here
  // instead of a broken stream.
  let first: IteratorResult<GatewayStreamEvent, void>
  try {
    first = await gateway.next()
  } catch (error) {
    return gatewayFailure(error)
  }

  async function* events(): AsyncGenerator<AssistantStreamEvent, void, void> {
    const cleaner = new AnswerCleaner()
    let step = first
    for (;;) {
      if (step.done) break
      const event = step.value
      if (event.type === 'text') {
        const safe = cleaner.push(event.delta)
        if (safe !== '') yield { type: 'text', delta: safe }
      } else {
        const tail = cleaner.finish()
        if (tail !== '') yield { type: 'text', delta: tail }
        if (!cleaner.hasContent) {
          yield { type: 'text', delta: EMPTY_ANSWER_MESSAGE }
        }
        yield { type: 'finish', usage: event.usage }
      }
      step = await gateway.next()
    }
  }

  return {
    status: 'ok',
    mode: prepared.mode,
    providerProfile: prepared.providerProfile,
    sources: prepared.sources,
    omissions: prepared.envelope.omissions.length,
    events: events(),
  }
}
