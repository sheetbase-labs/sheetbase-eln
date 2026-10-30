import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import {
  addSampleDataFn,
  fetchSampleDataStatusFn,
  sampleDataQueryKey,
} from '#/lib/sample-data'
import type { AddSampleDataResult } from '#/lib/sample-data'
import { t } from '#/copy'

/** What to tell the admin when the sample data could not be added. */
export function describeSampleDataFailure(
  result: Extract<AddSampleDataResult, { ok: false }>,
  projectKey = 'virus-stability',
): string {
  return result.reason === 'project_key_in_use'
    ? t('settings.sampleData.keyInUse', { key: projectKey })
    : t('settings.sampleData.elsewhere')
}

/** Adds the sample project, then refreshes everything it appears in. */
export function useAddSampleData(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const result = await addSampleDataFn({ data: { workspaceId } })
      if (!result.ok)
        throw new SampleDataError(describeSampleDataFailure(result))
    },
    onSuccess: async () => {
      toast.success(t('settings.sampleData.added'))
      // The sample touches projects, samples, materials, experiments and
      // reports, so every cached list is stale.
      await queryClient.invalidateQueries()
    },
  })
}

export class SampleDataError extends Error {}

export function sampleDataErrorMessage(error: unknown): string {
  return error instanceof SampleDataError
    ? error.message
    : t('settings.sampleData.error')
}

/**
 * Settings → General → Sample data. Optional, never automatic, and only ever
 * adds: nothing the lab has made is touched.
 */
export function SettingsSampleData({ workspaceId }: { workspaceId: string }) {
  const status = useQuery({
    queryKey: sampleDataQueryKey(workspaceId),
    queryFn: () => fetchSampleDataStatusFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const add = useAddSampleData(workspaceId)
  // An area the role can't open has nothing to offer.
  if (!status.data) return null

  return (
    <Section title={t('settings.sampleData.title')}>
      <p className="m-0 max-w-2xl text-body text-fg-muted">
        {t('settings.sampleData.description')}
      </p>
      {add.isError ? (
        <Notice tone="bad">{sampleDataErrorMessage(add.error)}</Notice>
      ) : null}
      {status.data.loaded || add.isSuccess ? (
        <p className="m-0 text-body">{t('settings.sampleData.loaded')}</p>
      ) : (
        <div>
          <Button
            variant="secondary"
            disabled={add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending
              ? t('settings.sampleData.adding')
              : t('settings.sampleData.add')}
          </Button>
        </div>
      )}
      <p className="m-0 text-label text-fg-muted">
        {t('settings.sampleData.hint')}
      </p>
    </Section>
  )
}
