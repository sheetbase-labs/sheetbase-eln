import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { IconButton } from '#/components/ui/icon-button'
import { Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { WebhookCard } from '#/components/pipelines/triggers-outputs'
import {
  webhookKey,
  webhookRequest,
} from '#/components/pipelines/webhook-state'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import {
  scheduleParametersLabel,
  scheduleSpecLabel,
} from '#/routes/pipelines/-schedule-labels'
import { describeInputs } from '#/lib/pipeline-schedule-form'
import {
  deletePipelineSchedule,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { startKind } from '#/lib/pipelines/starts-view'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import { KIND_ICON } from './composer-model'
import { Group, LinkButton, Row } from './composer-parts'
import { useDatasetNameMap } from './starts-data'

/** The ways this pipeline starts: stored starts and the webhook. */
export function StartsGroup({
  pipelineId,
  workspaceId,
  schedules,
  onAdd,
  onEdit,
  onHistory,
}: {
  pipelineId: string
  workspaceId: string
  schedules: PipelineScheduleWire[]
  onAdd: () => void
  onEdit: (schedule: PipelineScheduleWire) => void
  onHistory: (schedule: PipelineScheduleWire) => void
}) {
  const queryClient = useQueryClient()
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [removing, setRemoving] = useState<PipelineScheduleWire | null>(null)
  const datasetNames = useDatasetNameMap()

  const webhook = useQuery({
    queryKey: webhookKey(pipelineId),
    queryFn: () => webhookRequest(pipelineId, 'GET'),
    staleTime: 30_000,
    retry: false,
  })

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: pipelineDataQueryKeys.schedules(pipelineId),
    })

  const failed = (error: Error) =>
    toast(t('features.pipelineStarts.composer.saveFailed'), {
      description: error.message,
    })

  const toggle = useMutation({
    mutationFn: (input: { scheduleId: string; enabled: boolean }) =>
      updatePipelineSchedule(notebookDataClient, {
        workspaceId,
        scheduleId: input.scheduleId,
        enabled: input.enabled,
      }),
    onSuccess: refresh,
    onError: failed,
  })

  const remove = useMutation({
    mutationFn: (scheduleId: string) =>
      deletePipelineSchedule(notebookDataClient, { workspaceId, scheduleId }),
    onSuccess: refresh,
    onError: failed,
  })

  return (
    <>
      <Group
        head={
          <>
            <span>{t('features.pipelineStarts.composer.startWhen')}</span>
            <span>{t('features.pipelineStarts.composer.any')}</span>
            <span>{t('features.pipelineStarts.composer.ofTheseHappen')}</span>
          </>
        }
      >
        {schedules.map((schedule) => {
          const kind = startKind(schedule)

          return (
            <Row
              key={schedule.id}
              icon={KIND_ICON[kind]}
              type={t(`features.pipelineStarts.composer.${kind}`)}
              action={
                <span className="flex items-center">
                  <IconButton
                    label={t('features.pipelineStarts.composer.history')}
                    icon="history"
                    onClick={() => onHistory(schedule)}
                  />
                  <IconButton
                    label={t('features.pipelineStarts.composer.edit')}
                    icon="edit"
                    onClick={() => onEdit(schedule)}
                  />
                  <IconButton
                    label={
                      schedule.enabled
                        ? t('features.pipelineStarts.composer.pause')
                        : t('features.pipelineStarts.composer.resume')
                    }
                    icon={schedule.enabled ? 'pause' : 'play'}
                    disabled={toggle.isPending}
                    onClick={() =>
                      toggle.mutate({
                        scheduleId: schedule.id,
                        enabled: !schedule.enabled,
                      })
                    }
                  />
                  <IconButton
                    label={t('features.pipelineStarts.composer.remove')}
                    icon="x"
                    onClick={() => setRemoving(schedule)}
                  />
                </span>
              }
            >
              <span className={schedule.enabled ? undefined : 'text-fg-muted'}>
                {scheduleSpecLabel(schedule.kind, schedule.spec, datasetNames)}
              </span>
              {schedule.enabled ? null : (
                <span className="text-fg-muted">
                  · {t('features.pipelineStarts.composer.paused')}
                </span>
              )}
              {[
                ...describeInputs(schedule.spec, datasetNames),
                scheduleParametersLabel(schedule.spec),
              ].flatMap((line) =>
                line
                  ? [
                      <span key={line} className="basis-full text-fg-muted">
                        {line}
                      </span>,
                    ]
                  : [],
              )}
            </Row>
          )
        })}
        <Row
          icon={KIND_ICON.webhook}
          type={t('features.pipelineStarts.composer.webhook')}
          action={
            <IconButton
              label={t('features.pipelineStarts.composer.edit')}
              icon="edit"
              aria-expanded={webhookOpen}
              onClick={() => setWebhookOpen((open) => !open)}
            />
          }
        >
          <span className={webhook.data?.enabled ? undefined : 'text-fg-muted'}>
            {webhook.data?.enabled
              ? t('features.pipelineStarts.composer.webhookOn')
              : t('features.pipelineStarts.composer.webhookOff')}
          </span>
          <span className="text-fg-muted">
            · {t('features.pipelineStarts.composer.webhookHint')}
          </span>
        </Row>
        {webhookOpen ? (
          <div className="py-1.5 pl-6">
            <WebhookCard definitionId={pipelineId} />
          </div>
        ) : null}
        {schedules.length === 0 && !webhook.data?.enabled ? (
          <Muted className="pl-6">
            {t('features.pipelineStarts.composer.noStarts')}
          </Muted>
        ) : null}
        <div className="py-0.5 pl-6">
          <LinkButton onClick={() => onAdd()}>
            {t('features.pipelineStarts.composer.addStart')}
          </LinkButton>
        </div>
      </Group>
      <RemoveStartDialog
        schedule={removing}
        onClose={() => setRemoving(null)}
        onConfirm={(id) => remove.mutate(id)}
      />
    </>
  )
}

function RemoveStartDialog({
  schedule,
  onClose,
  onConfirm,
}: {
  schedule: PipelineScheduleWire | null
  onClose: () => void
  onConfirm: (scheduleId: string) => void
}) {
  return (
    <ConfirmDialog
      open={schedule !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('features.pipelineStarts.composer.removeTitle')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('features.pipelineStarts.composer.removeBody')}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel />
          <ConfirmDialogAction
            variant="danger-fill"
            onClick={() => {
              if (schedule) onConfirm(schedule.id)
              onClose()
            }}
          >
            {t('features.pipelineStarts.composer.removeConfirm')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
