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
import { BoardSelect } from '#/features/pipelines/board/board'
import { toast } from '#/components/ui/sonner'
import { WebhookCard } from '#/components/pipelines/triggers-outputs'
import {
  webhookKey,
  webhookRequest,
} from '#/components/pipelines/webhook-state'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'
import {
  deletePipelineSchedule,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { startKind } from '#/lib/pipelines/starts-view'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import { KIND_ICON } from './composer-model'
import { Group, LinkButton, Row, RowButton } from './composer-parts'
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
            {t('features.pipelineStarts.composer.startWhen')}
            <BoardSelect
              aria-label={t('features.pipelineStarts.composer.startWhen')}
              value="any"
              disabled
            >
              <option value="any">
                {t('features.pipelineStarts.composer.any')}
              </option>
            </BoardSelect>
            {t('features.pipelineStarts.composer.ofTheseHappen')}
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
                <span className="cr-actions">
                  <RowButton
                    label={t('features.pipelineStarts.composer.history')}
                    icon="history"
                    onClick={() => onHistory(schedule)}
                  />
                  <RowButton
                    label={t('features.pipelineStarts.composer.edit')}
                    icon="edit"
                    onClick={() => onEdit(schedule)}
                  />
                  <RowButton
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
                  <RowButton
                    label={t('features.pipelineStarts.composer.remove')}
                    icon="x"
                    onClick={() => setRemoving(schedule)}
                  />
                </span>
              }
            >
              <span className={schedule.enabled ? undefined : 'muted'}>
                {scheduleSpecLabel(schedule.kind, schedule.spec, datasetNames)}
              </span>
              {schedule.enabled ? null : (
                <span className="muted">
                  · {t('features.pipelineStarts.composer.paused')}
                </span>
              )}
            </Row>
          )
        })}
        <Row
          icon={KIND_ICON.webhook}
          type={t('features.pipelineStarts.composer.webhook')}
          action={
            <RowButton
              label={t('features.pipelineStarts.composer.edit')}
              icon="edit"
              aria-expanded={webhookOpen}
              onClick={() => setWebhookOpen((open) => !open)}
            />
          }
        >
          <span className={webhook.data?.enabled ? undefined : 'muted'}>
            {webhook.data?.enabled
              ? t('features.pipelineStarts.composer.webhookOn')
              : t('features.pipelineStarts.composer.webhookOff')}
          </span>
          <span className="muted">
            · {t('features.pipelineStarts.composer.webhookHint')}
          </span>
        </Row>
        {webhookOpen ? (
          <div className="addl">
            <WebhookCard definitionId={pipelineId} />
          </div>
        ) : null}
        {schedules.length === 0 && !webhook.data?.enabled ? (
          <div className="addl muted" style={{ fontSize: 11 }}>
            {t('features.pipelineStarts.composer.noStarts')}
          </div>
        ) : null}
        <div className="addl">
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
