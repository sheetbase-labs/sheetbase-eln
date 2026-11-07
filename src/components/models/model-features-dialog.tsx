/**
 * The Features button on a model: a list of the optional features the lab can
 * switch on for records of that model, each with a tick-box. The list comes from
 * the feature registry (`lib/features/registry.ts`), so a new feature appears
 * here without any change to this dialog.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { campaignKeys } from '#/lib/campaigns/data'
import {
  featureKeys,
  setModelFeature,
  useModelFeatures,
} from '#/lib/features/data'
import { MODEL_FEATURES } from '#/lib/features/registry'
import { notebookDataClient } from '#/lib/notebook-data'
import { ROOT_CONTEXT_QUERY_KEY } from '#/lib/root-context-cache'
import { messageOf } from '#/lib/result-quality'

import type { WorkspaceRecordModel } from './models-data'

const client = notebookDataClient

export function ModelFeaturesDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: WorkspaceRecordModel
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const features = useModelFeatures(client)
  const on = new Set(
    (features.data ?? [])
      .filter((f) => f.model_key === model.key)
      .map((f) => f.capability),
  )
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    if (!open || !features.data) return
    setDraft(
      new Set(
        features.data
          .filter((f) => f.model_key === model.key)
          .map((f) => f.capability),
      ),
    )
  }, [open, features.data, model.key])

  const save = useMutation({
    mutationFn: async () => {
      for (const feature of MODEL_FEATURES) {
        if (draft.has(feature.key) !== on.has(feature.key))
          await setModelFeature(
            client,
            model.key,
            feature.key,
            draft.has(feature.key),
          )
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: featureKeys.all })
      void queryClient.invalidateQueries({ queryKey: campaignKeys.all })
      // The sidebar shows a feature's page only while a model has it, and
      // reads that with the rest of the page context.
      queryClient.removeQueries({ queryKey: ROOT_CONTEXT_QUERY_KEY })
      await router.invalidate()
      toast.success(t('features.saved'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('features.couldNotSave'))),
  })

  const changed = MODEL_FEATURES.some((f) => draft.has(f.key) !== on.has(f.key))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader title={t('features.title', { name: model.name })} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-label text-fg-muted">
              {t('features.intro')}
            </p>
            {features.isError ? (
              <Notice tone="bad" title={t('features.loadError')}>
                {messageOf(features.error, '')}
              </Notice>
            ) : (
              MODEL_FEATURES.map((feature) => (
                <label
                  key={feature.key}
                  className="flex items-start gap-2 text-body"
                >
                  <Checkbox
                    checked={draft.has(feature.key)}
                    disabled={features.isPending}
                    onCheckedChange={(checked) =>
                      setDraft((current) => {
                        const next = new Set(current)
                        if (checked === true) next.add(feature.key)
                        else next.delete(feature.key)
                        return next
                      })
                    }
                    className="mt-0.5"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{feature.label()}</span>
                    <span className="text-label text-fg-muted">
                      {feature.hint()}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || !changed}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t('features.saving') : t('features.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
