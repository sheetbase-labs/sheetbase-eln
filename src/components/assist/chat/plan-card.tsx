import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { runPlan } from '#/features/plans/plan'
import type {
  PlanAction,
  PlanOutcome,
  PlanStepPhase,
  PlanStepResult,
  PlanStepState,
} from '#/features/plans/plan'
import { runPlanStep } from '#/features/plans/run'
import type { ApplyBuilt } from '#/features/plans/run'
import type { AssistantProposal } from '#/lib/assistant-proposals'

/**
 * A plan from the assistant: several changes approved once and run in order.
 * Nothing has happened until a button is pressed. Each step is built when its
 * turn comes, so it can use what the one before it made, and runs as the
 * signed-in person through the same path as a card of its own. A step that
 * removes or ends something waits for its own OK unless the workspace lets this
 * person run everything.
 */

type Phase = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'dismissed'

/** Kept outside the component so a re-render or reopened panel remembers it. */
const remembered = new Map<
  string,
  { phase: Phase; steps: PlanStepState[]; at: number | null }
>()

const ICON: Record<
  Exclude<PlanStepPhase, 'running'>,
  Parameters<typeof Icon>[0]['name']
> = {
  waiting: 'circle',
  done: 'checkCircle',
  paused: 'pause',
  failed: 'xCircle',
  skipped: 'minusCircle',
}

const WORDS: Record<PlanStepPhase, () => string> = {
  waiting: () => t('features.plans.plan.waiting'),
  running: () => t('features.plans.plan.running'),
  done: () => t('features.plans.plan.done'),
  paused: () => t('features.plans.plan.paused'),
  failed: () => t('features.plans.plan.failed'),
  skipped: () => t('features.plans.plan.skipped'),
}

export function PlanCard({
  callId,
  proposal,
  action,
  applyBuilt,
}: {
  callId: string
  proposal: AssistantProposal
  action: PlanAction
  /** How one built step is applied: the chat's own path, which also handles operations. */
  applyBuilt: ApplyBuilt
}) {
  const initial = remembered.get(callId)

  const [phase, setPhaseRaw] = useState<Phase>(initial?.phase ?? 'idle')

  const [steps, setStepsRaw] = useState<PlanStepState[]>(
    () =>
      initial?.steps ?? action.steps.map(() => ({ phase: 'waiting' as const })),
  )

  const [pausedAt, setPausedAt] = useState<number | null>(initial?.at ?? null)
  const latest = useRef(steps)
  const queryClient = useQueryClient()
  const router = useRouter()

  function save(next: Phase, at: number | null) {
    setPhaseRaw(next)
    setPausedAt(at)

    if (next !== 'running') {
      remembered.set(callId, { phase: next, steps: latest.current, at })
    }
  }

  function update(index: number, state: PlanStepState) {
    const next = latest.current.map((current, position) =>
      position === index ? state : current,
    )

    latest.current = next
    setStepsRaw(next)
  }

  function stop(from: number | null) {
    if (from !== null) {
      for (let index = from; index < action.steps.length; index++) {
        update(index, { phase: 'skipped' })
      }
    }

    save('stopped', null)
  }

  async function run(from: number, options: { runAll: boolean }) {
    save('running', null)

    const outcome: PlanOutcome = await runPlan({
      steps: action.steps,
      from,
      approved: options.runAll ? undefined : from,
      pauseDestructive: action.pauseDestructive,
      runAll: options.runAll,
      execute: (step): Promise<PlanStepResult> =>
        runPlanStep(action.workspaceId, step, applyBuilt),
      onUpdate: update,
    })

    if (outcome.status === 'paused') save('paused', outcome.at)
    else if (outcome.status === 'failed') save('stopped', outcome.at)
    else save('done', null)

    void queryClient.invalidateQueries()
    void router.invalidate()
  }

  const running = phase === 'running'
  const finished = phase === 'done' || phase === 'dismissed'

  return (
    <section
      data-testid="assistant-plan"
      data-state={phase}
      aria-label={t('features.plans.plan.label')}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
    >
      <header className="flex items-start gap-2">
        <span className="mt-0.5 text-fg-muted">
          <Icon name="listChecks" size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-label text-fg-muted">
            {t('features.plans.plan.label')} ·{' '}
            {t('features.plans.plan.steps', { count: action.steps.length })}
          </span>
          <span className="text-body font-medium text-fg">
            {proposal.title}
          </span>
        </div>
      </header>
      <p className="m-0 text-body text-fg-muted">{proposal.summary}</p>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {action.steps.map((step, index) => (
          <StepRow
            key={step.key}
            number={index + 1}
            title={step.title}
            state={steps[index]}
            waits={step.destructive && action.pauseDestructive}
          />
        ))}
      </ol>
      <PlanNotice phase={phase} steps={steps} pausedAt={pausedAt} />
      {finished ? (
        <span className="inline-flex items-center gap-1 text-label text-fg-muted">
          <Icon name={phase === 'done' ? 'check' : 'x'} size={12} />
          {phase === 'done'
            ? t('features.plans.plan.allDone')
            : t('notebook.assistantPanel.proposal.dismissed')}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {phase === 'paused' && pausedAt !== null ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void run(pausedAt, { runAll: false })}
              >
                {t('features.plans.plan.approveStep')}
              </Button>
              {action.runAllAllowed ? (
                <Button
                  size="sm"
                  onClick={() => void run(pausedAt, { runAll: true })}
                >
                  {t('features.plans.plan.runAll')}
                </Button>
              ) : null}
              <Button size="sm" variant="quiet" onClick={() => stop(pausedAt)}>
                {t('features.plans.plan.stop')}
              </Button>
            </>
          ) : phase === 'idle' ? (
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={running}
                onClick={() => void run(0, { runAll: false })}
              >
                {t('features.plans.cards.runPlan.apply')}
              </Button>
              {action.runAllAllowed ? (
                <Button
                  size="sm"
                  title={t('features.plans.plan.runAllHint')}
                  onClick={() => void run(0, { runAll: true })}
                >
                  {t('features.plans.plan.runAll')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="quiet"
                onClick={() => save('dismissed', null)}
              >
                {t('notebook.assistantPanel.proposal.dismiss')}
              </Button>
            </>
          ) : running ? (
            <span className="inline-flex items-center gap-1.5 text-label text-fg-muted">
              <Spinner size={12} />
              {t('features.plans.cards.runPlan.applying')}
            </span>
          ) : null}
        </div>
      )}
    </section>
  )
}

function StepRow({
  number,
  title,
  state,
  waits,
}: {
  number: number
  title: string
  state: PlanStepState
  waits: boolean
}) {
  const failed = state.phase === 'failed'

  return (
    <li
      data-step-state={state.phase}
      className="flex flex-col gap-0.5 rounded-lg bg-surface-muted px-2.5 py-2 text-label"
    >
      <span className="flex items-center gap-2">
        <span className={failed ? 'text-danger-text' : 'text-fg-muted'}>
          {state.phase === 'running' ? (
            <Spinner size={12} />
          ) : (
            <Icon name={ICON[state.phase]} size={12} />
          )}
        </span>
        <span className="min-w-0 flex-1 font-medium text-fg">
          {number}. {title}
        </span>
        <span className="text-fg-muted">
          {state.phase === 'waiting' && waits
            ? WORDS.paused()
            : WORDS[state.phase]()}
        </span>
        {state.openHref && state.phase === 'done' ? (
          <a
            href={state.openHref}
            className="font-medium text-fg underline underline-offset-2"
          >
            {t('features.plans.plan.open')}
          </a>
        ) : null}
      </span>
      {failed && state.message ? (
        <span className="text-danger-text" role="alert">
          {state.message}
        </span>
      ) : null}
      {state.note && state.phase === 'done' ? (
        <span className="break-all text-fg-muted">{state.note}</span>
      ) : null}
    </li>
  )
}

function PlanNotice({
  phase,
  steps,
  pausedAt,
}: {
  phase: Phase
  steps: PlanStepState[]
  pausedAt: number | null
}) {
  if (phase === 'paused' && pausedAt !== null) {
    return (
      <p className="m-0 text-label text-fg-muted">
        {t('features.plans.plan.pausedAt', { number: pausedAt + 1 })}
      </p>
    )
  }

  if (phase === 'stopped') {
    const failedAt = steps.findIndex((step) => step.phase === 'failed')

    return (
      <p className="m-0 text-label text-fg-muted">
        {failedAt === 0
          ? t('features.plans.plan.failedFirst')
          : failedAt > 0
            ? t('features.plans.plan.failedStop', { number: failedAt + 1 })
            : t('features.plans.plan.stopped')}
      </p>
    )
  }

  return null
}
