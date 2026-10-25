import { env } from '#/env.server'

import type { ModelProvider } from '../ai-gateway'
import {
  createModelProvider,
  estimatedMicrousdPerToken,
  parseProviderProfiles,
  toPublicProviderProfile,
} from './profiles'
import { AiProviderError } from './types'
import type { ProviderDeps, ProviderProfile } from './types'
import type { PublicProviderProfile } from './profiles'

/**
 * Server-only provider configuration. Workspace settings select a profile id;
 * keys stay in the deployment environment and never reach the database, the
 * browser or a log line.
 */

export interface ProviderConfiguration {
  profiles: ProviderProfile[]
  /** Present when the deployment value is present but invalid. */
  error: string | null
}

export function getProviderConfiguration(): ProviderConfiguration {
  try {
    return {
      profiles: parseProviderProfiles(env.AI_PROVIDER_PROFILES),
      error: null,
    }
  } catch (error) {
    return {
      profiles: [],
      error:
        error instanceof AiProviderError
          ? error.message
          : 'AI provider configuration is invalid',
    }
  }
}

function keyAvailable(profile: ProviderProfile): boolean {
  if (!profile.apiKeyEnv) return true
  const value = process.env[profile.apiKeyEnv]
  return typeof value === 'string' && value.trim() !== ''
}

export function getPublicProviderProfiles(): {
  profiles: PublicProviderProfile[]
  error: string | null
} {
  const configuration = getProviderConfiguration()
  return {
    profiles: configuration.profiles.map((profile) =>
      toPublicProviderProfile(profile, keyAvailable(profile)),
    ),
    error: configuration.error,
  }
}

export interface ResolvedProvider {
  provider: ModelProvider
  profile: ProviderProfile
  estimatedMicrousdPerToken: number
}

/**
 * Resolve one workspace's selected profile. Throws `AiProviderError` with a
 * bounded message when the profile is absent, malformed or has no key; the
 * caller turns that into an explicit unavailable state rather than falling
 * back to a different provider silently.
 */
export function resolveProvider(
  profileId: string,
  deps: ProviderDeps = {},
): ResolvedProvider {
  const configuration = getProviderConfiguration()
  if (configuration.error) {
    throw new AiProviderError('config_invalid', configuration.error, {
      providerId: profileId,
    })
  }
  const profile = configuration.profiles.find((entry) => entry.id === profileId)
  if (!profile) {
    throw new AiProviderError(
      'config_invalid',
      `Provider profile '${profileId}' is not configured on this deployment`,
      { providerId: profileId },
    )
  }
  const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : undefined
  return {
    provider: createModelProvider(profile, apiKey, deps),
    profile,
    estimatedMicrousdPerToken: estimatedMicrousdPerToken(profile.pricing),
  }
}
