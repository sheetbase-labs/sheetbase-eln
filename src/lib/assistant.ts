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
import type {
  ChatTurn,
  ProviderMessage,
  ProviderToolDef,
} from './ai-providers/types'
import { ASSISTANT_MAX_QUESTION_CHARS } from './assistant-chat'
import { fromWireToolName } from './agent-tool-catalogue'
import { AnswerCleaner, EMPTY_ANSWER_MESSAGE } from './assistant-output'
import { aiReadiness, aiReadinessMessage } from './ai-settings'
import type { AiReadiness, WorkspaceAiSettings } from './ai-settings'
import { defaultAiFeatureFlags } from './ai-feature-flags'
import type { AiFeatureFlags } from './ai-feature-flags'
import type { PublicProviderProfile } from './ai-providers/profiles'
import type { DataClient } from './data-client'
import type { AssistantProposal } from './assistant-proposals'

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

export const askAssistantSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  question: z.string().min(1).max(ASSISTANT_MAX_QUESTION_CHARS),
  objectRefs: z
    .array(
      z.strictObject({
        kind: z.enum(AI_OBJECT_REF_KINDS),
        id: z.string().uuid(),
        pinnedVersionId: z.string().uuid().nullish(),
      }),
    )
    .max(ASSISTANT_MAX_OBJECT_REFS)
    .default([]),
})

export type AskAssistantInput = z.infer<typeof askAssistantSchema>

/** Turns of earlier conversation sent along with a new question. */
export const ASSISTANT_MAX_HISTORY_TURNS = 20

/** Prior answers are clipped, so a long reply cannot crowd out the context. */
export const ASSISTANT_MAX_HISTORY_TURN_CHARS = 4_000

const objectRefSchema = z.strictObject({
  kind: z.enum(AI_OBJECT_REF_KINDS),
  id: z.string().uuid(),
  pinnedVersionId: z.string().uuid().nullish(),
})

/**
 * A chat turn: the whole conversation so far, ending with the person's new
 * question. Text only; sources and usage are never echoed back as history.
 */
export const assistantChatSchema = z
  .strictObject({
    workspaceId: z.string().uuid(),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(ASSISTANT_MAX_HISTORY_TURN_CHARS),
        }),
      )
      .min(1)
      .max(ASSISTANT_MAX_HISTORY_TURNS * 2),
    objectRefs: z
      .array(objectRefSchema)
      .max(ASSISTANT_MAX_OBJECT_REFS)
      .default([]),
    /** The person's own clock, so "tomorrow at 10" means their 10. */
    timeZone: z.string().min(1).max(64).optional(),
    /** The page the person is on, by name: "Schedule", "Requests". */
    page: z
      .strictObject({
        path: z.string().min(1).max(200),
        title: z.string().min(1).max(80),
      })
      .optional(),
  })
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
  /** Read tools the model may call. Absent means a plain chat. */
  toolkit?: AssistantToolkit
}

/**
 * What the assistant can look up. Built server-side from the MCP read tools
 * under the signed-in person's own access; the model only ever sees names,
 * descriptions and results.
 */
export interface AssistantToolkit {
  defs: ProviderToolDef[]
  /** Standing instructions for using the tools. */
  instructions: string
  /** Runs one call. `name` is the wire name; `argumentsJson` is the model's text. */
  run: (
    name: string,
    argumentsJson: string,
  ) => Promise<{
    text: string
    isError: boolean
    /** A change for the person to apply or dismiss. Never written by the call. */
    proposal?: AssistantProposal
  }>
}

/** Model steps in one turn; the last one is not offered tools, so it must answer. */
export const ASSISTANT_MAX_STEPS = 6

/** Tool calls honoured in one step; extras are answered with an error. */
export const ASSISTANT_MAX_CALLS_PER_STEP = 4

function toObjectRef(
  ref: AskAssistantInput['objectRefs'][number],
): AiObjectRef {
  return {
    kind: ref.kind,
    id: ref.id,
    pinnedVersionId: ref.pinnedVersionId ?? null,
  }
}

export type Failure = Extract<
  AskAssistantResult,
  { status: 'unavailable' | 'error' }
>

export interface Prepared {
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
export async function prepare(
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

export function gatewayFailure(error: unknown): Failure {
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

export function pricingFor(
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
  | { type: 'text'; delta: string }
  | {
      type: 'tool'
      id: string
      /** The MCP tool name, e.g. `sheetbase.search`. */
      name: string
      phase: 'start' | 'end'
      /** Parsed arguments, when they were valid JSON. */
      input?: unknown
      ok?: boolean
      /** Set when the call proposed a change for the person to apply. */
      proposal?: AssistantProposal
    }
  | { type: 'finish'; usage: GatewayUsage }

export type AssistantStreamStart =
  | Failure
  | {
      status: 'ok'
      mode: 'built-in' | 'provider'
      providerProfile: string | null
      sources: AssistantSource[]
      omissions: number
      /**
       * The turn as it unfolds: answer text cleaned of junk tokens, tool
       * lookups as they start and finish, then `finish` once usage is
       * recorded. A failure part-way is thrown as a `ModelGatewayError` for
       * the caller to turn into an error part.
       */
      events: AsyncGenerator<AssistantStreamEvent, void, void>
    }

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Where the person is, so "this week" on the Schedule or "the open ones" on
 * Requests means what they are looking at. Only the page's name and address
 * are sent, never its text.
 */
export function pageLine(page: AssistantChatInput['page']): string | null {
  if (!page) return null
  const path = page.path.replaceAll(/[^\w/?=&.,:-]/g, '')

  return `The person is on the ${page.title.replaceAll(/[^\p{L}\p{N} ·&'-]/gu, '')} page (${path}). Questions about "this", "here" or "these" are about what that page shows.`
}

/**
 * Streaming chat turn. Everything before the first byte (readiness, context,
 * budget) is decided here and returned as a plain result, so the caller can
 * answer with a normal error response; only a later failure surfaces inside
 * `events`.
 *
 * With a toolkit the model may look things up: each step is its own governed
 * gateway call (own policy check, own telemetry), and the token and cost caps
 * are shared across the whole turn so tool use cannot multiply the budget.
 */
export async function streamAssistant(
  input: AssistantChatInput,
  deps: AssistantDeps,
  signal?: AbortSignal,
): Promise<AssistantStreamStart> {
  const prepared = await prepare(input, deps)

  if ('status' in prepared) return prepared
  const run: Prepared = prepared

  const toolkit =
    deps.toolkit && run.provider.supportsTools === true
      ? deps.toolkit
      : undefined

  const instructions = [
    toolkit
      ? toolkit.instructions
      : 'You have no tools and cannot look anything up beyond the supplied context.',
    pageLine(input.page),
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: ProviderMessage[] = trimHistory(input.messages)
  const spent = { tokens: 0, cost: 0, latencyMs: 0 }

  function step(withTools: boolean) {
    return streamModel(
      deps.actor,
      {
        model: deps.settings.model,
        tools: [],
        toolDefs: withTools ? toolkit?.defs : undefined,
        contextEnvelope: run.envelope,
        citations: [],
        messages,
        instructions,
        signal,
        limits: {
          maxTokens: deps.settings.maxTokensPerCall,
          maxCostMicrousd: deps.settings.maxCostMicrousdPerCall,
          usedTokens: spent.tokens,
          usedCostMicrousd: spent.cost,
        },
      },
      { provider: run.provider, pricing: pricingFor(run, deps) },
    )
  }

  // Pull the first event now: the gateway's pre-call policy runs on the first
  // `next()`, so a budget or allowlist rejection becomes a plain failure here
  // instead of a broken stream.
  const firstStep = step(toolkit !== undefined)
  let first: IteratorResult<GatewayStreamEvent, void>

  try {
    first = await firstStep.next()
  } catch (error) {
    return gatewayFailure(error)
  }

  async function* events(): AsyncGenerator<AssistantStreamEvent, void, void> {
    let anyContent = false
    let gateway = firstStep
    let pending = first

    for (let index = 0; index < ASSISTANT_MAX_STEPS; index++) {
      const cleaner = new AnswerCleaner()
      const calls: Array<{ id: string; name: string; arguments: string }> = []
      let stepText = ''

      for (;;) {
        const event = pending

        if (event.done) break
        const value = event.value

        if (value.type === 'text') {
          const safe = cleaner.push(value.delta)

          if (safe !== '') {
            stepText += safe
            yield { type: 'text', delta: safe }
          }
        } else if (value.type === 'tool_call') {
          calls.push({
            id: value.id,
            name: value.name,
            arguments: value.arguments,
          })
        } else {
          const tail = cleaner.finish()

          if (tail !== '') {
            stepText += tail
            yield { type: 'text', delta: tail }
          }

          spent.tokens += value.usage.tokensUsed
          spent.cost += value.usage.costMicrousd
          spent.latencyMs += value.usage.latencyMs
        }

        pending = await gateway.next()
      }

      if (cleaner.hasContent) anyContent = true

      const canContinue =
        toolkit !== undefined && index < ASSISTANT_MAX_STEPS - 1

      if (calls.length === 0 || !canContinue) break

      messages.push({
        role: 'assistant',
        content: stepText,
        toolCalls: calls,
      })

      for (const [position, call] of calls.entries()) {
        const name = fromWireToolName(call.name)
        const parsed = parseJson(call.arguments)
        yield { type: 'tool', id: call.id, name, phase: 'start', input: parsed }

        let result: {
          text: string
          isError: boolean
          proposal?: AssistantProposal
        }

        if (position >= ASSISTANT_MAX_CALLS_PER_STEP) {
          result = {
            text: 'Too many lookups at once. Ask for fewer things per step.',
            isError: true,
          }
        } else {
          try {
            result = await toolkit.run(call.name, call.arguments)
          } catch {
            result = { text: 'The lookup could not complete.', isError: true }
          }
        }

        yield {
          type: 'tool',
          id: call.id,
          name,
          phase: 'end',
          ok: !result.isError,
          proposal: result.proposal,
        }
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: result.text,
        })
      }

      // The next step: policy check and a fresh provider call.
      gateway = step(index + 1 < ASSISTANT_MAX_STEPS - 1)
      pending = await gateway.next()
    }

    if (!anyContent) yield { type: 'text', delta: EMPTY_ANSWER_MESSAGE }
    yield {
      type: 'finish',
      usage: {
        tokensUsed: spent.tokens,
        costMicrousd: spent.cost,
        latencyMs: spent.latencyMs,
      },
    }
  }

  return {
    status: 'ok',
    mode: run.mode,
    providerProfile: run.providerProfile,
    sources: run.sources,
    omissions: run.envelope.omissions.length,
    events: events(),
  }
}
