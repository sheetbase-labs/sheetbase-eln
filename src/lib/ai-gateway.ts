/**
 * AI-03 — Governed model-call boundary.
 *
 * Every model call passes through `callModel`: the model and every requested
 * tool must be allowlisted (unknown values are rejected fail-closed, before
 * any provider is touched), the envelope's actor must equal the calling
 * actor (context never travels beyond the actor whose reads assembled it),
 * and the call must fit the caller's token/cost budgets. Model output is
 * never authoritative state — the gateway returns provider text plus the
 * citation set it was given, echoed verbatim, so callers can ground any
 * consequential use.
 *
 * There are no vendor integrations here: the only `ModelProvider` is a
 * deterministic stub for tests and eval fixtures. Adding a real provider
 * means implementing the `ModelProvider` interface in a later roadmap step —
 * never credentials handling or network clients in this module.
 *
 * ## Logging policy
 *
 * Default telemetry carries hashes, sizes and identifiers — never prompt or
 * output text:
 *
 * - `ai.gateway.call` (info): model, actor kind + id, tool names, prompt
 *   content hash (FNV-1a 64-bit log-join key, not a security digest),
 *   prompt length in chars, estimated tokens/cost, citation IDs.
 * - `ai.gateway.result` (info): model, prompt hash (joins to the call line),
 *   actual tokens/cost, latency in ms, citation IDs.
 * - `ai.gateway.rejected` (warn): error code, reason, model as given, actor
 *   kind + id. No prompt material at all.
 *
 * Full prompts, excerpts, envelope sections, provider output text and raw
 * secret values are never logged by default — operators debug with the hash
 * (recomputed from a local reproduction) and the citation IDs. Every payload
 * passes through the canonical logger `redact()`, so secret-shaped keys are
 * stripped even if a future envelope field carries them.
 *
 * Explicit opt-in debug excerpt: a caller may set
 * `CallModelInput.includeDebugExcerpt` for a single call to attach a
 * `debugPromptExcerpt` field to `ai.gateway.call`. The boundary is
 * `redact()` + `redactDebugExcerpt()` string scrubbing + the
 * `GATEWAY_EXCERPT_CHARS` cap + per-call opt-in — never ambient (no env var,
 * no global toggle). Debug excerpts stay out of production; they exist for
 * local reproduction of truncation or grounding faults.
 */

import { z } from 'zod'

import { parsePluginName } from './extensions/points'
import type { AiContextActor, AiContextEnvelope } from './ai-context'
import type { AiCitation } from './ai-retrieval'
import {
  AGENT_OPERATION_TOOL_NAMES,
  ASSISTANT_PROPOSE_TOOL_NAMES,
  ASSISTANT_READ_TOOL_NAMES,
  fromWireToolName,
} from './agent-tool-catalogue'
import { logger, redact } from './logger'
import type {
  ProviderMessage,
  ProviderStreamChunk,
  ProviderToolCall,
  ProviderToolDef,
} from './ai-providers/types'
import { MODEL_ERROR_CODES, MODEL_NAMES, metrics } from './metrics'
import type { MetricsRegistry, ModelErrorCode, ModelName } from './metrics'

/** Allowlisted models: the gateway rejects anything else fail-closed. */
export const GATEWAY_MODELS = MODEL_NAMES

export type GatewayModel = ModelName

/**
 * Allowlisted tools: the AUTO-PLUS-01 tool catalogue's operation vocabulary.
 * Single authority is `AGENT_OPERATION_TOOL_NAMES` — a model call may only
 * request tools the workflow layer can actually execute.
 */
export const GATEWAY_TOOLS = AGENT_OPERATION_TOOL_NAMES

export type GatewayTool = (typeof GATEWAY_TOOLS)[number]

/** Rejection codes. Each is also a bounded `sheetbase_model_errors_total` label. */
export type GatewayErrorCode = ModelErrorCode

export class ModelGatewayError extends Error {
  readonly code: GatewayErrorCode
  constructor(
    code: GatewayErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ModelGatewayError'
    this.code = code
  }
}

/** Minimal provider contract: complete a prompt, report usage. */
export interface ModelRequest {
  prompt: string
  /** Tokens remaining under the caller's cap; the provider must fit inside. */
  maxTokens: number
  /** Citation IDs the response may reference; echoed back in the result. */
  citationIds: string[]
  /** Conversation so far, ending with the latest question. */
  messages?: ProviderMessage[]
  /** Standing instructions placed with the context. */
  instructions?: string
  /** Tools the model may call this step. */
  tools?: ProviderToolDef[]
  /** Aborts an in-flight call. */
  signal?: AbortSignal
}

export interface ModelResponse {
  text: string
  tokensUsed: number
  costMicrousd: number
}

export interface ModelProvider {
  readonly name: string
  complete: (request: ModelRequest) => Promise<ModelResponse>
  /**
   * Optional incremental answer. Providers without it are streamed as one
   * chunk by the gateway, so every provider stays usable in a chat.
   */
  stream?: (request: ModelRequest) => AsyncIterable<ProviderStreamChunk>
  /** True when `stream` can carry tool calls. Others are offered no tools. */
  readonly supportsTools?: boolean
}

/**
 * Deterministic fixture pricing in micro-USD per token. This is eval
 * accounting, not vendor pricing — the stub charges exactly these rates.
 */
export const MODEL_MICROUSD_PER_TOKEN: Record<GatewayModel, number> = {
  'sheetbase-assist-1': 2,
  'sheetbase-summarise-1': 1,
}

/** Chars-per-token proxy, matching the AI-01 envelope convention (~4 chars). */
export const GATEWAY_CHARS_PER_TOKEN = 4

/** Max prompt characters kept in the opt-in `debugPromptExcerpt` field. */
export const GATEWAY_EXCERPT_CHARS = 200

export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / GATEWAY_CHARS_PER_TOKEN))
}

export function hashPrompt(prompt: string): string {
  // FNV-1a 64-bit over UTF-16 code units. Isomorphic by construction:
  // ai-gateway ships in client bundles (ASSIST surfaces), where
  // `node:crypto` is externalized and unusable. This is a log-join key,
  // not a security boundary — it only needs determinism, not SHA-256.
  let hash = 0xcbf29ce484222325n

  for (let i = 0; i < prompt.length; i++) {
    hash ^= BigInt(prompt.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }

  return hash.toString(16).padStart(16, '0')
}

/**
 * String-level scrub for the opt-in debug excerpt. The canonical `redact()`
 * only strips secret-shaped object keys — a raw prompt slice needs its own
 * pass: secret-shaped tokens and `key: value` / `key=value` pairs are
 * replaced with `[redacted]`, then the result is capped at
 * `GATEWAY_EXCERPT_CHARS`. Debug-only; default telemetry never calls this.
 */
function redactDebugExcerpt(prompt: string): string {
  const scrubbed = prompt
    .replace(/\bsk[_-][A-Za-z0-9_-]{4,}/g, '[redacted]')
    .replace(
      /(api[_-]?token|session[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|authorization|set-cookie|cookie|pgrst_jwt_secret|better_auth_secret|github_client_secret|postgres_password)\s*[:=]\s*[^\s,}]+/gi,
      '$1=[redacted]',
    )
    .replace(/(\btoken\b|\bbearer\b)\s*[:=]\s*[^\s,}]+/gi, '$1=[redacted]')

  return scrubbed.slice(0, GATEWAY_EXCERPT_CHARS)
}

/**
 * Deterministic stub provider for tests and eval fixtures. Returns a canned
 * response that names the citation IDs it was given, with token/cost usage
 * derived deterministically from the response text at fixture pricing.
 * No network, no credentials, no vendor SDK.
 */
export class StubModelProvider implements ModelProvider {
  readonly name: string
  private readonly cannedPrefix: string

  constructor(
    private readonly model: GatewayModel,
    cannedPrefix = 'Stub response',
  ) {
    this.name = `stub:${model}`
    this.cannedPrefix = cannedPrefix
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const refs =
      request.citationIds.length > 0 ? request.citationIds.join(', ') : 'none'

    const text = `${this.cannedPrefix} from ${this.model} (citations: ${refs}).`
    const tokensUsed = estimateTokensFromChars(text.length)

    return {
      text,
      tokensUsed,
      costMicrousd: tokensUsed * MODEL_MICROUSD_PER_TOKEN[this.model],
    }
  }
}

export interface GatewayLimits {
  maxTokens: number
  maxCostMicrousd: number
  /** Cumulative usage already spent against these caps (workflow precedent). */
  usedTokens?: number
  usedCostMicrousd?: number
}

export interface CallModelInput {
  model: string
  tools: string[]
  contextEnvelope: AiContextEnvelope
  citations?: AiCitation[]
  limits: GatewayLimits
  /**
   * Conversation so far, oldest first, ending with the latest question. Only
   * text crosses the boundary; it is budgeted with the context and never
   * logged.
   */
  messages?: ProviderMessage[]
  /** Standing instructions placed with the context (not logged). */
  instructions?: string
  /**
   * Read tools the model may call this step. Every name must be on the
   * assistant read allowlist; anything else is rejected before a provider is
   * touched. The gateway only offers them: running them is the caller's job.
   */
  toolDefs?: ProviderToolDef[]
  /** Aborts the provider call when the person stops waiting. */
  signal?: AbortSignal
  /**
   * Per-call opt-in for a redacted, capped `debugPromptExcerpt` on the
   * `ai.gateway.call` log record. Default false; there is no ambient or
   * global toggle. Debug-only — never enable in production.
   */
  includeDebugExcerpt?: boolean
}

export interface GatewayDeps {
  provider?: ModelProvider
  registry?: MetricsRegistry
  /**
   * Per-token cost estimate used only for the pre-call budget check. The
   * provider returns authoritative cost after the call; a workspace with a
   * real provider supplies that provider's rate here so a call that plainly
   * cannot fit is rejected before any network traffic.
   */
  pricing?: Partial<Record<GatewayModel, number>>
}

export interface GatewayUsage {
  tokensUsed: number
  costMicrousd: number
  latencyMs: number
}

/** The bounded, prompt-free fields of one gateway call, as the log carries them. */
interface GatewayCallFields {
  model: GatewayModel
  tools: string[]
  actorKind: AiContextActor['kind']
  actorId: string
  promptHash: string
  promptChars: number
  estimatedTokens: number
  estimatedCostMicrousd: number
  citationIds: string[]
  toolNames?: string[]
  historyTurns?: number
  historyChars?: number
  debugPromptExcerpt?: string
  /** The logger takes the fields as a flat record. */
  [field: string]: string | number | string[] | undefined
}

export interface GatewayResult {
  text: string
  model: GatewayModel
  /** The input citations, echoed verbatim — the gateway never drops or invents them. */
  citations: AiCitation[]
  usage: GatewayUsage
}

function isGatewayModel(model: string): model is GatewayModel {
  return GATEWAY_MODELS.some((known) => known === model)
}

function isGatewayTool(tool: string): tool is GatewayTool {
  return GATEWAY_TOOLS.some((known) => known === tool)
}

/**
 * Serialize the envelope into the provider prompt using known fields only:
 * object identity, section headings/bodies, omission refs and citation IDs.
 * Unknown extra keys on envelope objects are ignored, never forwarded.
 */
export function buildGatewayPrompt(
  envelope: AiContextEnvelope,
  citations: AiCitation[],
): string {
  const lines = [
    `# Sheetbase model context (v${envelope.version})`,
    `workspace: ${envelope.workspace.id}`,
  ]

  for (const object of envelope.objects) {
    lines.push(
      `## [${object.kind}:${object.id}] ${object.title} (${object.freshness})`,
    )

    for (const section of object.sections) {
      lines.push(`### ${section.heading}`)
      lines.push(section.body)
    }
  }

  for (const omission of envelope.omissions) {
    lines.push(`- omitted ${omission.kind}:${omission.id} (${omission.reason})`)
  }

  const ids = citations.map((citation) => citation.stableId)
  lines.push(`citations: ${ids.length > 0 ? ids.join(', ') : 'none'}`)

  return lines.join('\n')
}

/**
 * Bounded, body-free detail of a provider failure for the rejection log: the
 * provider error code, profile id and HTTP status only. Never the message
 * body, which an upstream error can fill with the prompt.
 */
interface ProviderFailureFields {
  providerCode?: string
  providerId?: string
  providerStatus?: number
}

/** The provider SDK's failure shape, as much of it as the log may carry. */
const providerFailure = z.looseObject({
  code: z.string().optional(),
  providerId: z.string().optional(),
  status: z.number().optional(),
})

function providerFailureFields(
  // A caught throw from the upstream SDK; the schema above keeps only its code, profile id and status.
  cause: unknown,
): ProviderFailureFields {
  const decoded = providerFailure.safeParse(cause)

  if (!decoded.success) return {}

  const fields: ProviderFailureFields = {}

  if (decoded.data.code !== undefined) fields.providerCode = decoded.data.code

  if (decoded.data.providerId !== undefined)
    fields.providerId = decoded.data.providerId

  if (decoded.data.status !== undefined)
    fields.providerStatus = decoded.data.status

  return fields
}

function reject(
  registry: MetricsRegistry,
  model: string,
  code: GatewayErrorCode,
  reason: string,
  actor: AiContextActor,
): never {
  registry.modelCalls.inc({ model, outcome: 'rejected' })
  registry.modelErrors.inc({ model, code })
  logger.warn(
    'ai.gateway.rejected',
    redact({ code, reason, model, actorKind: actor.kind, actorId: actor.id }),
  )
  throw new ModelGatewayError(code, reason)
}

interface PreparedCall {
  model: GatewayModel
  registry: MetricsRegistry
  citations: AiCitation[]
  citationIds: string[]
  prompt: string
  promptHash: string
  usedTokens: number
  usedCostMicrousd: number
}

/**
 * Every pre-call policy check, shared by the one-shot and streaming paths so
 * they cannot drift: allowlists, actor match, budget estimate (context plus
 * conversation history), then the hash-only `ai.gateway.call` line.
 */
function prepareCall(
  actor: AiContextActor,
  input: CallModelInput,
  deps: GatewayDeps,
): PreparedCall {
  const registry = deps.registry ?? metrics
  const citations = input.citations ?? []

  if (!actor.id) {
    throw new ModelGatewayError(
      'actor_mismatch',
      'callModel requires a concrete actor',
    )
  }

  if (!isGatewayModel(input.model)) {
    reject(
      registry,
      input.model,
      'model_not_allowed',
      `model '${input.model}' is not allowlisted`,
      actor,
    )
  }

  const model = input.model

  for (const tool of input.tools) {
    if (!isGatewayTool(tool)) {
      reject(
        registry,
        model,
        'tool_not_allowed',
        `tool '${tool}' is not allowlisted`,
        actor,
      )
    }
  }

  for (const def of input.toolDefs ?? []) {
    const original = fromWireToolName(def.name)

    if (
      !ASSISTANT_READ_TOOL_NAMES.includes(original) &&
      !ASSISTANT_PROPOSE_TOOL_NAMES.includes(original) &&
      // A tool an administrator-installed extension declares. The toolkit
      // builds these definitions from the workspace's enabled installs and
      // refuses a call to anything it did not offer.
      parsePluginName(original) === null
    ) {
      reject(
        registry,
        model,
        'tool_not_allowed',
        `tool '${original}' is not on the assistant tool allowlist`,
        actor,
      )
    }
  }

  const envelope = input.contextEnvelope

  if (envelope.actor.kind !== actor.kind || envelope.actor.id !== actor.id) {
    reject(
      registry,
      model,
      'actor_mismatch',
      'context envelope actor does not match the calling actor',
      actor,
    )
  }

  const usedTokens = input.limits.usedTokens ?? 0
  const usedCostMicrousd = input.limits.usedCostMicrousd ?? 0

  const historyChars =
    (input.messages ?? []).reduce(
      (total, turn) =>
        total +
        turn.content.length +
        ('toolCalls' in turn
          ? turn.toolCalls.reduce((n, call) => n + call.arguments.length, 0)
          : 0),
      0,
    ) +
    // Tool definitions and standing instructions are sent every step.
    (input.toolDefs ? JSON.stringify(input.toolDefs).length : 0) +
    (input.instructions?.length ?? 0)

  const estimatedTokens = estimateTokensFromChars(
    envelope.budgets.usage.chars + historyChars,
  )

  const costPerToken = deps.pricing?.[model] ?? MODEL_MICROUSD_PER_TOKEN[model]
  const estimatedCostMicrousd = Math.ceil(estimatedTokens * costPerToken)

  if (usedTokens + estimatedTokens > input.limits.maxTokens) {
    reject(
      registry,
      model,
      'budget_exhausted',
      'estimated tokens exceed the call token budget',
      actor,
    )
  }

  if (usedCostMicrousd + estimatedCostMicrousd > input.limits.maxCostMicrousd) {
    reject(
      registry,
      model,
      'budget_exhausted',
      'estimated cost exceeds the call cost budget',
      actor,
    )
  }

  const prompt = buildGatewayPrompt(envelope, citations)
  const promptHash = hashPrompt(prompt)
  const citationIds = citations.map((citation) => citation.stableId)

  const callFields: GatewayCallFields = {
    model,
    tools: input.tools,
    actorKind: actor.kind,
    actorId: actor.id,
    promptHash,
    promptChars: prompt.length,
    estimatedTokens,
    estimatedCostMicrousd,
    citationIds,
  }

  if (input.toolDefs && input.toolDefs.length > 0) {
    callFields.toolNames = input.toolDefs.map((def) => def.name)
  }

  if (input.messages && input.messages.length > 0) {
    // Counts only: the conversation text is never logged.
    callFields.historyTurns = input.messages.length
    callFields.historyChars = historyChars
  }

  if (input.includeDebugExcerpt === true) {
    callFields.debugPromptExcerpt = redactDebugExcerpt(prompt)
  }

  logger.info('ai.gateway.call', redact(callFields))

  return {
    model,
    registry,
    citations,
    citationIds,
    prompt,
    promptHash,
    usedTokens,
    usedCostMicrousd,
  }
}

/**
 * The governed model-call boundary. Fail-closed: any policy violation throws
 * `ModelGatewayError` before (pre-call checks) or after (usage overrun) the
 * provider is invoked, and every path emits telemetry.
 */
export async function callModel(
  actor: AiContextActor,
  input: CallModelInput,
  deps: GatewayDeps = {},
): Promise<GatewayResult> {
  const {
    model,
    registry,
    citations,
    citationIds,
    prompt,
    promptHash,
    usedTokens,
    usedCostMicrousd,
  } = prepareCall(actor, input, deps)

  const provider = deps.provider ?? new StubModelProvider(model)
  const startedAt = Date.now()
  let response: ModelResponse

  try {
    response = await provider.complete({
      prompt,
      maxTokens: input.limits.maxTokens - usedTokens,
      citationIds,
      messages: input.messages,
      instructions: input.instructions,
      signal: input.signal,
    })
  } catch (cause) {
    registry.modelCalls.inc({ model, outcome: 'error' })
    registry.modelErrors.inc({ model, code: 'provider_error' })
    logger.warn(
      'ai.gateway.rejected',
      redact({
        code: 'provider_error',
        model,
        promptHash,
        ...providerFailureFields(cause),
      }),
    )
    throw new ModelGatewayError('provider_error', 'model provider failed', {
      cause,
    })
  }

  const latencyMs = Date.now() - startedAt
  registry.modelDuration.observe({ model }, latencyMs / 1000)
  registry.modelCost.inc({ model }, response.costMicrousd)

  if (
    usedTokens + response.tokensUsed > input.limits.maxTokens ||
    usedCostMicrousd + response.costMicrousd > input.limits.maxCostMicrousd
  ) {
    registry.modelCalls.inc({ model, outcome: 'rejected' })
    registry.modelErrors.inc({ model, code: 'budget_exhausted' })
    logger.warn(
      'ai.gateway.rejected',
      redact({ code: 'budget_exhausted', model, promptHash }),
    )
    throw new ModelGatewayError(
      'budget_exhausted',
      'actual provider usage exceeded the call budget',
    )
  }

  registry.modelCalls.inc({ model, outcome: 'ok' })
  logger.info(
    'ai.gateway.result',
    redact({
      model,
      promptHash,
      tokensUsed: response.tokensUsed,
      costMicrousd: response.costMicrousd,
      latencyMs,
      citationIds,
    }),
  )

  return {
    text: response.text,
    model,
    citations,
    usage: {
      tokensUsed: response.tokensUsed,
      costMicrousd: response.costMicrousd,
      latencyMs,
    },
  }
}

export type GatewayStreamEvent =
  | { type: 'text'; delta: string }
  | ({ type: 'tool_call' } & ProviderToolCall)
  | { type: 'finish'; usage: GatewayUsage; model: GatewayModel }

/**
 * Streaming twin of `callModel`. The same pre-call policy runs before any
 * provider traffic (so a budget rejection throws before the first byte), the
 * provider is invoked exactly once with no retry, and usage is recorded when
 * the stream ends: the final `finish` event carries actual (or, if the
 * provider reports none, estimated) tokens and cost.
 *
 * A stream cannot be taken back once text has been sent, so an overrun found
 * at the end is logged and counted as `budget_exhausted` rather than thrown;
 * the provider's `maxTokens` cap is what bounds it. A provider without native
 * streaming is delivered as a single chunk.
 */
export async function* streamModel(
  actor: AiContextActor,
  input: CallModelInput,
  deps: GatewayDeps = {},
): AsyncGenerator<GatewayStreamEvent, void, void> {
  const {
    model,
    registry,
    citationIds,
    prompt,
    promptHash,
    usedTokens,
    usedCostMicrousd,
  } = prepareCall(actor, input, deps)

  const provider: ModelProvider = deps.provider ?? new StubModelProvider(model)

  const request: ModelRequest = {
    prompt,
    maxTokens: input.limits.maxTokens - usedTokens,
    citationIds,
    messages: input.messages,
    instructions: input.instructions,
    tools:
      provider.supportsTools === true && input.toolDefs?.length
        ? input.toolDefs
        : undefined,
    signal: input.signal,
  }

  const startedAt = Date.now()
  let emittedChars = 0
  let usage: { tokensUsed: number; costMicrousd: number } | null = null

  try {
    const chunks: AsyncIterable<ProviderStreamChunk> = provider.stream
      ? provider.stream(request)
      : (async function* () {
          const response = await provider.complete(request)
          yield { type: 'text', delta: response.text } as const
          yield {
            type: 'usage',
            tokensUsed: response.tokensUsed,
            costMicrousd: response.costMicrousd,
          } as const
        })()

    for await (const chunk of chunks) {
      if (chunk.type === 'text') {
        emittedChars += chunk.delta.length
        yield { type: 'text', delta: chunk.delta }
      } else if (chunk.type === 'tool_call') {
        emittedChars += chunk.arguments.length
        yield chunk
      } else {
        usage = {
          tokensUsed: chunk.tokensUsed,
          costMicrousd: chunk.costMicrousd,
        }
      }
    }
  } catch (cause) {
    if (input.signal?.aborted) {
      // The person stopped waiting. Not a provider fault; record what we know.
      registry.modelCalls.inc({ model, outcome: 'ok' })
      logger.info(
        'ai.gateway.result',
        redact({
          model,
          promptHash,
          aborted: true,
          latencyMs: Date.now() - startedAt,
          citationIds,
        }),
      )

      return
    }

    registry.modelCalls.inc({ model, outcome: 'error' })
    registry.modelErrors.inc({ model, code: 'provider_error' })
    logger.warn(
      'ai.gateway.rejected',
      redact({
        code: 'provider_error',
        model,
        promptHash,
        ...providerFailureFields(cause),
      }),
    )
    throw new ModelGatewayError('provider_error', 'model provider failed', {
      cause,
    })
  }

  const latencyMs = Date.now() - startedAt

  const finalUsage = usage ?? {
    // A provider that reports nothing must not produce a zero-cost lie.
    tokensUsed:
      estimateTokensFromChars(prompt.length) +
      estimateTokensFromChars(emittedChars),
    costMicrousd: 0,
  }

  registry.modelDuration.observe({ model }, latencyMs / 1000)
  registry.modelCost.inc({ model }, finalUsage.costMicrousd)

  if (
    usedTokens + finalUsage.tokensUsed > input.limits.maxTokens ||
    usedCostMicrousd + finalUsage.costMicrousd > input.limits.maxCostMicrousd
  ) {
    registry.modelErrors.inc({ model, code: 'budget_exhausted' })
    logger.warn(
      'ai.gateway.rejected',
      redact({
        code: 'budget_exhausted',
        reason: 'streamed usage exceeded the call budget',
        model,
        promptHash,
      }),
    )
  }

  registry.modelCalls.inc({ model, outcome: 'ok' })
  logger.info(
    'ai.gateway.result',
    redact({
      model,
      promptHash,
      tokensUsed: finalUsage.tokensUsed,
      costMicrousd: finalUsage.costMicrousd,
      latencyMs,
      citationIds,
      streamed: true,
    }),
  )
  yield {
    type: 'finish',
    model,
    usage: { ...finalUsage, latencyMs },
  }
}

/** All gateway rejection codes, for parity with the metrics error vocabulary. */
export const GATEWAY_ERROR_CODES = MODEL_ERROR_CODES
