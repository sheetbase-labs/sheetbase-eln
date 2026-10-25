import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  AI_FEATURE_FLAGS,
  defaultAiFeatureFlags,
  noAiFeatureFlags,
  readAiFeatureFlags,
  resolveAiFeatureFlags,
  updateAiFeatureFlagsSchema,
} from './ai-feature-flags'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('AI feature flags', () => {
  it('defaults standard access on and privileged access off', () => {
    const flags = defaultAiFeatureFlags()
    expect(flags.assistant).toBe(true)
    expect(flags.mcp_read).toBe(true)
    expect(flags.mcp_draft).toBe(true)
    expect(flags.mcp_workflow).toBe(false)
    expect(flags.mcp_admin_read).toBe(false)
    expect(flags.mcp_admin_propose).toBe(false)
  })

  it('resolves a partial stored record against the defaults', () => {
    expect(
      resolveAiFeatureFlags({ mcp_admin_read: true, unknown: true }),
    ).toEqual({
      ...defaultAiFeatureFlags(),
      mcp_admin_read: true,
    })
  })

  it('ignores malformed values rather than enabling a flag', () => {
    expect(
      resolveAiFeatureFlags({ mcp_admin_propose: 'yes', mcp_workflow: 1 }),
    ).toEqual(defaultAiFeatureFlags())
    expect(resolveAiFeatureFlags(null)).toEqual(defaultAiFeatureFlags())
    expect(resolveAiFeatureFlags([])).toEqual(defaultAiFeatureFlags())
  })

  it('fails closed when asked for the no-access record', () => {
    expect(Object.values(noAiFeatureFlags()).every((value) => !value)).toBe(
      true,
    )
  })

  it('requires every known boolean in the update payload', () => {
    const complete = Object.fromEntries(
      AI_FEATURE_FLAGS.map((flag) => [flag.key, true]),
    )
    expect(
      updateAiFeatureFlagsSchema.safeParse({
        workspaceId: WORKSPACE_ID,
        featureFlags: complete,
      }).success,
    ).toBe(true)
    expect(
      updateAiFeatureFlagsSchema.safeParse({
        workspaceId: WORKSPACE_ID,
        featureFlags: { ...complete, mcp_admin_read: 'yes' },
      }).success,
    ).toBe(false)
    expect(
      updateAiFeatureFlagsSchema.safeParse({
        workspaceId: WORKSPACE_ID,
        featureFlags: { ...complete, extra: true },
      }).success,
    ).toBe(false)
  })

  it('reads and resolves the workspace settings row', async () => {
    const client = {
      list: vi.fn(async () => [{ ai_feature_flags: { mcp_read: false } }]),
    } as unknown as DataClient
    await expect(readAiFeatureFlags(client, WORKSPACE_ID)).resolves.toEqual({
      ...defaultAiFeatureFlags(),
      mcp_read: false,
    })
    expect(client.list).toHaveBeenCalledWith(
      'workspace_settings',
      `?select=ai_feature_flags&workspace_id=eq.${WORKSPACE_ID}&limit=1`,
    )
  })
})
