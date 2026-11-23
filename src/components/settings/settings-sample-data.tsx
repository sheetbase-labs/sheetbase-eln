import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { Notice } from '#/components/ui/alert'
import { Button, buttonVariants } from '#/components/ui/button'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  addSampleDataFn,
  fetchSampleDataStatusFn,
  sampleDataQueryKey,
} from '#/lib/sample-data'
import { cn } from '#/lib/utils'
import { createDataClient } from '#/lib/data-client'
import { setActiveWorkspace } from '#/lib/user-preferences'
import { t } from '#/copy'
import { describeSampleDataFailure } from './sample-data-messages'

export { describeSampleDataFailure } from './sample-data-messages'

/**
 * Creates the Demo workspace and makes it the active one. Nothing in the
 * person's own workspace changes.
 */
export function useOpenDemoWorkspace(workspaceId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: async () => {
      const result = await addSampleDataFn({ data: { workspaceId } })

      if (!result.ok)
        throw new SampleDataError(describeSampleDataFailure(result))

      await setActiveWorkspace(createDataClient(), result.workspaceId)
    },
    onSuccess: async () => {
      toast.success(t('settings.sampleData.added'))
      // A different workspace: every cached read belongs to the one just left.
      queryClient.clear()
      await router.navigate({ to: '/', ignoreBlocker: true })
      await router.invalidate()
    },
  })
}

class SampleDataError extends Error {}

function sampleDataErrorMessage(error: Error): string {
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

  const add = useOpenDemoWorkspace(workspaceId)

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
      {status.data.loaded ? (
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

/**
 * Settings → General → Lab setup. The first-run checklist only shows on an
 * empty Home, so this is the way back into the setup dialog (name, time zone,
 * starter tables, sample project) after skipping it.
 */
export function SettingsLabSetup() {
  return (
    <Section title={t('settings.labSetup.sectionTitle')}>
      <p className="m-0 max-w-2xl text-body text-fg-muted">
        {t('settings.labSetup.sectionHint')}
      </p>
      <div>
        <a
          href="/?setup=1"
          className={cn(buttonVariants({ variant: 'secondary' }))}
        >
          {t('settings.labSetup.sectionAction')}
        </a>
      </div>
    </Section>
  )
}
