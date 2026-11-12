import { useState } from 'react'

import { t } from '#/copy'
import { BoardButton } from '#/features/pipelines/board/board'
import { toast } from '#/components/ui/sonner'
import { ScheduleDialog } from '#/components/pipelines/schedule-dialog'
import { ScheduleHistoryDialog } from '#/components/pipelines/schedule-history'
import type { declaredRunInputs } from '#/components/pipelines/pipelines-data'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import type { RuleForm } from './composer-model'
import { ConditionsGroup } from './conditions-group'
import { StartsGroup } from './starts-group'
import { useDatasetNameMap, useSetStartRules } from './starts-data'
import { ThenGroup } from './then-group'

/** The starts, the conditions that gate them and what a start does, as one
 * sentence-shaped card with its plain-words readback beside it. */
export function StartsComposer({
  pipelineId,
  workspaceId,
  schedules,
  declared,
  form,
}: {
  pipelineId: string
  workspaceId: string
  schedules: PipelineScheduleWire[]
  declared: ReturnType<typeof declaredRunInputs>
  form: RuleForm
}) {
  const save = useSetStartRules(workspaceId, pipelineId)
  const [editing, setEditing] = useState<PipelineScheduleWire | null>(null)
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState<PipelineScheduleWire | null>(null)
  const datasetNames = useDatasetNameMap()

  const {
    draft,
    setDraft,
    rowsText,
    setRowsText,
    waitText,
    setWaitText,
    rowsValue,
    effective,
    problems,
    hasProblem,
    dirty,
    reset,
  } = form

  const onSave = () =>
    save.mutate(effective, {
      onSuccess: () => toast(t('features.pipelineStarts.composer.saved')),
      onError: (error) =>
        toast(t('features.pipelineStarts.composer.saveFailed'), {
          description: error instanceof Error ? error.message : undefined,
        }),
    })

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="cmp">
          <StartsGroup
            pipelineId={pipelineId}
            workspaceId={workspaceId}
            schedules={schedules}
            onAdd={() => setAdding(true)}
            onEdit={setEditing}
            onHistory={setHistory}
          />
          <ConditionsGroup
            draft={draft}
            setDraft={setDraft}
            problems={problems}
            rowsText={rowsText}
            setRowsText={setRowsText}
            rowsValue={rowsValue}
          />
          <ThenGroup
            draft={draft}
            setDraft={setDraft}
            problems={problems}
            waitText={waitText}
            setWaitText={setWaitText}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BoardButton
            variant="primary"
            disabled={!dirty || hasProblem || save.isPending}
            onClick={onSave}
          >
            {save.isPending
              ? t('features.pipelineStarts.composer.saving')
              : t('features.pipelineStarts.composer.save')}
          </BoardButton>
          <BoardButton disabled={!dirty || save.isPending} onClick={reset}>
            {t('features.pipelineStarts.composer.reset')}
          </BoardButton>
          {dirty ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('features.pipelineStarts.composer.unsaved')}
            </span>
          ) : null}
        </div>
      </div>

      <ScheduleDialog
        open={adding}
        onOpenChange={setAdding}
        definitionId={pipelineId}
        workspaceId={workspaceId}
        inputs={declared.inputs}
        parameters={declared.parameters}
      />
      {editing ? (
        <ScheduleDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          schedule={editing}
          definitionId={pipelineId}
          workspaceId={workspaceId}
          inputs={declared.inputs}
          parameters={declared.parameters}
        />
      ) : null}
      {history ? (
        <ScheduleHistoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setHistory(null)
          }}
          schedule={history}
          title={scheduleSpecLabel(history.kind, history.spec, datasetNames)}
        />
      ) : null}
    </>
  )
}
