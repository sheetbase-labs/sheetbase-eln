import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import { usePageAi } from '#/lib/use-page-ai'
import type { PageAi } from '#/lib/use-page-ai'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  FIX_INSTRUCTION,
  applyStepFix,
  buildFixText,
  parseFailureReply,
  statementOf,
} from '#/lib/pipelines/ai-fix'
import type {
  FailureExplanation,
  RunFailureFacts,
} from '#/lib/pipelines/ai-fix'
import {
  createPipelineDefinitionVersion,
  updatePipelineDefinitionVersionDraft,
} from '#/lib/pipelines/data'
import type { PipelineConfig } from '#/lib/pipelines/config'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

/**
 * On a failed run: AI explains the error and, when a code change would fix it,
 * proposes one corrected step as an Apply / Dismiss card. Apply writes the
 * draft version (or creates the first one). It never publishes, and it is
 * hidden when AI is off or only the built-in model is connected.
 */

type Phase =
  | { name: 'idle' }
  | { name: 'asking' }
  | { name: 'error'; message: string }
  | { name: 'answer'; answer: FailureExplanation }
  | { name: 'applied'; created: boolean }
  | { name: 'dismissed' }

function useApplyFix({
  draft,
  runConfig,
  workspaceId,
  pipelineId,
  client,
  setPhase,
}: {
  draft: PipelineDefinitionVersionWire | undefined
  runConfig: Partial<PipelineConfig>
  workspaceId: string
  pipelineId: string
  client: DataClient
  setPhase: (phase: Phase) => void
}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (fix: NonNullable<FailureExplanation['fix']>) => {
      const next = applyStepFix(draft?.configuration ?? runConfig, fix)

      if (!next.ok) throw new Error(next.reason)

      if (draft) {
        await updatePipelineDefinitionVersionDraft(client, {
          workspaceId,
          versionId: draft.id,
          expectedRevision: Number(draft.revision),
          configuration: pipelineJsonObjectSchema.parse(next.config),
        })

        return false
      }

      await createPipelineDefinitionVersion(client, {
        workspaceId,
        definitionId: pipelineId,
        configuration: pipelineJsonObjectSchema.parse(next.config),
      })

      return true
    },
    onSuccess: (created) => {
      setPhase({ name: 'applied', created })
      toast(
        created
          ? t('data.pipelineRunAiFix.appliedCreate')
          : t('data.pipelineRunAiFix.appliedUpdate'),
      )
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : ''
      setPhase({
        name: 'error',
        message: /revision|stale|conflict/i.test(message)
          ? t('data.pipelineRunAiFix.stale')
          : t('data.pipelineRunAiFix.cantApply', { reason: message }),
      })
    },
  })
}

export function RunAiFix({
  pipelineId,
  errorCode,
  errorMessage,
  logLines,
  failedStep,
  runConfig,
  draft,
  pageAi,
  client = notebookDataClient,
}: {
  pipelineId: string
  errorCode: string | null
  errorMessage: string | null
  /** The run's error-level log lines, oldest first. */
  logLines: string[]
  /** The name of the step the run stopped on, when known. */
  failedStep: string | null
  /** The configuration of the version the run used. */
  runConfig: Partial<PipelineConfig>
  draft: PipelineDefinitionVersionWire | undefined
  pageAi?: PageAi
  client?: DataClient
}) {
  const contextAi = usePageAi()
  const ai = pageAi ?? contextAi
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })

  const apply = useApplyFix({
    draft,
    runConfig,
    workspaceId: ai.workspaceId ?? '',
    pipelineId,
    client,
    setPhase,
  })

  // Off, not ready, or only the built-in model (it can't read code): no card.
  if (!ai.available || !ai.live) return null

  async function ask() {
    setPhase({ name: 'asking' })
    setPhase(
      await explainFailure(ai, {
        errorCode,
        errorMessage,
        logLines,
        failedStep,
        config: runConfig,
      }),
    )
  }

  if (phase.name === 'dismissed') return null
  const fix = phase.name === 'answer' ? phase.answer.fix : null
  const before = fix ? statementOf(runConfig, fix.target) : null

  return (
    <section
      data-testid="run-ai-fix"
      aria-label={t('data.pipelineRunAiFix.heading')}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
    >
      <FixHeading fix={fix} />

      {phase.name === 'idle' || phase.name === 'asking' ? (
        <>
          <p className="m-0 text-label text-fg-muted">
            {t('data.pipelineRunAiFix.intro')}
          </p>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={phase.name === 'asking'}
              onClick={() => void ask()}
            >
              {phase.name === 'asking'
                ? t('data.pipelineRunAiFix.asking')
                : t('data.pipelineRunAiFix.ask')}
            </Button>
          </div>
        </>
      ) : null}

      {phase.name === 'error' ? (
        <>
          <p className="m-0 text-label text-danger-text" role="alert">
            {phase.message}
          </p>
          <div>
            <Button size="sm" onClick={() => void ask()}>
              {t('data.pipelineRunAiFix.tryAgain')}
            </Button>
          </div>
        </>
      ) : null}

      {phase.name === 'answer' ? (
        <FixAnswer
          answer={phase.answer}
          before={before}
          pending={apply.isPending}
          onApply={apply.mutate}
          onDismiss={() => setPhase({ name: 'dismissed' })}
        />
      ) : null}

      {phase.name === 'applied' ? (
        <div className="flex items-center gap-3 text-label text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Icon name="check" size={12} />
            {t('data.pipelineRunAiFix.applied')}
          </span>
          <Link
            to="/pipelines/$pipelineId/steps"
            params={{ pipelineId }}
            className="font-medium text-fg underline underline-offset-2"
          >
            {t('data.pipelineRunAiFix.openDraft')}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

async function explainFailure(
  ai: PageAi,
  facts: RunFailureFacts,
): Promise<Extract<Phase, { name: 'answer' | 'error' }>> {
  try {
    const result = await ai.run({
      task: 'freeform',
      instruction: FIX_INSTRUCTION,
      text: buildFixText(facts),
    })

    if (result.status !== 'ok')
      return {
        name: 'error',
        message: t('data.pipelineRunAiFix.failed', { reason: result.message }),
      }

    const answer = parseFailureReply(result.text, facts.config)

    return answer
      ? { name: 'answer', answer }
      : { name: 'error', message: t('data.pipelineRunAiFix.badReply') }
  } catch (error) {
    return {
      name: 'error',
      message: t('data.pipelineRunAiFix.failed', {
        reason: error instanceof Error ? error.message : '',
      }),
    }
  }
}

function FixHeading({ fix }: Pick<FailureExplanation, 'fix'>) {
  return (
    <header className="flex items-start gap-2">
      <span className="mt-0.5 text-fg-muted">
        <Icon name="spark" size={14} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="m-0 font-sans text-label font-semibold">
          {fix
            ? t('data.pipelineRunAiFix.suggestionIn', {
                step: fix.target,
              })
            : t('data.pipelineRunAiFix.heading')}
        </h3>
      </div>
    </header>
  )
}

function FixAnswer({
  answer,
  before,
  pending,
  onApply,
  onDismiss,
}: {
  answer: FailureExplanation
  before: ReturnType<typeof statementOf>
  pending: boolean
  onApply: (fix: NonNullable<FailureExplanation['fix']>) => void
  onDismiss: () => void
}) {
  const { fix } = answer

  return (
    <>
      <p className="m-0 whitespace-pre-line text-body text-fg">
        {answer.explanation}
      </p>
      {fix && before ? (
        <div className="flex flex-col gap-1.5">
          <CodeBlock
            label={t('data.pipelineRunAiFix.before')}
            code={before.statement}
            tone="before"
          />
          <CodeBlock
            label={t('data.pipelineRunAiFix.after')}
            code={fix.statement}
            tone="after"
          />
        </div>
      ) : (
        <p className="m-0 text-label text-fg-muted">
          {t('data.pipelineRunAiFix.noCodeFix')}
        </p>
      )}
      <p className="m-0 text-label text-fg-faint">
        {t('data.pipelineRunAiFix.generated')}
      </p>
      <div className="flex items-center gap-2">
        {fix ? (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => onApply(fix)}
          >
            {pending
              ? t('data.pipelineRunAiFix.applying')
              : t('data.pipelineRunAiFix.apply')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="quiet"
          disabled={pending}
          onClick={onDismiss}
        >
          {t('data.pipelineRunAiFix.dismiss')}
        </Button>
      </div>
    </>
  )
}

function CodeBlock({
  label,
  code,
  tone,
}: {
  label: string
  code: string
  tone: 'before' | 'after'
}) {
  return (
    <div
      className={
        tone === 'before'
          ? 'rounded-lg bg-danger-wash px-2.5 py-2'
          : 'rounded-lg bg-surface-muted px-2.5 py-2'
      }
    >
      <span className="text-label font-medium text-fg-muted">{label}</span>
      <pre className="m-0 mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-label text-fg">
        {code}
      </pre>
    </div>
  )
}
