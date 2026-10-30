/**
 * Server functions behind Add sample data (Settings → General and the lab
 * setup dialog). Server-only modules are imported inside the handlers: the
 * settings route imports this file in the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'

import type {
  AddSampleDataResult,
  SampleDataStatus,
} from '#/lib/sample-data.server'

export type { AddSampleDataResult, SampleDataStatus }

export const sampleDataQueryKey = (workspaceId: string) =>
  ['sample-data', workspaceId] as const

export const fetchSampleDataStatusFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<SampleDataStatus> => {
    const { requireSettingsArea } = await import('#/lib/admin-platform')
    await requireSettingsArea(data.workspaceId, 'general')
    const { sampleDataStatus } = await import('#/lib/sample-data.server')
    return sampleDataStatus(data.workspaceId)
  })

export const addSampleDataFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<AddSampleDataResult> => {
    const { requireSettingsArea } = await import('#/lib/admin-platform')
    const { userId } = await requireSettingsArea(
      data.workspaceId,
      'general',
      'manage',
    )
    const { addSampleData } = await import('#/lib/sample-data.server')
    return addSampleData({ workspaceId: data.workspaceId, userId })
  })
