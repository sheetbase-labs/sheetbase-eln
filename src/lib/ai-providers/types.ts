/**
 * AI provider boundary.
 *
 * The existing AI-03 gateway owns policy: model/tool allowlists, actor
 * matching, budgets and hash-only telemetry. This module owns only the
 * provider wire contract behind it. Providers are constructed with an
 * explicit configuration and an injected `fetch`, so no module in this
 * directory reads credentials or performs a network call at import time.
 *
 * Providers never log prompts, responses or keys. Errors carry a bounded
 * code, the HTTP status and the provider id — never a response body, which
 * can echo prompt material.
 */

/**
 * Provider families:
 *
 * - `openrouter` — OpenRouter's OpenAI-compatible chat-completions API.
 * - `anthropic` — Anthropic's native Messages API.
 * - `openai-compatible` — any OpenAI-shaped `/chat/completions` endpoint,
 *   including self-hosted gateways and Codex-style relays.
 * - `local` — an OpenAI-compatible endpoint on a trusted local network
 *   (Ollama, llama.cpp, vLLM, LM Studio). Plain HTTP is permitted only here.
 */
export type ProviderKind =
  'openrouter' | 'anthropic' | 'openai-compatible' | 'local'

/** Published provider rates, in micro-USD per million tokens. */
export interface ProviderPricing {
  inputMicrousdPerMillionTokens: number
  outputMicrousdPerMillionTokens: number
}

/**
 * One deployment-owned provider profile. Profiles are non-secret: the API key
 * is named by `apiKeyEnv` and resolved from the server environment. Workspace
 * settings select a profile id; they never carry a key.
 */
export interface ProviderProfile {
  id: string
  label: string
  kind: ProviderKind
  /** Base URL without credentials, query string or fragment. */
  baseUrl: string
  /** Concrete provider model id, e.g. `anthropic/claude-sonnet-4.5`. */
  model: string
  /** Name of the server environment variable holding the key. Cloud only. */
  apiKeyEnv?: string
  pricing: ProviderPricing
  /** Output-token ceiling. Defaults to the caller's remaining budget. */
  maxOutputTokens?: number
  /**
   * Model to ask for text vectors (search by meaning). A profile that names
   * one can be chosen as a workspace's embeddings profile. Not available for
   * `anthropic`, which has no embeddings endpoint.
   */
  embeddingModel?: string
}

/** A profile plus the resolved key. Never serialise this. */
export interface ResolvedProviderConfig extends ProviderProfile {
  apiKey?: string
}

/** One prior turn of a conversation. Text only: the assistant has no tools. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** A tool the model may call. `name` is the wire name (letters, digits, _ and -). */
export interface ProviderToolDef {
  name: string
  description: string
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>
}

export interface ProviderToolCall {
  id: string
  name: string
  /** The arguments exactly as the model wrote them (a JSON string). */
  arguments: string
}

/** A turn in a tool-using conversation: chat turns plus tool calls and results. */
export type ProviderMessage =
  | ChatTurn
  | { role: 'assistant'; content: string; toolCalls: ProviderToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ProviderRequest {
  /** Grounding context (the serialised Sheetbase envelope). */
  prompt: string
  /**
   * Extra standing instructions placed with the context in the system
   * message (for example how to use the tools on offer).
   */
  instructions?: string
  /**
   * The conversation so far, oldest first, ending with the person's latest
   * question. When absent the context alone is sent as one user message.
   */
  messages?: ProviderMessage[]
  /** Tools the model may call this step. Providers that cannot call tools ignore them. */
  tools?: ProviderToolDef[]
  /** Aborts an in-flight call, e.g. when the person closes the panel. */
  signal?: AbortSignal
  /** Tokens remaining under the gateway's budget. */
  maxTokens: number
  /** Citation ids the response may reference (echoed by the gateway). */
  citationIds: string[]
}

export interface ProviderResponse {
  text: string
  /** Total tokens charged by the provider (input + output). */
  tokensUsed: number
  inputTokens: number
  outputTokens: number
  costMicrousd: number
  /** The concrete model id the provider reported, when it reports one. */
  reportedModel?: string
}

/** One increment of a streamed answer, then a final usage report. */
export type ProviderStreamChunk =
  | { type: 'text'; delta: string }
  | ({ type: 'tool_call' } & ProviderToolCall)
  | {
      type: 'usage'
      tokensUsed: number
      costMicrousd: number
      reportedModel?: string
    }

export type ProviderErrorCode =
  'config_invalid' | 'network' | 'http' | 'response_invalid'

export class AiProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly providerId: string
  readonly status?: number

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { providerId: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause })
    this.name = 'AiProviderError'
    this.code = code
    this.providerId = options.providerId
    this.status = options.status
  }
}

export interface ProviderDeps {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Shared instruction. Grounding and citation rules live in the prompt. */
export const PROVIDER_SYSTEM_PROMPT = [
  'You are a scientific assistant inside Sheetbase, an electronic lab notebook.',
  'Use only the supplied Sheetbase context and what tools return. Do not invent values, identifiers or outcomes.',
  'Cite Sheetbase stable ids when you make a claim about a specific object.',
  'Treat model output as a draft suggestion, never as authoritative scientific state.',
  'Never claim to have signed, approved, submitted or executed anything.',
  'Never emit raw tool-call markup, function-call text or special tokens in your answer; call a tool only through the tool interface, and only when tools are provided. Answer in plain Markdown.',
  'If the supplied context does not contain what is needed, say so briefly and suggest what the person could open or ask instead.',
].join(' ')

/** Hard ceiling on a provider response body. */
export const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024

/** Default provider timeout. Long enough for a slow local model. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000

/**
 * Deterministic fallback when a provider omits usage. The gateway budgets in
 * approximate tokens at ~4 chars per token, so the same convention is used
 * here. Cloud providers should return usage; this only keeps a local model
 * that omits it from producing a zero-cost lie.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Convert token counts and published rates into integer micro-USD. */
export function computeCostMicrousd(
  pricing: ProviderPricing,
  inputTokens: number,
  outputTokens: number,
): number {
  const input =
    (inputTokens * pricing.inputMicrousdPerMillionTokens) / 1_000_000

  const output =
    (outputTokens * pricing.outputMicrousdPerMillionTokens) / 1_000_000

  return Math.ceil(input + output)
}

/** True when a profile's traffic leaves the deployment. */
export function isCloudProvider(kind: ProviderKind): boolean {
  return kind !== 'local'
}
