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
}

/** A profile plus the resolved key. Never serialise this. */
export interface ResolvedProviderConfig extends ProviderProfile {
  apiKey?: string
}

export interface ProviderRequest {
  prompt: string
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
  'Use only the supplied Sheetbase context. Do not invent values, identifiers or outcomes.',
  'Cite Sheetbase stable ids when you make a claim about a specific object.',
  'Treat model output as a draft suggestion, never as authoritative scientific state.',
  'Never claim to have signed, approved, submitted or executed anything.',
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
