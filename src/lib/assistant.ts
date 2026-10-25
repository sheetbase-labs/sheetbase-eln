import { z } from 'zod'

import { AI_OBJECT_REF_KINDS, assembleAiContext } from './ai-context'
import type {
  AiContextActor,
  AiFreshness,
  AiObjectRef,
  AiObjectRefKind,
  AiVersionPin,
} from './ai-context'
import { ModelGatewayError, StubModelProvider, callModel } from './ai-gateway'
import type { GatewayModel, ModelProvider } from './ai-gateway'
import { aiReadiness, aiReadinessMessage } from './ai-settings'
import type { AiReadiness, WorkspaceAiSettings } from './ai-settings'
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

export const ASSISTANT_MAX_QUESTION_CHARS = 2_000
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

/**
 * Pure orchestration: policy decision, context assembly, governed call and
 * source projection. The server function supplies the actor, settings,
 * provider and RLS-scoped client.
 */
export async function askAssistant(
  input: AskAssistantInput,
  deps: AssistantDeps,
): Promise<AskAssistantResult> {
  const readiness = aiReadiness(
    deps.settings,
    deps.profiles,
    deps.providerConfigError,
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

  let envelope
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
    readiness.mode === 'provider'
      ? deps.provider
      : new StubModelProvider(
          deps.settings.model,
          'Built-in deterministic answer',
        )

  try {
    const result = await callModel(
      deps.actor,
      {
        model: deps.settings.model,
        tools: [],
        contextEnvelope: envelope,
        citations: [],
        limits: {
          maxTokens: deps.settings.maxTokensPerCall,
          maxCostMicrousd: deps.settings.maxCostMicrousdPerCall,
        },
      },
      {
        provider,
        pricing:
          readiness.mode === 'provider' && deps.pricing !== undefined
            ? { [deps.settings.model]: deps.pricing }
            : undefined,
      },
    )
    return {
      status: 'ok',
      text: result.text,
      model: result.model,
      mode: readiness.mode,
      providerProfile:
        readiness.mode === 'provider' ? readiness.profileId : null,
      sources: envelope.objects.map((object) => ({
        kind: object.kind,
        id: object.id,
        title: object.title,
        deepLink: object.deepLink,
        freshness: object.freshness,
        pins: object.pins,
      })),
      omissions: envelope.omissions.length,
      usage: result.usage,
      generated: true,
    }
  } catch (error) {
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
}
