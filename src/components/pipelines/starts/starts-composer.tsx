import { useEffect, useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { ScheduleDialog } from '#/components/pipelines/schedule-dialog'
import { ScheduleHistoryDialog } from '#/components/pipelines/schedule-history'
import type { declaredRunInputs } from '#/components/pipelines/pipelines-data'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import { numberOrNull, ruleProblems } from './composer-model'
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
  rules,
  declared,
  onDraft,
}: {
  pipelineId: string
  workspaceId: string
  schedules: PipelineScheduleWire[]
  rules: StartRules
  declared: ReturnType<typeof declaredRunInputs>
  /** The form's current, valid rules and whether they differ from the saved. */
  onDraft: (draft: StartRules, dirty: boolean, problem: boolean) => void
}) {
  const save = useSetStartRules(workspaceId, pipelineId)
  const [draft, setDraft] = useState<StartRules>(rules)
  const [rowsText, setRowsText] = useState(String(rules.minNewRows ?? 1))
  const [waitText, setWaitText] = useState(String(rules.waitMinutes))
  const [editing, setEditing] = useState<PipelineScheduleWire | null>(null)
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState<PipelineScheduleWire | null>(null)
  const datasetNames = useDatasetNameMap()

  const rowsValue = numberOrNull(rowsText)
  const waitValue = numberOrNull(waitText)

  const effective: StartRules = {
    ...draft,
    minNewRows:
      draft.minNewRows === null ? null : (rowsValue ?? draft.minNewRows),
    waitMinutes: waitValue ?? draft.waitMinutes,
  }

  const problems = ruleProblems(effective, rowsText, waitText)
  const hasProblem = Object.values(problems).some(Boolean)
  const dirty = JSON.stringify(effective) !== JSON.stringify(rules)

  // Hand the form's state up so the readback and the Test button judge the
  // rules as they stand on screen, not as last saved.
  const reported = JSON.stringify([effective, dirty, hasProblem])

  useEffect(() => {
    onDraft(effective, dirty, hasProblem)
  }, [reported])

  const onSave = () =>
    save.mutate(effective, {
      onSuccess: () => toast(t('features.pipelineStarts.composer.saved')),
      onError: (error) =>
        toast(t('features.pipelineStarts.composer.saveFailed'), {
          description: error instanceof Error ? error.message : undefined,
        }),
    })

  const reset = () => {
    setDraft(rules)
    setRowsText(String(rules.minNewRows ?? 1))
    setWaitText(String(rules.waitMinutes))
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-border bg-surface">
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
          <Button
            variant="primary"
            disabled={!dirty || hasProblem || save.isPending}
            onClick={onSave}
          >
            {save.isPending
              ? t('features.pipelineStarts.composer.saving')
              : t('features.pipelineStarts.composer.save')}
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={reset}>
            {t('features.pipelineStarts.composer.reset')}
          </Button>
          {dirty ? (
            <Muted>{t('features.pipelineStarts.composer.unsaved')}</Muted>
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
