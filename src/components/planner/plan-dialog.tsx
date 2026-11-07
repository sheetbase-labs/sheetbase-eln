/**
 * "Plan with AI": a goal goes in and a plan comes out to read. Nothing is
 * created until the person presses Create experiment, which makes the
 * experiment with its parts, plate, worklist and samples in one step.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Textarea } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  createPlannedExperiment,
  fetchPlannerContext,
} from '#/lib/planner/data'
import { parsePlanAnswer, plannerInstruction } from '#/lib/planner/plan'
import type { ExperimentPlan } from '#/lib/planner/plan'
import { messageOf } from '#/lib/result-quality'
import { usePageAi } from '#/lib/use-page-ai'

import { PlanReview } from './plan-review'

const client = notebookDataClient

export function PlanDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const ai = usePageAi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [goal, setGoal] = useState('')
  const [projectId, setProjectId] = useState('')
  const [working, setWorking] = useState(false)
  const [plan, setPlan] = useState<ExperimentPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = useQuery({
    queryKey: ['planner', 'projects'],
    queryFn: () =>
      client.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&archived_at=is.null&order=title.asc&limit=200',
      ),
    enabled: open,
  })
  const options = projects.data ?? []
  const selected = projectId || options[0]?.id || ''

  async function draft() {
    setWorking(true)
    setError(null)
    try {
      const context = await fetchPlannerContext(client)
      const result = await ai.run({
        task: 'plan_experiment',
        instruction: plannerInstruction(goal, context),
      })
      if (result.status !== 'ok') {
        setError(t('planner.dialog.failed', { message: result.message }))
        return
      }
      const drawn = parsePlanAnswer(result.text, goal, context)
      if (!drawn) {
        setError(t('planner.dialog.nothing'))
        return
      }
      setPlan(drawn)
    } catch (e) {
      setError(
        t('planner.dialog.failed', {
          message: e instanceof Error ? e.message : '',
        }),
      )
    } finally {
      setWorking(false)
    }
  }

  const create = useMutation({
    mutationFn: () =>
      createPlannedExperiment(client, { projectId: selected, plan: plan! }),
    onSuccess: (made) => {
      void queryClient.invalidateQueries({ queryKey: ['records'] })
      onOpenChange(false)
      setPlan(null)
      setGoal('')
      void navigate({
        to: '/experiments/$expId',
        params: { expId: made.recordId },
      })
    },
  })

  if (plan)
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => !create.isPending && onOpenChange(next)}
      >
        <DialogContent className="w-[min(860px,calc(100vw-32px))]">
          <DialogHeader title={t('planner.dialog.reviewTitle')} />
          <DialogBody className="max-h-[70vh] overflow-auto">
            {create.isError ? (
              <Notice tone="bad" title={t('planner.view.createFailed')}>
                {messageOf(create.error, '')}
              </Notice>
            ) : null}
            <PlanReview goal={goal.trim()} plan={plan} />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="quiet"
              disabled={create.isPending}
              onClick={() => {
                create.reset()
                setPlan(null)
              }}
            >
              {t('planner.dialog.back')}
            </Button>
            <Button
              variant="primary"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending
                ? t('planner.view.creating')
                : t('planner.view.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader title={t('planner.dialog.title')} />
        <DialogBody className="flex flex-col gap-3">
          <Field
            label={t('planner.dialog.goal')}
            hint={t('planner.dialog.goalHint')}
          >
            <Textarea
              rows={4}
              maxLength={4000}
              value={goal}
              placeholder={t('planner.dialog.goalPlaceholder')}
              onChange={(e) => setGoal(e.target.value)}
            />
          </Field>
          <Field label={t('planner.dialog.project')}>
            <Select
              value={selected}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {options.length === 0 ? (
                <option value="">
                  {t('planner.dialog.projectPlaceholder')}
                </option>
              ) : null}
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-label text-fg-muted">
            {t('planner.dialog.advisory')}
          </p>
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" disabled={working} />}>
            {t('planner.dialog.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            icon="spark"
            disabled={!goal.trim() || !selected || working}
            onClick={() => void draft()}
          >
            {working ? t('planner.dialog.working') : t('planner.dialog.draft')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
