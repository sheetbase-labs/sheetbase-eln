import { asRecord, joinUrl, postProviderJson } from './http'
import { AiProviderError } from './types'
import type { ProviderDeps, ProviderProfile } from './types'

/**
 * Text vectors from an OpenAI-shaped `/embeddings` endpoint (OpenAI,
 * OpenRouter, self-hosted gateways, Ollama, vLLM, LM Studio). Same rules as
 * the chat providers: no retry, no body in errors, the key never logged.
 */

/** Every stored vector is exactly this wide (see api.search_embeddings). */
export const EMBEDDING_DIMENSIONS = 1024

/** Texts per request. Small enough for local models, big enough to be cheap. */
export const EMBEDDING_BATCH = 32

export interface EmbeddingResult {
  /** One vector per input text, padded to `EMBEDDING_DIMENSIONS`. */
  vectors: number[][]
  /** The provider's token count, or an estimate when it omits one. */
  tokens: number
  /** The concrete model, which names the vector space. */
  model: string
}

/**
 * Shrink a wider vector to the stored width with a fixed random projection
 * (every output value is a signed sum of a few inputs, the same way every
 * time). Random projection keeps the angles between vectors close to what they
 * were, so cosine ranking holds for any model, not only ones trained to be cut
 * short.
 */
function projectVector(vector: readonly number[]) {
  const out = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  let state = 0x9e3779b9
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
  for (let i = 0; i < vector.length; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const bits = next()
      out[bits % EMBEDDING_DIMENSIONS] +=
        (bits & 0x80000000 ? -1 : 1) * vector[i]
    }
  }
  return out
}

/**
 * Fit a vector to the stored width and scale it to unit length. A narrower
 * vector is padded with zeros, which leaves cosine similarity unchanged, so a
 * 768-wide local model and a 1024-wide one share the same column. A wider one
 * is projected down. The column is a fixed width because the index needs one;
 * that is the only reason it is fixed.
 */
export function fitVector(vector: readonly number[], providerId: string) {
  if (vector.length === 0) {
    throw new AiProviderError(
      'response_invalid',
      'The embedding model returned no values',
      { providerId },
    )
  }
  let norm = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new AiProviderError(
        'response_invalid',
        'The embedding model returned a value that is not a number',
        { providerId },
      )
    }
    norm += value * value
  }
  let fitted: number[]
  if (vector.length > EMBEDDING_DIMENSIONS) {
    fitted = projectVector(vector)
    norm = 0
    for (const value of fitted) norm += value * value
  } else {
    fitted = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
    for (let i = 0; i < vector.length; i += 1) fitted[i] = vector[i]
  }
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 1
  return fitted.map((value) => value * scale)
}

export function buildEmbeddingRequest(
  profile: ProviderProfile,
  texts: readonly string[],
) {
  return {
    model: profile.embeddingModel,
    input: texts,
    // Models that can be shortened (OpenAI text-embedding-3, many local ones)
    // are asked for the stored width; the rest ignore it or are padded.
    ...(profile.kind === 'openai-compatible' || profile.kind === 'openrouter'
      ? { dimensions: EMBEDDING_DIMENSIONS }
      : {}),
    encoding_format: 'float',
  }
}

export function parseEmbeddingResponse(
  profile: ProviderProfile,
  texts: readonly string[],
  json: unknown,
): EmbeddingResult {
  const root = asRecord(json)
  const data = root?.data
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new AiProviderError(
      'response_invalid',
      'The embedding response did not match the request',
      { providerId: profile.id },
    )
  }
  const ordered = [...data]
    .map((entry, position) => ({
      index:
        typeof asRecord(entry)?.index === 'number'
          ? (asRecord(entry)!.index as number)
          : position,
      embedding: asRecord(entry)?.embedding,
    }))
    .sort((a, b) => a.index - b.index)
  const vectors = ordered.map((entry) => {
    if (
      !Array.isArray(entry.embedding) ||
      !entry.embedding.every((n) => typeof n === 'number')
    ) {
      throw new AiProviderError(
        'response_invalid',
        'The embedding response held something that is not a vector',
        { providerId: profile.id },
      )
    }
    return fitVector(entry.embedding, profile.id)
  })
  const usage = asRecord(root?.usage)
  const reported =
    typeof usage?.total_tokens === 'number'
      ? usage.total_tokens
      : typeof usage?.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : texts.reduce((n, text) => n + Math.ceil(text.length / 4), 0)
  return {
    vectors,
    tokens: reported,
    model:
      typeof root?.model === 'string' && root.model !== ''
        ? root.model
        : (profile.embeddingModel ?? profile.model),
  }
}

/** Embed texts with a profile. Batches are the caller's job (`EMBEDDING_BATCH`). */
export async function embedTexts(
  profile: ProviderProfile,
  apiKey: string | undefined,
  texts: readonly string[],
  deps: ProviderDeps = {},
): Promise<EmbeddingResult> {
  if (!profile.embeddingModel || profile.kind === 'anthropic') {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' is not set up for embeddings`,
      { providerId: profile.id },
    )
  }
  if (texts.length === 0) return { vectors: [], tokens: 0, model: '' }
  const headers: Record<string, string> = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const json = await postProviderJson(
    profile.id,
    {
      url: joinUrl(profile.baseUrl, 'embeddings'),
      headers,
      body: buildEmbeddingRequest(profile, texts),
    },
    deps,
  )
  return parseEmbeddingResponse(profile, texts, json)
}
