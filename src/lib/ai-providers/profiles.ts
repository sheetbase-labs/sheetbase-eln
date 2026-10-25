import { z } from 'zod'

import type { ModelProvider } from '../ai-gateway'
import { AnthropicProvider } from './anthropic'
import { OpenAiCompatibleProvider } from './openai-compatible'
import { AiProviderError, isCloudProvider } from './types'
import type {
  ProviderDeps,
  ProviderKind,
  ProviderPricing,
  ProviderProfile,
} from './types'

const PROVIDER_KINDS = [
  'openrouter',
  'anthropic',
  'openai-compatible',
  'local',
] as const satisfies readonly ProviderKind[]

const pricingSchema = z
  .object({
    inputMicrousdPerMillionTokens: z.number().int().min(0),
    outputMicrousdPerMillionTokens: z.number().int().min(0),
  })
  .strict()

const profileSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,48}$/),
    label: z.string().min(1).max(80),
    kind: z.enum(PROVIDER_KINDS),
    baseUrl: z.string().min(1).max(500),
    model: z.string().min(1).max(200),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,80}$/)
      .optional(),
    pricing: pricingSchema,
    maxOutputTokens: z.number().int().min(1).max(100_000).optional(),
  })
  .strict()

const profilesFileSchema = z.union([
  z.array(profileSchema),
  z.object({ profiles: z.array(profileSchema) }).strict(),
])

export interface PublicProviderProfile {
  id: string
  label: string
  kind: ProviderKind
  model: string
  dataClass: 'cloud' | 'local'
  keyAvailable: boolean
}

/**
 * Parse and validate `AI_PROVIDER_PROFILES`. The value is deployment
 * configuration, not user input, but it is still validated fail-closed: an
 * unknown kind or a credential-bearing URL must stop the profile from being
 * offered rather than silently fall back to a different provider.
 */
export function parseProviderProfiles(
  raw: string | undefined,
): ProviderProfile[] {
  if (raw === undefined || raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new AiProviderError(
      'config_invalid',
      'AI_PROVIDER_PROFILES is not valid JSON',
      { providerId: 'deployment', cause },
    )
  }
  const result = profilesFileSchema.safeParse(parsed)
  if (!result.success) {
    throw new AiProviderError(
      'config_invalid',
      'AI_PROVIDER_PROFILES does not match the provider profile schema',
      { providerId: 'deployment', cause: result.error },
    )
  }
  const profiles = Array.isArray(result.data)
    ? result.data
    : result.data.profiles
  const seen = new Set<string>()
  for (const profile of profiles) {
    assertProviderProfile(profile)
    if (seen.has(profile.id)) {
      throw new AiProviderError(
        'config_invalid',
        `AI_PROVIDER_PROFILES has a duplicate id: ${profile.id}`,
        { providerId: profile.id },
      )
    }
    seen.add(profile.id)
  }
  return profiles
}

/** Validate the non-schema rules: URL shape, TLS and key naming. */
export function assertProviderProfile(profile: ProviderProfile): void {
  let url: URL
  try {
    url = new URL(profile.baseUrl)
  } catch (cause) {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' has an invalid base URL`,
      { providerId: profile.id, cause },
    )
  }
  if (url.username || url.password) {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' must not carry credentials in its base URL`,
      { providerId: profile.id },
    )
  }
  if (url.search || url.hash) {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' base URL must not carry a query string or fragment`,
      { providerId: profile.id },
    )
  }
  const cloud = isCloudProvider(profile.kind)
  if (cloud && url.protocol !== 'https:') {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' is a cloud provider and must use HTTPS`,
      { providerId: profile.id },
    )
  }
  if (profile.kind === 'local' && !['http:', 'https:'].includes(url.protocol)) {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' must use HTTP or HTTPS`,
      { providerId: profile.id },
    )
  }
  if (cloud && !profile.apiKeyEnv) {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' is a cloud provider and must name apiKeyEnv`,
      { providerId: profile.id },
    )
  }
}

export function createModelProvider(
  profile: ProviderProfile,
  apiKey: string | undefined,
  deps: ProviderDeps = {},
): ModelProvider {
  assertProviderProfile(profile)
  if (isCloudProvider(profile.kind) && !apiKey) {
    throw new AiProviderError(
      'config_invalid',
      `Provider '${profile.id}' has no resolved API key`,
      { providerId: profile.id },
    )
  }
  const config = { ...profile, apiKey }
  if (profile.kind === 'anthropic') {
    return new AnthropicProvider(config, deps)
  }
  return new OpenAiCompatibleProvider(config, deps)
}

/**
 * Conservative per-token estimate for the gateway's pre-call budget check.
 * The provider returns authoritative cost after the call; this estimate only
 * prevents a call that plainly cannot fit.
 */
export function estimatedMicrousdPerToken(pricing: ProviderPricing): number {
  const worst = Math.max(
    pricing.inputMicrousdPerMillionTokens,
    pricing.outputMicrousdPerMillionTokens,
  )
  return worst / 1_000_000
}

export function toPublicProviderProfile(
  profile: ProviderProfile,
  keyAvailable: boolean,
): PublicProviderProfile {
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    model: profile.model,
    dataClass: isCloudProvider(profile.kind) ? 'cloud' : 'local',
    keyAvailable,
  }
}
